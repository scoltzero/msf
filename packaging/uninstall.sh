#!/usr/bin/env sh
set -eu

APP_NAME="msf"
PREFIX="/usr/local"
DATA_DIR="/opt/msf"
SERVICE_NAME="msf"
PURGE="0"
YES="0"
KEEP_DATA="0"
ALIAS_NAME="msm"
DATA_DIR_SET="0"

usage() {
  cat <<'EOF'
Usage: ./uninstall.sh [options]

Options:
  --prefix PATH        Binary prefix used during install (default: /usr/local)
  --data-dir PATH      Data directory used during install (default: /opt/msf)
  --service-name NAME  systemd service name (default: msf)
  --alias-name NAME    CLI alias registered during install (default: msm)
  --purge             Remove the data directory as well
  --yes               Confirm destructive purge in non-interactive runs
  --keep-data         Keep the data directory without prompting
  -h, --help           Show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix)
      PREFIX="${2:?missing value for --prefix}"
      shift 2
      ;;
    --data-dir)
      DATA_DIR="${2:?missing value for --data-dir}"
      DATA_DIR_SET="1"
      shift 2
      ;;
    --service-name)
      SERVICE_NAME="${2:?missing value for --service-name}"
      shift 2
      ;;
    --alias-name)
      ALIAS_NAME="${2:?missing value for --alias-name}"
      shift 2
      ;;
    --purge)
      PURGE="1"
      shift
      ;;
    --yes|-y)
      YES="1"
      shift
      ;;
    --keep-data)
      KEEP_DATA="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "uninstall.sh must be run as root" >&2
  exit 1
fi

if [ -f /.dockerenv ] || grep -qaE '/docker/|/kubepods/|/containerd/' /proc/1/cgroup 2>/dev/null || [ "${MSF_RUNTIME:-}" = "docker" ]; then
  echo "Docker / Compose installs must be removed from Docker, Compose, or your container manager; remove the container and its volume there" >&2
  exit 1
fi

if [ -f /etc/unraid-version ] || [ -x /usr/local/sbin/emhttp ] || [ -d /boot/config/plugins ] || echo "${UNRAID_VERSION:-}" | grep -qi unraid; then
  echo "on Unraid, remove msf from the WebGUI plugin page; application data is kept under /mnt/user/appdata/msf" >&2
  exit 1
fi

case "$(printf '%s %s %s %s %s' "${MSF_RUNTIME:-}" "${MSF_PACKAGE_RUNTIME:-}" "${MSF_PACKAGE_TYPE:-}" "${FNOS_RUNTIME:-}" "${FNOS_PACKAGE_TYPE:-}" | tr '[:upper:]' '[:lower:]')" in
  *fnos*|*fpk*)
    echo "fnOS FPK installs must be removed from fnOS / 飞牛应用中心 or the FPK package manager" >&2
    exit 1
    ;;
esac
if [ -f /etc/fnos-release ] || [ -f /etc/feiniu-release ] || [ -f /etc/fnOS-release ] || [ -e /usr/local/fnos ] || [ -e /var/packages/msf ]; then
  echo "fnOS FPK installs must be removed from fnOS / 飞牛应用中心 or the FPK package manager" >&2
  exit 1
fi

SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME.service"
BIN_DEST="$PREFIX/bin/$APP_NAME"
ALIAS_DEST="$PREFIX/bin/$ALIAS_NAME"

if [ -x "$BIN_DEST" ]; then
  set -- uninstall --prefix "$PREFIX" --service-name "$SERVICE_NAME" --alias-name "$ALIAS_NAME"
  [ "$DATA_DIR_SET" = "1" ] && set -- "$@" --config "$DATA_DIR"
  [ "$PURGE" = "1" ] && set -- "$@" --purge
  [ "$YES" = "1" ] && set -- "$@" --yes
  [ "$KEEP_DATA" = "1" ] && set -- "$@" --keep-data
  exec "$BIN_DEST" "$@"
fi

if [ "$PURGE" = "1" ] && [ "$KEEP_DATA" = "1" ]; then
  echo "--purge and --keep-data cannot be used together" >&2
  exit 2
fi
if [ "$PURGE" = "1" ] && [ "$YES" != "1" ] && [ ! -t 0 ]; then
  echo "refusing to purge data directory in non-interactive mode without --yes" >&2
  exit 1
fi
if [ "$PURGE" != "1" ] && [ "$KEEP_DATA" != "1" ]; then
  if [ -t 0 ]; then
    printf 'Remove MSF data directory %s? This deletes configs, database, logs, components, and zashboard. [y/N]: ' "$DATA_DIR"
    read ans || ans=""
    case "$ans" in
      y|Y|yes|YES) PURGE="1" ;;
      *) PURGE="0" ;;
    esac
  else
    echo "non-interactive uninstall: keeping data directory $DATA_DIR; pass --purge --yes to remove it"
  fi
fi

stop_pid_file() {
  pid_file="$1"
  [ -f "$pid_file" ] || return 0
  pid="$(cat "$pid_file" 2>/dev/null | tr -dc '0-9' || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "-$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    i=0
    while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 50 ]; do
      sleep 0.1
      i=$((i + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "-$pid" 2>/dev/null || true
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$pid_file"
}

stop_owned_component_processes() {
  [ -d /proc ] || return 0
  pids=""
  for p in /proc/[0-9]*; do
    [ -e "$p/exe" ] || continue
    exe="$(readlink "$p/exe" 2>/dev/null || true)"
    case "$exe" in
      "$DATA_DIR/data/binaries/mihomo/"*|"$DATA_DIR/data/binaries/mosdns/"*)
        pid="${p##*/}"
        kill "-$pid" 2>/dev/null || true
        kill "$pid" 2>/dev/null || true
        pids="$pids $pid"
        ;;
    esac
  done
  i=0
  while [ -n "$pids" ] && [ "$i" -lt 50 ]; do
    alive=""
    for pid in $pids; do
      if kill -0 "$pid" 2>/dev/null; then
        alive="$alive $pid"
      fi
    done
    [ -n "$alive" ] || return 0
    pids="$alive"
    sleep 0.1
    i=$((i + 1))
  done
  for pid in $pids; do
    kill -9 "-$pid" 2>/dev/null || true
    kill -9 "$pid" 2>/dev/null || true
  done
}

stop_pid_file "$DATA_DIR/data/mihomo.pid"
stop_pid_file "$DATA_DIR/data/mosdns.pid"
stop_owned_component_processes
stop_pid_file "$DATA_DIR/msf.pid"

if command -v systemctl >/dev/null 2>&1 && [ -f "$SERVICE_PATH" ]; then
  systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
  rm -f "$SERVICE_PATH"
  systemctl daemon-reload
  systemctl reset-failed "$SERVICE_NAME" >/dev/null 2>&1 || true
fi
stop_pid_file "$DATA_DIR/data/mihomo.pid"
stop_pid_file "$DATA_DIR/data/mosdns.pid"
stop_owned_component_processes

rm -f "$BIN_DEST"
if [ -n "$ALIAS_NAME" ] && [ "$ALIAS_NAME" != "$APP_NAME" ] && [ -L "$ALIAS_DEST" ]; then
  ALIAS_TARGET=$(readlink "$ALIAS_DEST" || true)
  if [ "$ALIAS_TARGET" = "$BIN_DEST" ] || [ "$ALIAS_TARGET" = "$APP_NAME" ]; then
    rm -f "$ALIAS_DEST"
  fi
fi

if [ "$PURGE" = "1" ]; then
  CLEAN_PARENT=$(cd "$(dirname "$DATA_DIR")" 2>/dev/null && pwd -P || true)
  if [ -n "$CLEAN_PARENT" ]; then
    CLEAN_DATA_DIR="$CLEAN_PARENT/$(basename "$DATA_DIR")"
  else
    CLEAN_DATA_DIR="$DATA_DIR"
  fi
  case "$CLEAN_DATA_DIR" in
    ""|"."|"/"|"/opt"|"/usr"|"/usr/local"|"/mnt"|"/mnt/user"|"/mnt/cache")
      echo "refusing to purge unsafe data directory: $DATA_DIR" >&2
      exit 1
      ;;
  esac
  rm -rf "$DATA_DIR"
  echo "removed $APP_NAME and purged $DATA_DIR"
else
  echo "removed $APP_NAME binary and service"
  echo "kept data directory: $DATA_DIR"
fi
