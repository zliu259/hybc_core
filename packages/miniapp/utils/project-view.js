/**
 * 项目列表、项目详情的视图模型。不碰接口和 wx，页面把接口结果交给这里，
 * 拿到可以直接显示的数据。
 */
const { formatAmount } = require("./amount-cn");

const STATUS_TEXT = {
  planning: "规划中",
  preparing: "筹备中",
  active: "施工中",
  completing: "收尾中",
  archived: "已归档"
};

const STATUS_THEME = {
  planning: "primary",
  preparing: "warning",
  active: "success",
  completing: "primary",
  archived: "default"
};

const STAGES = [
  { key: "planning", label: "规划" },
  { key: "preparing", label: "筹备" },
  { key: "active", label: "施工" },
  { key: "completing", label: "收尾" },
  { key: "archived", label: "归档" }
];

const SECTION_STATUS_TEXT = {
  ...STATUS_TEXT,
  normal: "正常",
  paused: "暂停",
  blocked: "受阻",
  done: "完成"
};

const LOG_STATUS_TEXT = {
  draft: "草稿",
  submitted: "已提交",
  approved: "已审核",
  rejected: "已驳回"
};

const LOG_STATUS_THEME = {
  draft: "default",
  submitted: "primary",
  approved: "success",
  rejected: "danger"
};

/** 办公室、仓库是费用归集用的占位项目，不是真实工程 */
const SYSTEM_PROJECT_NAMES = ["办公室", "仓库"];

const WRITE_ROLES = ["super_admin", "manager", "site_manager"];

const toDay = (value) => String(value || "").slice(0, 10);

const round1 = (value) => Number(value.toFixed(1));

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/** 历史数据和日志正文里有 HTML：段落和换行变成真换行，其他标签去掉。 */
const cleanRichText = (raw) =>
  String(raw || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\s*\n\s*/g, "\n")
    .trim();

/** 冒号前超过这个长度就不是「项目名」，而是一句话 */
const BRIEFING_LABEL_MAX = 8;

const toBriefingRow = (segment, index) => {
  const separator = segment.search(/[：:]/);
  const label = separator > 0 ? segment.slice(0, separator).trim() : "";
  const value = separator > 0 ? segment.slice(separator + 1).trim() : "";
  const labeled = label && value && label.length <= BRIEFING_LABEL_MAX;
  return labeled
    ? { key: index, label, value }
    : { key: index, label: "", value: segment };
};

/**
 * 项目交底是自由文本，线上有两种写法：
 * - 「开工日期：大约5月初；施工范围：…；管径：DN2000钢管」，拆成一行一项；
 * - 「顶进方式：泥水平衡，全长89米……完成时间为11月10日。」，整段显示。
 * 至少两项带标签才拆，否则会把一整段话都算成第一个冒号的内容。
 * 拆开后每个字都还在，只去掉用来分隔的分号。
 */
const parseBriefing = (raw) => {
  const text = cleanRichText(raw);
  if (!text) return { mode: "empty", text: "", rows: [] };
  const rows = text
    .split(/[；;\n]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map(toBriefingRow);
  const labeledCount = rows.filter((row) => row.label).length;
  return labeledCount >= 2
    ? { mode: "rows", text: "", rows }
    : { mode: "text", text, rows: [] };
};

const buildStageBar = (status) => {
  const currentIndex = STAGES.findIndex((stage) => stage.key === status);
  const stateAt = (index) => {
    if (currentIndex < 0 || index > currentIndex) return "todo";
    return index === currentIndex ? "current" : "past";
  };
  return STAGES.map((stage, index) => ({ ...stage, state: stateAt(index) }));
};

const isSystemProject = (item) =>
  SYSTEM_PROJECT_NAMES.includes(String((item && item.project_code) || "")) ||
  SYSTEM_PROJECT_NAMES.includes(String((item && item.project_name) || ""));

const projectStartDay = (project) =>
  toDay(project.project_start_at || project.start_date);

const managerNameOf = (project, toName) =>
  project.manager_userid ? toName(project.manager_userid) : "未指定";

const canWriteProject = (project, profile) => {
  const roles = Array.isArray(profile.roles) ? profile.roles : [];
  return (
    roles.some((role) => WRITE_ROLES.includes(role)) ||
    Boolean(project.manager_userid && project.manager_userid === profile.username)
  );
};

const buildProjectCard = (project, { toName, profile }) => ({
  id: project.id,
  name: project.project_name || "未命名项目",
  statusText: STATUS_TEXT[project.status] || "未知",
  statusTheme: STATUS_THEME[project.status] || "default",
  managerName: managerNameOf(project, toName),
  startDate: projectStartDay(project),
  location: project.location_text || "",
  archived: project.status === "archived",
  readonly: !canWriteProject(project, profile)
});

const buildProjectFacts = (project, toName) => {
  const external =
    project.project_kind === "external" && project.external_party_name;
  return [
    { label: "项目经理", value: managerNameOf(project, toName) },
    { label: "开工日期", value: projectStartDay(project) || "未设置" },
    ...(project.end_date
      ? [{ label: "计划完工", value: toDay(project.end_date) }]
      : []),
    { label: "项目位置", value: project.location_text || "未填写" },
    ...(external
      ? [{ label: "外部单位", value: project.external_party_name }]
      : [])
  ];
};

/** 累计进尺取最大值；都没填累计时才把当日进尺相加。与网页项目工作区同一口径。 */
const advancedFootage = (logs) => {
  const cumulative = logs
    .map((item) => toNumberOrNull(item.cumulative_footage_m))
    .filter((value) => value !== null);
  return cumulative.length > 0
    ? Math.max(...cumulative)
    : logs.reduce((sum, item) => sum + Number(item.footage_m || 0), 0);
};

const latestDay = (logs) =>
  logs.reduce((latest, item) => {
    const day = toDay(item.log_date);
    return day > latest ? day : latest;
  }, "");

/**
 * @param failedSectionIds 施工日志没取到的标段：进度未知，不能显示成 0%、「还没有施工日志」
 */
const buildSectionCards = (sections, operatorLogs, reports, failedSectionIds = []) =>
  (sections || []).map((section) => {
    const id = Number(section.id);
    const logs = (operatorLogs || []).filter(
      (item) => Number(item.section_id) === id
    );
    const footage = round1(advancedFootage(logs));
    const length = Number(section.section_length || 0);
    const latest = latestDay(logs);
    const shared = {
      id,
      title: `${section.section_code || "-"} ${section.section_name || "未命名标段"}`,
      statusText: SECTION_STATUS_TEXT[section.status] || "未知",
      breakthroughCount: (reports || []).filter(
        (item) => Number(item.section_id) === id
      ).length
    };
    if (failedSectionIds.includes(id)) {
      return {
        ...shared,
        footageText: "",
        percent: null,
        latestText: "进度没有取到，下拉刷新重试"
      };
    }
    return {
      ...shared,
      footageText: length > 0 ? `${footage} / ${length} m` : `${footage} m`,
      // 没有总长算不出比例，为 null，不能显示成 0%
      percent: length > 0 ? Math.min(100, round1((footage / length) * 100)) : null,
      latestText: latest ? `最近更新 ${latest}` : "还没有施工日志"
    };
  });

const toPhoto = (photo) => {
  const url = photo && (photo.file_url || photo.url || photo.preview_url);
  return url ? { url, name: photo.file_name || "日志图片" } : null;
};

const buildLogRows = (rows, toName) =>
  (rows || [])
    .slice()
    .sort(
      (a, b) =>
        String(b.log_date || "").localeCompare(String(a.log_date || "")) ||
        Number(b.id || 0) - Number(a.id || 0)
    )
    .map((item) => {
      const photos = (Array.isArray(item.photos) ? item.photos : [])
        .map(toPhoto)
        .filter(Boolean);
      return {
        id: Number(item.id),
        dayText: toDay(item.log_date) || "-",
        statusText: LOG_STATUS_TEXT[item.status] || "未知",
        statusTheme: LOG_STATUS_THEME[item.status] || "default",
        title: item.title || "未命名日志",
        detailText: cleanRichText(item.detail_html),
        riskNote: item.risk_note || "",
        managerName: toName(item.manager_userid),
        photos,
        photoUrls: photos.map((photo) => photo.url)
      };
    });

const toMoneyText = (value) => {
  const text = formatAmount(value);
  return text === "-" ? text : `¥${text}`;
};

const buildFinanceRows = (summary) =>
  summary
    ? [
        { label: "对外已付", value: toMoneyText(summary.outboundPaidAmount) },
        { label: "报销累计", value: toMoneyText(summary.reimbursementAmount) },
        { label: "收款已开票", value: toMoneyText(summary.inboundInvoicedAmount) },
        { label: "收款已到账", value: toMoneyText(summary.inboundReceivedAmount) }
      ]
    : null;

/** 与后端 canReviewExternalLogSubmission 一致：超管，或这个项目自己的管理人员。 */
const canReviewExternalLogs = (project, profile) => {
  const roles = Array.isArray(profile.roles) ? profile.roles : [];
  if (roles.includes("super_admin")) return true;
  const hasManagementRole =
    roles.includes("manager") || roles.includes("site_manager");
  return Boolean(
    hasManagementRole &&
      project &&
      project.manager_userid === profile.username
  );
};

module.exports = {
  STATUS_TEXT,
  STATUS_THEME,
  buildFinanceRows,
  buildLogRows,
  buildProjectCard,
  buildProjectFacts,
  buildSectionCards,
  buildStageBar,
  canReviewExternalLogs,
  cleanRichText,
  isSystemProject,
  parseBriefing
};
