#!/bin/zsh
set -euo pipefail

configuration="${1:-Debug}"
project_root="$(cd "$(dirname "$0")/.." && /bin/pwd)"
app="${MSF_APP_PATH:-$project_root/DerivedData/Build/Products/$configuration/MSF.app}"
main_binary="$app/Contents/MacOS/MSF"
helper_name="io.github.scoltzero.msf.daemon"
helper="$app/Contents/Library/HelperTools/$helper_name"
service_plist="$app/Contents/Library/LaunchDaemons/$helper_name.plist"
legacy_plist="$app/Contents/Resources/$helper_name.legacy.plist"
installer="$app/Contents/Resources/msf-daemon-installer.sh"
app_icon="$app/Contents/Resources/AppIcon.icns"
asset_catalog="$app/Contents/Resources/Assets.car"
expected_version="${MSF_EXPECTED_VERSION:-}"
expected_commit="${MSF_EXPECTED_COMMIT:-}"
expected_tag="${MSF_EXPECTED_TAG:-}"
require_developer_id="${MSF_REQUIRE_DEVELOPER_ID:-0}"
require_legacy_only="${MSF_REQUIRE_LEGACY_ONLY:-0}"

fail() {
  echo "verify-app: $*" >&2
  exit 1
}

[[ -d "$app" ]] || fail "app bundle not found: $app"
[[ -x "$main_binary" ]] || fail "main executable missing: $main_binary"
[[ -x "$helper" ]] || fail "embedded daemon missing: $helper"
[[ -f "$service_plist" ]] || fail "SMAppService plist missing: $service_plist"
[[ -f "$legacy_plist" ]] || fail "legacy LaunchDaemon plist missing: $legacy_plist"
[[ -x "$installer" ]] || fail "legacy installer missing or not executable: $installer"
[[ -s "$app_icon" ]] || fail "application icon missing or empty: $app_icon"
[[ -s "$asset_catalog" ]] || fail "compiled asset catalog missing or empty: $asset_catalog"

for binary in "$main_binary" "$helper"; do
  archs="$(/usr/bin/lipo -archs "$binary")"
  [[ " $archs " == *" arm64 "* ]] || fail "$(basename "$binary") does not contain arm64: $archs"
  [[ " $archs " == *" x86_64 "* ]] || fail "$(basename "$binary") does not contain x86_64: $archs"
done

/usr/bin/plutil -lint "$app/Contents/Info.plist" "$service_plist" "$legacy_plist" >/dev/null
[[ "$(/usr/libexec/PlistBuddy -c 'Print :LSUIElement' "$app/Contents/Info.plist")" == "true" ]] \
  || fail "LSUIElement must be true for a menu bar-only app"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$app/Contents/Info.plist")" == "15.0" ]] \
  || fail "minimum macOS version must remain 15.0"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" == "io.github.scoltzero.msf.menubar" ]] \
  || fail "unexpected app bundle identifier"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconName' "$app/Contents/Info.plist")" == "AppIcon" ]] \
  || fail "CFBundleIconName must reference AppIcon"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :BundleProgram' "$service_plist")" == "Contents/Library/HelperTools/$helper_name" ]] \
  || fail "SMAppService BundleProgram does not point at the embedded daemon"

icon_width="$(/usr/bin/sips -g pixelWidth "$app_icon" 2>/dev/null | /usr/bin/awk '/pixelWidth/ { print $2 }')"
[[ "$icon_width" == <-> ]] || fail "cannot read AppIcon.icns dimensions"
(( icon_width >= 256 )) || fail "AppIcon.icns is too small: ${icon_width}px"

bundle_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")"
bundle_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$app/Contents/Info.plist")"
[[ -n "$bundle_build" ]] || fail "CFBundleVersion must not be empty"
if [[ -n "$expected_version" ]]; then
  [[ "$bundle_version" == "$expected_version" ]] \
    || fail "bundle version $bundle_version does not match $expected_version"
fi

/bin/zsh -n "$project_root/Scripts/embed-daemon.sh"
/bin/zsh -n "$project_root/Resources/msf-daemon-installer.sh"
/bin/zsh -n "$installer"
/usr/bin/codesign --verify --strict "$helper"

if [[ "$require_legacy_only" == "1" ]]; then
  if /usr/bin/otool -L "$main_binary" | /usr/bin/grep -q '/ServiceManagement.framework/'; then
    fail "unsigned beta must not link ServiceManagement or use SMAppService"
  fi
fi

provenance="$("$helper" version --json)" || fail "cannot read embedded daemon provenance"
/usr/bin/python3 - "$provenance" "$expected_version" "$expected_commit" "$expected_tag" <<'PY' \
  || fail "embedded daemon provenance mismatch"
import json
import sys

payload = json.loads(sys.argv[1])
expected = {
    "version": sys.argv[2],
    "commit": sys.argv[3],
    "tag": sys.argv[4],
}
if sys.argv[3]:
    expected["source_commit"] = sys.argv[3]
if sys.argv[3] and sys.argv[4]:
    expected["tag_commit"] = sys.argv[3]
    expected["dirty"] = "false"
for key, value in expected.items():
    if value and payload.get(key) != value:
        raise SystemExit(f"{key}={payload.get(key)!r}, want {value!r}")
PY

if [[ "$require_developer_id" == "1" ]]; then
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$app"
  app_signature="$(/usr/bin/codesign -dvvv "$app" 2>&1)"
  helper_signature="$(/usr/bin/codesign -dvvv "$helper" 2>&1)"
  [[ "$app_signature" == *"Authority=Developer ID Application:"* ]] \
    || fail "app is not signed with Developer ID Application"
  [[ "$helper_signature" == *"Authority=Developer ID Application:"* ]] \
    || fail "daemon is not signed with Developer ID Application"
  [[ "$app_signature" == *"flags="*"runtime"* ]] \
    || fail "app Hardened Runtime flag is missing"
  [[ "$helper_signature" == *"flags="*"runtime"* ]] \
    || fail "daemon Hardened Runtime flag is missing"
fi

echo "verified:$configuration:$app"
echo "bundle-version:$bundle_version"
echo "bundle-build:$bundle_build"
echo "app-icon:$app_icon"
echo "main-archs:$(/usr/bin/lipo -archs "$main_binary")"
echo "daemon-archs:$(/usr/bin/lipo -archs "$helper")"
