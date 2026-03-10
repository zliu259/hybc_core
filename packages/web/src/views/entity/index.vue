<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { UploadRequestOptions } from "element-plus";
import { message } from "@/utils/message";
import {
  createEntity,
  createEntityAttachment,
  createEntityBankAccount,
  createEntityInvoiceProfile,
  deleteEntityAttachment,
  getEntityStorageSummary,
  listEntities,
  listEntityAttachments,
  listEntityBankAccounts,
  listEntityInvoiceProfiles,
  updateEntity,
  type Entity,
  type EntityAttachment,
  type EntityBankAccount,
  type EntityInvoiceProfile
} from "@/api/entity";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";

defineOptions({
  name: "EntityManagement"
});

const entities = ref<Entity[]>([]);
const selectedEntityId = ref<number | null>(null);
const bankAccounts = ref<EntityBankAccount[]>([]);
const invoiceProfiles = ref<EntityInvoiceProfile[]>([]);
const attachments = ref<EntityAttachment[]>([]);

const storageSummary = ref({
  storage_quota_mb: 0,
  storage_used_mb: 0,
  storage_remaining_mb: 0,
  active_attachment_count: 0
});

const entityForm = ref({
  entity_code: "",
  entity_name: "",
  legal_person: "",
  tax_id: "",
  company_attribute: "self_owned" as "self_owned" | "external" | "shareholder_personal",
  storage_quota_mb: 1024,
  primary_bank_name: "",
  primary_bank_branch_no: "",
  primary_bank_account_no: ""
});

const bankForm = ref({
  bank_name: "",
  account_name: "",
  account_no: "",
  bank_branch_no: "",
  bank_line_no: ""
});

const invoiceForm = ref({
  invoice_title: "",
  tax_no: "",
  address: "",
  phone: "",
  bank_name: "",
  bank_account: ""
});

const selectedEntity = computed(() => {
  return entities.value.find((item) => item.id === selectedEntityId.value) ?? null;
});

const companyAttributeLabel = (value: string) => {
  if (value === "self_owned") return "自有公司";
  if (value === "external") return "外挂公司";
  if (value === "shareholder_personal") return "股东个人";
  return value;
};

const loadSubResources = async (entityId: number) => {
  const [bankResult, invoiceResult, attachmentResult, storageResult] = await Promise.all([
    listEntityBankAccounts(entityId),
    listEntityInvoiceProfiles(entityId),
    listEntityAttachments(entityId),
    getEntityStorageSummary(entityId)
  ]);
  bankAccounts.value = bankResult.data;
  invoiceProfiles.value = invoiceResult.data;
  attachments.value = attachmentResult.data;
  storageSummary.value = storageResult.data;
};

const loadEntities = async () => {
  const result = await listEntities();
  entities.value = result.data;
  if (!selectedEntityId.value && entities.value.length > 0) {
    selectedEntityId.value = entities.value[0].id;
  }
  if (selectedEntityId.value) {
    await loadSubResources(selectedEntityId.value);
  }
};

const createEntityRow = async () => {
  if (!entityForm.value.entity_code || !entityForm.value.entity_name) {
    message("请填写实体编码和名称", { type: "warning" });
    return;
  }

  await createEntity({ ...entityForm.value });
  entityForm.value = {
    entity_code: "",
    entity_name: "",
    legal_person: "",
    tax_id: "",
    company_attribute: "self_owned",
    storage_quota_mb: 1024,
    primary_bank_name: "",
    primary_bank_branch_no: "",
    primary_bank_account_no: ""
  };
  await loadEntities();
  message("实体创建成功", { type: "success" });
};

const saveSelectedEntity = async () => {
  if (!selectedEntity.value) {
    message("请先选择实体", { type: "warning" });
    return;
  }
  await updateEntity(selectedEntity.value.id, {
    tax_id: selectedEntity.value.tax_id,
    company_attribute: selectedEntity.value.company_attribute,
    storage_quota_mb: selectedEntity.value.storage_quota_mb,
    primary_bank_name: selectedEntity.value.primary_bank_name,
    primary_bank_branch_no: selectedEntity.value.primary_bank_branch_no,
    primary_bank_account_no: selectedEntity.value.primary_bank_account_no
  });
  await loadEntities();
  message("实体信息已更新", { type: "success" });
};

const createBankAccountRow = async () => {
  if (!selectedEntityId.value) {
    message("请先选择实体", { type: "warning" });
    return;
  }

  await createEntityBankAccount(selectedEntityId.value, { ...bankForm.value });
  bankForm.value = {
    bank_name: "",
    account_name: "",
    account_no: "",
    bank_branch_no: "",
    bank_line_no: ""
  };
  await loadSubResources(selectedEntityId.value);
  message("银行账户创建成功", { type: "success" });
};

const createInvoiceProfileRow = async () => {
  if (!selectedEntityId.value) {
    message("请先选择实体", { type: "warning" });
    return;
  }

  await createEntityInvoiceProfile(selectedEntityId.value, {
    ...invoiceForm.value
  });
  invoiceForm.value = {
    invoice_title: "",
    tax_no: "",
    address: "",
    phone: "",
    bank_name: "",
    bank_account: ""
  };
  await loadSubResources(selectedEntityId.value);
  message("开票信息创建成功", { type: "success" });
};

const uploadAttachment = async (options: UploadRequestOptions) => {
  if (!selectedEntityId.value) {
    options.onError?.(new Error("entity_required") as never);
    message("请先选择实体", { type: "warning" });
    return;
  }

  try {
    const signResult = await createUploadSignature({
      fileName: options.file.name,
      contentType: options.file.type || undefined,
      category: "entity"
    });

    const uploadResp = await fetch(resolveUploadUrl(signResult.data.uploadUrl), {
      method: "PUT",
      headers: {
        "content-type": options.file.type || "application/octet-stream"
      },
      body: options.file
    });

    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }

    await createEntityAttachment(selectedEntityId.value, {
      file_key: signResult.data.key,
      file_name: options.file.name,
      file_size: options.file.size,
      file_category: "business_license"
    });
    await loadSubResources(selectedEntityId.value);
    options.onSuccess?.({} as never);
    message("附件上传成功", { type: "success" });
  } catch {
    options.onError?.(new Error("upload_failed") as never);
    message("附件上传失败", { type: "error" });
  }
};

const removeAttachment = async (attachmentId: number) => {
  if (!selectedEntityId.value) return;
  await deleteEntityAttachment(selectedEntityId.value, attachmentId);
  await loadSubResources(selectedEntityId.value);
  message("附件已删除", { type: "success" });
};

onMounted(loadEntities);
</script>

<template>
  <el-row :gutter="16">
    <el-col :md="10" :xs="24">
      <el-card shadow="never" header="公司实体管理">
        <el-form label-width="98px">
          <el-form-item label="实体编码"><el-input v-model="entityForm.entity_code" /></el-form-item>
          <el-form-item label="实体名称"><el-input v-model="entityForm.entity_name" /></el-form-item>
          <el-form-item label="法人"><el-input v-model="entityForm.legal_person" /></el-form-item>
          <el-form-item label="税号"><el-input v-model="entityForm.tax_id" /></el-form-item>
          <el-form-item label="公司属性">
            <el-select v-model="entityForm.company_attribute" style="width: 100%">
              <el-option label="自有公司" value="self_owned" />
              <el-option label="外挂公司" value="external" />
              <el-option label="股东个人" value="shareholder_personal" />
            </el-select>
          </el-form-item>
          <el-form-item label="存储额度(MB)">
            <el-input-number v-model="entityForm.storage_quota_mb" :min="1" :max="102400" />
          </el-form-item>
          <el-form-item label="主开户行"><el-input v-model="entityForm.primary_bank_name" /></el-form-item>
          <el-form-item label="主行号"><el-input v-model="entityForm.primary_bank_branch_no" /></el-form-item>
          <el-form-item label="主账号"><el-input v-model="entityForm.primary_bank_account_no" /></el-form-item>
          <el-button type="primary" @click="createEntityRow">新增实体</el-button>
        </el-form>

        <el-table
          :data="entities"
          highlight-current-row
          style="margin-top: 16px"
          @current-change="(row: Entity) => row && (selectedEntityId = row.id)"
        >
          <el-table-column prop="entity_code" label="编码" width="120" />
          <el-table-column prop="entity_name" label="名称" />
          <el-table-column label="属性" width="110">
            <template #default="scope">{{ companyAttributeLabel(scope.row.company_attribute) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="90" />
        </el-table>
      </el-card>
    </el-col>

    <el-col :md="14" :xs="24">
      <el-card shadow="never" :header="`实体详情 - ${selectedEntity?.entity_name ?? '-'}`">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="公司属性">
            {{ companyAttributeLabel(selectedEntity?.company_attribute ?? "") }}
          </el-descriptions-item>
          <el-descriptions-item label="税号">{{ selectedEntity?.tax_id || "-" }}</el-descriptions-item>
          <el-descriptions-item label="已用空间(MB)">
            {{ storageSummary.storage_used_mb }} / {{ storageSummary.storage_quota_mb }}
          </el-descriptions-item>
          <el-descriptions-item label="附件数量">{{ storageSummary.active_attachment_count }}</el-descriptions-item>
        </el-descriptions>

        <el-form v-if="selectedEntity" label-width="90px" style="margin-top: 12px">
          <el-form-item label="税号"><el-input v-model="selectedEntity.tax_id" /></el-form-item>
          <el-form-item label="公司属性">
            <el-select v-model="selectedEntity.company_attribute" style="width: 100%">
              <el-option label="自有公司" value="self_owned" />
              <el-option label="外挂公司" value="external" />
              <el-option label="股东个人" value="shareholder_personal" />
            </el-select>
          </el-form-item>
          <el-form-item label="空间配额(MB)">
            <el-input-number v-model="selectedEntity.storage_quota_mb" :min="1" :max="102400" />
          </el-form-item>
          <el-form-item label="主开户行"><el-input v-model="selectedEntity.primary_bank_name" /></el-form-item>
          <el-form-item label="主行号"><el-input v-model="selectedEntity.primary_bank_branch_no" /></el-form-item>
          <el-form-item label="主账号"><el-input v-model="selectedEntity.primary_bank_account_no" /></el-form-item>
          <el-button type="primary" @click="saveSelectedEntity">保存实体详情</el-button>
        </el-form>

        <el-tabs style="margin-top: 12px">
          <el-tab-pane label="银行账户">
            <el-form inline>
              <el-form-item label="银行名"><el-input v-model="bankForm.bank_name" /></el-form-item>
              <el-form-item label="户名"><el-input v-model="bankForm.account_name" /></el-form-item>
              <el-form-item label="账号"><el-input v-model="bankForm.account_no" /></el-form-item>
              <el-form-item label="分行号"><el-input v-model="bankForm.bank_branch_no" /></el-form-item>
              <el-form-item label="行号"><el-input v-model="bankForm.bank_line_no" /></el-form-item>
              <el-button type="primary" @click="createBankAccountRow">新增账户</el-button>
            </el-form>
            <el-table :data="bankAccounts">
              <el-table-column prop="bank_name" label="银行" />
              <el-table-column prop="account_name" label="户名" />
              <el-table-column prop="account_no" label="账号" />
              <el-table-column prop="bank_branch_no" label="分行号" />
              <el-table-column prop="bank_line_no" label="行号" />
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="开票信息">
            <el-form label-width="86px">
              <el-form-item label="抬头"><el-input v-model="invoiceForm.invoice_title" /></el-form-item>
              <el-form-item label="税号"><el-input v-model="invoiceForm.tax_no" /></el-form-item>
              <el-form-item label="地址"><el-input v-model="invoiceForm.address" /></el-form-item>
              <el-form-item label="电话"><el-input v-model="invoiceForm.phone" /></el-form-item>
              <el-form-item label="开户行"><el-input v-model="invoiceForm.bank_name" /></el-form-item>
              <el-form-item label="银行账号"><el-input v-model="invoiceForm.bank_account" /></el-form-item>
              <el-button type="primary" @click="createInvoiceProfileRow">新增开票信息</el-button>
            </el-form>
            <el-table :data="invoiceProfiles" style="margin-top: 12px">
              <el-table-column prop="invoice_title" label="抬头" />
              <el-table-column prop="tax_no" label="税号" />
              <el-table-column prop="bank_name" label="开户行" />
              <el-table-column prop="bank_account" label="银行账号" />
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="公司附件">
            <el-upload drag :show-file-list="false" :http-request="uploadAttachment">
              <div class="el-upload__text">拖拽营业执照等附件到这里，或 <em>点击上传</em></div>
            </el-upload>
            <el-table :data="attachments" style="margin-top: 12px">
              <el-table-column prop="file_name" label="文件名" />
              <el-table-column prop="file_category" label="分类" width="120" />
              <el-table-column label="大小(KB)" width="120">
                <template #default="scope">{{ scope.row.file_size ? Math.ceil(scope.row.file_size / 1024) : "-" }}</template>
              </el-table-column>
              <el-table-column prop="created_at" label="上传时间" width="180" />
              <el-table-column label="操作" width="110" fixed="right">
                <template #default="scope">
                  <el-button link type="danger" @click="removeAttachment(scope.row.id)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </el-col>
  </el-row>
</template>
