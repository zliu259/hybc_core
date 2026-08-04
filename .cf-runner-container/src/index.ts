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
    API_BASE_URL: "https://api.hybcdg.com",
    API_KEY: "40aea6c95e44af22a4fd04f6f0c2cf26",
    NODE_NAME: "cf-container-runner",
    NODE_TYPE: "cloudflare_container",
    POLL_INTERVAL_SECONDS: "3",
    HEARTBEAT_INTERVAL_SECONDS: "60",
    // 注意：该环境变量会覆盖 runner/config.py 的默认能力清单——新增任务类型
    // 必须同时在此登记，否则容器起来也不会领取新任务
    CAPABILITIES: "contract_review,risk_assessment,payment_risk_assessment,reimbursement_check,reimbursement_anomaly,log_smart_fill,log_analysis,log_summary,external_log_audit,equipment_recommend,consumable_estimation,inventory_alert_analysis,consumption_anomaly,ocr_extract,file_generate,voice_stt,approval_ai_gate,contract_precheck_extract",
    MOCK_AI_ONLY: "false",
    OPENAI_MODEL: "gpt-5.5",
    OPENAI_MODEL_CONTRACT_REVIEW_TEXT: "gpt-5.5",
    OPENAI_MODEL_CONTRACT_REVIEW_VISION: "gpt-4o",
    OPENAI_MODEL_APPROVAL_AI_GATE_TEXT: "gpt-5.5",
    OPENAI_MODEL_APPROVAL_AI_GATE_VISION: "gpt-4o",
    OPENAI_MODEL_VISION_FALLBACK: "gpt-4o",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    ANTHROPIC_MODEL: "claude-sonnet-4-20250514"
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const container = env.RUNNER.getByName("singleton-v7");

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    return container.fetch("http://container/");
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    const shouldWake = await fetch("https://api.hybcdg.com/api/v1/system/automation/task-queue-backlog", {
      method: "GET",
      headers: {
        "x-api-key": "40aea6c95e44af22a4fd04f6f0c2cf26"
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

    const container = env.RUNNER.getByName("singleton-v7");
    await container.fetch("http://container/");
  }
};
