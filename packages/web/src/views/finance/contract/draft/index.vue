<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import {
  addSection as apiAddSection,
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
  type DraftDirection
} from "@/api/contract-draft";
import { listEntities, type Entity } from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useContractDraftAI } from "./composables/useContractDraftAI";
import DraftInitCard from "./components/DraftInitCard.vue";
import SectionListPanel from "./components/SectionListPanel.vue";
import SectionCard from "./components/SectionCard.vue";
import CompletenessDialog, {
  type MissingHint
} from "./components/CompletenessDialog.vue";

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
const keywordValues = computed<Record<string, string>>(() => {
  const our = ourEntity.value;
  const cp = draft.value;
  const base: Record<string, string> = { ...keywords.value };
  if (cp?.direction === "inbound") {
    // 我方为乙方
    if (cp.counterparty_name) base.party_a = cp.counterparty_name;
    if (cp.counterparty_credit_code)
      base.party_a_credit_code = cp.counterparty_credit_code;
    if (cp.counterparty_legal_person)
      base.party_a_legal_person = cp.counterparty_legal_person;
    if (cp.counterparty_address) base.party_a_address = cp.counterparty_address;
    if (our) {
      base.party_b = our.entity_name;
      if (our.tax_id) base.party_b_credit_code = our.tax_id;
      if (our.legal_person) base.party_b_legal_person = our.legal_person;
      if (our.primary_bank_name) base.party_b_bank_name = our.primary_bank_name;
      if (our.primary_bank_account_no)
        base.party_b_bank_account = our.primary_bank_account_no;
    }
  } else if (cp) {
    // 我方为甲方
    if (our) {
      base.party_a = our.entity_name;
      if (our.tax_id) base.party_a_credit_code = our.tax_id;
      if (our.legal_person) base.party_a_legal_person = our.legal_person;
      if (our.primary_bank_name) base.party_a_bank_name = our.primary_bank_name;
      if (our.primary_bank_account_no)
        base.party_a_bank_account = our.primary_bank_account_no;
    }
    if (cp.counterparty_name) base.party_b = cp.counterparty_name;
    if (cp.counterparty_credit_code)
      base.party_b_credit_code = cp.counterparty_credit_code;
    if (cp.counterparty_legal_person)
      base.party_b_legal_person = cp.counterparty_legal_person;
    if (cp.counterparty_address) base.party_b_address = cp.counterparty_address;
  }
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

const loadTemplates = async (direction: DraftDirection) => {
  templates.value = await listClauseTemplates(direction);
};

const onCreate = async (payload: {
  direction: DraftDirection;
  title: string;
  counterparty_name: string;
}) => {
  const detail = await createDraft(payload);
  applyDetail(detail);
  await loadTemplates(detail.draft.direction);
  await router.replace({ query: { id: String(detail.draft.id) } });
};

const saveDraftMeta = async () => {
  if (!draft.value) return;
  saving.value = true;
  try {
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
      keywords: keywords.value
    });
    draft.value = res.draft;
    if (res.keyword_findings.length) {
      ElMessage.warning(res.keyword_findings.map(f => f.reason).join("；"));
    } else {
      ElMessage.success("已保存");
    }
  } finally {
    saving.value = false;
  }
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
}) => {
  if (!draft.value) return;
  const section = await apiAddSection(draft.value.id, payload);
  sections.value = [...sections.value, section].sort(
    (a, b) => a.sort_order - b.sort_order || a.id - b.id
  );
};

const onRemoveSection = async (sectionId: number) => {
  if (!draft.value) return;
  await removeSection(draft.value.id, sectionId);
  sections.value = sections.value.filter(s => s.id !== sectionId);
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
    await loadTemplates(detail.draft.direction);
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
                <span>{{
                  draft.direction === "inbound" ? "对甲方合同" : "对分包商合同"
                }}</span>
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
          </div>
          <SectionCard
            v-for="s in sections"
            :key="s.id"
            :section="s"
            :keyword-values="keywordValues"
            :ai-state="ai.stateOf(s.id)"
            @generate="onGenerate"
            @review="onReview"
            @save="onSave"
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
.meta-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.toolbar :deep(.el-alert) {
  flex: 1;
}
.section-card {
  margin-bottom: 12px;
}
</style>
