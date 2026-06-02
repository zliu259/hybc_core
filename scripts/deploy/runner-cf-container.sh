#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[runner-cf] Missing command: $1" >&2
    exit 1
  fi
}

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$ROOT_DIR/.cf-runner-container}"
DEPLOY="${DEPLOY:-false}"
RUNNER_DOMAIN="${RUNNER_DOMAIN:-runner.hybcdg.com}"

API_BASE_URL="${API_BASE_URL:-}"
API_KEY="${API_KEY:-}"
NODE_NAME="${NODE_NAME:-cf-container-runner}"
NODE_TYPE="${NODE_TYPE:-cloudflare_container}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-3}"
HEARTBEAT_INTERVAL_SECONDS="${HEARTBEAT_INTERVAL_SECONDS:-60}"
RUNNER_INSTANCE_NAME="${RUNNER_INSTANCE_NAME:-singleton-v5}"
CAPABILITIES="${CAPABILITIES:-contract_review,risk_assessment,payment_risk_assessment,reimbursement_check,reimbursement_anomaly,log_smart_fill,log_analysis,log_summary,external_log_audit,equipment_recommend,consumable_estimation,inventory_alert_analysis,consumption_anomaly,ocr_extract,file_generate,voice_stt,approval_ai_gate}"
MOCK_AI_ONLY="${MOCK_AI_ONLY:-false}"
OPENAI_MODEL="${OPENAI_MODEL:-gpt-5.5}"
OPENAI_MODEL_CONTRACT_REVIEW_TEXT="${OPENAI_MODEL_CONTRACT_REVIEW_TEXT:-gpt-5.5}"
OPENAI_MODEL_CONTRACT_REVIEW_VISION="${OPENAI_MODEL_CONTRACT_REVIEW_VISION:-gpt-4o}"
OPENAI_MODEL_APPROVAL_AI_GATE_TEXT="${OPENAI_MODEL_APPROVAL_AI_GATE_TEXT:-gpt-5.5}"
OPENAI_MODEL_APPROVAL_AI_GATE_VISION="${OPENAI_MODEL_APPROVAL_AI_GATE_VISION:-gpt-4o}"
OPENAI_MODEL_VISION_FALLBACK="${OPENAI_MODEL_VISION_FALLBACK:-gpt-4o}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}"
ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-claude-sonnet-4-20250514}"

if [[ -z "$API_BASE_URL" || -z "$API_KEY" ]]; then
  echo "[runner-cf] API_BASE_URL and API_KEY are required."
  echo "Example: API_BASE_URL=https://api.example.com API_KEY=xxx bash scripts/deploy/runner-cf-container.sh"
  exit 1
fi

require_cmd docker
require_cmd npm
require_cmd curl
require_cmd tar

echo "[runner-cf] Preparing project in $PROJECT_DIR"
rm -rf "$PROJECT_DIR"
mkdir -p "$PROJECT_DIR/src" "$PROJECT_DIR/runner" "$PROJECT_DIR/vendor"

cp "$ROOT_DIR/task-runner/requirements.txt" "$PROJECT_DIR/requirements.txt"
cp -R "$ROOT_DIR/task-runner/runner/." "$PROJECT_DIR/runner/"

cat >"$PROJECT_DIR/package.json" <<'EOF'
{
  "name": "hybc-cf-runner",
  "private": true,
  "type": "module",
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev"
  }
}
EOF

echo "[runner-cf] Vendoring @cloudflare/containers dist"
TMP_DIR="$(mktemp -d)"
CONTAINERS_TARBALL_URL="$(npm view @cloudflare/containers dist.tarball)"
curl -sSL "$CONTAINERS_TARBALL_URL" -o "$TMP_DIR/containers.tgz"
tar -xzf "$TMP_DIR/containers.tgz" -C "$TMP_DIR"
cp -R "$TMP_DIR/package/dist" "$PROJECT_DIR/vendor/containers"
rm -rf "$TMP_DIR"

cat >"$PROJECT_DIR/Dockerfile" <<'EOF'
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY runner ./runner

EXPOSE 8080

CMD ["bash", "-lc", "python -m runner.main & python -m http.server 8080 --bind 0.0.0.0"]
EOF

cat >"$PROJECT_DIR/src/index.ts" <<EOF
import { Container } from "../vendor/containers/index.js";

type Env = {
  RUNNER: {
    getByName(name: string): {
      fetch(input: string | Request): Promise<Response>;
    };
  };
};

export class RunnerContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "30m";
  envVars = {
    API_BASE_URL: "${API_BASE_URL}",
    API_KEY: "${API_KEY}",
    NODE_NAME: "${NODE_NAME}",
    NODE_TYPE: "${NODE_TYPE}",
    POLL_INTERVAL_SECONDS: "${POLL_INTERVAL_SECONDS}",
    HEARTBEAT_INTERVAL_SECONDS: "${HEARTBEAT_INTERVAL_SECONDS}",
    CAPABILITIES: "${CAPABILITIES}",
    MOCK_AI_ONLY: "${MOCK_AI_ONLY}",
    OPENAI_MODEL: "${OPENAI_MODEL}",
    OPENAI_MODEL_CONTRACT_REVIEW_TEXT: "${OPENAI_MODEL_CONTRACT_REVIEW_TEXT}",
    OPENAI_MODEL_CONTRACT_REVIEW_VISION: "${OPENAI_MODEL_CONTRACT_REVIEW_VISION}",
    OPENAI_MODEL_APPROVAL_AI_GATE_TEXT: "${OPENAI_MODEL_APPROVAL_AI_GATE_TEXT}",
    OPENAI_MODEL_APPROVAL_AI_GATE_VISION: "${OPENAI_MODEL_APPROVAL_AI_GATE_VISION}",
    OPENAI_MODEL_VISION_FALLBACK: "${OPENAI_MODEL_VISION_FALLBACK}",
    OPENAI_BASE_URL: "${OPENAI_BASE_URL}",
    ANTHROPIC_MODEL: "${ANTHROPIC_MODEL}"
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const container = env.RUNNER.getByName("${RUNNER_INSTANCE_NAME}");

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    return container.fetch("http://container/");
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const shouldWake = await fetch("${API_BASE_URL}/api/v1/system/automation/task-queue-backlog", {
      method: "GET",
      headers: {
        "x-api-key": "${API_KEY}"
      }
    })
      .then(async (r) => {
        if (!r.ok) {
          return true;
        }
        const payload = (await r.json()) as {
          success?: boolean;
          data?: { should_wake_runner?: boolean };
        };
        return payload?.data?.should_wake_runner === true;
      })
      .catch(() => true);

    if (!shouldWake) {
      return;
    }

    const container = env.RUNNER.getByName("${RUNNER_INSTANCE_NAME}");
    await container.fetch("http://container/");
  }
};
EOF

cat >"$PROJECT_DIR/wrangler.toml" <<'EOF'
name = "hybc-cf-runner"
main = "src/index.ts"
compatibility_date = "2026-03-01"
workers_dev = false

[[routes]]
pattern = "__RUNNER_DOMAIN__"
custom_domain = true

[[containers]]
max_instances = 1
class_name = "RunnerContainer"
image = "./Dockerfile"
instance_type = "lite"

[[durable_objects.bindings]]
name = "RUNNER"
class_name = "RunnerContainer"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RunnerContainer"]

[triggers]
crons = ["*/1 * * * *"]
EOF

sed -i.bak "s/__RUNNER_DOMAIN__/${RUNNER_DOMAIN}/g" "$PROJECT_DIR/wrangler.toml"
rm -f "$PROJECT_DIR/wrangler.toml.bak"

echo "[runner-cf] Scaffold complete"
echo "- Project: $PROJECT_DIR"
echo "- Deploy manually: cd $PROJECT_DIR && npx wrangler deploy"
echo "- Warm container: curl https://<worker-domain>/"

if [[ "$DEPLOY" == "true" ]]; then
  require_cmd npx
  echo "[runner-cf] Deploying with Wrangler..."
  (cd "$PROJECT_DIR" && npx wrangler deploy)
  echo "[runner-cf] Deploy finished"
fi
