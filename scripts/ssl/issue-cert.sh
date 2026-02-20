#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Auto issue and install TLS certificates via acme.sh.

Usage:
  issue-cert.sh --domain DOMAIN --email EMAIL [options]

Required:
  --domain DOMAIN        Primary domain, e.g. apix.hybcdg.com
  --email EMAIL          ACME account email

Options:
  --mode MODE            Challenge mode: standalone | tls_alpn | webroot | dns_cf (default: standalone)
  --webroot PATH         Required when mode=webroot
  --out-dir PATH         Output base dir (default: /etc/letsencrypt/live)
  --reload-cmd CMD       Reload command after cert install (default: "systemctl reload nginx")
  --server NAME          ACME server: letsencrypt | zerossl (default: letsencrypt)
  --rsa                  Use RSA-2048 instead of EC-256
  --staging              Use Let's Encrypt staging endpoint
  --force                Force re-issue

Examples:
  sudo ./scripts/ssl/issue-cert.sh \
    --domain apix.hybcdg.com \
    --email ops@hybcdg.com

  sudo ./scripts/ssl/issue-cert.sh \
    --domain apix.hybcdg.com \
    --email ops@hybcdg.com \
    --mode webroot \
    --webroot /var/www/html

  CF_Token=xxx CF_Zone_ID=yyy \
  sudo ./scripts/ssl/issue-cert.sh \
    --domain apix.hybcdg.com \
    --email ops@hybcdg.com \
    --mode dns_cf

  CF_Token=xxx CF_Account_ID=yyy \
  sudo ./scripts/ssl/issue-cert.sh \
    --domain apix.hybcdg.com \
    --email ops@hybcdg.com \
    --mode dns_cf

Notes:
  - standalone mode needs port 80 reachable from internet.
  - webroot mode needs your HTTP server already serving /.well-known/acme-challenge.
  - dns_cf mode supports either:
      1) CF_Token + (CF_Zone_ID or CF_Account_ID), or
      2) CF_Key + CF_Email (legacy global key, not recommended).
EOF
}

DOMAIN=""
EMAIL=""
MODE="standalone"
WEBROOT=""
OUT_DIR="/etc/letsencrypt/live"
RELOAD_CMD="systemctl reload nginx"
SERVER="letsencrypt"
KEY_TYPE="ec-256"
USE_STAGING="false"
FORCE="false"
DEBUG="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --webroot)
      WEBROOT="${2:-}"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --reload-cmd)
      RELOAD_CMD="${2:-}"
      shift 2
      ;;
    --server)
      SERVER="${2:-}"
      shift 2
      ;;
    --rsa)
      KEY_TYPE="2048"
      shift
      ;;
    --staging)
      USE_STAGING="true"
      shift
      ;;
    --force)
      FORCE="true"
      shift
      ;;
    --debug)
      DEBUG="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "--domain and --email are required" >&2
  usage
  exit 1
fi

if [[ "$MODE" != "standalone" && "$MODE" != "tls_alpn" && "$MODE" != "webroot" && "$MODE" != "dns_cf" ]]; then
  echo "Invalid --mode: $MODE" >&2
  exit 1
fi

if [[ "$MODE" == "webroot" && -z "$WEBROOT" ]]; then
  echo "--webroot is required when --mode webroot" >&2
  exit 1
fi

if [[ "$MODE" == "webroot" && ! -d "$WEBROOT" ]]; then
  echo "Webroot does not exist: $WEBROOT" >&2
  exit 1
fi

if [[ "$MODE" == "dns_cf" ]]; then
  HAS_TOKEN_MODE="false"
  HAS_KEY_MODE="false"

  if [[ -n "${CF_Token:-}" && ( -n "${CF_Zone_ID:-}" || -n "${CF_Account_ID:-}" ) ]]; then
    HAS_TOKEN_MODE="true"
  fi

  if [[ -n "${CF_Key:-}" && -n "${CF_Email:-}" ]]; then
    HAS_KEY_MODE="true"
  fi

  if [[ "$HAS_TOKEN_MODE" == "false" && "$HAS_KEY_MODE" == "false" ]]; then
    echo "dns_cf requires either CF_Token + (CF_Zone_ID or CF_Account_ID), or CF_Key + CF_Email" >&2
    exit 1
  fi
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

if [[ ! -x "$HOME/.acme.sh/acme.sh" ]]; then
  echo "Installing acme.sh..."
  curl -fsSL https://get.acme.sh | sh -s email="$EMAIL"
fi

ACME_SH="$HOME/.acme.sh/acme.sh"
if [[ ! -x "$ACME_SH" ]]; then
  echo "acme.sh not found at $ACME_SH" >&2
  exit 1
fi

mkdir -p "$OUT_DIR/$DOMAIN"

ISSUE_ARGS=(--issue -d "$DOMAIN" --server "$SERVER" --keylength "$KEY_TYPE")
if [[ "$USE_STAGING" == "true" ]]; then
  ISSUE_ARGS+=(--staging)
fi
if [[ "$FORCE" == "true" ]]; then
  ISSUE_ARGS+=(--force)
fi
if [[ "$DEBUG" == "true" ]]; then
  ISSUE_ARGS+=(--debug 2)
fi

case "$MODE" in
  standalone)
    ISSUE_ARGS+=(--standalone)
    ;;
  tls_alpn)
    ISSUE_ARGS+=(--alpn)
    ;;
  webroot)
    ISSUE_ARGS+=(--webroot "$WEBROOT")
    ;;
  dns_cf)
    ISSUE_ARGS+=(--dns dns_cf)
    ;;
esac

echo "Issuing certificate for $DOMAIN via mode=$MODE server=$SERVER key=$KEY_TYPE"
"$ACME_SH" "${ISSUE_ARGS[@]}"

CERT_PATH="$OUT_DIR/$DOMAIN/fullchain.pem"
KEY_PATH="$OUT_DIR/$DOMAIN/privkey.pem"
CA_PATH="$OUT_DIR/$DOMAIN/ca.cer"

echo "Installing certificate to $OUT_DIR/$DOMAIN"
"$ACME_SH" --install-cert -d "$DOMAIN" \
  --key-file "$KEY_PATH" \
  --fullchain-file "$CERT_PATH" \
  --ca-file "$CA_PATH" \
  --reloadcmd "$RELOAD_CMD"

echo "Done."
echo "Certificate: $CERT_PATH"
echo "Private key: $KEY_PATH"
echo "CA chain: $CA_PATH"
echo "Reminder: set WECHAT_REDIRECT_URI to https://$DOMAIN/login and PASSKEY_RP_ID to $DOMAIN"
