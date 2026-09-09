#!/bin/zsh
set -euo pipefail

label="io.github.scoltzero.msf.daemon"
helper_path="/Library/PrivilegedHelperTools/$label"
plist_path="/Library/LaunchDaemons/$label.plist"
data_path="/Library/Application Support/MSF"
log_path="/Library/Logs/MSF"
stderr_log="$log_path/msf-daemon.err.log"

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

service_loaded() {
  /bin/launchctl print "system/$label" >/dev/null 2>&1
}

wait_until_unloaded() {
  local attempt
  for attempt in {1..20}; do
    if ! service_loaded; then
      return 0
    fi
    /bin/sleep 0.25
  done
  return 1
}

print_launchd_diagnostics() {
  echo "launchd failed to load $label" >&2
  echo "--- installed files and extended attributes ---" >&2
  /bin/ls -lO@ "$helper_path" "$plist_path" >&2 2>/dev/null || true
  echo "--- launchd plist ---" >&2
  /usr/bin/plutil -p "$plist_path" >&2 2>/dev/null || true
  echo "--- helper signature ---" >&2
  /usr/bin/codesign --verify --strict --verbose=4 "$helper_path" >&2 2>/dev/null || true
  echo "--- launchctl print system/$label ---" >&2
  /bin/launchctl print "system/$label" >&2 2>/dev/null || true
  echo "--- tcp port 7777 listeners ---" >&2
  /usr/sbin/lsof -nP -iTCP:7777 -sTCP:LISTEN >&2 2>/dev/null || true
  if [[ -f "$stderr_log" ]]; then
    echo "--- $stderr_log tail ---" >&2
    /usr/bin/tail -n 40 "$stderr_log" >&2 2>/dev/null || true
  fi
  echo "--- recent launchd messages ---" >&2
  /usr/bin/log show \
    --last 5m \
    --style compact \
    --predicate "process == 'launchd' AND eventMessage CONTAINS[c] '$label'" \
    2>/dev/null | /usr/bin/tail -n 80 >&2 || true
}

remove_quarantine() {
  local installed_path="$1"
  /usr/bin/xattr -d com.apple.quarantine "$installed_path" >/dev/null 2>&1 || true
  if /usr/bin/xattr -p com.apple.quarantine "$installed_path" >/dev/null 2>&1; then
    echo "failed to remove quarantine attribute: $installed_path" >&2
    return 1
  fi
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
    if ! wait_until_unloaded; then
      echo "existing launchd job did not unload: $label" >&2
      print_launchd_diagnostics
      exit 1
    fi
    /usr/bin/install -d -o root -g wheel -m 0755 /Library/PrivilegedHelperTools /Library/LaunchDaemons
    /usr/bin/install -d -o root -g wheel -m 0750 "$data_path"
    /usr/bin/install -d -o root -g wheel -m 0755 "$log_path"
    /usr/bin/install -o root -g wheel -m 0755 "$source_helper" "$helper_path"
    /usr/bin/install -o root -g wheel -m 0644 "$source_plist" "$plist_path"
    /usr/bin/codesign --force --sign - "$helper_path" >/dev/null 2>&1
    remove_quarantine "$helper_path"
    remove_quarantine "$plist_path"
    /usr/bin/codesign --verify --strict "$helper_path" >/dev/null
    /usr/bin/plutil -lint "$plist_path" >/dev/null
    if ! /bin/launchctl bootstrap system "$plist_path"; then
      print_launchd_diagnostics
      exit 1
    fi
    /bin/launchctl enable "system/$label"
    /bin/launchctl kickstart -k "system/$label"
    if ! service_loaded; then
      echo "launchd job is not loaded after bootstrap: $label" >&2
      print_launchd_diagnostics
      exit 1
    fi
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
