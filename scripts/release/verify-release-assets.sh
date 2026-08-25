#!/bin/sh
set -eu

VERSION="${1:?version is required}"
COMMIT="${2:?commit is required}"
TAG="${3:?tag is required}"
DIST="${4:-dist}"
ASSET="$DIST/msf-linux-amd64.tar.gz"

fail() {
  echo "release verification failed: $*" >&2
  exit 1
}

[ -f "$ASSET" ] || fail "missing asset $ASSET"
[ -f "$ASSET.sha256" ] || fail "missing checksum $ASSET.sha256"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c "$ASSET.sha256" >/dev/null || fail "checksum mismatch for $ASSET"
else
  shasum -a 256 -c "$ASSET.sha256" >/dev/null || fail "checksum mismatch for $ASSET"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM
tar -xzf "$ASSET" -C "$tmp"
binary="$tmp/msf-$VERSION-linux-amd64/msf"
[ -x "$binary" ] || fail "missing executable $binary"

python3 - "$binary" <<'PY' || fail "$binary architecture mismatch"
import struct
import sys

with open(sys.argv[1], "rb") as handle:
    header = handle.read(20)
if len(header) < 20 or header[:4] != b"\x7fELF":
    raise SystemExit("not an ELF binary")
byte_order = "<" if header[5] == 1 else ">" if header[5] == 2 else None
if byte_order is None or struct.unpack(byte_order + "H", header[18:20])[0] != 62:
    raise SystemExit("not an amd64 ELF binary")
PY

metadata="$(go version -m "$binary" 2>&1)" || fail "cannot inspect $binary"
printf '%s\n' "$metadata" | grep -F "vcs.revision=$COMMIT" >/dev/null || fail "$binary revision is not $COMMIT"
printf '%s\n' "$metadata" | grep -F 'vcs.modified=false' >/dev/null || fail "$binary has vcs.modified=true or missing vcs metadata"
provenance="$("$binary" version --json 2>&1)" || fail "cannot execute $binary to inspect embedded provenance"
python3 -c '
import json, sys
payload = json.loads(sys.argv[1])
expected = {"version": sys.argv[2], "commit": sys.argv[3], "tag": sys.argv[4], "tag_commit": sys.argv[3], "source_commit": sys.argv[3], "dirty": "false"}
bad = {key: (payload.get(key), value) for key, value in expected.items() if payload.get(key) != value}
if bad:
    raise SystemExit(bad)
' "$provenance" "$VERSION" "$COMMIT" "$TAG" || fail "$binary embedded provenance mismatch"

python3 - "$binary" <<'PY' || fail "embedded frontend or legacy MosDNS template validation failed"
import sys

binary = open(sys.argv[1], "rb").read()
if "正在保存初始化配置".encode() not in binary:
    raise SystemExit("embedded frontend is missing the MosDNS-before-initialize flow")
if b"type: nft_add" in binary:
    raise SystemExit("legacy nft_add MosDNS template is still embedded")
PY

echo "release asset verified for $TAG ($COMMIT)"
