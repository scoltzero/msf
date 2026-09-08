#!/usr/bin/env bash
set -euo pipefail

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
upstream_ref=${1:-7a25e847416fe56a9d6141ecd6249fde8664d1bb}
upstream_base="https://raw.githubusercontent.com/ipverse/country-ip-blocks/${upstream_ref}/country/cn"
output_dir="$repo_root/internal/server/runtime_templates/network"
temp_dir=$(mktemp -d)

cleanup() {
  rm -rf "$temp_dir"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$output_dir"
for family in v4 v6; do
  if [ "$family" = "v4" ]; then
    upstream_name=ipv4-aggregated.txt
    version=4
  else
    upstream_name=ipv6-aggregated.txt
    version=6
  fi
  downloaded="$temp_dir/$upstream_name"
  curl --fail --location --proto '=https' --tlsv1.2 \
    "$upstream_base/$upstream_name" \
    --output "$downloaded"
  python3 - "$downloaded" "$version" <<'PY'
import ipaddress
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
version = int(sys.argv[2])
prefixes = []
for line_number, raw in enumerate(source.read_text(encoding="utf-8").splitlines(), 1):
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    try:
        prefix = ipaddress.ip_network(line, strict=True)
    except ValueError as exc:
        raise SystemExit(f"{source}:{line_number}: invalid CIDR: {exc}")
    if prefix.version != version:
        raise SystemExit(f"{source}:{line_number}: unexpected IPv{prefix.version} prefix")
    prefixes.append(prefix)
if not prefixes:
    raise SystemExit(f"{source}: no CIDR prefixes found")
if len(prefixes) != len(set(prefixes)):
    raise SystemExit(f"{source}: duplicate CIDR prefixes found")
ordered = sorted(prefixes, key=lambda item: (int(item.network_address), int(item.broadcast_address)))
for previous, current in zip(ordered, ordered[1:]):
    if current.network_address <= previous.broadcast_address:
        raise SystemExit(f"{source}: overlapping CIDRs: {previous} and {current}")
print(f"validated IPv{version}: {len(prefixes)} prefixes")
PY
  install -m 0644 "$downloaded" "$output_dir/chnroute_${family}.txt"
done

echo "updated chnroute data from ipverse/country-ip-blocks@$upstream_ref"
