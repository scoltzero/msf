#!/bin/zsh
set -euo pipefail

version="${1:?version is required}"
release_tag="${2:?release tag is required}"
expected_commit="${3:?expected commit is required}"
output_dir="${4:?output directory is required}"
sign_identity="${MACOS_SIGNING_IDENTITY:?MACOS_SIGNING_IDENTITY is required}"
notary_profile="${MACOS_NOTARY_PROFILE:?MACOS_NOTARY_PROFILE is required}"

project_root="$(cd "$(dirname "$0")/.." && /bin/pwd)"
repo_root="$(cd "$project_root/../.." && /bin/pwd)"
app="$project_root/DerivedData/Build/Products/Release/MSF.app"
asset_prefix="MSF-$version-macos-universal"
dmg="$output_dir/$asset_prefix.dmg"
zip="$output_dir/$asset_prefix.zip"
tmp="$(/usr/bin/mktemp -d)"

cleanup() {
  /bin/rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

fail() {
  echo "package-release-signed: $*" >&2
  exit 1
}

[[ "$release_tag" == "v$version" ]] || fail "$release_tag does not match version $version"
[[ -d "$app" ]] || fail "Release app not found: $app"

MSF_EXPECTED_VERSION="$version" \
MSF_EXPECTED_COMMIT="$expected_commit" \
MSF_EXPECTED_TAG="$release_tag" \
MSF_REQUIRE_DEVELOPER_ID=1 \
  "$project_root/Scripts/verify-app.sh" Release

/bin/mkdir -p "$output_dir"
/bin/rm -f "$dmg" "$dmg.sha256" "$zip" "$zip.sha256"

notary_zip="$tmp/MSF-notary.zip"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$notary_zip"
/usr/bin/xcrun notarytool submit "$notary_zip" --keychain-profile "$notary_profile" --wait
/usr/bin/xcrun stapler staple "$app"
/usr/bin/xcrun stapler validate "$app"
/usr/sbin/spctl --assess --type execute --verbose=2 "$app"

/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"

dmg_root="$tmp/dmg-root"
/bin/mkdir -p "$dmg_root"
/usr/bin/ditto "$app" "$dmg_root/MSF.app"
/bin/ln -s /Applications "$dmg_root/Applications"
/bin/cp "$repo_root/LICENSE" "$dmg_root/LICENSE.txt"
/bin/cp "$repo_root/THIRD_PARTY_NOTICES.md" "$dmg_root/THIRD_PARTY_NOTICES.md"
/usr/bin/hdiutil create \
  -volname "MSF" \
  -srcfolder "$dmg_root" \
  -ov \
  -format UDZO \
  "$dmg"
/usr/bin/codesign --force --timestamp --sign "$sign_identity" "$dmg"
/usr/bin/xcrun notarytool submit "$dmg" --keychain-profile "$notary_profile" --wait
/usr/bin/xcrun stapler staple "$dmg"
/usr/bin/xcrun stapler validate "$dmg"
/usr/sbin/spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"

zip_check="$tmp/zip-check"
/bin/mkdir -p "$zip_check"
/usr/bin/ditto -x -k "$zip" "$zip_check"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$zip_check/MSF.app"
/usr/bin/xcrun stapler validate "$zip_check/MSF.app"

(
  cd "$output_dir"
  /usr/bin/shasum -a 256 "$(basename "$dmg")" > "$(basename "$dmg").sha256"
  /usr/bin/shasum -a 256 "$(basename "$zip")" > "$(basename "$zip").sha256"
)

echo "packaged-signed:$dmg"
echo "packaged-signed:$zip"
