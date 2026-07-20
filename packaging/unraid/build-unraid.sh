#!/bin/sh
set -eu

APP_NAME="${APP_NAME:-msf}"
VERSION="${VERSION:-0.1.0-dev}"
UNRAID_VERSION="${UNRAID_VERSION:-$VERSION}"
GITHUB_REPO="${GITHUB_REPO:-scoltzero/msf}"
RELEASE_TAG="${RELEASE_TAG:-v$VERSION}"
DIST="${DIST:-dist}"
ARCH="x86_64"
BUILD="1"

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
PKG_NAME="${APP_NAME}-${UNRAID_VERSION}-${ARCH}-${BUILD}"
PKG_ROOT="${ROOT_DIR}/${DIST}/unraid/pkgroot"
OUT_DIR="${ROOT_DIR}/${DIST}/unraid"
TXZ="${OUT_DIR}/${PKG_NAME}.txz"
PLG="${OUT_DIR}/${APP_NAME}.plg"
ROOT_PLG="${ROOT_DIR}/${APP_NAME}.plg"
UPDATE_ROOT_PLG="${UPDATE_ROOT_PLG:-false}"
BIN="${ROOT_DIR}/${DIST}/${APP_NAME}-linux-amd64"

if [ ! -x "$BIN" ]; then
  echo "missing Linux amd64 binary: $BIN" >&2
  echo "run: make package GOOS=linux GOARCH=amd64" >&2
  exit 1
fi

rm -rf "$PKG_ROOT"
mkdir -p "$PKG_ROOT" "$OUT_DIR"
cp -R "${ROOT_DIR}/packaging/unraid/root/." "$PKG_ROOT/"
mkdir -p "$PKG_ROOT/usr/local/emhttp/plugins/${APP_NAME}/bin" "$PKG_ROOT/install"
cp "$BIN" "$PKG_ROOT/usr/local/emhttp/plugins/${APP_NAME}/bin/${APP_NAME}"

chmod 0755 "$PKG_ROOT/usr/local/emhttp/plugins/${APP_NAME}/bin/${APP_NAME}"
chmod 0755 "$PKG_ROOT/etc/rc.d/rc.${APP_NAME}"
chmod 0755 "$PKG_ROOT/usr/local/bin/msf"
chmod 0755 "$PKG_ROOT/usr/local/emhttp/plugins/${APP_NAME}/event/started"
chmod 0755 "$PKG_ROOT/usr/local/emhttp/plugins/${APP_NAME}/event/stopping_svcs"

cat > "$PKG_ROOT/install/slack-desc" <<EOF
${APP_NAME}: ${APP_NAME}
${APP_NAME}:
${APP_NAME}: A free and open-source, user-facing all-in-one
${APP_NAME}: management tool for DNS and proxy (mihomo /
${APP_NAME}: sing-box, in development).
${APP_NAME}: This package installs the Unraid WebGUI page, rc script,
${APP_NAME}: and msf Linux amd64 binary. Persistent data is stored under
${APP_NAME}: /mnt/user/appdata/msf by default.
${APP_NAME}:
${APP_NAME}: Project: https://github.com/${GITHUB_REPO}
${APP_NAME}:
${APP_NAME}:
${APP_NAME}:
EOF

rm -f "$TXZ"
if tar --version 2>/dev/null | grep -qi "gnu tar"; then
  tar --owner=0 --group=0 --numeric-owner -cJf "$TXZ" -C "$PKG_ROOT" .
else
  tar --uid 0 --gid 0 --uname root --gname root -cJf "$TXZ" -C "$PKG_ROOT" .
fi

if command -v sha256sum >/dev/null 2>&1; then
  PKG_SHA256="$(sha256sum "$TXZ" | awk '{print $1}')"
else
  PKG_SHA256="$(shasum -a 256 "$TXZ" | awk '{print $1}')"
fi

sed \
  -e "s|__PLUGIN_VERSION__|${UNRAID_VERSION}|g" \
  -e "s|__GITHUB_REPO__|${GITHUB_REPO}|g" \
  -e "s|__RELEASE_TAG__|${RELEASE_TAG}|g" \
  -e "s|__PACKAGE_SHA256__|${PKG_SHA256}|g" \
  "${ROOT_DIR}/packaging/unraid/msf.plg.in" > "$PLG"
if [ "$UPDATE_ROOT_PLG" = "true" ]; then
  cp "$PLG" "$ROOT_PLG"
fi

cp "${ROOT_DIR}/packaging/unraid/README.md" "${OUT_DIR}/README.md"

echo "Unraid package: $TXZ"
echo "Unraid plugin:  $PLG"
if [ "$UPDATE_ROOT_PLG" = "true" ]; then
  echo "Repo plugin:    $ROOT_PLG"
fi
echo "SHA256:         $PKG_SHA256"
