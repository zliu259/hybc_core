<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  addSection as apiAddSection,
  applyVariant,
  createDraft,
  getDraft,
  getSection,
  ignoreCompletenessHint,
  listClauseTemplates,
  removeSection,
  requestCompleteness,
  updateDraft,
  updateSection,
  type ClauseTemplate,
  type ContractDraft,
  type ContractDraftSection,
  type ContractFamily,
  type DraftDirection
} from "@/api/contract-draft";
import {
  draftStatusLabelMap,
  draftStatusTagType,
  familyLabelMap
} from "./draft-labels";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useContractDraftAI } from "./composables/useContractDraftAI";
import DraftInitCard from "./components/DraftInitCard.vue";
import SectionListPanel from "./components/SectionListPanel.vue";
import SectionCard from "./components/SectionCard.vue";
import CompletenessDialog, {
  type MissingHint
} from "./components/CompletenessDialog.vue";
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
const missingHints = ref<MissingHint[]>([]);
const saving = ref(false);
const checking = ref(false);
const convertVisible = ref(false);
const plainPreviewVisible = ref(false);
const entityBankAccounts = ref<EntityBankAccount[]>([]);
const selectedBankAccountId = ref<number | null>(null);

const onConverted = (payload: { contract_id: number }) => {
  router.push(`/finance/contract/detail/${payload.contract_id}`);
};

const ai = useContractDraftAI();

// 关键字字段清单（与条款库占位符对齐；甲乙方主体信息按立场自动映射）
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

const onGenerate = async (payload: {
  sectionId: number;
  instruction: string;
}) => {
  if (!draft.value) return;
  refreshSection(
    await ai.generateForSection(
      draft.value.id,
      payload.sectionId,
      payload.instruction
    )
  );
};

const onReview = async (sectionId: number) => {
  if (!draft.value) return;
  refreshSection(await ai.reviewForSection(draft.value.id, sectionId));
};

const onSave = async (payload: { sectionId: number; content: string }) => {
  if (!draft.value) return;
  refreshSection(
    await updateSection(draft.value.id, payload.sectionId, {
      content: payload.content
    })
  );
  ElMessage.success("已保存该节");
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
  ElMessage.success("已切换模版");
};

const onRemoveSection = async (sectionId: number) => {
  if (!draft.value) return;
  await removeSection(draft.value.id, sectionId);
  sections.value = sections.value.filter(s => s.id !== sectionId);
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

const onMoveSection = async (payload: { id: number; delta: -1 | 1 }) => {
  if (!draft.value) return;
  const idx = sections.value.findIndex(s => s.id === payload.id);
  const swapIdx = idx + payload.delta;
  if (idx < 0 || swapIdx < 0 || swapIdx >= sections.value.length) return;
  const a = sections.value[idx];
  const b = sections.value[swapIdx];
  const [updatedA, updatedB] = await Promise.all([
    updateSection(draft.value.id, a.id, { sort_order: b.sort_order }),
    updateSection(draft.value.id, b.id, { sort_order: a.sort_order })
  ]);
  sections.value = sections.value
    .map(s =>
      s.id === updatedA.id ? updatedA : s.id === updatedB.id ? updatedB : s
    )
    .sort((x, y) => x.sort_order - y.sort_order || x.id - y.id);
};

const runCompleteness = async () => {
  if (!draft.value) return;
  checking.value = true;
  try {
    await requestCompleteness(draft.value.id);
    // 轮询草稿完整性状态（沿用 2s × 60 次）
    for (let i = 0; i < 60; i++) {
      const detail = await getDraft(draft.value.id);
      if (detail.draft.completeness_status === "done") {
        applyDetail(detail);
        try {
          const parsed = JSON.parse(
            detail.draft.completeness_result_json ?? "{}"
          ) as {
            missing?: MissingHint[];
          };
          missingHints.value = parsed.missing ?? [];
        } catch {
          missingHints.value = [];
        }
        completenessVisible.value = true;
        return;
      }
      if (detail.draft.completeness_status === "error") {
        ElMessage.error("完整性检查失败，请重试");
        return;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    ElMessage.error("完整性检查超时，请重试");
  } finally {
    checking.value = false;
  }
};

const onHintAdd = async (sectionKey: string) => {
  await onAddSection({ section_key: sectionKey });
  missingHints.value = missingHints.value.filter(
    m => m.section_key !== sectionKey
  );
};

const onHintIgnore = async (sectionKey: string) => {
  if (!draft.value) return;
  await ignoreCompletenessHint(draft.value.id, sectionKey);
  const detail = await getDraft(draft.value.id);
  applyDetail(detail);
};

const onSelectSection = (id: number) => {
  activeSectionId.value = id;
  document
    .getElementById(`section-${id}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
};

onMounted(async () => {
  await Promise.all([
    loadProjects(),
    listEntities({ status: "active" }).then(res => (entities.value = res.data))
  ]);
  const id = Number(route.query.id);
  if (Number.isInteger(id) && id > 0) {
    const detail = await getDraft(id);
    applyDetail(detail);
    await loadTemplates(detail.draft.direction, detail.draft.family);
  }
});
</script>

<template>
  <div class="draft-page">
    <DraftInitCard v-if="!draft" @create="onCreate" />
    <template v-else>
      <el-row :gutter="12">
        <el-col :span="8">
          <el-card class="meta-card">
            <template #header>
              <div class="meta-header">
                <span class="meta-title">
                  {{
                    draft.direction === "inbound"
                      ? "对甲方合同"
                      : "对分包商合同"
                  }}
                  <el-tag size="small">{{
                    familyLabelMap[draft.family] ?? draft.family
                  }}</el-tag>
                  <el-tag
                    size="small"
                    :type="draftStatusTagType[draft.status] ?? 'info'"
                  >
                    {{ draftStatusLabelMap[draft.status] ?? draft.status }}
                  </el-tag>
                  <el-button
                    v-if="
                      draft.status === 'converted' &&
                      draft.converted_contract_id
                    "
                    link
                    type="primary"
                    @click="
                      router.push(
                        `/finance/contract/detail/${draft.converted_contract_id}`
                      )
                    "
                  >
                    查看正式合同
                  </el-button>
                </span>
                <el-button
                  size="small"
                  type="primary"
                  :loading="saving"
                  @click="saveDraftMeta"
                  >保存信息</el-button
                >
              </div>
            </template>
            <el-form label-width="96px" size="small">
              <el-form-item label="草稿标题">
                <el-input v-model="draft.title" maxlength="120" />
              </el-form-item>
              <el-form-item label="关联项目">
                <el-select
                  v-model="draft.project_id"
                  clearable
                  filterable
                  style="width: 100%"
                >
                  <el-option
                    v-for="p in projects"
                    :key="p.id"
                    :value="p.id"
                    :label="p.project_name"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="我方主体">
                <el-select
                  v-model="draft.entity_id"
                  clearable
                  filterable
                  style="width: 100%"
                >
                  <el-option
                    v-for="e in entities"
                    :key="e.id"
                    :value="e.id"
                    :label="e.entity_name"
                  />
                </el-select>
              </el-form-item>
              <el-descriptions
                v-if="ourEntity"
                class="entity-descriptions"
                size="small"
                :column="1"
              >
                <el-descriptions-item label="统一社会信用代码">
                  {{ ourEntity.tax_id || "—" }}
                </el-descriptions-item>
                <el-descriptions-item label="法定代表人">
                  {{ ourEntity.legal_person || "—" }}
                </el-descriptions-item>
              </el-descriptions>
              <el-form-item v-if="ourEntity" label="开户账户">
                <el-select
                  v-model="selectedBankAccountId"
                  clearable
                  filterable
                  placeholder="不选则用主账户"
                  style="width: 100%"
                >
                  <el-option
                    v-for="a in entityBankAccounts"
                    :key="a.id"
                    :value="a.id"
                    :label="`${a.bank_name} ${a.account_no}`"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="对方单位">
                <el-input v-model="draft.counterparty_name" maxlength="120" />
              </el-form-item>
              <el-form-item label="信用代码">
                <el-input
                  v-model="draft.counterparty_credit_code"
                  maxlength="32"
                />
              </el-form-item>
              <el-form-item label="法定代表人">
                <el-input
                  v-model="draft.counterparty_legal_person"
                  maxlength="60"
                />
              </el-form-item>
              <el-form-item label="对方地址">
                <el-input
                  v-model="draft.counterparty_address"
                  maxlength="200"
                />
              </el-form-item>
              <el-divider>合同关键字</el-divider>
              <el-form-item
                v-for="f in KEYWORD_FIELDS"
                :key="f.key"
                :label="f.label"
              >
                <el-input v-model="keywords[f.key]" />
              </el-form-item>
            </el-form>
          </el-card>
          <SectionListPanel
            :sections="sections"
            :templates="templates"
            :active-id="activeSectionId"
            @select="onSelectSection"
            @add="onAddSection"
            @remove="onRemoveSection"
            @move="onMoveSection"
            @reorder="onReorder"
          />
        </el-col>
        <el-col :span="16">
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
              完整性检查
            </el-button>
            <el-button plain @click="plainPreviewVisible = true">
              纯文本预览
            </el-button>
            <el-button
              type="primary"
              :disabled="!['drafting', 'finalized'].includes(draft.status)"
              @click="convertVisible = true"
            >
              {{
                draft.status === "finalized"
                  ? "重试转正式合同"
                  : "定稿转正式合同"
              }}
            </el-button>
          </div>
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
          />
        </el-col>
      </el-row>
      <CompletenessDialog
        v-model:visible="completenessVisible"
        :missing="missingHints"
        :ignored="ignoredHints"
        @add="onHintAdd"
        @ignore="onHintIgnore"
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
      />
    </template>
  </div>
</template>

<style scoped>
.draft-page {
  padding: 12px;
}

.meta-card {
  margin-bottom: 12px;
}

.entity-descriptions {
  padding-left: 12px;
  margin-bottom: 12px;
}

.meta-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.meta-title {
  display: inline-flex;
  gap: 6px;
  align-items: center;
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

.section-card {
  margin-bottom: 12px;
}
</style>
