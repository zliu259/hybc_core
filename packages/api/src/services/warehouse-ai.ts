import type { TbmCompositionAssetInput, TbmCompositionCandidate } from "./asset-composition";
import type {
  WarehouseTaskPriority,
  WarehouseAssetWorkOrderStatus,
  WarehouseAssetWorkOrderType,
  WarehouseTaskSource
} from "../types/work-order";
import type { WarehouseTaskWorkloadSummary } from "./warehouse-task";

export interface WarehouseDispatchRecommendationTask {
  id: number;
  work_order_no: string;
  work_order_type: WarehouseAssetWorkOrderType;
  priority: WarehouseTaskPriority;
  status: WarehouseAssetWorkOrderStatus;
  warehouse_id: number | null;
  project_id: number | null;
  assignee_userid: string | null;
  package_id: number | null;
  scheduled_date: string | null;
  blocking_flag: number;
  required_photo_count: number;
  remark: string | null;
}

export interface WarehouseDispatchRecommendationFilters {
  task_ids?: number[];
  warehouse_id?: number;
  project_id?: number;
  source?: WarehouseTaskSource;
  assignee_userid?: string;
}

export const buildWarehouseDispatchRecommendationPayload = (input: {
  filters: WarehouseDispatchRecommendationFilters;
  tasks: WarehouseDispatchRecommendationTask[];
  workload_summary: WarehouseTaskWorkloadSummary[];
}) => {
  return {
    task_type: "warehouse_task_dispatch_recommendation" as const,
    no_auto_dispatch: true,
    filters: input.filters,
    task_count: input.tasks.length,
    tasks: input.tasks.map((task) => ({
      id: task.id,
      work_order_no: task.work_order_no,
      work_order_type: task.work_order_type,
      priority: task.priority,
      status: task.status,
      warehouse_id: task.warehouse_id,
      project_id: task.project_id,
      assignee_userid: task.assignee_userid,
      package_id: task.package_id,
      scheduled_date: task.scheduled_date,
      blocking_flag: task.blocking_flag,
      required_photo_count: task.required_photo_count,
      remark: task.remark
    })),
    workload_summary: input.workload_summary,
    output_contract: {
      recommendations: [
        {
          work_order_id: "number",
          recommended_assignee_userid: "string|null",
          recommended_package_id: "number|null",
          scheduled_date: "YYYY-MM-DD|null",
          priority_adjustment: "low|normal|high|urgent|null",
          reason: "string",
          risk_flags: ["string"]
        }
      ],
      summary: "string",
      operator_notice: "string"
    }
  };
};

export const buildTbmCompositionRecommendationPayload = (input: {
  core: Omit<TbmCompositionAssetInput, "properties_json">;
  shells: TbmCompositionCandidate[];
  consoles: TbmCompositionCandidate[];
}) => {
  return {
    task_type: "tbm_composition_recommendation" as const,
    no_auto_apply: true,
    core: input.core,
    shell_count: input.shells.length,
    console_count: input.consoles.length,
    shells: input.shells,
    consoles: input.consoles,
    output_contract: {
      recommended_shell_asset_id: "number|null",
      recommended_console_asset_id: "number|null",
      requires_modification: "boolean",
      reason: "string",
      risk_flags: ["string"],
      operator_notice: "string"
    }
  };
};
