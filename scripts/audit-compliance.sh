#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

rg_args=(
  --with-filename
  --hidden
  -g '!.git/**'
  -g '!node_modules/**'
  -g '!web/node_modules/**'
  -g '!docs/research/**'
  -g '!docs/design-references/**'
  -g '!scripts/audit-compliance.sh'
)

known_patterns=(
  'resourcemap[.]lol'
  'api[.]prodigal4936'
  '69[.]63[.]222[.]180'
  '107[.]172[.]78[.]250'
  'c20bcd43[-]90af[-]410d[-]bfe5[-]2bdb1261956b'
  '795817dd[-]e39f[-]4b28[-]a3e4[-]1d2e66d7c75d'
  'gateway[.]icloud[.]com'
  'USxDMI[T]'
  'USxNer[d]'
  '7244416[5]'
  '1L8gkzICOYdMLdK3PDdr[W]lgt6vtMI4vZYGQqgsJErWU'
  'Y2Q2YWY2OWM3NTZ[k]'
)

fail=0

echo "== Known live sample scan =="
for pattern in "${known_patterns[@]}"; do
  if rg -n -i -I "${rg_args[@]}" -e "$pattern" "$ROOT"; then
    echo "ERROR: matched known live sample pattern: $pattern" >&2
    fail=1
  fi
done

echo "== Proxy URL sample scan =="
proxy_hits="$(rg -n -I "${rg_args[@]}" -e '(ss|ssr|trojan|vmess|vless|hysteria2?|tuic)://' "$ROOT" || true)"
bad_proxy_hits="$(printf '%s\n' "$proxy_hits" | grep -Ev 'example\.(com|org|net|invalid)|placeholder|TrimPrefix|HasPrefix|strings\.|server_test\.go|支持协议|分享链接模式|protocol|Protocol|proxy URL sample scan|audit-compliance' || true)"
if [[ -n "$bad_proxy_hits" ]]; then
  printf '%s\n' "$bad_proxy_hits"
  echo "ERROR: proxy URL samples must use inert example.* placeholders only." >&2
  fail=1
fi

echo "== Generated artifact strings scan =="
artifact_roots=(
  "$ROOT/dist"
  "$ROOT/msf"
  "$ROOT/internal/server/web/dist"
  "$ROOT/web/dist"
)

for artifact_root in "${artifact_roots[@]}"; do
  [[ -e "$artifact_root" ]] || continue
  while IFS= read -r file; do
    [[ -f "$file" ]] || continue
    for pattern in "${known_patterns[@]}"; do
      if strings "$file" 2>/dev/null | rg -q -i -e "$pattern"; then
        echo "$file"
        echo "ERROR: generated artifact contains known live sample pattern: $pattern" >&2
        fail=1
      fi
    done
  done < <(find "$artifact_root" -type f)
done

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "Compliance audit passed."
