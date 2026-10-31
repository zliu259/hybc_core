#!/usr/bin/env bash
# Caddy 配置函数库：被 bridge-azure-vm.sh 与 bridge-azure-update.sh `source`，两份脚本共用同一份
# Caddyfile 模板，避免漂移。调用方必须先定义 `as_root`（以 root 执行命令）。
#
# 站点：
#   - bridge 站点（BRIDGE_PUBLIC_DOMAIN + BRIDGE_EXTRA_DOMAINS）：http/https 反代 127.0.0.1:9001（uvicorn relay，小程序主入口）
#   - api-relay 站点（API_RELAY_PUBLIC_DOMAIN，默认 api-relay.hybcdg.com；设为 none 可关闭）：
#     只声明 https，流式直通 Worker（API_RELAY_UPSTREAM，默认 api.hybcdg.com），注入可信中转头 X-Relay-Auth。
#   - web 整站镜像站点（WEB_PUBLIC_DOMAIN，空或 none = 关；需要 CF_DNS_API_TOKEN）：同域名直出，
#     /api/* 直通 Worker，其余反代 Pages 源站（WEB_STATIC_UPSTREAM，默认 hybc-core.pages.dev），
#     证书走 Cloudflare DNS-01，可在 DNS 切到本机之前预签；需要带 caddy-dns/cloudflare 模块的 Caddy 构建，
#     由 ensure_caddy_cloudflare_dns 按 Caddy 官方「apt 包 + 自定义构建」方式（dpkg-divert + alternatives）安装。
#
# 回归测试：bash scripts/deploy/bridge-caddy.test.sh

CADDYFILE_PATH="${CADDYFILE_PATH:-/etc/caddy/Caddyfile}"
CADDY_ENV_FILE="${CADDY_ENV_FILE:-/etc/caddy/hybc.env}"
CADDY_DROPIN_DIR="${CADDY_DROPIN_DIR:-/etc/systemd/system/caddy.service.d}"
CADDY_DROPIN_FILE="${CADDY_DROPIN_DIR}/hybc-env.conf"
CADDY_DOWNLOAD_BASE="${CADDY_DOWNLOAD_BASE:-https://caddyserver.com/api/download}"
DEFAULT_API_RELAY_DOMAIN="api-relay.hybcdg.com"
DEFAULT_API_RELAY_UPSTREAM="api.hybcdg.com"
DEFAULT_WEB_STATIC_UPSTREAM="hybc-core.pages.dev"

# 读 env 文件里某个键最后一次赋值；不 source 文件，避免执行任意内容。
read_env_value() {
  local file="$1"
  local key="$2"
  [[ -f "$file" ]] || return 0
  # grep 对缺键退出 1；调用方都在 set -euo pipefail 下，必须吞掉这个状态码，否则整个部署脚本会在这里中止。
  { grep -E "^${key}=" "$file" || true; } | tail -n 1 | cut -d '=' -f2-
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

# render_caddyfile BRIDGE_DOMAIN_LIST API_RELAY_DOMAIN API_RELAY_UPSTREAM [WEB_DOMAIN] [WEB_UPSTREAM] → stdout
render_caddyfile() {
  local bridge_domains="$1"
  local api_relay_domain="$2"
  local api_relay_upstream="$3"
  local web_domain="${4:-}"
  local web_upstream="${5:-$DEFAULT_WEB_STATIC_UPSTREAM}"

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

  if [[ -n "$web_domain" ]]; then
    cat <<EOF

# 网页端整站镜像（同域名直出）：/api/* 直通 Worker，其余反代 Pages 源站。证书走 Cloudflare DNS-01，
# 因此能在 DNS 切到本机之前预签；Pages 的 308 去扩展名跳转会带源站域名，header_down 把它改回本域名。
https://${web_domain} {
  tls {
    dns cloudflare {env.CF_DNS_API_TOKEN}
    resolvers 1.1.1.1 1.0.0.1
  }
  encode zstd gzip
  handle /api/* {
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
  handle {
    reverse_proxy https://${web_upstream} {
      header_up Host ${web_upstream}
      header_down Location https://${web_upstream} https://${web_domain}
      transport http {
        tls_server_name ${web_upstream}
        response_header_timeout 60s
      }
    }
  }
}
EOF
  fi
}

# caddy_download_url MACHINE → stdout：Caddy 官方下载 API，带 caddy-dns/cloudflare 模块；未知架构返回 1。
caddy_download_url() {
  local machine="$1"
  local arch
  case "$machine" in
    x86_64 | amd64) arch="amd64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *)
      echo "[bridge-caddy] unsupported architecture for custom caddy build: $machine" >&2
      return 1
      ;;
  esac
  printf '%s?os=linux&arch=%s&p=github.com%%2Fcaddy-dns%%2Fcloudflare' "$CADDY_DOWNLOAD_BASE" "$arch"
}

# ensure_caddy_cloudflare_dns：保证 `caddy` 带 dns.providers.cloudflare 模块。已有则直接返回；
# 否则按 Caddy 官方 apt 包的自定义构建方式安装：dpkg-divert 把官方二进制挪到 caddy.default，
# 自定义构建放 caddy.custom，update-alternatives 让 /usr/bin/caddy 指向 custom（apt 升级只会更新 .default）。
ensure_caddy_cloudflare_dns() {
  if command -v caddy >/dev/null 2>&1 && caddy list-modules 2>/dev/null | grep -q '^dns.providers.cloudflare'; then
    echo "[bridge-caddy] caddy already provides dns.providers.cloudflare"
    return 0
  fi
  local url tmp
  url="$(caddy_download_url "$(uname -m)")" || return 1
  tmp="$(mktemp)"
  echo "[bridge-caddy] downloading caddy with the cloudflare DNS module: $url"
  curl -fsSL --retry 3 --max-time 180 "$url" -o "$tmp"
  chmod +x "$tmp"
  if ! "$tmp" list-modules 2>/dev/null | grep -q '^dns.providers.cloudflare'; then
    echo "[bridge-caddy] downloaded caddy lacks dns.providers.cloudflare, aborting" >&2
    rm -f "$tmp"
    return 1
  fi
  if [[ -e /usr/bin/caddy && ! -e /usr/bin/caddy.default ]]; then
    as_root dpkg-divert --divert /usr/bin/caddy.default --rename /usr/bin/caddy
  fi
  as_root install -m 0755 "$tmp" /usr/bin/caddy.custom
  rm -f "$tmp"
  if [[ -e /usr/bin/caddy.default ]]; then
    as_root update-alternatives --install /usr/bin/caddy caddy /usr/bin/caddy.default 10
  fi
  as_root update-alternatives --install /usr/bin/caddy caddy /usr/bin/caddy.custom 50
  as_root update-alternatives --set caddy /usr/bin/caddy.custom
  echo "[bridge-caddy] installed custom caddy: $(/usr/bin/caddy version 2>/dev/null | head -n 1)"
}

# install_caddy_env BRIDGE_ENV_FILE：把 RELAY_TRUST_TOKEN 与 CF_DNS_API_TOKEN 从 bridge/.env 抄进 Caddy 专用
# 环境文件，并用 systemd drop-in 让 caddy.service 加载它（apt 版 caddy 单元没有 EnvironmentFile）。
install_caddy_env() {
  local env_file="$1"
  local token cf_token
  token="$(read_env_value "$env_file" RELAY_TRUST_TOKEN)"
  cf_token="$(read_env_value "$env_file" CF_DNS_API_TOKEN)"
  as_root mkdir -p "$CADDY_DROPIN_DIR"
  printf 'RELAY_TRUST_TOKEN=%s\nCF_DNS_API_TOKEN=%s\n' "$token" "$cf_token" | as_root tee "$CADDY_ENV_FILE" >/dev/null
  if ! as_root chown root:caddy "$CADDY_ENV_FILE" 2>/dev/null; then
    echo "[bridge-caddy] warning: chown root:caddy $CADDY_ENV_FILE failed (caddy user missing?)" >&2
  fi
  as_root chmod 0640 "$CADDY_ENV_FILE"
  local caddy_bin
  caddy_bin="$(command -v caddy)"
  render_caddy_dropin "$caddy_bin" | as_root tee "$CADDY_DROPIN_FILE" >/dev/null
  as_root systemctl daemon-reload
}

# render_caddy_dropin CADDY_BIN → stdout：caddy.service 的 drop-in。
# apt 版单元的 ExecStart 带 --environ，会在每次启动时把完整环境（含 RELAY_TRUST_TOKEN）打进 journal，
# 并经 workflow 的 systemctl status 进入 CI 日志；这里重置 ExecStart 去掉它。环境文件缺失不致命（- 前缀）。
render_caddy_dropin() {
  local caddy_bin="$1"
  cat <<EOF
[Service]
EnvironmentFile=-${CADDY_ENV_FILE}
ExecStart=
ExecStart=${caddy_bin} run --config ${CADDYFILE_PATH}
EOF
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

  local web_domain web_upstream cf_token
  web_domain="${WEB_PUBLIC_DOMAIN:-$(read_env_value "$env_file" WEB_PUBLIC_DOMAIN)}"
  if [[ "$web_domain" == "none" ]]; then
    web_domain=""
  fi
  web_upstream="${WEB_STATIC_UPSTREAM:-$(read_env_value "$env_file" WEB_STATIC_UPSTREAM)}"
  web_upstream="${web_upstream:-$DEFAULT_WEB_STATIC_UPSTREAM}"
  cf_token="${CF_DNS_API_TOKEN:-$(read_env_value "$env_file" CF_DNS_API_TOKEN)}"
  if [[ -n "$web_domain" && -z "$cf_token" ]]; then
    echo "[bridge-caddy] warning: WEB_PUBLIC_DOMAIN=${web_domain} but CF_DNS_API_TOKEN is empty; web site skipped (DNS-01 needs the token)" >&2
    web_domain=""
  fi

  if [[ -z "$bridge_domains" && -z "$relay_domain" && -z "$web_domain" ]]; then
    echo "[bridge-caddy] no domains configured, skip Caddy configuration"
    return 0
  fi

  if [[ -n "$web_domain" ]]; then
    ensure_caddy_cloudflare_dns
  fi
  install_caddy_env "$env_file"
  render_caddyfile "$bridge_domains" "$relay_domain" "$relay_upstream" "$web_domain" "$web_upstream" | as_root tee "$CADDYFILE_PATH" >/dev/null
  as_root caddy validate --config "$CADDYFILE_PATH" --adapter caddyfile
  as_root systemctl enable caddy
  as_root systemctl restart caddy
  echo "[bridge-caddy] Caddy configured: bridge=[${bridge_domains}] api-relay=[${relay_domain}] upstream=[${relay_upstream}] web=[${web_domain}] web-upstream=[${web_upstream}]"
}
