#!/usr/bin/env bash
# Caddy 配置函数库：被 bridge-azure-vm.sh 与 bridge-azure-update.sh `source`，两份脚本共用同一份
# Caddyfile 模板，避免漂移。调用方必须先定义 `as_root`（以 root 执行命令）。
#
# 站点：
#   - bridge 站点（BRIDGE_PUBLIC_DOMAIN + BRIDGE_EXTRA_DOMAINS）：http/https 反代 127.0.0.1:9001（uvicorn relay，小程序主入口）
#   - api-relay 站点（API_RELAY_PUBLIC_DOMAIN，默认 api-relay.hybcdg.com；设为 none 可关闭）：
#     只声明 https，流式直通 Worker（API_RELAY_UPSTREAM，默认 api.hybcdg.com），注入可信中转头 X-Relay-Auth。
#
# 回归测试：bash scripts/deploy/bridge-caddy.test.sh

CADDYFILE_PATH="${CADDYFILE_PATH:-/etc/caddy/Caddyfile}"
CADDY_ENV_FILE="${CADDY_ENV_FILE:-/etc/caddy/hybc.env}"
CADDY_DROPIN_DIR="${CADDY_DROPIN_DIR:-/etc/systemd/system/caddy.service.d}"
CADDY_DROPIN_FILE="${CADDY_DROPIN_DIR}/hybc-env.conf"
DEFAULT_API_RELAY_DOMAIN="api-relay.hybcdg.com"
DEFAULT_API_RELAY_UPSTREAM="api.hybcdg.com"

# 读 env 文件里某个键最后一次赋值；不 source 文件，避免执行任意内容。
read_env_value() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d '=' -f2-
}

# 把主域名与逗号/分号分隔的附加域名合成 Caddy 站点头用的逗号列表。
join_domain_list() {
  local primary="$1"
  local extra="$2"
  local clean_extra
  clean_extra="$(printf '%s' "$extra" | tr -d ' ' | tr ';' ',')"
  if [[ -n "$primary" && -n "$clean_extra" ]]; then
    printf '%s,%s' "$primary" "$clean_extra"
  else
    printf '%s' "${primary}${clean_extra}"
  fi
}

# render_caddyfile BRIDGE_DOMAIN_LIST API_RELAY_DOMAIN API_RELAY_UPSTREAM → stdout
render_caddyfile() {
  local bridge_domains="$1"
  local api_relay_domain="$2"
  local api_relay_upstream="$3"

  if [[ -n "$bridge_domains" ]]; then
    cat <<EOF
http://${bridge_domains} {
  encode gzip
  reverse_proxy 127.0.0.1:9001 {
    header_up X-Forwarded-Proto {scheme}
  }
}

https://${bridge_domains} {
  encode gzip
  reverse_proxy 127.0.0.1:9001 {
    header_up X-Forwarded-Proto {scheme}
  }
}
EOF
  fi

  if [[ -n "$api_relay_domain" ]]; then
    cat <<EOF

# 网页端 API 入口：流式直通 Worker，不经 uvicorn。X-Relay-Auth 用 header_up 的 Set 语义整体替换
# 客户端自带值；不要再加带 - 前缀的同名删除指令（Caddy 的删除在设置之后执行，会删掉刚设的值）。
# 非 trusted_proxies 来源的 X-Forwarded-* 由 Caddy 丢弃重写，因此上游只会收到真实客户端 IP 一跳。
https://${api_relay_domain} {
  encode zstd gzip
  request_body {
    max_size 100MB
  }
  reverse_proxy https://${api_relay_upstream} {
    header_up Host {upstream_hostport}
    header_up X-Relay-Auth {env.RELAY_TRUST_TOKEN}
    transport http {
      tls_server_name ${api_relay_upstream}
      response_header_timeout 120s
    }
  }
}
EOF
  fi
}

# install_caddy_env BRIDGE_ENV_FILE：把 RELAY_TRUST_TOKEN 从 bridge/.env 抄进 Caddy 专用环境文件，
# 并用 systemd drop-in 让 caddy.service 加载它（apt 版 caddy 单元没有 EnvironmentFile）。
install_caddy_env() {
  local env_file="$1"
  local token
  token="$(read_env_value "$env_file" RELAY_TRUST_TOKEN)"
  as_root mkdir -p "$CADDY_DROPIN_DIR"
  printf 'RELAY_TRUST_TOKEN=%s\n' "$token" | as_root tee "$CADDY_ENV_FILE" >/dev/null
  as_root chown root:caddy "$CADDY_ENV_FILE" 2>/dev/null || true
  as_root chmod 0640 "$CADDY_ENV_FILE"
  printf '[Service]\nEnvironmentFile=%s\n' "$CADDY_ENV_FILE" | as_root tee "$CADDY_DROPIN_FILE" >/dev/null
  as_root systemctl daemon-reload
}

# apply_caddy BRIDGE_ENV_FILE：解析域名 → 写环境文件与 drop-in → 渲染并校验 Caddyfile → 重启 caddy。
# 显式环境变量优先于 bridge/.env 里的同名键；API_RELAY_PUBLIC_DOMAIN=none 关闭 api-relay 站点。
apply_caddy() {
  local env_file="$1"
  if ! command -v caddy >/dev/null 2>&1; then
    echo "[bridge-caddy] caddy not installed, skip Caddy configuration"
    return 0
  fi

  local primary extra bridge_domains relay_domain relay_upstream
  primary="${BRIDGE_PUBLIC_DOMAIN:-$(read_env_value "$env_file" BRIDGE_PUBLIC_DOMAIN)}"
  extra="${BRIDGE_EXTRA_DOMAINS:-$(read_env_value "$env_file" BRIDGE_EXTRA_DOMAINS)}"
  bridge_domains="$(join_domain_list "$primary" "$extra")"
  relay_domain="${API_RELAY_PUBLIC_DOMAIN:-$(read_env_value "$env_file" API_RELAY_PUBLIC_DOMAIN)}"
  relay_domain="${relay_domain:-$DEFAULT_API_RELAY_DOMAIN}"
  if [[ "$relay_domain" == "none" ]]; then
    relay_domain=""
  fi
  relay_upstream="${API_RELAY_UPSTREAM:-$(read_env_value "$env_file" API_RELAY_UPSTREAM)}"
  relay_upstream="${relay_upstream:-$DEFAULT_API_RELAY_UPSTREAM}"

  if [[ -z "$bridge_domains" && -z "$relay_domain" ]]; then
    echo "[bridge-caddy] no domains configured, skip Caddy configuration"
    return 0
  fi

  install_caddy_env "$env_file"
  render_caddyfile "$bridge_domains" "$relay_domain" "$relay_upstream" | as_root tee "$CADDYFILE_PATH" >/dev/null
  as_root caddy validate --config "$CADDYFILE_PATH" --adapter caddyfile
  as_root systemctl enable caddy
  as_root systemctl restart caddy
  echo "[bridge-caddy] Caddy configured: bridge=[${bridge_domains}] api-relay=[${relay_domain}] upstream=[${relay_upstream}]"
}
