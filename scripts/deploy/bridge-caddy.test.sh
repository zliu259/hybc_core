#!/usr/bin/env bash
# Caddyfile 模板的回归测试：bash scripts/deploy/bridge-caddy.test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=bridge-caddy.sh
source "$here/bridge-caddy.sh"

fail() {
  echo "bridge-caddy.test.sh: FAIL — $1" >&2
  exit 1
}

out="$(render_caddyfile "bridge.hybcdg.com" "api-relay.hybcdg.com" "api.hybcdg.com")"

# bridge 段保持现状：http + https 两段都反代 uvicorn
grep -q '^http://bridge.hybcdg.com {' <<<"$out" || fail "bridge http site missing"
grep -q '^https://bridge.hybcdg.com {' <<<"$out" || fail "bridge https site missing"
grep -q 'reverse_proxy 127.0.0.1:9001' <<<"$out" || fail "bridge upstream missing"

# api-relay 段：只声明 https，直通 Worker，注入可信中转头
grep -q '^https://api-relay.hybcdg.com {' <<<"$out" || fail "api-relay https site missing"
grep -q '^http://api-relay' <<<"$out" && fail "api-relay must not declare an http:// site (let Caddy auto-redirect)"
grep -q 'reverse_proxy https://api.hybcdg.com {' <<<"$out" || fail "api-relay upstream missing"
grep -q 'header_up Host {upstream_hostport}' <<<"$out" || fail "Host rewrite missing"
grep -q 'header_up X-Relay-Auth {env.RELAY_TRUST_TOKEN}' <<<"$out" || fail "X-Relay-Auth injection missing"
grep -q 'header_up -X-Relay-Auth' <<<"$out" && fail "must not delete X-Relay-Auth (Caddy applies deletes after sets)"
grep -q 'tls_server_name api.hybcdg.com' <<<"$out" || fail "tls_server_name missing"
grep -q 'response_header_timeout 120s' <<<"$out" || fail "upstream timeout missing"
grep -q 'max_size 100MB' <<<"$out" || fail "request_body max_size missing"
grep -q 'encode zstd gzip' <<<"$out" || fail "encode missing on api-relay site"

# 多个 bridge 域名以逗号列表原样进入站点头
out_multi="$(render_caddyfile "bridge.hybcdg.com,bridge-hk-2.hybcdg.com" "api-relay.hybcdg.com" "api.hybcdg.com")"
grep -q '^https://bridge.hybcdg.com,bridge-hk-2.hybcdg.com {' <<<"$out_multi" || fail "bridge domain list not preserved"

# 不传 api-relay 域名时不输出该段
out2="$(render_caddyfile "bridge.hybcdg.com" "" "api.hybcdg.com")"
grep -q 'api-relay' <<<"$out2" && fail "api-relay site rendered without a domain"

# read_env_value：缺键在 set -euo pipefail 下必须存活并输出空（grep 退出 1 不能传染给调用方）
tmp_env="$(mktemp)"
printf 'BRIDGE_PUBLIC_DOMAIN=bridge.hybcdg.com\nBRIDGE_EXTRA_DOMAINS=\n' >"$tmp_env"
missing_out="$( (set -euo pipefail; v="$(read_env_value "$tmp_env" API_RELAY_PUBLIC_DOMAIN)"; printf '[%s]' "$v") )" \
  || fail "read_env_value must survive a missing key under set -euo pipefail"
[[ "$missing_out" == "[]" ]] || fail "missing key must yield an empty value, got $missing_out"
[[ "$(read_env_value "$tmp_env" BRIDGE_PUBLIC_DOMAIN)" == "bridge.hybcdg.com" ]] || fail "present key must be read"
[[ -z "$(read_env_value "$tmp_env" BRIDGE_EXTRA_DOMAINS)" ]] || fail "present-but-empty key must yield empty"
rm -f "$tmp_env"

# systemd drop-in：加载环境文件（缺失不致命），并去掉 apt 版单元 ExecStart 里会把环境打进 journal 的 --environ
dropin="$(render_caddy_dropin "/usr/bin/caddy")"
grep -q '^\[Service\]$' <<<"$dropin" || fail "drop-in must start a [Service] section"
grep -q '^EnvironmentFile=-/etc/caddy/hybc.env$' <<<"$dropin" || fail "drop-in must load the env file non-fatally"
grep -q '^ExecStart=$' <<<"$dropin" || fail "drop-in must reset ExecStart before overriding it"
grep -q '^ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile$' <<<"$dropin" || fail "drop-in must override ExecStart"
grep -q -- '--environ' <<<"$dropin" && fail "drop-in must not keep --environ (prints RELAY_TRUST_TOKEN into journal)"

echo "bridge-caddy.test.sh: ok"
