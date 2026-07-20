#!/bin/sh
set -eu

BINARY="${1:?path to an msf binary is required}"
[ -x "$BINARY" ] || { echo "not executable: $BINARY" >&2; exit 1; }

ROOT="$(mktemp -d)"
DATA="$ROOT/data"
LOG="$ROOT/msf.log"
PORT="${MSF_SMOKE_PORT:-17777}"
PID=""

cleanup() {
  if [ -n "$PID" ]; then
    kill "$PID" >/dev/null 2>&1 || true
    wait "$PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT INT TERM

if [ "$(uname -s)" = "Linux" ] && command -v ip >/dev/null 2>&1; then
  ip link set lo up >/dev/null 2>&1 || true
fi

MSF_RUNTIME=native "$BINARY" serve --config "$DATA" --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
PID="$!"

ready=false
attempt=0
while [ "$attempt" -lt 100 ]; do
  if curl -fsS "http://127.0.0.1:$PORT/api/v1/setup/check" >/dev/null 2>&1; then
    ready=true
    break
  fi
  if ! kill -0 "$PID" >/dev/null 2>&1; then
    cat "$LOG" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done
[ "$ready" = true ] || { cat "$LOG" >&2; echo "server did not become ready" >&2; exit 1; }

request() {
  method="$1"
  path="$2"
  body="$3"
  token="${4:-}"
  if [ -n "$token" ]; then
	  curl -fsS -X "$method" "http://127.0.0.1:$PORT$path" \
		-H 'Content-Type: application/json' \
		-H "Authorization: Bearer $token" \
		--data "$body"
	  return
  fi
  curl -fsS -X "$method" "http://127.0.0.1:$PORT$path" \
    -H 'Content-Type: application/json' \
    --data "$body"
}

NFT_INIT='{"username":"root","password":"old-password-123","confirmPassword":"old-password-123","timezone":"Etc/UTC","webPort":"17777","selected_interface":"eth0","proxyCore":"mihomo","mosdnsEnabled":true,"mihomo_core_type":"meta","linux_proxy_mode":"nft","enableIPv6":false,"auto_set_dns":true}'
request POST /api/v1/setup/initialize "$NFT_INIT" >/dev/null

LOGIN="$(request POST /api/v1/auth/login '{"username":"root","password":"old-password-123"}')"
TOKEN="$(printf '%s' "$LOGIN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')"
[ -n "$TOKEN" ] || { echo "login did not return a token" >&2; exit 1; }

RESET="$(request POST /api/v1/setup/reset '{"current_password":"old-password-123","delete_components":false}' "$TOKEN")"
printf '%s' "$RESET" | grep -q '"factory_reset":true' || { echo "$RESET" >&2; exit 1; }
printf '%s' "$RESET" | grep -q '"requires_reinitialize":true' || { echo "$RESET" >&2; exit 1; }

OLD_STATUS="$(curl -sS -o "$ROOT/old-token.json" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/api/v1/users")"
[ "$OLD_STATUS" = "401" ] || { cat "$ROOT/old-token.json" >&2; echo "old token status=$OLD_STATUS" >&2; exit 1; }

TUN_INIT='{"username":"root","password":"new-password-456","confirmPassword":"new-password-456","timezone":"Etc/UTC","webPort":"17777","selected_interface":"eth0","proxyCore":"mihomo","mosdnsEnabled":true,"mihomo_core_type":"meta","linux_proxy_mode":"tun","enableIPv6":false,"auto_set_dns":true}'
TUN_RESPONSE="$(request POST /api/v1/setup/initialize "$TUN_INIT")"
printf '%s' "$TUN_RESPONSE" | grep -q '"effective_proxy_mode":"tun"' || { echo "$TUN_RESPONSE" >&2; exit 1; }

MIHOMO="$DATA/configs/mihomo/config.yaml"
NETWORK="$DATA/configs/network/network.yaml"
grep -q '^tun:' "$MIHOMO"
grep -q '^[[:space:]]*enable: true$' "$MIHOMO"
grep -q '^[[:space:]]*stack: system$' "$MIHOMO"
grep -q '^[[:space:]]*route-address:$' "$MIHOMO"
grep -q '^[[:space:]]*route-exclude-address:$' "$MIHOMO"
grep -q '^[[:space:]]*proxy-server-nameserver:$' "$MIHOMO"
if grep -Eq '^(redir-port|tproxy-port|routing-mark):' "$MIHOMO"; then
  echo "TUN config contains nftables transparent-proxy fields" >&2
  exit 1
fi
grep -q '^mode: tun$' "$NETWORK"
[ ! -e "$DATA/configs/network/network.nft" ] || { echo "TUN reset smoke test left network.nft" >&2; exit 1; }

echo "factory reset smoke test passed for $BINARY"
