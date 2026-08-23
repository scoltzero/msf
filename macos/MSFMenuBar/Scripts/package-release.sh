#!/bin/zsh
set -euo pipefail

version="${1:?version is required}"
release_tag="${2:?release tag is required}"
expected_commit="${3:?expected commit is required}"
output_dir="${4:?output directory is required}"

project_root="$(cd "$(dirname "$0")/.." && /bin/pwd)"
repo_root="$(cd "$project_root/../.." && /bin/pwd)"
app="$project_root/DerivedData/Build/Products/Release/MSF.app"
asset_prefix="MSF-$version-macos-universal-unsigned"
dmg="$output_dir/$asset_prefix.dmg"
zip="$output_dir/$asset_prefix.zip"
tmp="$(/usr/bin/mktemp -d)"
mounted=0
mount_point="$tmp/dmg-mount"

cleanup() {
  if [[ "$mounted" == "1" ]]; then
    /usr/bin/hdiutil detach "$mount_point" -quiet >/dev/null 2>&1 || true
  fi
  /bin/rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

fail() {
  echo "package-release: $*" >&2
  exit 1
}

verify_app() {
  local app_path="$1"
  MSF_APP_PATH="$app_path" \
  MSF_EXPECTED_VERSION="$version" \
  MSF_EXPECTED_COMMIT="$expected_commit" \
  MSF_EXPECTED_TAG="$release_tag" \
  MSF_REQUIRE_LEGACY_ONLY=1 \
    "$project_root/Scripts/verify-app.sh" Release
}

[[ "$release_tag" == "v$version" ]] || fail "$release_tag does not match version $version"
[[ -d "$app" ]] || fail "Release app not found: $app"

verify_app "$app"

signature_info="$(/usr/bin/codesign -dvvv "$app" 2>&1 || true)"
[[ "$signature_info" != *"Authority=Developer ID Application:"* ]] \
  || fail "unsigned beta unexpectedly contains a Developer ID signature"

/bin/mkdir -p "$output_dir"
/bin/rm -f "$dmg" "$dmg.sha256" "$zip" "$zip.sha256"

/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"

dmg_root="$tmp/dmg-root"
/bin/mkdir -p "$dmg_root"
/usr/bin/ditto "$app" "$dmg_root/MSF.app"
/bin/ln -s /Applications "$dmg_root/Applications"
/bin/cp "$repo_root/docs/install/macos.md" "$dmg_root/安装说明.md"
/bin/cp "$repo_root/LICENSE" "$dmg_root/LICENSE.txt"
/bin/cp "$repo_root/THIRD_PARTY_NOTICES.md" "$dmg_root/THIRD_PARTY_NOTICES.md"
/usr/bin/hdiutil create \
  -volname "MSF Unsigned Beta" \
  -srcfolder "$dmg_root" \
  -ov \
  -format UDZO \
  "$dmg"
/usr/bin/hdiutil verify "$dmg" >/dev/null

zip_check="$tmp/zip-check"
/bin/mkdir -p "$zip_check"
/usr/bin/ditto -x -k "$zip" "$zip_check"
verify_app "$zip_check/MSF.app"

/bin/mkdir -p "$mount_point"
/usr/bin/hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount_point" -quiet
mounted=1
verify_app "$mount_point/MSF.app"
/usr/bin/hdiutil detach "$mount_point" -quiet
mounted=0

(
  cd "$output_dir"
  /usr/bin/shasum -a 256 "$(basename "$dmg")" > "$(basename "$dmg").sha256"
  /usr/bin/shasum -a 256 "$(basename "$zip")" > "$(basename "$zip").sha256"
)

echo "packaged-unsigned:$dmg"
echo "packaged-unsigned:$zip"
