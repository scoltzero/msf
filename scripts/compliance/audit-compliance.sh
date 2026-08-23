#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

rg_args=(
  --with-filename
  --hidden
  -g '!.git/**'
  -g '!node_modules/**'
  -g '!web/node_modules/**'
  -g '!docs/research/**'
  -g '!scripts/compliance/audit-compliance.sh'
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

echo "== Retired identifier scan =="
retired_patterns=(
  '\bm[s]m\b'
  'm[s]m[-_ ]?free'
)

# The public workflow reference is allowed only in the approved provenance
# documents. Source code, templates, generated output, and paths must remain
# free of the retired identifier.
if rg -n -i -I "${rg_args[@]}" \
  -g '!README.md' \
  -g '!README.en.md' \
  -g '!THIRD_PARTY_NOTICES.md' \
  -g '!docs/compliance/ui-provenance.md' \
  -e 'm[s]sb' "$ROOT"; then
  echo "ERROR: workflow-reference identifier appears outside approved provenance documents" >&2
  fail=1
fi

for pattern in "${retired_patterns[@]}"; do
  if rg -n -i -I "${rg_args[@]}" -e "$pattern" "$ROOT"; then
    echo "ERROR: retired project identifier remains in published content: $pattern" >&2
    fail=1
  fi
  if (cd "$ROOT" && rg --files --hidden -g '!.git/**' -g '!node_modules/**' -g '!web/node_modules/**' -g '!dist/**' -g '!graphify-out/**' -g '!output/**') | rg -n -i -e "$pattern"; then
    echo "ERROR: published path contains a retired project identifier: $pattern" >&2
    fail=1
  fi
done

if (cd "$ROOT" && rg --files --hidden -g '!.git/**' -g '!node_modules/**' -g '!web/node_modules/**' -g '!dist/**' -g '!graphify-out/**' -g '!output/**') | rg -n -i -e 'm[s]sb'; then
  echo "ERROR: published path contains a retired project identifier" >&2
  fail=1
fi

echo "== Required provenance declarations =="
required_declarations=(
  'baozaodetudou/m'"ssb"
  'yyysuo/mosdns'
  'yyysuo/firetv'
  'MetaCubeX/meta-rules-dat'
  'Zephyruso/zashboard'
  'DavidHDev/react-bits'
  'nolangz/pixel2motion'
)
for declaration in "${required_declarations[@]}"; do
  if ! rg -q -F "$declaration" "$ROOT/THIRD_PARTY_NOTICES.md" "$ROOT/README.md" "$ROOT/README.en.md"; then
    echo "ERROR: required provenance declaration is missing: $declaration" >&2
    fail=1
  fi
done

echo "== Prohibited reference artifact scan =="
prohibited_tracked_paths=(
  'docs/design-references/logo-archive/'
  'docs/research/components/login-logo-showcase.spec.md'
)

while IFS= read -r tracked_path; do
  [[ -n "$tracked_path" ]] || continue
  if [[ "$tracked_path" =~ (^|/)[^/]+_html_export([.]tar[.]gz|/|$) ]] ||
     [[ "$tracked_path" =~ ^docs/(research|design-references)/[^/]+-login(/|$) ]]; then
    echo "$tracked_path"
    echo "ERROR: private comparison/reference artifact is tracked: $tracked_path" >&2
    fail=1
  fi
  for prohibited_path in "${prohibited_tracked_paths[@]}"; do
    if [[ "$tracked_path" == "$prohibited_path" || "$tracked_path" == "$prohibited_path"* ]]; then
      echo "$tracked_path"
      echo "ERROR: private comparison/reference artifact is tracked: $tracked_path" >&2
      fail=1
    fi
  done
done < <(git -C "$ROOT" ls-files)

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

for release_artifact in \
  "$ROOT/dist/msf-linux-amd64" \
  "$ROOT/dist/msf-linux-arm64" \
  "$ROOT/dist/msf-linux-amd64.tar.gz" \
  "$ROOT/dist/msf-linux-arm64.tar.gz"; do
  [[ -f "$release_artifact" ]] || continue
  for pattern in "${known_patterns[@]}"; do
    if strings "$release_artifact" 2>/dev/null | rg -q -i -e "$pattern"; then
      echo "$release_artifact"
      echo "ERROR: generated release artifact contains known live sample pattern: $pattern" >&2
      fail=1
    fi
  done
done

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "Compliance audit passed."
