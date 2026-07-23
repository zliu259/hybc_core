<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  convertDraft,
  finalizeDraft,
  type ContractDraft,
  type FixedSection
} from "@/api/contract-draft";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { buildDocxBuffer } from "@/views/bidding/dedup/lib/docx-export";

const CONTRACT_TYPE_OPTIONS = ["人工", "机械", "总包", "材料", "其他"];

const props = defineProps<{ visible: boolean; draft: ContractDraft }>();
const emit = defineEmits<{
  (e: "update:visible", v: boolean): void;
  (e: "converted", payload: { contract_id: number; contract_no: string }): void;
}>();

const step = ref<"confirm" | "working">("confirm");
const contractType = ref("机械");
const unresolvedKeys = ref<string[]>([]);
const fixedSections = ref<FixedSection[]>([]);
const finalized = ref(false);

const docxParagraphs = computed(() => {
  const paras: string[] = [props.draft.title];
  for (const s of fixedSections.value) {
    paras.push("");
    paras.push(s.title);
    paras.push(...s.content.split("\n"));
  }
  paras.push("");
  paras.push("【本文档由 AI 辅助起草，须经负责人审核后方可作为正式合同使用】");
  return paras;
});

async function runFinalize(): Promise<boolean> {
  const res = await finalizeDraft(props.draft.id);
  fixedSections.value = res.fixed_sections;
  unresolvedKeys.value = res.unresolved_keys;
  finalized.value = true;
  return true;
}

async function runConvert(): Promise<void> {
  step.value = "working";
  try {
    if (!finalized.value) await runFinalize();
    const buffer = await buildDocxBuffer(docxParagraphs.value);
    const fileName = `${props.draft.title || "合同草稿"}.docx`;
    const signRes = await createUploadSignature({
      fileName,
      category: "contract-draft"
    });
    const uploadResp = await fetch(resolveUploadUrl(signRes.data.uploadUrl), {
      method: "PUT",
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      body: new Uint8Array(buffer)
    });
    if (!uploadResp.ok)
      throw new Error(`文档上传失败（HTTP ${uploadResp.status}）`);
    const converted = await convertDraft(props.draft.id, {
      contract_type: contractType.value,
      file_key: signRes.data.key,
      file_name: fileName,
      file_size: buffer.byteLength
    });
    ElMessage.success(`已生成正式合同 ${converted.contract_no}`);
    emit("converted", converted);
    emit("update:visible", false);
  } catch (e: unknown) {
    ElMessage.error(e instanceof Error ? e.message : "转化失败，请重试");
    step.value = "confirm";
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="定稿并转为正式合同"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="v => emit('update:visible', v)"
  >
    <el-alert
      type="warning"
      :closable="false"
      title="定稿后草稿锁定编辑；将固化关键字、生成 docx 并创建正式合同，随后请在合同详情页提交审批。"
    />
    <el-form label-width="96px" class="convert-form">
      <el-form-item label="合同类型" required>
        <el-select v-model="contractType" style="width: 100%">
          <el-option
            v-for="t in CONTRACT_TYPE_OPTIONS"
            :key="t"
            :value="t"
            :label="t"
          />
        </el-select>
      </el-form-item>
    </el-form>
    <el-alert
      v-if="unresolvedKeys.length"
      type="error"
      :closable="false"
      :title="`仍有未填写的关键字：${unresolvedKeys.join('、')}（导出文档将保留占位符原样）`"
    />
    <template #footer>
      <el-button
        :disabled="step === 'working'"
        @click="emit('update:visible', false)"
        >取消</el-button
      >
      <el-button
        type="primary"
        :loading="step === 'working'"
        @click="runConvert"
      >
        定稿并转正式合同
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.convert-form {
  margin-top: 12px;
}
</style>
