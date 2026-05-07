import type { WarehouseManualType } from "../types/warehouse-manual";

export interface WarehouseManualDraftHistoricalTask {
  work_order_no: string;
  work_order_type: string;
  result_summary: string | null;
  completion_summary_json: string | null;
}

export interface WarehouseManualDraftInput {
  manual_id: number;
  manual_title: string;
  manual_type: WarehouseManualType;
  asset_type_id: number | null;
  historical_tasks: WarehouseManualDraftHistoricalTask[];
}

export const buildWarehouseManualDraftTaskPayload = (input: WarehouseManualDraftInput) => ({
  manual_id: input.manual_id,
  manual_title: input.manual_title,
  manual_type: input.manual_type,
  asset_type_id: input.asset_type_id,
  task_count: input.historical_tasks.length,
  historical_tasks: input.historical_tasks.map((task) => ({
    work_order_no: task.work_order_no,
    work_order_type: task.work_order_type,
    result_summary: task.result_summary,
    completion_summary_json: task.completion_summary_json
  })),
  output_contract: {
    status: "draft",
    sections: ["tools", "checks", "steps", "photo_requirements", "safety_notes"],
    publish_policy: "human_review_required"
  }
});

export const buildWarehouseManualDraftContent = (input: WarehouseManualDraftInput): string =>
  JSON.stringify(
    {
      source: "ai_draft",
      status: "draft",
      manual_id: input.manual_id,
      manual_title: input.manual_title,
      manual_type: input.manual_type,
      asset_type_id: input.asset_type_id,
      generated_from_task_count: input.historical_tasks.length,
      steps: [
        {
          title: "准备工具和安全确认",
          detail: "根据历史任务简报补充工具、人员防护和现场安全确认项。",
          required: true
        },
        {
          title: "执行检查或保养步骤",
          detail: "由 AI 草稿根据历史任务简报整理，发布前必须由库房负责人复核。",
          required: true
        },
        {
          title: "照片与简报归档",
          detail: "按任务要求拍照并填写简报，确保设备档案可追溯。",
          required: true
        }
      ],
      historical_summaries: input.historical_tasks
    },
    null,
    2
  );

export const normalizeWarehouseManualDraftResultContent = (result: {
  output: string;
  metadata?: Record<string, unknown>;
}): string => {
  const output = result.output.trim();
  let content: Record<string, unknown>;
  try {
    const parsed = JSON.parse(output) as unknown;
    content =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { body: output };
  } catch {
    content = { body: output };
  }

  return JSON.stringify(
    {
      ...content,
      source: "ai_draft",
      status: "draft",
      ai_metadata: result.metadata ?? null
    },
    null,
    2
  );
};
