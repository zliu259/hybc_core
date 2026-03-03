import { Container } from "@cloudflare/containers";

type Env = {
  RUNNER: DurableObjectNamespace;
};

export class RunnerContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "20s";
  envVars = {
    API_BASE_URL: "https://api.hybcdg.com",
    API_KEY: "40aea6c95e44af22a4fd04f6f0c2cf26",
    NODE_NAME: "cf-container-runner",
    NODE_TYPE: "cloudflare_container",
    POLL_INTERVAL_SECONDS: "3",
    HEARTBEAT_INTERVAL_SECONDS: "30",
    CAPABILITIES: "contract_review,risk_assessment,payment_risk_assessment,approval_ai_gate,reimbursement_check,reimbursement_anomaly,log_smart_fill,log_analysis,log_summary,ocr_extract,equipment_recommend,consumable_estimation,inventory_alert_analysis,consumption_anomaly,file_generate,voice_stt",
    MOCK_AI_ONLY: "false",
    OPENAI_MODEL: "gpt-5.2",
    OPENAI_MODEL_CONTRACT_REVIEW_TEXT: "gpt-5.2",
    OPENAI_MODEL_CONTRACT_REVIEW_VISION: "gpt-4o",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    ANTHROPIC_MODEL: "claude-sonnet-4-20250514"
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const container = env.RUNNER.getByName("singleton");

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    return container.fetch("http://container/");
  }
};
