#!/bin/sh
set -eu

VERSION="${1:?version is required}"
COMMIT="${2:?commit is required}"
TAG="${3:?tag is required}"
DIST="${4:-dist}"

fail() {
  echo "release verification failed: $*" >&2
  exit 1
}

verify_checksum() {
  file="$1"
  checksum_file="${file}.sha256"
  [ -f "$file" ] || fail "missing asset $file"
  [ -f "$checksum_file" ] || fail "missing checksum $checksum_file"
  expected="$(awk 'NR == 1 { print $1 }' "$checksum_file")"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{ print $1 }')"
  else
    actual="$(shasum -a 256 "$file" | awk '{ print $1 }')"
  fi
  [ "$actual" = "$expected" ] || fail "checksum mismatch for $file"
}

verify_binary() {
  binary="$1"
  expected_arch="$2"
  [ -x "$binary" ] || fail "missing executable $binary"
  python3 - "$binary" "$expected_arch" <<'PY' || fail "$binary architecture mismatch"
import struct
import sys

path, expected = sys.argv[1:]
with open(path, "rb") as handle:
    header = handle.read(20)
if len(header) < 20 or header[:4] != b"\x7fELF":
    raise SystemExit(f"{path} is not an ELF binary")
byte_order = "<" if header[5] == 1 else ">" if header[5] == 2 else None
if byte_order is None:
    raise SystemExit(f"{path} has an unknown ELF byte order")
machine = struct.unpack(byte_order + "H", header[18:20])[0]
machines = {"amd64": 62, "arm64": 183}
if machine != machines[expected]:
    raise SystemExit(f"{path} e_machine={machine}, want {machines[expected]} ({expected})")
PY
  metadata="$(go version -m "$binary" 2>&1)" || fail "cannot inspect $binary"
  printf '%s\n' "$metadata" | grep -F "vcs.revision=$COMMIT" >/dev/null || fail "$binary revision is not $COMMIT"
  printf '%s\n' "$metadata" | grep -F "vcs.modified=false" >/dev/null || fail "$binary has vcs.modified=true or missing vcs metadata"
  provenance="$("$binary" version --json 2>&1)" || fail "cannot execute $binary to inspect embedded provenance (configure binfmt/QEMU for cross-architecture assets)"
  python3 -c '
import json, sys
payload = json.loads(sys.argv[1])
expected = {
    "version": sys.argv[2],
    "commit": sys.argv[3],
    "tag": sys.argv[4],
    "tag_commit": sys.argv[3],
    "source_commit": sys.argv[3],
    "dirty": "false",
}
for key, value in expected.items():
    if payload.get(key) != value:
        raise SystemExit(f"{key}={payload.get(key)!r}, want {value!r}")
' "$provenance" "$VERSION" "$COMMIT" "$TAG" || fail "$binary embedded provenance mismatch"
}

for asset in \
  "$DIST/msf-linux-amd64.tar.gz" \
  "$DIST/msm-free-linux-amd64.tar.gz" \
  "$DIST/msf-linux-arm64.tar.gz" \
  "$DIST/msm-free-linux-arm64.tar.gz" \
  "$DIST/unraid/msf-$VERSION-x86_64-1.txz" \
  "$DIST/unraid/msf.plg" \
  "$DIST/msf_${VERSION}_x86.fpk" \
  "$DIST/msf_${VERSION}_arm.fpk"; do
  verify_checksum "$asset"
done

cmp "$DIST/msf-linux-amd64.tar.gz" "$DIST/msm-free-linux-amd64.tar.gz" >/dev/null || fail "amd64 compatibility asset differs"
cmp "$DIST/msf-linux-arm64.tar.gz" "$DIST/msm-free-linux-arm64.tar.gz" >/dev/null || fail "arm64 compatibility asset differs"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

mkdir -p "$tmp/linux-amd64" "$tmp/linux-arm64" "$tmp/unraid" "$tmp/fnos-x86" "$tmp/fnos-arm" "$tmp/fnos-x86-app" "$tmp/fnos-arm-app"
tar -xzf "$DIST/msf-linux-amd64.tar.gz" -C "$tmp/linux-amd64"
tar -xzf "$DIST/msf-linux-arm64.tar.gz" -C "$tmp/linux-arm64"
tar -xJf "$DIST/unraid/msf-$VERSION-x86_64-1.txz" -C "$tmp/unraid"
tar -xzf "$DIST/msf_${VERSION}_x86.fpk" -C "$tmp/fnos-x86"
tar -xzf "$DIST/msf_${VERSION}_arm.fpk" -C "$tmp/fnos-arm"
tar -xzf "$tmp/fnos-x86/app.tgz" -C "$tmp/fnos-x86-app"
tar -xzf "$tmp/fnos-arm/app.tgz" -C "$tmp/fnos-arm-app"

verify_binary "$tmp/linux-amd64/msf-$VERSION-linux-amd64/msf" amd64
verify_binary "$tmp/linux-arm64/msf-$VERSION-linux-arm64/msf" arm64
verify_binary "$tmp/unraid/usr/local/emhttp/plugins/msf/bin/msf" amd64
verify_binary "$tmp/fnos-x86-app/msf" amd64
verify_binary "$tmp/fnos-arm-app/msf" arm64

grep -Eq '^appname[[:space:]]*=[[:space:]]*msf$' "$tmp/fnos-x86/manifest" || fail "fnOS x86 manifest appname mismatch"
grep -Eq "^version[[:space:]]*=[[:space:]]*$VERSION$" "$tmp/fnos-x86/manifest" || fail "fnOS x86 manifest version mismatch"
grep -Eq '^platform[[:space:]]*=[[:space:]]*x86$' "$tmp/fnos-x86/manifest" || fail "fnOS x86 manifest platform mismatch"
grep -Eq "^version[[:space:]]*=[[:space:]]*$VERSION$" "$tmp/fnos-arm/manifest" || fail "fnOS arm manifest version mismatch"
grep -Eq '^platform[[:space:]]*=[[:space:]]*arm$' "$tmp/fnos-arm/manifest" || fail "fnOS arm manifest platform mismatch"

echo "release assets verified for $TAG ($COMMIT)"
