import { describe, expect, it } from "vitest";

import {
  defaultAllowedWeComToolNames,
  isWeComGroupWebhookProxyMode,
  isWeComReadOnlyToolName,
  isWeComToolName,
  weComReadOnlyToolNames,
  weComToolDefinitions
} from "./wecom-tools";

describe("wecom tools registry", () => {
  it("registers the first-phase read-only project tools", () => {
    expect(weComReadOnlyToolNames).toEqual([
      "get_project_overview",
      "list_project_sections",
      "get_section_progress",
      "get_latest_manager_logs",
      "get_latest_operator_logs",
      "get_project_risk_summary",
      "get_equipment_summary",
      "get_public_log_link"
    ]);
  });

  it("defaults allowed tools to read-only tools only", () => {
    expect(defaultAllowedWeComToolNames).toEqual(weComReadOnlyToolNames);
    expect(defaultAllowedWeComToolNames).not.toContain("create_manager_log_draft");
    expect(defaultAllowedWeComToolNames).not.toContain("update_section_mileage");
  });

  it("rejects unknown tools and write tools in the read-only guard", () => {
    expect(isWeComToolName("get_project_overview")).toBe(true);
    expect(isWeComToolName("create_manager_log_draft")).toBe(true);
    expect(isWeComToolName("unknown_tool")).toBe(false);

    expect(isWeComReadOnlyToolName("get_latest_manager_logs")).toBe(true);
    expect(isWeComReadOnlyToolName("create_manager_log_draft")).toBe(false);
  });

  it("exposes manifest-ready tool definitions with schemas", () => {
    const overview = weComToolDefinitions.get_project_overview;

    expect(overview).toMatchObject({
      name: "get_project_overview",
      access: "read",
      scope: "project"
    });
    expect(overview.input_schema.required).toContain("project_id");
    expect(overview.description.length).toBeGreaterThan(0);
  });

  it("accepts only supported group webhook proxy modes", () => {
    expect(isWeComGroupWebhookProxyMode("direct")).toBe(true);
    expect(isWeComGroupWebhookProxyMode("bridge")).toBe(true);
    expect(isWeComGroupWebhookProxyMode("proxy")).toBe(false);
    expect(isWeComGroupWebhookProxyMode(undefined)).toBe(false);
  });
});
