#!/bin/zsh
set -euo pipefail

label="io.github.scoltzero.msf.daemon"
helper_path="/Library/PrivilegedHelperTools/$label"
plist_path="/Library/LaunchDaemons/$label.plist"
data_path="/Library/Application Support/MSF"
log_path="/Library/Logs/MSF"

if [[ "$(/usr/bin/id -u)" -ne 0 ]]; then
  echo "installer must run as root" >&2
  exit 1
fi

action="${1:-install}"
app_bundle="${2:-}"

stop_service() {
  /bin/launchctl bootout "system/$label" >/dev/null 2>&1 || true
  /bin/launchctl bootout system "$plist_path" >/dev/null 2>&1 || true
}

case "$action" in
  install|repair)
    if [[ -z "$app_bundle" ]]; then
      echo "app bundle path is required" >&2
      exit 1
    fi
    source_helper="$app_bundle/Contents/Library/HelperTools/$label"
    source_plist="$app_bundle/Contents/Resources/$label.legacy.plist"
    if [[ ! -x "$source_helper" ]]; then
      echo "bundled daemon is missing: $source_helper" >&2
      exit 1
    fi
    if [[ ! -f "$source_plist" ]]; then
      echo "legacy launchd plist is missing: $source_plist" >&2
      exit 1
    fi

    stop_service
    /usr/bin/install -d -o root -g wheel -m 0755 /Library/PrivilegedHelperTools /Library/LaunchDaemons
    /usr/bin/install -d -o root -g wheel -m 0750 "$data_path"
    /usr/bin/install -d -o root -g wheel -m 0755 "$log_path"
    /usr/bin/install -o root -g wheel -m 0755 "$source_helper" "$helper_path"
    /usr/bin/install -o root -g wheel -m 0644 "$source_plist" "$plist_path"
    /usr/bin/xattr -d com.apple.quarantine "$helper_path" >/dev/null 2>&1 || true
    /usr/bin/codesign --force --sign - "$helper_path" >/dev/null 2>&1
    /usr/bin/plutil -lint "$plist_path" >/dev/null
    /bin/launchctl bootstrap system "$plist_path"
    /bin/launchctl enable "system/$label"
    /bin/launchctl kickstart -k "system/$label"
    echo "installed:$label"
    ;;
  uninstall)
    stop_service
    /bin/rm -f "$plist_path" "$helper_path"
    echo "uninstalled:$label:data-preserved:$data_path"
    ;;
  *)
    echo "usage: $0 install|repair|uninstall [app-bundle]" >&2
    exit 2
    ;;
esac
