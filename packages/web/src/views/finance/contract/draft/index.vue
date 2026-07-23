<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  addSection as apiAddSection,
  applyCompletenessRevision,
  applyVariant,
  createDraft,
  getCheck,
  getDraft,
  ignoreCompletenessHint,
  listChecks,
  listClauseTemplates,
  removeSection,
  requestCompleteness,
  updateDraft,
  updateSection,
  type CheckVersion,
  type ClauseTemplate,
  type CompletenessReport,
  type ContractDraft,
  type ContractDraftSection,
  type ContractFamily,
  type DraftDirection
} from "@/api/contract-draft";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useContractDraftAI } from "./composables/useContractDraftAI";
import { parseCompletenessReport } from "./lib/completeness-report";
import AiWorkingIndicator from "./components/AiWorkingIndicator.vue";
import DraftInitCard from "./components/DraftInitCard.vue";
import DraftListCard from "./components/DraftListCard.vue";
import DraftBanner from "./components/DraftBanner.vue";
import SectionListPanel from "./components/SectionListPanel.vue";
import SectionCard from "./components/SectionCard.vue";
import CompletenessDialog from "./components/CompletenessDialog.vue";
import ConvertDialog from "./components/ConvertDialog.vue";
import PlainPreviewDrawer from "./components/PlainPreviewDrawer.vue";

defineOptions({ name: "ContractDraftWorkbench" });

const route = useRoute();
const router = useRouter();
const { projects, loadProjects } = useProjectOptions();

const draft = ref<ContractDraft | null>(null);
const sections = ref<ContractDraftSection[]>([]);
const templates = ref<ClauseTemplate[]>([]);
const entities = ref<Entity[]>([]);
const activeSectionId = ref<number | null>(null);
const completenessVisible = ref(false);
// 完整检查 v2：当前查看的递进结果 + 历史版本 + 当前版本 id
const currentReport = ref<CompletenessReport | null>(null);
const completenessVersions = ref<CheckVersion[]>([]);
const currentCheckId = ref<number | null>(null);
// 本次弹窗内已一键采纳修正稿 / 已「添加」处理的缺失节 key（用于按钮态与列表隐藏）
const appliedSectionKeys = ref<string[]>([]);
const handledMissingKeys = ref<string[]>([]);
const saving = ref(false);
const checking = ref(false);
const convertVisible = ref(false);
const plainPreviewVisible = ref(false);
const entityBankAccounts = ref<EntityBankAccount[]>([]);
const selectedBankAccountId = ref<number | null>(null);

const onConverted = (payload: { contract_id: number }) => {
  router.push(`/finance/contract/detail/${payload.contract_id}`);
};
const onViewContract = (contractId: number) => {
  router.push(`/finance/contract/detail/${contractId}`);
};

const ai = useContractDraftAI();

// 关键字字段清单（与条款库占位符对齐；甲乙方主体信息按立场自动映射）。
// 编辑入口统一为正文点选 popover；此清单保留用于口径与「正文未出现」提示。
const KEYWORD_FIELDS: Array<{ key: string; label: string }> = [
  { key: "project_name", label: "工程名称" },
  { key: "location", label: "工程地点" },
  { key: "pipe_spec", label: "管材规格" },
  { key: "length", label: "顶进长度(米)" },
  { key: "unit_price", label: "综合单价(元/米)" },
  { key: "amount", label: "合同总价(元)" },
  { key: "tax_rate", label: "税率(%)" },
  { key: "start_date", label: "开工日期" },
  { key: "end_date", label: "竣工日期" },
  { key: "sign_date", label: "签约日期" },
  { key: "dispute_venue", label: "争议管辖地" }
];
const keywords = ref<Record<string, string>>({});

// 正文中没有出现占位符的关键字（用户没有点选入口），在纯文本预览底部提示
const absentKeywordLabels = computed<string[]>(() =>
  KEYWORD_FIELDS.filter(
    f => !sections.value.some(s => s.content.includes(`{{${f.key}}}`))
  ).map(f => f.label)
);

const ourEntity = computed(() =>
  entities.value.find(e => e.id === draft.value?.entity_id)
);
const selectedBankAccount = computed<EntityBankAccount | null>(
  () =>
    entityBankAccounts.value.find(a => a.id === selectedBankAccountId.value) ??
    null
);
// 我方侧银行关键字键名（inbound=我方乙方，outbound=我方甲方）
const ourSideBankKeys = computed<{ name: string; account: string } | null>(
  () => {
    if (!draft.value) return null;
    const prefix = draft.value.direction === "inbound" ? "party_b" : "party_a";
    return { name: `${prefix}_bank_name`, account: `${prefix}_bank_account` };
  }
);

// 切换我方主体时加载其开户账户；预选与已存关键字账号匹配的账户，否则第一条
let bankAccountsReqSeq = 0;
watch(
  () => draft.value?.entity_id ?? null,
  async entityId => {
    const seq = ++bankAccountsReqSeq;
    if (!entityId) {
      entityBankAccounts.value = [];
      selectedBankAccountId.value = null;
      return;
    }
    try {
      const res = await listEntityBankAccounts(entityId);
      if (seq !== bankAccountsReqSeq) return; // 主体已再次切换，丢弃过期响应
      const accounts = res.data.filter(a => a.status !== "deleted");
      entityBankAccounts.value = accounts;
      const savedNo = ourSideBankKeys.value
        ? keywords.value[ourSideBankKeys.value.account]
        : undefined;
      const matched = savedNo
        ? accounts.find(a => a.account_no === savedNo)
        : undefined;
      selectedBankAccountId.value = matched?.id ?? accounts[0]?.id ?? null;
    } catch {
      if (seq !== bankAccountsReqSeq) return;
      entityBankAccounts.value = [];
      selectedBankAccountId.value = null;
      ElMessage.warning("开户账户加载失败，将使用主体主账户");
    }
  }
);

// 与服务端 buildKeywordValues 同口径：显式关键字优先，空缺才由主体/对方信息回填；
// 所选开户账户视为显式选择，覆盖我方侧银行字段。
const keywordValues = computed<Record<string, string>>(() => {
  const cp = draft.value;
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(keywords.value)) {
    if (v && v.trim().length > 0) base[k] = v.trim();
  }
  if (!cp) return base;
  const acct = selectedBankAccount.value;
  const bankKeys = ourSideBankKeys.value;
  if (acct && bankKeys) {
    base[bankKeys.name] = acct.bank_name;
    base[bankKeys.account] = acct.account_no;
  }
  const fill = (key: string, value: string | null | undefined) => {
    if (
      typeof value === "string" &&
      value.trim().length > 0 &&
      !(key in base)
    ) {
      base[key] = value.trim();
    }
  };
  const our = ourEntity.value;
  const ourInfo = {
    name: our?.entity_name ?? null,
    credit: our?.tax_id ?? null,
    legal: our?.legal_person ?? null,
    address: null as string | null,
    phone: null as string | null,
    bank: our?.primary_bank_name ?? null,
    account: our?.primary_bank_account_no ?? null
  };
  const cpInfo = {
    name: cp.counterparty_name,
    credit: cp.counterparty_credit_code,
    legal: cp.counterparty_legal_person,
    address: cp.counterparty_address,
    phone: cp.counterparty_phone,
    bank: cp.counterparty_bank_name,
    account: cp.counterparty_bank_account
  };
  const partyA = cp.direction === "inbound" ? cpInfo : ourInfo;
  const partyB = cp.direction === "inbound" ? ourInfo : cpInfo;
  fill("party_a", partyA.name);
  fill("party_a_credit_code", partyA.credit);
  fill("party_a_legal_person", partyA.legal);
  fill("party_a_address", partyA.address);
  fill("party_a_phone", partyA.phone);
  fill("party_a_bank_name", partyA.bank);
  fill("party_a_bank_account", partyA.account);
  fill("party_b", partyB.name);
  fill("party_b_credit_code", partyB.credit);
  fill("party_b_legal_person", partyB.legal);
  fill("party_b_address", partyB.address);
  fill("party_b_phone", partyB.phone);
  fill("party_b_bank_name", partyB.bank);
  fill("party_b_bank_account", partyB.account);
  return base;
});

const ignoredHints = computed<string[]>(() => {
  if (!draft.value) return [];
  try {
    const parsed = JSON.parse(draft.value.ignored_hints_json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
});

// 弹窗缺失列表隐藏的 key：已忽略（留痕）+ 本次已「添加」处理
const dialogHiddenMissing = computed<string[]>(() => [
  ...ignoredHints.value,
  ...handledMissingKeys.value
]);

// 有已完成的检查即可「查看上次检查」（采纳修正稿或再编辑会置空 status，按钮随之隐藏）
const hasCompletedCheck = computed(
  () => draft.value?.completeness_status === "done"
);

// 从 axios 错误体提取后端 error.message（类型安全，无 as any）
const apiErrorMessage = (e: unknown, fallback: string): string => {
  if (e && typeof e === "object") {
    const resp = (
      e as { response?: { data?: { error?: { message?: unknown } } } }
    ).response;
    const msg = resp?.data?.error?.message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  return fallback;
};

const applyDetail = (detail: {
  draft: ContractDraft;
  sections: ContractDraftSection[];
}) => {
  draft.value = detail.draft;
  sections.value = detail.sections;
  try {
    const parsed = JSON.parse(detail.draft.keywords_json) as Record<
      string,
      unknown
    >;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed))
      if (typeof v === "string") next[k] = v;
    keywords.value = next;
  } catch {
    keywords.value = {};
  }
};

const loadTemplates = async (
  direction: DraftDirection,
  family: ContractFamily
) => {
  templates.value = await listClauseTemplates(direction, family);
};

const loadDraft = async (id: number) => {
  const detail = await getDraft(id);
  applyDetail(detail);
  await loadTemplates(detail.draft.direction, detail.draft.family);
};

const onCreate = async (payload: {
  direction: DraftDirection;
  family: ContractFamily;
  title: string;
  counterparty_name: string;
}) => {
  const detail = await createDraft(payload);
  applyDetail(detail);
  await loadTemplates(detail.draft.direction, detail.draft.family);
  await router.replace({ query: { id: String(detail.draft.id) } });
};

// 历史草稿列表「继续编辑」：写回 query 后走现有加载逻辑
const onOpenDraft = async (id: number) => {
  await router.replace({ query: { id: String(id) } });
  await loadDraft(id);
};

// 返回列表态：清 query 与工作台状态；DraftListCard 随 v-if 重挂载自动刷新
const onBackToList = async () => {
  await router.replace({ query: {} });
  draft.value = null;
  sections.value = [];
  templates.value = [];
  keywords.value = {};
  activeSectionId.value = null;
  currentReport.value = null;
  completenessVersions.value = [];
  currentCheckId.value = null;
  appliedSectionKeys.value = [];
  handledMissingKeys.value = [];
};

// Banner 内表单变更以不可变 patch 方式合入草稿
const onPatchDraft = (patch: Partial<ContractDraft>) => {
  if (!draft.value) return;
  draft.value = { ...draft.value, ...patch };
};

/** 保存草稿信息；silent=true 成功不弹 toast（关键字校验告警仍弹）。所选开户账户按方向并入 keywords。 */
const persistDraftMeta = async (silent = false) => {
  if (!draft.value) return;
  saving.value = true;
  try {
    const keywordsPayload: Record<string, string> = { ...keywords.value };
    const acct = selectedBankAccount.value;
    const bankKeys = ourSideBankKeys.value;
    if (acct && bankKeys) {
      keywordsPayload[bankKeys.name] = acct.bank_name;
      keywordsPayload[bankKeys.account] = acct.account_no;
    }
    const res = await updateDraft(draft.value.id, {
      title: draft.value.title,
      project_id: draft.value.project_id ?? undefined,
      entity_id: draft.value.entity_id ?? undefined,
      counterparty_name: draft.value.counterparty_name,
      counterparty_credit_code: draft.value.counterparty_credit_code,
      counterparty_legal_person: draft.value.counterparty_legal_person,
      counterparty_address: draft.value.counterparty_address,
      counterparty_contact: draft.value.counterparty_contact,
      counterparty_phone: draft.value.counterparty_phone,
      counterparty_bank_name: draft.value.counterparty_bank_name,
      counterparty_bank_account: draft.value.counterparty_bank_account,
      keywords: keywordsPayload
    });
    draft.value = res.draft;
    keywords.value = keywordsPayload;
    if (res.keyword_findings.length) {
      ElMessage.warning(res.keyword_findings.map(f => f.reason).join("；"));
    } else if (!silent) {
      ElMessage.success("已保存");
    }
  } finally {
    saving.value = false;
  }
};
const saveDraftMeta = () => persistDraftMeta(false);

// 右侧正文点选关键字修改：更新本地关键字并静默落库
const onUpdateKeyword = async (payload: { key: string; value: string }) => {
  const bankKeys = ourSideBankKeys.value;
  if (
    bankKeys &&
    (payload.key === bankKeys.name || payload.key === bankKeys.account)
  ) {
    // 用户手改我方银行字段时清除账户选择，避免保存时被所选账户覆盖
    selectedBankAccountId.value = null;
  }
  keywords.value = { ...keywords.value, [payload.key]: payload.value };
  await persistDraftMeta(true);
};

const refreshSection = (section: ContractDraftSection | null) => {
  if (!section) return;
  sections.value = sections.value.map(s => (s.id === section.id ? section : s));
};

// 内容变更后本地同步失效完整检查状态（服务端已真源失效），保证定稿按钮态即时正确。
// 与服务端口径一致：仅 drafting 态失效。
const invalidateCompletenessLocal = () => {
  if (!draft.value || draft.value.status !== "drafting") return;
  if (draft.value.completeness_status === null) return;
  draft.value = {
    ...draft.value,
    completeness_status: null,
    completeness_result_json: null
  };
};

// 定稿门禁：drafting 态必须先通过完整检查；finalized 态保持可重试转化
const completenessGateBlocked = computed(
  () =>
    draft.value?.status === "drafting" &&
    draft.value.completeness_status !== "done"
);

const onGenerate = async (payload: {
  sectionId: number;
  instruction: string;
}) => {
  if (!draft.value) return;
  const section = await ai.generateForSection(
    draft.value.id,
    payload.sectionId,
    payload.instruction
  );
  refreshSection(section);
  if (section) invalidateCompletenessLocal();
};

const onReview = async (sectionId: number) => {
  if (!draft.value) return;
  refreshSection(await ai.reviewForSection(draft.value.id, sectionId));
};

const onSave = async (payload: { sectionId: number; content: string }) => {
  if (!draft.value) return;
  const prevContent = sections.value.find(
    s => s.id === payload.sectionId
  )?.content;
  refreshSection(
    await updateSection(draft.value.id, payload.sectionId, {
      content: payload.content
    })
  );
  ElMessage.success("已保存该节");
  if (prevContent !== payload.content) invalidateCompletenessLocal();
};

// 节内 AI 审查修正稿一键替换：走既有节更新接口（服务端置 source=manual 并失效完整检查）。
// 注意：与弹窗的「完整检查一键采纳」(onApplyCompletenessRevision) 是两条不同链路。
const onApplyRevision = async (payload: {
  sectionId: number;
  content: string;
}) => {
  if (!draft.value) return;
  refreshSection(
    await updateSection(draft.value.id, payload.sectionId, {
      content: payload.content
    })
  );
  invalidateCompletenessLocal();
  ElMessage.success("已替换为审查修正稿");
};

const onAddSection = async (payload: {
  section_key?: string;
  title?: string;
  variant_key?: string;
}) => {
  if (!draft.value) return;
  const section = await apiAddSection(draft.value.id, payload);
  sections.value = [...sections.value, section].sort(
    (a, b) => a.sort_order - b.sort_order || a.id - b.id
  );
  invalidateCompletenessLocal();
};

// 同 section_key 的可用模版变体（direction 特定行优先于 both，按 variant_key 去重）
const variantsOf = (sectionKey: string): ClauseTemplate[] => {
  const byKey = new Map<string, ClauseTemplate>();
  for (const t of templates.value) {
    if (t.section_key !== sectionKey) continue;
    const existing = byKey.get(t.variant_key);
    if (!existing || (existing.direction === "both" && t.direction !== "both"))
      byKey.set(t.variant_key, t);
  }
  return [...byKey.values()];
};

const onApplyVariant = async (payload: {
  sectionId: number;
  variantKey: string;
}) => {
  if (!draft.value) return;
  refreshSection(
    await applyVariant(draft.value.id, payload.sectionId, payload.variantKey)
  );
  invalidateCompletenessLocal();
  ElMessage.success("已切换模版");
};

const onRemoveSection = async (sectionId: number) => {
  if (!draft.value) return;
  await removeSection(draft.value.id, sectionId);
  sections.value = sections.value.filter(s => s.id !== sectionId);
  invalidateCompletenessLocal();
};

// 拖拽排序：先本地重排（右侧卡片即时跟随），仅对 sort_order 变化的节并行持久化；失败回读服务端真序
const onReorder = async (orderedIds: number[]) => {
  if (!draft.value) return;
  const draftId = draft.value.id;
  const byId = new Map(sections.value.map(s => [s.id, s]));
  const ordered = orderedIds
    .map(id => byId.get(id))
    .filter((s): s is ContractDraftSection => !!s);
  if (ordered.length !== sections.value.length) return;
  sections.value = ordered;
  const changes = ordered
    .map((s, idx) => ({ id: s.id, sort_order: (idx + 1) * 10 }))
    .filter(c => byId.get(c.id)?.sort_order !== c.sort_order);
  if (!changes.length) return;
  try {
    const updated = await Promise.all(
      changes.map(c =>
        updateSection(draftId, c.id, { sort_order: c.sort_order })
      )
    );
    const updatedMap = new Map(updated.map(u => [u.id, u]));
    sections.value = sections.value.map(s => updatedMap.get(s.id) ?? s);
  } catch {
    ElMessage.error("排序保存失败，已恢复服务端顺序");
    try {
      applyDetail(await getDraft(draftId));
    } catch {
      // 回读也失败（网络异常）：保持当前本地顺序，刷新页面可恢复
    }
  }
};

// 拉取历史版本列表 + 指定版本（checkId=null 取最新）结果，解析为递进报告并填充弹窗态。
// 返回是否成功（解析失败/无版本时提示并返回 false）。
const loadCheckReport = async (
  draftId: number,
  checkId: number | null
): Promise<boolean> => {
  const versions = await listChecks(draftId);
  completenessVersions.value = versions;
  const targetId = checkId ?? versions[0]?.id ?? null;
  if (targetId == null) {
    ElMessage.error("没有可用的检查结果");
    return false;
  }
  const check = await getCheck(draftId, targetId);
  const report = parseCompletenessReport(check.result_json);
  if (!report) {
    ElMessage.error("检查结果无法解析，请重新检查");
    return false;
  }
  currentReport.value = report;
  currentCheckId.value = check.id;
  return true;
};

const runCompleteness = async () => {
  if (!draft.value) return;
  const draftId = draft.value.id;
  checking.value = true;
  try {
    await requestCompleteness(draftId);
    // 轮询草稿完整检查状态（2s × 150 次：前后递进双模型最长约 5 分钟）
    for (let i = 0; i < 150; i++) {
      const detail = await getDraft(draftId);
      if (detail.draft.completeness_status === "done") {
        applyDetail(detail);
        // 新一次检查：重置弹窗内的采纳/添加处理态
        appliedSectionKeys.value = [];
        handledMissingKeys.value = [];
        if (await loadCheckReport(draftId, null)) {
          completenessVisible.value = true;
        }
        return;
      }
      if (detail.draft.completeness_status === "error") {
        ElMessage.error("完整检查失败，请重试");
        return;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    ElMessage.error("完整检查超时，请重试");
  } finally {
    checking.value = false;
  }
};

// 「查看上次检查」：不重跑，直接拉最新历史版本打开弹窗
const openLastCheck = async () => {
  if (!draft.value) return;
  appliedSectionKeys.value = [];
  handledMissingKeys.value = [];
  if (await loadCheckReport(draft.value.id, null)) {
    completenessVisible.value = true;
  }
};

// 版本切换：仅重取该版本结果重渲染，不重跑 AI（保留已采纳标记）
const onSwitchVersion = async (checkId: number) => {
  if (!draft.value || checkId === currentCheckId.value) return;
  try {
    const check = await getCheck(draft.value.id, checkId);
    const report = parseCompletenessReport(check.result_json);
    if (!report) {
      ElMessage.error("该版本结果无法解析");
      return;
    }
    currentReport.value = report;
    currentCheckId.value = check.id;
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, "加载该版本失败"));
  }
};

// 弹窗内一键采纳某节复核通过的修正稿（门控在后端；成功后重锁定稿门禁）
const onApplyCompletenessRevision = async (sectionKey: string) => {
  if (!draft.value || currentCheckId.value == null) return;
  try {
    const section = await applyCompletenessRevision(
      draft.value.id,
      currentCheckId.value,
      sectionKey
    );
    refreshSection(section);
    appliedSectionKeys.value = [...appliedSectionKeys.value, sectionKey];
    // 后端已置空 completeness_status（定稿门禁自动重锁）；本地不可变同步
    draft.value = {
      ...draft.value,
      completeness_status: null,
      completeness_result_json: null
    };
    ElMessage.success("已采纳修正稿");
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, "采纳修正稿失败，请重试"));
  }
};

const onHintAdd = async (sectionKey: string) => {
  await onAddSection({ section_key: sectionKey });
  // 本次弹窗内隐藏该缺失项（报告本身不可变，用本地 handled 集合驱动）
  handledMissingKeys.value = [...handledMissingKeys.value, sectionKey];
};

const onHintIgnore = async (sectionKey: string) => {
  if (!draft.value) return;
  await ignoreCompletenessHint(draft.value.id, sectionKey);
  const detail = await getDraft(draft.value.id);
  applyDetail(detail);
};

// 逐节问题组标题点击定位：关弹窗后按 section_key 滚动到对应节
const onLocateSection = async (sectionKey: string) => {
  const target = sections.value.find(s => s.section_key === sectionKey);
  if (!target) return;
  completenessVisible.value = false;
  await nextTick();
  onSelectSection(target.id);
};

// —— 目录滚动跟随（scrollspy）：视口内最靠上的节高亮；点击跳转短暂抑制防跳变 ——
let sectionObserver: IntersectionObserver | null = null;
const visibleSectionIds = new Set<number>();
let scrollspySuppressedUntil = 0;

const updateActiveFromViewport = () => {
  let topId: number | null = null;
  let topY = Number.POSITIVE_INFINITY;
  for (const id of visibleSectionIds) {
    const el = document.getElementById(`section-${id}`);
    if (!el) continue;
    const y = el.getBoundingClientRect().top;
    if (y < topY) {
      topY = y;
      topId = id;
    }
  }
  if (topId != null) activeSectionId.value = topId;
};

const setupScrollspy = () => {
  sectionObserver?.disconnect();
  visibleSectionIds.clear();
  if (typeof IntersectionObserver === "undefined" || !sections.value.length)
    return;
  sectionObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const id = Number(entry.target.id.replace("section-", ""));
      if (!Number.isInteger(id)) continue;
      if (entry.isIntersecting) visibleSectionIds.add(id);
      else visibleSectionIds.delete(id);
    }
    if (Date.now() < scrollspySuppressedUntil) return;
    updateActiveFromViewport();
  });
  for (const s of sections.value) {
    const el = document.getElementById(`section-${s.id}`);
    if (el) sectionObserver.observe(el);
  }
};

// 节集合变化（加载/增删/返回列表）后重建观察
watch(
  () => sections.value.map(s => s.id).join(","),
  async () => {
    await nextTick();
    setupScrollspy();
  }
);

onBeforeUnmount(() => {
  sectionObserver?.disconnect();
  sectionObserver = null;
});

const onSelectSection = (id: number) => {
  activeSectionId.value = id;
  scrollspySuppressedUntil = Date.now() + 500;
  const el = document.getElementById(`section-${id}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  // 部分环境（reduced-motion / 无合成器动画）smooth 会静默不滚动：
  // 短延时检测未发生位移则瞬时跳转兜底（已在目标位时兜底无副作用）
  const initialTop = el.getBoundingClientRect().top;
  window.setTimeout(() => {
    if (Math.abs(el.getBoundingClientRect().top - initialTop) < 2) {
      el.scrollIntoView({ block: "start" });
    }
  }, 150);
};

onMounted(async () => {
  await Promise.all([
    loadProjects(),
    listEntities({ status: "active" }).then(res => (entities.value = res.data))
  ]);
  const id = Number(route.query.id);
  if (Number.isInteger(id) && id > 0) {
    await loadDraft(id);
  }
});
</script>

<template>
  <div class="draft-page">
    <template v-if="!draft">
      <DraftInitCard @create="onCreate" />
      <DraftListCard @open="onOpenDraft" />
    </template>
    <template v-else>
      <DraftBanner
        v-model:bank-account-id="selectedBankAccountId"
        :draft="draft"
        :entities="entities"
        :projects="projects"
        :bank-accounts="entityBankAccounts"
        :saving="saving"
        @patch="onPatchDraft"
        @save="saveDraftMeta"
        @back="onBackToList"
        @view-contract="onViewContract"
      />
      <el-row :gutter="12">
        <el-col :span="6">
          <div class="toc-sticky">
            <SectionListPanel
              :sections="sections"
              :templates="templates"
              :active-id="activeSectionId"
              @select="onSelectSection"
              @add="onAddSection"
              @remove="onRemoveSection"
              @reorder="onReorder"
            />
          </div>
        </el-col>
        <el-col :span="18">
          <div class="toolbar">
            <el-alert
              type="info"
              :closable="false"
              title="AI 辅助起草的内容为草稿，须经负责人审核后方可作为正式合同使用"
            />
            <el-button
              type="warning"
              plain
              :loading="checking"
              @click="runCompleteness"
            >
              {{ checking ? "检查中…" : "完整检查" }}
            </el-button>
            <el-button
              v-if="hasCompletedCheck && !checking"
              plain
              @click="openLastCheck"
            >
              查看上次检查
            </el-button>
            <el-button plain @click="plainPreviewVisible = true">
              纯文本预览
            </el-button>
            <el-tooltip
              content="完成完整检查后方可定稿（内容变更后需重新检查）"
              :disabled="!completenessGateBlocked"
              placement="top"
            >
              <span class="convert-btn-wrap">
                <el-button
                  type="primary"
                  :disabled="
                    !['drafting', 'finalized'].includes(draft.status) ||
                    completenessGateBlocked
                  "
                  @click="convertVisible = true"
                >
                  {{
                    draft.status === "finalized"
                      ? "重试转正式合同"
                      : "定稿转正式合同"
                  }}
                </el-button>
              </span>
            </el-tooltip>
          </div>
          <AiWorkingIndicator
            v-if="checking"
            mode="completeness"
            class="completeness-indicator"
          />
          <SectionCard
            v-for="s in sections"
            :key="s.id"
            :section="s"
            :keyword-values="keywordValues"
            :ai-state="ai.stateOf(s.id)"
            :readonly="draft.status !== 'drafting'"
            :variants="variantsOf(s.section_key)"
            @generate="onGenerate"
            @review="onReview"
            @save="onSave"
            @apply-variant="onApplyVariant"
            @update-keyword="onUpdateKeyword"
            @apply-revision="onApplyRevision"
          />
        </el-col>
      </el-row>
      <CompletenessDialog
        v-model:visible="completenessVisible"
        :report="currentReport"
        :versions="completenessVersions"
        :current-version-id="currentCheckId"
        :applied-keys="appliedSectionKeys"
        :ignored="dialogHiddenMissing"
        @switch-version="onSwitchVersion"
        @add="onHintAdd"
        @ignore="onHintIgnore"
        @locate="onLocateSection"
        @apply-revision="onApplyCompletenessRevision"
      />
      <ConvertDialog
        v-model:visible="convertVisible"
        :draft="draft"
        @converted="onConverted"
      />
      <PlainPreviewDrawer
        v-model:visible="plainPreviewVisible"
        :title="draft.title"
        :sections="sections"
        :keyword-values="keywordValues"
        :absent-keyword-labels="absentKeywordLabels"
      />
    </template>
  </div>
</template>

<style>
/* PureAdmin 布局给 el-scrollbar__view 内联了 overflow:hidden，会把 sticky 的
   滚动容器劫持为不滚动的 view，导致目录无法吸顶；仅当本页挂载（:has 命中
   .draft-page）时放开该 view 的 overflow，不影响其他页面。 */
.app-main .el-scrollbar__view:has(.draft-page) {
  overflow: visible !important;
}
</style>

<style scoped>
.draft-page {
  padding: 12px;
}

/* 目录列 sticky：下滚时目录固定可见，条目区在卡片内自行滚动 */
.toc-sticky {
  position: sticky;
  top: 8px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 120px);
}

.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.toolbar :deep(.el-alert) {
  flex: 1;
}

/* 禁用按钮不触发 hover 事件，包一层 span 承接门禁 tooltip */
.convert-btn-wrap {
  display: inline-block;
}

/* 完整检查运行中：toolbar 下方全宽指示器 */
.completeness-indicator {
  margin-bottom: 12px;
}

.section-card {
  margin-bottom: 12px;
}
</style>
