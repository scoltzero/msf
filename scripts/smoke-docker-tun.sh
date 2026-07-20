#!/bin/bash
set -euo pipefail

IMAGE="${1:?image is required}"
MODE="${2:?host-tun or macvlan-tun is required}"
[[ "$MODE" == "host-tun" || "$MODE" == "macvlan-tun" ]] || { echo "unsupported mode: $MODE" >&2; exit 1; }

ROOT="$(mktemp -d)"
NAME="msf-smoke-${MODE}-$$"
NETWORK=""
DUMMY=""

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  if [[ -n "$NETWORK" ]]; then
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
  fi
  if [[ -n "$DUMMY" ]]; then
    sudo ip link del "$DUMMY" >/dev/null 2>&1 || true
  fi
  sudo rm -rf "$ROOT"
}
trap cleanup EXIT INT TERM

network_args=(--network host)
if [[ "$MODE" == "macvlan-tun" ]]; then
  DUMMY="msfdummy$$"
  NETWORK="msf-smoke-macvlan-$$"
  sudo ip link add "$DUMMY" type dummy
  sudo ip link set "$DUMMY" up
  docker network create --driver macvlan --subnet "172.30.$(( $$ % 200 + 20 )).0/24" --gateway "172.30.$(( $$ % 200 + 20 )).1" -o "parent=$DUMMY" "$NETWORK" >/dev/null
  network_args=(--network "$NETWORK")
fi

docker run -d --name "$NAME" \
  "${network_args[@]}" \
  --cap-add NET_ADMIN \
  --cap-add NET_RAW \
  --device /dev/net/tun:/dev/net/tun \
  -e MSF_RUNTIME=docker \
  -e "MSF_DOCKER_NETWORK_MODE=$MODE" \
  -e MSF_DATA_DIR=/opt/msf \
  -v "$ROOT:/opt/msf" \
  "$IMAGE" >/dev/null

attempt=0
until docker exec "$NAME" curl -fsS http://127.0.0.1:7777/api/v1/setup/check >/dev/null 2>&1; do
  if (( attempt >= 100 )); then
    docker logs "$NAME" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 0.1
done

docker_request() {
  local method="$1" path="$2" body="$3" token="${4:-}"
  local args=(-sS -X "$method" "http://127.0.0.1:7777$path" -H 'Content-Type: application/json' --data "$body")
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer $token")
  fi
  docker exec "$NAME" curl "${args[@]}"
}

NFT='{"username":"root","password":"password-123","confirmPassword":"password-123","timezone":"Etc/UTC","selected_interface":"eth0","linux_proxy_mode":"nft"}'
NFT_RESULT="$(docker exec "$NAME" curl -sS -o /tmp/nft-response.json -w '%{http_code}' -X POST http://127.0.0.1:7777/api/v1/setup/initialize -H 'Content-Type: application/json' --data "$NFT")"
[[ "$NFT_RESULT" == "400" ]] || { docker exec "$NAME" cat /tmp/nft-response.json >&2; echo "Docker nft status=$NFT_RESULT" >&2; exit 1; }

TUN='{"username":"root","password":"old-password-123","confirmPassword":"old-password-123","timezone":"Etc/UTC","selected_interface":"eth0","proxyCore":"mihomo","mosdnsEnabled":true,"mihomo_core_type":"meta","linux_proxy_mode":"tun","enableIPv6":false,"auto_set_dns":true}'
INIT="$(docker_request POST /api/v1/setup/initialize "$TUN")"
grep -q '"effective_proxy_mode":"tun"' <<<"$INIT"

LOGIN="$(docker_request POST /api/v1/auth/login '{"username":"root","password":"old-password-123"}')"
TOKEN="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])' <<<"$LOGIN")"
RESET="$(docker_request POST /api/v1/setup/reset '{"current_password":"old-password-123"}' "$TOKEN")"
grep -q '"factory_reset":true' <<<"$RESET"

TUN_NEW='{"username":"root","password":"new-password-456","confirmPassword":"new-password-456","timezone":"Etc/UTC","selected_interface":"eth0","proxyCore":"mihomo","mosdnsEnabled":true,"mihomo_core_type":"meta","linux_proxy_mode":"tun","enableIPv6":false,"auto_set_dns":true}'
REINIT="$(docker_request POST /api/v1/setup/initialize "$TUN_NEW")"
grep -q '"effective_proxy_mode":"tun"' <<<"$REINIT"

sudo grep -q '^tun:' "$ROOT/configs/mihomo/config.yaml"
sudo grep -q '^[[:space:]]*enable: true$' "$ROOT/configs/mihomo/config.yaml"
sudo grep -q '^mode: tun$' "$ROOT/configs/network/network.yaml"
[[ ! -e "$ROOT/configs/network/network.nft" ]]

echo "Docker $MODE smoke test passed for $IMAGE"
