const required = [
  "API_BASE_URL",
  "AUTH_TOKEN",
  "SELF_USERID",
  "PROJECT_ID",
  "ENTITY_ID",
  "PAYEE_ID"
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env: ${key}`);
  }
}

const API_BASE_URL = process.env.API_BASE_URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const SELF_USERID = process.env.SELF_USERID;
const PROJECT_ID = Number(process.env.PROJECT_ID);
const ENTITY_ID = Number(process.env.ENTITY_ID);
const PAYEE_ID = Number(process.env.PAYEE_ID);

const now = new Date();
const isoDay = now.toISOString().slice(0, 10);
const amount = Number(process.env.PAYMENT_AMOUNT ?? "1000");
const contractAmount = Number(process.env.CONTRACT_AMOUNT ?? "100000");

const req = async (path, init = {}) => {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      authorization: `Bearer ${AUTH_TOKEN}`,
      ...(init.headers ?? {})
    }
  });

  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON response ${res.status} ${path}: ${text}`);
  }

  if (!res.ok || body?.success === false) {
    throw new Error(`Request failed ${res.status} ${path}: ${JSON.stringify(body)}`);
  }

  return body;
};

const createContract = async () => {
  const payload = {
    direction: "outbound",
    project_id: PROJECT_ID,
    entity_id: ENTITY_ID,
    counterparty: `E2E供应商-${Date.now()}`,
    contract_type: "材料",
    handler_userid: SELF_USERID,
    contract_date: isoDay,
    total_amount: contractAmount,
    remark: "phase3-e2e"
  };
  const res = await req("/api/v1/contract", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return res.data.id;
};

const createPaymentRequest = async (contractId) => {
  const payload = {
    contract_id: contractId,
    project_id: PROJECT_ID,
    expected_payment_date: isoDay,
    category: "材料费",
    payee_id: PAYEE_ID,
    amount,
    content: "phase3-e2e payment",
    payment_method: "对公转账",
    remark: "phase3-e2e"
  };
  const res = await req("/api/v1/payment", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return res.data.id;
};

const submitApproval = async (path) => {
  const payload = {
    instance_config: {
      default_assignee_userids: [SELF_USERID],
      note: "phase3-e2e default self-approval"
    }
  };
  const res = await req(path, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  return res.data.approval_instance_id;
};

const approveUntilDone = async (instanceId) => {
  for (let i = 0; i < 12; i += 1) {
    const detail = await req(`/api/v1/approval/${instanceId}`);
    const status = detail.data.instance.status;
    if (status === "approved") return;
    if (status !== "in_progress") {
      throw new Error(`Unexpected approval status: ${status}`);
    }

    const actions = detail.data.available_actions ?? [];
    if (!actions.includes("approve")) {
      throw new Error(`No approve action available on round ${detail.data.instance.current_round}`);
    }

    await req(`/api/v1/approval/${instanceId}/approve`, {
      method: "POST",
      body: JSON.stringify({ comment: `phase3-e2e approve step ${i + 1}` })
    });
  }

  throw new Error(`Approval did not complete in expected iterations: ${instanceId}`);
};

const main = async () => {
  console.log("[phase3-e2e] creating outbound contract");
  const contractId = await createContract();
  console.log(`[phase3-e2e] contract created: ${contractId}`);

  await req(`/api/v1/contract/${contractId}/trigger-review`, { method: "POST" });
  console.log("[phase3-e2e] contract AI review triggered");

  const contractInstanceId = await submitApproval(`/api/v1/contract/${contractId}/submit-approval`);
  console.log(`[phase3-e2e] contract approval submitted: ${contractInstanceId}`);
  await approveUntilDone(contractInstanceId);
  console.log("[phase3-e2e] contract approval completed");

  const paymentId = await createPaymentRequest(contractId);
  console.log(`[phase3-e2e] payment request created: ${paymentId}`);

  await req(`/api/v1/payment/${paymentId}/trigger-risk-assessment`, { method: "POST" });
  console.log("[phase3-e2e] payment risk assessment triggered");

  const paymentInstanceId = await submitApproval(`/api/v1/payment/${paymentId}/submit-approval`);
  console.log(`[phase3-e2e] payment approval submitted: ${paymentInstanceId}`);
  await approveUntilDone(paymentInstanceId);
  console.log("[phase3-e2e] payment approval completed");

  await req(`/api/v1/payment/${paymentId}/mark-paid`, { method: "POST" });
  console.log("[phase3-e2e] payment marked paid");

  const contract = await req(`/api/v1/contract/${contractId}`);
  const paid = Number(contract.data.paid_amount);
  if (paid < amount) {
    throw new Error(`Contract paid_amount check failed. expected >= ${amount}, got ${paid}`);
  }

  console.log("[phase3-e2e] PASS");
  console.log(JSON.stringify({ contractId, paymentId, contractInstanceId, paymentInstanceId }, null, 2));
};

main().catch((err) => {
  console.error("[phase3-e2e] FAIL", err);
  process.exit(1);
});
