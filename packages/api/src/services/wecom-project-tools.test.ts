import { describe, expect, it } from "vitest";

import type { Env } from "../types/env";
import { callWeComProjectTool } from "./wecom-project-tools";

class ProjectToolStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: ProjectToolDb,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.params);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return this.db.all<T>(this.sql, this.params);
  }
}

class ProjectToolDb {
  prepare(sql: string) {
    return new ProjectToolStatement(this, sql);
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes("FROM project WHERE id = ?")) {
      return {
        id: Number(params[0]),
        project_code: "P-001",
        project_name: "东线顶管项目",
        manager_userid: "manager-a",
        status: "active",
        location_text: "广州",
        project_kind: "internal",
        start_date: "2026-05-01",
        end_date: "2026-08-01",
        updated_at: "2026-05-18T08:00:00.000Z",
        contract_amount: 999999
      } as T;
    }

    if (sql.includes("COUNT(*) AS section_count")) {
      return { section_count: 2 } as T;
    }

    if (sql.includes("FROM project_section") && sql.includes("AND id = ?")) {
      return {
        id: Number(params[1]),
        project_id: Number(params[0]),
        section_code: "S-01",
        section_name: "东线一标",
        section_length: 320,
        pipe_material: "钢筋混凝土",
        pipe_model: "DN1200",
        soil_type: "粘土、细砂",
        status: "active",
        updated_at: "2026-05-18T08:30:00.000Z"
      } as T;
    }

    if (sql.includes("MAX(cumulative_pipe_count) AS cumulative_pipe_count")) {
      return {
        cumulative_pipe_count: 12,
        total_footage_m: 36,
        latest_log_date: "2026-05-18"
      } as T;
    }

    if (sql.includes("FROM project_public_log_link")) {
      return {
        id: 3,
        project_id: Number(params[0]),
        token: "public-token",
        allowed_log_types_json: '["operator_log","project_log"]',
        expires_at: null,
        status: "active",
        updated_at: "2026-05-18T08:40:00.000Z"
      } as T;
    }

    if (sql.includes("FROM project_equipment_plan")) {
      return {
        id: 9,
        plan_no: "EP-001",
        plan_status: "confirmed",
        ai_status: "completed",
        updated_at: "2026-05-18T07:00:00.000Z"
      } as T;
    }

    if (sql.includes("COUNT(*) AS active_asset_count")) {
      return { active_asset_count: 3 } as T;
    }

    return null;
  }

  async all<T>(sql: string, params: unknown[]): Promise<{ results: T[] }> {
    if (sql.includes("FROM project_section") && !sql.includes("WHERE id = ?")) {
      return {
        results: [
          {
            id: 11,
            project_id: Number(params[0]),
            section_code: "S-01",
            section_name: "东线一标",
            section_length: 320,
            pipe_material: "钢筋混凝土",
            pipe_model: "DN1200",
            soil_type: "粘土、细砂",
            status: "active",
            updated_at: "2026-05-18T08:30:00.000Z"
          },
          {
            id: 12,
            project_id: Number(params[0]),
            section_code: "S-02",
            section_name: "东线二标",
            section_length: 280,
            pipe_material: "钢筋混凝土",
            pipe_model: "DN1000",
            soil_type: "中砂",
            status: "planning",
            updated_at: "2026-05-18T08:35:00.000Z"
          }
        ] as T[]
      };
    }

    if (sql.includes("FROM manager_log")) {
      return {
        results: [
          {
            id: 21,
            project_id: Number(params[0]),
            log_date: "2026-05-18",
            title: "今日进展",
            detail_html: "<p>完成 <strong>12 米</strong>，设备运行正常。</p>",
            risk_note: "注意沉降监测",
            status: "published",
            updated_at: "2026-05-18T09:00:00.000Z",
            paid_amount: 1000
          }
        ] as T[]
      };
    }

    if (sql.includes("FROM operator_log")) {
      return {
        results: [
          {
            id: 31,
            project_id: Number(params[0]),
            section_id: Number(params[1] ?? 11),
            log_date: "2026-05-18",
            shift: "day",
            completed_pipe_count: 4,
            cumulative_pipe_count: 12,
            footage_m: 12,
            issue_summary: "",
            remark: "正常顶进",
            status: "submitted",
            updated_at: "2026-05-18T09:10:00.000Z"
          }
        ] as T[]
      };
    }

    if (sql.includes("FROM project_equipment_plan_item")) {
      return {
        results: [
          {
            asset_type_id: 4,
            planned_qty: 2,
            recommended_qty: 2,
            source: "ai",
            note: "泥水平衡顶管机"
          }
        ] as T[]
      };
    }

    return { results: [] };
  }
}

const createEnv = () =>
  ({
    DB: new ProjectToolDb(),
    WECOM_TOOL_WEB_BASE_URL: "https://web.example.com"
  }) as unknown as Env;

describe("wecom project tools", () => {
  it("returns a project overview without financial fields", async () => {
    const result = await callWeComProjectTool(createEnv(), "get_project_overview", {
      project_id: 7
    });

    expect(result.data).toMatchObject({
      project_id: 7,
      project_code: "P-001",
      project_name: "东线顶管项目",
      section_count: 2
    });
    expect(JSON.stringify(result.data)).not.toContain("contract_amount");
  });

  it("lists sections with pipe and soil fields", async () => {
    const result = await callWeComProjectTool(createEnv(), "list_project_sections", {
      project_id: 7
    });

    expect(result.data).toMatchObject({
      project_id: 7,
      sections: [
        {
          section_id: 11,
          section_name: "东线一标",
          pipe_model: "DN1200",
          soil_type: "粘土、细砂"
        },
        {
          section_id: 12,
          section_name: "东线二标"
        }
      ]
    });
  });

  it("returns section progress from operator logs", async () => {
    const result = await callWeComProjectTool(createEnv(), "get_section_progress", {
      project_id: 7,
      section_id: 11
    });

    expect(result.data).toMatchObject({
      project_id: 7,
      section_id: 11,
      section_name: "东线一标",
      cumulative_pipe_count: 12,
      total_footage_m: 36
    });
  });

  it("sanitizes manager log html and strips sensitive fields", async () => {
    const result = await callWeComProjectTool(createEnv(), "get_latest_manager_logs", {
      project_id: 7,
      limit: 1
    });

    expect(result.data).toMatchObject({
      project_id: 7,
      logs: [
        {
          log_id: 21,
          detail_text: "完成 12 米，设备运行正常。",
          risk_note: "注意沉降监测"
        }
      ]
    });
    expect(JSON.stringify(result.data)).not.toContain("paid_amount");
    expect(JSON.stringify(result.data)).not.toContain("<strong>");
  });

  it("returns active public log links using the configured web base url", async () => {
    const result = await callWeComProjectTool(createEnv(), "get_public_log_link", {
      project_id: 7
    });

    expect(result.data).toMatchObject({
      project_id: 7,
      status: "active",
      url: "https://web.example.com/#/public/project-log/public-token"
    });
  });
});
