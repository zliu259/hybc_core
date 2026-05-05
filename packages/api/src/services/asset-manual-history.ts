import type {
  WarehouseAssetWorkOrderStatus,
  WarehouseAssetWorkOrderType
} from "../types/work-order";

export type AssetManualReferenceHistoryRow = {
  work_order_id: number;
  work_order_no: string;
  work_order_type: WarehouseAssetWorkOrderType | string;
  work_order_status: WarehouseAssetWorkOrderStatus | string;
  manual_version_id: number | null;
  manual_id: number | null;
  manual_title: string | null;
  manual_version_no: number | null;
  referenced_at: string | null;
};

export type AssetManualReferenceHistoryItem = {
  work_order_id: number;
  work_order_no: string;
  work_order_type: string;
  work_order_status: string;
  manual_version_id: number;
  manual_id: number | null;
  manual_title: string;
  manual_version_no: number | null;
  referenced_at: string | null;
};

const toSortTime = (value: string | null): number => {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
};

export const buildAssetManualReferenceHistory = (
  rows: AssetManualReferenceHistoryRow[]
): AssetManualReferenceHistoryItem[] => {
  return rows
    .filter((row) => row.manual_version_id !== null && row.manual_title !== null)
    .map((row) => ({
      work_order_id: row.work_order_id,
      work_order_no: row.work_order_no,
      work_order_type: row.work_order_type,
      work_order_status: row.work_order_status,
      manual_version_id: row.manual_version_id as number,
      manual_id: row.manual_id,
      manual_title: row.manual_title as string,
      manual_version_no: row.manual_version_no,
      referenced_at: row.referenced_at
    }))
    .sort((left, right) => toSortTime(right.referenced_at) - toSortTime(left.referenced_at));
};
