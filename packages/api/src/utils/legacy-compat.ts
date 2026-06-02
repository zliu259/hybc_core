type Row = Record<string, unknown>;

const asText = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const normalizeShift = (value: unknown): string | undefined => {
  const text = asText(value);
  if (!text) return undefined;
  if (text === "day" || text.includes("白")) return "day";
  if (text === "night" || text.includes("夜")) return "night";
  return undefined;
};

const suggestMachineByDiameter = (
  diameterMm: number | undefined
): { type: string; score: number } => {
  if (!diameterMm) return { type: "通用泥水平衡顶管机", score: 0.4 };
  if (diameterMm <= 800) return { type: "小型土压平衡顶管机", score: 0.7 };
  if (diameterMm <= 1200) return { type: "中型泥水平衡顶管机", score: 0.78 };
  if (diameterMm <= 1800) return { type: "中大型泥水平衡顶管机", score: 0.82 };
  return { type: "大型泥水平衡顶管机", score: 0.86 };
};

const withCompatFlag = (row: Row, usedCompat: boolean): Row => {
  if (!usedCompat) return row;
  return { ...row, compat_fallback_used: true };
};

export const hydrateLegacyProject = (input: Row): Row => {
  const row = { ...input };
  let usedCompat = false;

  if (!asText(row.project_name)) {
    const fallback = asText(row.project_short_name) ?? asText(row.project_alias);
    if (fallback) {
      row.project_name = fallback;
      usedCompat = true;
    }
  }

  if (!asText(row.project_code) && asText(row.project_short_name)) {
    row.project_code = asText(row.project_short_name);
    usedCompat = true;
  }

  if (!asText(row.location_text)) {
    const location = [
      asText(row.province),
      asText(row.city),
      asText(row.district),
      asText(row.address_detail)
    ]
      .filter(Boolean)
      .join(" ");
    if (location) {
      row.location_text = location;
      usedCompat = true;
    }
  }

  if (!asText(row.project_briefing) && asText(row.legacy_note)) {
    row.project_briefing = asText(row.legacy_note);
    usedCompat = true;
  }

  if (!asText(row.project_start_at)) {
    const fallback = asText(row.start_date) ?? asText(row.created_at);
    if (fallback) {
      row.project_start_at = fallback;
      usedCompat = true;
    }
  }

  return withCompatFlag(row, usedCompat);
};

export const hydrateLegacySection = (input: Row): Row => {
  const row = { ...input };
  let usedCompat = false;
  const ref = asText(row.legacy_section_ref);
  const diameter = asNumber(row.pipe_diameter_mm);

  if (!asText(row.section_code) && ref) {
    row.section_code = ref;
    usedCompat = true;
  }

  if (!asText(row.section_name) && ref) {
    row.section_name = ref;
    usedCompat = true;
  }

  if (!asText(row.pipe_model) && asText(row.pipe_spec)) {
    row.pipe_model = asText(row.pipe_spec);
    usedCompat = true;
  }

  if (!asText(row.assigned_machine_type)) {
    const suggestion = suggestMachineByDiameter(diameter);
    row.assigned_machine_type = suggestion.type;
    usedCompat = true;
  }

  if (asNumber(row.ai_machine_match_score) === undefined) {
    const suggestion = suggestMachineByDiameter(diameter);
    row.ai_machine_match_score = suggestion.score;
    usedCompat = true;
  }

  if (!asText(row.ai_machine_match_note)) {
    const suggestion = suggestMachineByDiameter(diameter);
    const soil = asText(row.soil_type);
    const diameterText = diameter ? `${diameter}mm` : "未知管径";
    row.ai_machine_match_note = `基于管径(${diameterText})${soil ? `与土质(${soil})` : ""}的启发式匹配，建议机型：${suggestion.type}`;
    usedCompat = true;
  }

  return withCompatFlag(row, usedCompat);
};

export const hydrateLegacyOperatorLog = (input: Row): Row => {
  const row = { ...input };
  let usedCompat = false;

  if (!asText(row.log_date)) {
    const fallback = asText(row.submitted_at) ?? asText(row.created_at);
    if (fallback) {
      row.log_date = fallback;
      usedCompat = true;
    }
  }

  if (!asText(row.shift)) {
    const fallback = normalizeShift(row.shift_cn);
    if (fallback) {
      row.shift = fallback;
      usedCompat = true;
    }
  }

  if (!asNumber(row.completed_pipe_count)) {
    const fallback = asNumber(row.jacking_count);
    if (fallback !== undefined) {
      row.completed_pipe_count = fallback;
      usedCompat = true;
    }
  }

  if (!asText(row.operator_userid)) {
    const fallback =
      asText(row.wechat_openid) ?? asText(row.submitted_by_name) ?? asText(row.operator_name);
    if (fallback) {
      row.operator_userid = fallback;
      usedCompat = true;
    }
  }

  if (!asText(row.issue_summary)) {
    const fallback = asText(row.section_text) ?? asText(row.soil_type);
    if (fallback) {
      row.issue_summary = fallback;
      usedCompat = true;
    }
  }

  if (!asText(row.cutter_current_text)) {
    const current = asNumber(row.cutter_current_a);
    if (current !== undefined) {
      row.cutter_current_text = `${current}A`;
      usedCompat = true;
    }
  }

  if (!asText(row.main_thrust_text)) {
    const thrust = asNumber(row.main_thrust_mpa);
    if (thrust !== undefined) {
      row.main_thrust_text = `${thrust}MPa`;
      usedCompat = true;
    }
  }

  if (!asText(row.horizontal_deviation_direction)) {
    const direction = asText(row.deviation_direction);
    if (direction) {
      row.horizontal_deviation_direction = direction;
      usedCompat = true;
    }
  }

  if (asNumber(row.horizontal_deviation_mm) === undefined) {
    const value = asNumber(row.deviation_value_mm);
    if (value !== undefined) {
      row.horizontal_deviation_mm = value;
      usedCompat = true;
    }
  }

  return withCompatFlag(row, usedCompat);
};

export const hydrateLegacyManagerLog = (input: Row): Row => {
  const row = { ...input };
  let usedCompat = false;

  if (!asText(row.log_date)) {
    const fallback = asText(row.submitted_at) ?? asText(row.created_at);
    if (fallback) {
      row.log_date = fallback;
      usedCompat = true;
    }
  }

  if (!asText(row.title)) {
    const detail = asText(row.detail_html);
    const fallback = detail ? detail.slice(0, 20) : asText(row.tomorrow_plan);
    if (fallback) {
      row.title = fallback;
      usedCompat = true;
    }
  }

  if (!asText(row.manager_userid)) {
    const fallback = asText(row.submitter_name);
    if (fallback) {
      row.manager_userid = fallback;
      usedCompat = true;
    }
  }

  return withCompatFlag(row, usedCompat);
};

export const hydrateLegacyBreakthrough = (input: Row): Row => {
  const row = { ...input };
  let usedCompat = false;

  if (!asText(row.report_date)) {
    const fallback = asText(row.submitted_at) ?? asText(row.start_date) ?? asText(row.created_at);
    if (fallback) {
      row.report_date = fallback;
      usedCompat = true;
    }
  }

  if (!asNumber(row.breakthrough_m)) {
    const fallback = asNumber(row.total_length_m);
    if (fallback !== undefined) {
      row.breakthrough_m = fallback;
      usedCompat = true;
    }
  }

  if (!asText(row.summary)) {
    const fallback = asText(row.other_notes);
    if (fallback) {
      row.summary = fallback;
      usedCompat = true;
    }
  }

  if (!asText(row.detail)) {
    const fallback = asText(row.other_notes);
    if (fallback) {
      row.detail = fallback;
      usedCompat = true;
    }
  }

  return withCompatFlag(row, usedCompat);
};
