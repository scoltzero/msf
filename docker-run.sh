#!/usr/bin/env sh
set -eu

IMAGE="${MSF_IMAGE:-ghcr.io/scoltzero/msf:latest}"
NAME="${MSF_CONTAINER_NAME:-msf}"
DATA_DIR="${MSF_DOCKER_DATA_DIR:-$(pwd)/msf-data}"
CLEANUP_ON_EXIT="${MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT:-true}"

mkdir -p "$DATA_DIR"

exec docker run -d \
  --name "$NAME" \
  --network host \
  --cap-add NET_ADMIN \
  --cap-add NET_RAW \
  --restart unless-stopped \
  --stop-timeout 30 \
  -e MSF_RUNTIME=docker \
  -e MSF_DATA_DIR=/opt/msf \
  -e MSF_DOCKER_CLEANUP_NETWORK_ON_EXIT="$CLEANUP_ON_EXIT" \
  -v "$DATA_DIR:/opt/msf" \
  "$IMAGE"
