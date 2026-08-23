#!/bin/zsh
set -euo pipefail

project_root="$(cd "$SRCROOT/../.." && /bin/pwd)"
work_root="$DERIVED_FILE_DIR/MSFDaemon"
app_contents="$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH"
helper_name="io.github.scoltzero.msf.daemon"
helper_dir="$app_contents/Library/HelperTools"
launchd_dir="$app_contents/Library/LaunchDaemons"
resource_dir="$app_contents/Resources"

version="${MSF_VERSION:-${MARKETING_VERSION:-0.6.0}}"
build_commit="${MSF_BUILD_COMMIT:-$(cd "$project_root" && git rev-parse HEAD 2>/dev/null || printf unknown)}"
build_tag="${MSF_BUILD_TAG:-dev}"
build_tag_commit="${MSF_BUILD_TAG_COMMIT:-unknown}"
build_source_commit="${MSF_BUILD_SOURCE_COMMIT:-$build_commit}"
build_dirty="${MSF_BUILD_DIRTY:-$(cd "$project_root" && test -z "$(git status --porcelain 2>/dev/null)" && printf false || printf true)}"
build_time="${MSF_BUILD_TIME:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
ldflags="-s -w -X main.version=$version -X main.buildCommit=$build_commit -X main.buildTag=$build_tag -X main.buildTagCommit=$build_tag_commit -X main.buildSourceCommit=$build_source_commit -X main.buildDirty=$build_dirty -X main.buildTime=$build_time"

/bin/mkdir -p "$work_root" "$helper_dir" "$launchd_dir" "$resource_dir"

build_daemon() {
  local arch="$1"
  local output="$work_root/msf-daemon-$arch"
  (
    cd "$project_root"
    CGO_ENABLED=0 GOOS=darwin GOARCH="$arch" /usr/bin/env go build \
      -buildvcs=true \
      -trimpath \
      -ldflags "$ldflags" \
      -o "$output" \
      ./cmd/msf
  )
}

build_daemon arm64
build_daemon amd64
/usr/bin/xcrun lipo -create \
  "$work_root/msf-daemon-arm64" \
  "$work_root/msf-daemon-amd64" \
  -output "$helper_dir/$helper_name"
/bin/chmod 0755 "$helper_dir/$helper_name"

/bin/cp "$SRCROOT/Resources/$helper_name.plist" "$launchd_dir/$helper_name.plist"
/bin/cp "$SRCROOT/Resources/$helper_name.legacy.plist" "$resource_dir/$helper_name.legacy.plist"
/bin/cp "$SRCROOT/Resources/msf-daemon-installer.sh" "$resource_dir/msf-daemon-installer.sh"
/bin/chmod 0755 "$resource_dir/msf-daemon-installer.sh"

sign_identity="${EXPANDED_CODE_SIGN_IDENTITY:-}"
if [[ "${CODE_SIGNING_ALLOWED:-NO}" == "YES" && -n "$sign_identity" && "$sign_identity" != "-" ]]; then
  /usr/bin/codesign --force --timestamp --options runtime --sign "$sign_identity" "$helper_dir/$helper_name"
else
  /usr/bin/codesign --force --sign - "$helper_dir/$helper_name"
fi
