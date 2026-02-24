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

  return withCompatFlag(row, usedCompat);
};

export const hydrateLegacySection = (input: Row): Row => {
  const row = { ...input };
  let usedCompat = false;
  const ref = asText(row.legacy_section_ref);

  if (!asText(row.section_code) && ref) {
    row.section_code = ref;
    usedCompat = true;
  }

  if (!asText(row.section_name) && ref) {
    row.section_name = ref;
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
