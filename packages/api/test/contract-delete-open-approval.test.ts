import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queue } from "../src/queue-handler";
import { contractRoutes } from "../src/routes/contract";
import { applyAiGateReturn } from "../src/services/approval/ai-gate-apply";
import { returnToInitiator } from "../src/services/approval/operations";
import {
  createMigratedDatabase,
  createSqliteD1,
  hasSqlite,
  normalizeParam
} from "./helpers/sqlite-d1";

// 背景（2026-11-11，SP-20261013-0005 / CT-20261013-0005）：合同在审批走到最后一步「复核」时被删除，
// 删除只把合同置 deleted，审批实例还是进行中、复核人的待办一直挂着：
//  - 打开这张审批取不到合同，报 Contract not found；
//  - 复核人一旦点通过，审批回写会把已删除的合同改回 active，变成一份重复合同。
// 删除接口当时也不记审计，查不出是谁删的。
// 这里用真实 SQLite + 真实迁移 + 真实路由和队列消费者复现这两件事。

const authState = vi.hoisted(() => ({
  payload: {
    sub: "finance-a",
    username: "finance-a",
    nickname: "Finance A",
    avatar: "",
    roles: ["finance"],
    permissions: [],
    tokenId: "token-a",
    type: "access",
    auth_method: "wecom_oauth",
    wecom_verified_at: "2026-07-01T00:00:00.000Z",
    exp: 4102444800,
    iat: 1770000000
  }
}));

vi.mock("../src/services/auth", () => ({ verifyToken: async () => authState.payload }));

// 审批结果会给发起人推企微卡片，测试里不发
vi.mock("../src/services/wecom-approval-push", () => ({
  sendApprovalTodoTemplateCard: async () => ({
    msgid: "m1",
    invaliduser: null,
    unlicenseduser: null
  }),
  sendApprovalResultTemplateCard: async () => ({
    msgid: "m2",
    invaliduser: null,
    unlicenseduser: null
  }),
  resolveApplicantDisplayName: async (_env, userid) => userid,
  resolveApprovalPushMeta: async () => ({ requestTitle: "测试合同", amountText: "¥80,000.00" })
}));

const SEEDED_AT = "2026-10-13T08:51:36.948Z";

describe.skipIf(!hasSqlite)("删除合同时收口它的审批", () => {
  let database;
  let env;
  let sequence = 0;

  const next = () => {
    sequence += 1;
    return sequence;
  };

  const insertRow = (table, row) => {
    const columns = Object.keys(row);
    const info = database
      .prepare(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
      )
      .run(...columns.map((column) => normalizeParam(row[column])));
    return Number(info.lastInsertRowid);
  };

  const rowOf = (table, id) => database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);

  const seedContract = (patch = {}) =>
    insertRow("contract", {
      contract_no: `CT-TEST-${next()}`,
      direction: "outbound",
      project_id: 143,
      entity_id: 18,
      counterparty: "王志敏",
      contract_type: "其他",
      handler_userid: "initiator-a",
      contract_date: "2026-10-13",
      total_amount: 80000,
      status: "pending_approval",
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT,
      ...patch
    });

  /** 一个停在「复核」节点、复核人待办未处理的审批实例。 */
  const seedApproval = ({ bizType = "outbound_contract", bizId, status = "in_progress" }) => {
    const running = status === "in_progress";
    const instanceId = insertRow("approval_instance", {
      instance_no: `SP-TEST-${next()}`,
      template_id: 2,
      biz_type: bizType,
      biz_id: bizId,
      biz_summary: "CT-TEST | 王志敏 | 80000",
      initiator_userid: "initiator-a",
      current_node_key: running ? "review" : null,
      status,
      current_round: 1,
      submitted_at: SEEDED_AT,
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT
    });
    const nodeId = insertRow("approval_node_instance", {
      instance_id: instanceId,
      node_key: "review",
      node_type: "sequential",
      node_name: "复核",
      assignee_userids: JSON.stringify(["approver-a"]),
      status: "in_progress",
      round: 1,
      sort_order: 3,
      started_at: SEEDED_AT,
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT
    });
    const taskId = insertRow("approval_task", {
      node_instance_id: nodeId,
      instance_id: instanceId,
      assignee_userid: "approver-a",
      round: 1,
      status: "pending",
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT
    });
    return { instanceId, nodeId, taskId };
  };

  const seedAiGateTask = (instanceId) =>
    insertRow("task_queue", {
      task_code: `TK-TEST-${next()}`,
      task_type: "approval_ai_gate",
      biz_type: "approval_ai_gate",
      biz_id: instanceId,
      payload_json: "{}",
      status: "pending",
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT
    });

  const deleteContract = (id) => {
    const app = new Hono();
    app.route("/contract", contractRoutes);
    return app.request(
      `/contract/${id}`,
      { method: "DELETE", headers: { authorization: "Bearer test-token" } },
      env
    );
  };

  const deliver = (type, instanceId) =>
    queue(
      {
        messages: [
          {
            body: {
              type,
              source: "approval-engine",
              payload: { instance_id: instanceId },
              timestamp: SEEDED_AT
            },
            ack() {},
            retry() {}
          }
        ]
      },
      env
    );

  beforeEach(() => {
    database = createMigratedDatabase();
    env = {
      APP_ENV: "local",
      DB: createSqliteD1(database),
      KV: {
        get: async (key) => (key.startsWith("session:") ? "session" : null),
        put: async () => {},
        delete: async () => {}
      },
      EVENT_QUEUE: { send: async () => {} }
    };
    authState.payload = { ...authState.payload, sub: "finance-a", roles: ["finance"] };
  });

  describe("DELETE /contract/:id", () => {
    it("终止进行中的审批：实例、节点、待办一起收口，别的单子不动", async () => {
      const contractId = seedContract();
      const own = seedApproval({ bizId: contractId });
      const otherContractId = seedContract();
      const otherContract = seedApproval({ bizId: otherContractId });
      // 付款审批的 biz_id 可能恰好等于合同 id，不能被当成这份合同的审批
      const sameIdPayment = seedApproval({ bizType: "payment_request", bizId: contractId });

      const response = await deleteContract(contractId);

      expect(response.status).toBe(200);
      expect(rowOf("contract", contractId).status).toBe("deleted");
      const instance = rowOf("approval_instance", own.instanceId);
      expect(instance.status).toBe("cancelled");
      expect(instance.completed_at).not.toBeNull();
      expect(rowOf("approval_node_instance", own.nodeId).status).toBe("cancelled");
      expect(rowOf("approval_task", own.taskId).status).toBe("cancelled");

      expect(rowOf("contract", otherContractId).status).toBe("pending_approval");
      expect(rowOf("approval_instance", otherContract.instanceId).status).toBe("in_progress");
      expect(rowOf("approval_task", otherContract.taskId).status).toBe("pending");
      expect(rowOf("approval_instance", sameIdPayment.instanceId).status).toBe("in_progress");
      expect(rowOf("approval_task", sameIdPayment.taskId).status).toBe("pending");
    });

    it.each(["returned", "withdrawn", "pending"])(
      "%s 状态、等发起人重提的审批也终止",
      async (status) => {
        const contractId = seedContract({ status: "draft" });
        const { instanceId } = seedApproval({ bizId: contractId, status });

        const response = await deleteContract(contractId);

        expect(response.status).toBe(200);
        expect(rowOf("approval_instance", instanceId).status).toBe("cancelled");
      }
    );

    it("已经走完的审批保持原样", async () => {
      const contractId = seedContract({ status: "active" });
      const { instanceId } = seedApproval({ bizId: contractId, status: "approved" });

      const response = await deleteContract(contractId);

      expect(response.status).toBe(200);
      expect(rowOf("contract", contractId).status).toBe("deleted");
      expect(rowOf("approval_instance", instanceId).status).toBe("approved");
      const actions = database
        .prepare("SELECT COUNT(*) AS total FROM approval_initiator_action WHERE instance_id = ?")
        .get(instanceId);
      expect(actions.total).toBe(0);
    });

    it("在审批记录里写明是谁、因为删除合同终止的", async () => {
      const contractId = seedContract();
      const { instanceId } = seedApproval({ bizId: contractId });

      await deleteContract(contractId);

      const actions = database
        .prepare(
          "SELECT action, userid, comment FROM approval_initiator_action WHERE instance_id = ?"
        )
        .all(instanceId);
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe("cancel");
      expect(actions[0].userid).toBe("finance-a");
      expect(actions[0].comment).toContain("合同已删除");
    });

    it("撤回被终止审批还没跑的 AI 关卡任务", async () => {
      const contractId = seedContract();
      const own = seedApproval({ bizId: contractId });
      const otherContract = seedApproval({ bizId: seedContract() });
      const ownGateTask = seedAiGateTask(own.instanceId);
      const otherGateTask = seedAiGateTask(otherContract.instanceId);

      await deleteContract(contractId);

      expect(rowOf("task_queue", ownGateTask).status).toBe("cancelled");
      expect(rowOf("task_queue", otherGateTask).status).toBe("pending");
    });

    it("记审计：谁删的、删之前什么状态、终止了哪些审批", async () => {
      const contractId = seedContract({ contract_no: "CT-20261013-0005" });
      const { instanceId } = seedApproval({ bizId: contractId });

      await deleteContract(contractId);

      const audits = database
        .prepare(
          "SELECT actor_userid, action, detail_json FROM api_audit_log WHERE target_type = 'contract' AND target_id = ?"
        )
        .all(String(contractId));
      expect(audits).toHaveLength(1);
      expect(audits[0].actor_userid).toBe("finance-a");
      expect(audits[0].action).toBe("contract.delete");
      expect(JSON.parse(audits[0].detail_json)).toEqual({
        contract_no: "CT-20261013-0005",
        previous_status: "pending_approval",
        closed_approval_instance_ids: [instanceId]
      });
    });

    it("合同不存在时返回 404，不留审计", async () => {
      const response = await deleteContract(999999);

      expect(response.status).toBe(404);
      const audits = database.prepare("SELECT COUNT(*) AS total FROM api_audit_log").get();
      expect(audits.total).toBe(0);
    });
  });

  describe("审批回写不复活已删除的合同", () => {
    it.each(["outbound_contract", "inbound_contract"])(
      "%s 审批通过：已删除的合同保持删除，正常合同照常生效",
      async (bizType) => {
        const deletedId = seedContract({ status: "deleted" });
        const liveId = seedContract();
        const orphan = seedApproval({ bizType, bizId: deletedId, status: "approved" });
        const live = seedApproval({ bizType, bizId: liveId, status: "approved" });

        await deliver("APPROVAL_APPROVED", orphan.instanceId);
        await deliver("APPROVAL_APPROVED", live.instanceId);

        expect(rowOf("contract", deletedId).status).toBe("deleted");
        expect(rowOf("contract", liveId).status).toBe("active");
      }
    );

    it.each(["outbound_contract", "inbound_contract"])(
      "%s 审批驳回：已删除的合同保持删除，正常合同回草稿",
      async (bizType) => {
        const deletedId = seedContract({ status: "deleted" });
        const liveId = seedContract();
        const orphan = seedApproval({ bizType, bizId: deletedId, status: "rejected" });
        const live = seedApproval({ bizType, bizId: liveId, status: "rejected" });

        await deliver("APPROVAL_REJECTED", orphan.instanceId);
        await deliver("APPROVAL_REJECTED", live.instanceId);

        expect(rowOf("contract", deletedId).status).toBe("deleted");
        expect(rowOf("contract", liveId).status).toBe("draft");
      }
    );

    it("审批人退回发起人：已删除的合同保持删除，正常合同回草稿", async () => {
      const deletedId = seedContract({ status: "deleted" });
      const liveId = seedContract();
      const orphan = seedApproval({ bizId: deletedId });
      const live = seedApproval({ bizId: liveId });

      await returnToInitiator(env, orphan.taskId, "approver-a", "合同已经删了");
      await returnToInitiator(env, live.taskId, "approver-a", "补材料");

      expect(rowOf("contract", deletedId).status).toBe("deleted");
      expect(rowOf("contract", liveId).status).toBe("draft");
    });

    it("AI 关卡退回：已删除的合同保持删除，正常合同回草稿", async () => {
      const deletedId = seedContract({ status: "deleted" });
      const liveId = seedContract();
      const orphan = seedApproval({ bizId: deletedId });
      const live = seedApproval({ bizId: liveId });
      const refOf = (instanceId, bizId) => ({
        id: instanceId,
        instance_no: rowOf("approval_instance", instanceId).instance_no,
        biz_type: "outbound_contract",
        biz_id: bizId
      });

      await applyAiGateReturn(env, refOf(orphan.instanceId, deletedId), orphan.nodeId);
      await applyAiGateReturn(env, refOf(live.instanceId, liveId), live.nodeId);

      expect(rowOf("contract", deletedId).status).toBe("deleted");
      expect(rowOf("contract", liveId).status).toBe("draft");
    });
  });
});
