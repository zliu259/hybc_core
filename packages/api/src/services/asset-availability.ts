export type AssetAvailabilityState =
  | "available_now"
  | "available_after_modification"
  | "blocked"
  | "returned_quarantine"
  | "inspection"
  | "maintenance"
  | "servicing"
  | "modification"
  | "on_project"
  | "scrapped";

export type AssetAvailabilitySeverity = "success" | "warning" | "danger" | "info";

export type AssetAvailabilityStatus = {
  state: AssetAvailabilityState;
  label: string;
  severity: AssetAvailabilitySeverity;
  can_dispatch: boolean;
  reasons: string[];
};

type AssetAvailabilityInput = {
  asset: {
    status: string;
    current_project_id: number | null;
  };
  blockingWorkOrders: Array<{
    work_order_no: string;
    status: string;
  }>;
  configurations: Array<{
    configuration_code?: string | null;
    status: string;
  }>;
};

const statusMap: Record<string, Pick<AssetAvailabilityStatus, "state" | "label" | "severity">> = {
  returned_quarantine: {
    state: "returned_quarantine",
    label: "返库待检查",
    severity: "warning"
  },
  quarantine: {
    state: "returned_quarantine",
    label: "返库待检查",
    severity: "warning"
  },
  inspection: {
    state: "inspection",
    label: "检查中",
    severity: "warning"
  },
  maintenance: {
    state: "maintenance",
    label: "维护中",
    severity: "danger"
  },
  repair: {
    state: "maintenance",
    label: "维护中",
    severity: "danger"
  },
  servicing: {
    state: "servicing",
    label: "保养中",
    severity: "warning"
  },
  modification: {
    state: "modification",
    label: "改装中",
    severity: "warning"
  },
  scrapped: {
    state: "scrapped",
    label: "已报废",
    severity: "danger"
  }
};

const pendingConfigurationStatuses = new Set(["planned", "assembling", "disassembling"]);

export const buildAssetAvailabilityStatus = ({
  asset,
  blockingWorkOrders,
  configurations
}: AssetAvailabilityInput): AssetAvailabilityStatus => {
  const mapped = statusMap[asset.status];
  if (mapped) {
    return {
      ...mapped,
      can_dispatch: false,
      reasons: [`设备状态为${mapped.label}`]
    };
  }

  if (asset.current_project_id) {
    return {
      state: "on_project",
      label: "项目占用",
      severity: "info",
      can_dispatch: false,
      reasons: [`设备当前在项目 ${asset.current_project_id}`]
    };
  }

  if (blockingWorkOrders.length > 0) {
    return {
      state: "blocked",
      label: "任务阻塞",
      severity: "danger",
      can_dispatch: false,
      reasons: [
        `存在未完成阻塞任务：${blockingWorkOrders.map((item) => item.work_order_no).join("、")}`
      ]
    };
  }

  const pendingConfigurations = configurations.filter((item) =>
    pendingConfigurationStatuses.has(item.status)
  );
  if (pendingConfigurations.length > 0) {
    return {
      state: "available_after_modification",
      label: "改装后可用",
      severity: "warning",
      can_dispatch: false,
      reasons: [
        `存在未完成组合/改装：${pendingConfigurations
          .map((item) => item.configuration_code || item.status)
          .join("、")}`
      ]
    };
  }

  return {
    state: "available_now",
    label: "可出库",
    severity: "success",
    can_dispatch: true,
    reasons: ["设备当前在库且没有阻塞任务"]
  };
};
