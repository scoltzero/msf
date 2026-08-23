#!/bin/bash
set -euo pipefail

# ── defaults ──────────────────────────────────────────────
APP_NAME="${APP_NAME:-msf}"
VERSION="${VERSION:-0.0.0}"
DIST="${DIST:-dist}"
ARCH="${ARCH:-amd64}"
case "${ARCH}" in
  amd64) PLATFORM="x86" ;;
  arm64) PLATFORM="arm" ;;
  *) echo "ERROR: unsupported ARCH=${ARCH} (use amd64 or arm64)" >&2; exit 1 ;;
esac
SRC_BIN="${DIST}/${APP_NAME}-linux-${ARCH}"

# ── preflight ─────────────────────────────────────────────
if [ ! -x "${SRC_BIN}" ]; then
  echo "ERROR: binary not found: ${SRC_BIN}" >&2
  echo "Run 'make package GOARCH=${ARCH}' first to produce the linux/${ARCH} binary." >&2
  exit 1
fi

# ── stage directory ───────────────────────────────────────
STAGE="$(mktemp -d)"
ICON_TMP=""
trap 'rm -rf "${STAGE}" ${ICON_TMP:+"${ICON_TMP}"}' EXIT

mkdir -p "${STAGE}"/{config,cmd,wizard,app/ui,systemd}

# ── checksum ──────────────────────────────────────────────
if command -v sha256sum >/dev/null 2>&1; then
  FULL_SHA256="$(sha256sum "${SRC_BIN}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  FULL_SHA256="$(shasum -a 256 "${SRC_BIN}" | awk '{print $1}')"
else
  FULL_SHA256="$(openssl dgst -sha256 "${SRC_BIN}" | awk '{print $NF}')"
fi

# fnOS 官方 toolchain 期望 md5 前 16 位
if command -v md5sum >/dev/null 2>&1; then
  CHECKSUM="$(md5sum "${SRC_BIN}" | awk '{print $1}' | cut -c1-16)"
elif command -v md5 >/dev/null 2>&1; then
  CHECKSUM="$(md5 "${SRC_BIN}" | awk '{print $NF}' | cut -c1-16)"
else
  CHECKSUM="${FULL_SHA256:0:16}"
fi

# ── manifest ──────────────────────────────────────────────
sed -e "s/__VERSION__/${VERSION}/g" \
    -e "s/__CHECKSUM__/${CHECKSUM}/g" \
    packaging/fnos/manifest.in > "${STAGE}/manifest"

# override platform from manifest.in (default x86) for target ARCH
if grep -q "^platform" "${STAGE}/manifest"; then
  sed -i.bak -e "s/^platform.*/platform        = ${PLATFORM}/" "${STAGE}/manifest" && rm -f "${STAGE}/manifest.bak"
else
  echo "platform        = ${PLATFORM}" >> "${STAGE}/manifest"
fi

# ── copy assets ───────────────────────────────────────────
cp packaging/fnos/msf.sc       "${STAGE}/msf.sc"
cp packaging/fnos/config/privilege  "${STAGE}/config/privilege"
cp packaging/fnos/config/resource   "${STAGE}/config/resource"

for f in packaging/fnos/cmd/*; do
  [ -f "$f" ] || continue
  bn="$(basename "$f")"
  cp "$f" "${STAGE}/cmd/${bn}"
  chmod 755 "${STAGE}/cmd/${bn}"
done

for f in packaging/fnos/wizard/*; do
  [ -f "$f" ] || continue
  bn="$(basename "$f")"
  cp "$f" "${STAGE}/wizard/${bn}"
  chmod 755 "${STAGE}/wizard/${bn}"
done

cp packaging/fnos/systemd/msf.service "${STAGE}/systemd/msf.service"

cp "${SRC_BIN}" "${STAGE}/app/msf"
chmod 755 "${STAGE}/app/msf"

# ── icons ─────────────────────────────────────────────────
ICON_SRC=""
# 1. try PNG sources first
for cand in \
  logo.png \
  logo-white.png \
  assets/logo.png \
  internal/server/web/dist/logo/*.png \
  internal/server/web/dist/dashboard_preview.png \
  internal/server/web/dist/images/*.png; do
  # shellcheck disable=SC2086
  for f in ${cand}; do
    if [ -f "$f" ]; then ICON_SRC="$f"; break 2; fi
  done
done

# 2. if no PNG, try SVG with qlmanage
if [ -z "${ICON_SRC}" ]; then
  for cand in internal/server/web/dist/logo/*.svg; do
    # shellcheck disable=SC2086
    for f in ${cand}; do
      if [ -f "$f" ] && command -v qlmanage >/dev/null 2>&1; then
        ICON_TMP="$(mktemp -d)"
        qlmanage -t -s 512 -o "${ICON_TMP}" "$f" >/dev/null 2>&1 || true
        SVG_OUTNAME="$(basename "$f").png"
        if [ -f "${ICON_TMP}/${SVG_OUTNAME}" ]; then
          ICON_SRC="${ICON_TMP}/${SVG_OUTNAME}"
          break 2
        fi
      fi
    done
  done
fi

# 3. resize with sips if we have a PNG source
if [ -n "${ICON_SRC}" ] && command -v sips >/dev/null 2>&1; then
  sips -z 64  64  "${ICON_SRC}" --out "${STAGE}/ICON.PNG"      >/dev/null 2>&1 || true
  sips -z 256 256 "${ICON_SRC}" --out "${STAGE}/ICON_256.PNG"  >/dev/null 2>&1 || true
fi

# 4. fallback to minimal placeholder PNGs
if [ ! -s "${STAGE}/ICON.PNG" ]; then
  echo "WARN: no source PNG/SVG found or tools unavailable; using minimal placeholder ICON.PNG" >&2
  # minimal 64×64 white PNG (119 bytes)
  printf '\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x40\0\0\0\x40\x08\x02\0\0\0\x25\x0b\xe6\x89\0\0\0\x04gAMA\0\0\xb1\x8f\x0b\xfca\x05\0\0\0\x0eIDATx\x9c\xed\xc1\x01\x01\0\0\0\x82 \xff\xafnH@\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0IEND\xaeB`\x82' > "${STAGE}/ICON.PNG"
fi

if [ ! -s "${STAGE}/ICON_256.PNG" ]; then
  echo "WARN: no source PNG/SVG found or tools unavailable; using minimal placeholder ICON_256.PNG" >&2
  # minimal 256×256 white PNG (119 bytes)
  printf '\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\x01\0\0\0\x01\0\x08\x02\0\0\0\x90wS\xde\0\0\0\x04gAMA\0\0\xb1\x8f\x0b\xfca\x05\0\0\0\x0eIDATx\x9c\xed\xc1\x01\x01\0\0\0\x82 \xff\xafnH@\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0IEND\xaeB`\x82' > "${STAGE}/ICON_256.PNG"
fi

# ── app/ui config + images ───────────────────────────────
cat > "${STAGE}/app/ui/config" <<'UICONF'
{
    ".url": {
        "msf.Application": {
            "title": "MSF Free",
            "desc": "MSF Free Web UI",
            "icon": "images/{0}.png",
            "type": "url",
            "port": "7777",
            "protocol": "http",
            "url": "/",
            "allUsers": true
        }
    }
}
UICONF

mkdir -p "${STAGE}/app/ui/images"
cp "${STAGE}/ICON_256.PNG" "${STAGE}/app/ui/images/256.png"
cp "${STAGE}/ICON.PNG"     "${STAGE}/app/ui/images/64.png"
sips -z 32 32  "${STAGE}/ICON_256.PNG" --out "${STAGE}/app/ui/images/32.png" >/dev/null 2>&1 || true
sips -z 48 48  "${STAGE}/ICON_256.PNG" --out "${STAGE}/app/ui/images/48.png" >/dev/null 2>&1 || true
[ -s "${STAGE}/app/ui/images/32.png" ] || cp "${STAGE}/ICON.PNG" "${STAGE}/app/ui/images/32.png"
[ -s "${STAGE}/app/ui/images/48.png" ] || cp "${STAGE}/ICON.PNG" "${STAGE}/app/ui/images/48.png"

# ── pack ──────────────────────────────────────────────────
OUT="${DIST}/${APP_NAME}_${VERSION}_${PLATFORM}.fpk"
mkdir -p "${DIST}"

# try fnpack
FNPACK=""
if command -v fnpack >/dev/null 2>&1; then
  FNPACK="fnpack"
else
  OS="linux"
  ARCH="amd64"
  case "$(uname -s)" in
    Darwin) OS="darwin" ;;
    Linux)  OS="linux" ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) ARCH="arm64" ;;
    x86_64|amd64)  ARCH="amd64" ;;
  esac

  FNPACK_URL="https://static2.fnnas.com/fnpack/fnpack-1.2.1-${OS}-${ARCH}"
  FNPACK_CACHE="${HOME}/.cache/fnpack/fnpack-1.2.1-${OS}-${ARCH}"

  if [ ! -x "${FNPACK_CACHE}" ]; then
    echo "INFO: downloading fnpack from ${FNPACK_URL} ..." >&2
    mkdir -p "$(dirname "${FNPACK_CACHE}")"
    if curl -fSL --connect-timeout 15 --max-time 120 -o "${FNPACK_CACHE}.tmp" "${FNPACK_URL}" 2>/dev/null; then
      chmod 755 "${FNPACK_CACHE}.tmp"
      mv "${FNPACK_CACHE}.tmp" "${FNPACK_CACHE}"
    else
      echo "ERROR: failed to download fnpack; refusing to create an invalid .fpk fallback" >&2
      rm -f "${FNPACK_CACHE}.tmp"
    fi
  fi

  if [ -x "${FNPACK_CACHE}" ]; then
    FNPACK="${FNPACK_CACHE}"
  fi
fi

if [ -z "${FNPACK}" ]; then
  echo "ERROR: fnpack is required for release-quality fnOS assets" >&2
  exit 1
fi

echo "INFO: building .fpk with ${FNPACK} ..." >&2
( cd "${STAGE}" && "${FNPACK}" build )
FPK_FILE="$(find "${STAGE}" -maxdepth 1 -name '*.fpk' -print -quit 2>/dev/null || true)"
if [ -z "${FPK_FILE}" ] || [ ! -f "${FPK_FILE}" ]; then
  echo "ERROR: fnpack completed without producing a .fpk" >&2
  exit 1
fi
mv "${FPK_FILE}" "${OUT}"

echo "DONE: ${OUT}" >&2
echo "${OUT}"
