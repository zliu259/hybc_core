import { describe, expect, it } from "vitest";

import {
  buildTbmCompositionCandidate,
  buildTbmCompositionTaskDefinitions,
  hasCompatibilityRule
} from "./asset-composition";

const asset = {
  id: 1,
  asset_code: "HY-CORE-0001",
  asset_name: "机芯 1",
  asset_type_id: 10,
  asset_type_code: "CORE",
  asset_type_name: "顶管机机芯",
  status: "idle",
  current_warehouse_id: 7
};

describe("asset composition rules", () => {
  it("matches compatibility rules in either type order", () => {
    const rules = [
      {
        left_asset_type_id: 11,
        right_asset_type_id: 10,
        relation_type: "shell_core" as const
      }
    ];

    expect(hasCompatibilityRule(rules, 10, 11, "shell_core")).toBe(true);
    expect(hasCompatibilityRule(rules, 11, 10, "shell_core")).toBe(true);
    expect(hasCompatibilityRule(rules, 12, 10, "core_console")).toBe(false);
  });

  it("marks same-warehouse compatible idle components as available", () => {
    const candidate = buildTbmCompositionCandidate({
      candidate: {
        ...asset,
        id: 2,
        asset_type_id: 11,
        asset_type_code: "SHELL",
        asset_type_name: "顶管机壳体"
      },
      selectedCore: asset,
      role: "shell",
      compatibilityRules: [
        {
          left_asset_type_id: 11,
          right_asset_type_id: 10,
          relation_type: "shell_core"
        }
      ]
    });

    expect(candidate.available).toBe(true);
    expect(candidate.requires_modification).toBe(false);
    expect(candidate.reasons).toEqual([]);
  });

  it("explains blocked candidates and missing compatibility", () => {
    const candidate = buildTbmCompositionCandidate({
      candidate: {
        ...asset,
        id: 3,
        asset_type_id: 12,
        asset_type_code: "CONSOLE",
        asset_type_name: "操作台",
        status: "maintenance",
        current_warehouse_id: 8
      },
      selectedCore: asset,
      role: "console",
      compatibilityRules: []
    });

    expect(candidate.available).toBe(false);
    expect(candidate.requires_modification).toBe(true);
    expect(candidate.reasons).toContain("设备状态为 maintenance");
    expect(candidate.reasons).toContain("不在同一库房");
    expect(candidate.reasons).toContain("缺少机芯-操作台兼容规则");
  });

  it("marks model diameter and manufacturer mismatches as modification reasons", () => {
    const candidate = buildTbmCompositionCandidate({
      candidate: {
        ...asset,
        id: 4,
        asset_type_id: 11,
        asset_type_code: "SHELL",
        asset_type_name: "顶管机壳体",
        brand: "厂家B",
        model: "DN1000",
        properties_json: JSON.stringify({ diameter_mm: 1000 })
      },
      selectedCore: {
        ...asset,
        brand: "厂家A",
        model: "DN1200",
        properties_json: JSON.stringify({ diameter_mm: 1200 })
      },
      role: "shell",
      compatibilityRules: [
        {
          left_asset_type_id: 11,
          right_asset_type_id: 10,
          relation_type: "shell_core"
        }
      ]
    });

    expect(candidate.available).toBe(false);
    expect(candidate.requires_modification).toBe(true);
    expect(candidate.reasons).toContain("型号不一致：DN1000 / DN1200");
    expect(candidate.reasons).toContain("口径不匹配：1000mm / 1200mm");
    expect(candidate.reasons).toContain("厂家不一致：厂家B / 厂家A");
  });

  it("builds a separate confirmation task definition for composition packages", () => {
    const definitions = buildTbmCompositionTaskDefinitions();

    expect(definitions.map((item) => item.key)).toEqual([
      "precheck",
      "modification",
      "confirmation"
    ]);
    expect(definitions[2]).toMatchObject({
      work_order_type: "inspection",
      step_title: "组合确认",
      required_photo_count: 3
    });
  });
});
