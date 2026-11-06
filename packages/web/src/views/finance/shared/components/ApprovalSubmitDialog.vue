<script setup lang="ts">
/** 付款单、合同共用的提交审批设置。提交动作由调用方传入，这里只管表单和幂等键。 */
import { computed, ref, watch } from "vue";
import type { InstanceConfig } from "@/api/contract";
import type { WeComUser } from "@/api/wecom";
import { useUserStoreHook } from "@/store/modules/user";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";

defineOptions({ name: "ApprovalSubmitDialog" });

const visible = defineModel<boolean>("visible", { required: true });

type ApprovalSubmitPayload = {
  biz_summary?: string;
  instance_config?: InstanceConfig;
};

const props = defineProps<{
  /** 业务单 id，未加载时为 null */
  bizId: number | null;
  /** 幂等键前缀，如 payment-detail-submit */
  scope: string;
  defaultSummary: string;
  noteTemplates: readonly string[];
  wecomUsers: WeComUser[];
  submit: (
    payload: ApprovalSubmitPayload,
    options: { idempotencyKey: string }
  ) => Promise<unknown>;
}>();

const emit = defineEmits<{ (e: "submitted"): void }>();

const userStore = useUserStoreHook();
const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);

const submitting = ref(false);
const summary = ref("");
const configMode = ref<"form" | "json">("form");
const configText = ref("{}");
const formConfig = ref({
  default_assignee_userids: [] as string[],
  note: ""
});
const selectedTemplate = ref("");

type SubmitSnapshot = { fingerprint: string; idempotencyKey: string };
// 同样的内容重复提交要带同一个幂等键，避免网络抖动时生成两个审批实例
let snapshot: SubmitSnapshot | null = null;

const createIdempotencyKey = () => {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${props.scope}-${random}`;
};

const applyTemplate = (value: string) => {
  if (!value) return;
  formConfig.value = { ...formConfig.value, note: value };
};

watch(visible, open => {
  if (!open) return;
  summary.value = props.defaultSummary;
  configMode.value = "form";
  configText.value = "{}";
  formConfig.value = { default_assignee_userids: [], note: "" };
  selectedTemplate.value = "";
});

/** @returns 配置内容；JSON 写错时返回 null，调用方不再继续提交 */
const buildInstanceConfig = (): { value?: InstanceConfig } | null => {
  if (configMode.value === "json") {
    const trimmed = configText.value.trim();
    if (!trimmed || trimmed === "{}") return {};
    try {
      return { value: JSON.parse(trimmed) as InstanceConfig };
    } catch {
      message("实例级配置 JSON 格式不正确", { type: "warning" });
      return null;
    }
  }
  const userIds = formConfig.value.default_assignee_userids.filter(Boolean);
  const note = formConfig.value.note.trim();
  if (userIds.length === 0 && !note) return {};
  return {
    value: {
      ...(userIds.length > 0 ? { default_assignee_userids: userIds } : {}),
      ...(note ? { note } : {})
    }
  };
};

const confirm = async () => {
  const id = props.bizId;
  if (submitting.value || !id) return;
  const config = buildInstanceConfig();
  if (!config) return;

  const bizSummary = summary.value.trim();
  const fingerprint = JSON.stringify({
    request_id: id,
    biz_summary: bizSummary,
    instance_config: config.value ?? null
  });
  if (snapshot?.fingerprint !== fingerprint) {
    snapshot = { fingerprint, idempotencyKey: createIdempotencyKey() };
  }

  submitting.value = true;
  try {
    await props.submit(
      {
        biz_summary: bizSummary || undefined,
        instance_config: config.value
      },
      { idempotencyKey: snapshot.idempotencyKey }
    );
    snapshot = null;
    visible.value = false;
    message("已提交审批", { type: "success" });
    emit("submitted");
  } catch (error) {
    message(resolveApiErrorMessage(error, "提交审批失败，请重试"), {
      type: "error"
    });
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <el-dialog
    v-model="visible"
    title="审批提交设置"
    width="560px"
    append-to-body
  >
    <el-alert
      type="info"
      :closable="false"
      title="用于临时指定审批人或补充审批说明；不填写时按模板默认流程执行"
      style="margin-bottom: 12px"
    />
    <el-form label-width="120px">
      <el-form-item label="审批摘要">
        <el-input
          v-model="summary"
          placeholder="可选：补充本次提交重点，例如 付款节点加急"
        />
      </el-form-item>
      <el-form-item v-if="isSuperAdmin" label="设置模式">
        <el-radio-group v-model="configMode">
          <el-radio-button value="form">可视化</el-radio-button>
          <el-radio-button value="json">JSON(高级)</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <template v-if="configMode === 'form'">
        <el-form-item label="临时审批人">
          <el-select
            v-model="formConfig.default_assignee_userids"
            multiple
            clearable
            filterable
            placeholder="可选，指定本次审批默认审批人"
            style="width: 100%"
          >
            <el-option
              v-for="item in wecomUsers"
              :key="item.userid"
              :label="item.name || item.userid"
              :value="item.userid"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="常用说明模板">
          <el-select
            v-model="selectedTemplate"
            clearable
            placeholder="选择后自动填充审批说明"
            style="width: 100%"
            @change="applyTemplate"
          >
            <el-option
              v-for="item in noteTemplates"
              :key="item"
              :label="item"
              :value="item"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="审批说明">
          <el-input
            v-model="formConfig.note"
            type="textarea"
            :rows="3"
            placeholder="可选，用于补充本次实例级说明"
          />
        </el-form-item>
      </template>
      <el-form-item v-else-if="isSuperAdmin" label="实例配置(JSON)">
        <el-input
          v-model="configText"
          type="textarea"
          :rows="7"
          placeholder='例如 {"default_assignee_userids":["zhangsan"],"note":"加急审批"}'
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        :disabled="submitting"
        @click="confirm"
      >
        确认提交
      </el-button>
    </template>
  </el-dialog>
</template>
