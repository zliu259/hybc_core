<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  createEntity,
  createEntityBankAccount,
  createEntityInvoiceProfile,
  listEntities,
  listEntityBankAccounts,
  listEntityInvoiceProfiles,
  type Entity,
  type EntityBankAccount,
  type EntityInvoiceProfile
} from "@/api/entity";

defineOptions({
  name: "EntityManagement"
});

const entities = ref<Entity[]>([]);
const selectedEntityId = ref<number | null>(null);
const bankAccounts = ref<EntityBankAccount[]>([]);
const invoiceProfiles = ref<EntityInvoiceProfile[]>([]);

const entityForm = ref({
  entity_code: "",
  entity_name: "",
  legal_person: ""
});

const bankForm = ref({
  bank_name: "",
  account_name: "",
  account_no: ""
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

const loadSubResources = async (entityId: number) => {
  const [bankResult, invoiceResult] = await Promise.all([
    listEntityBankAccounts(entityId),
    listEntityInvoiceProfiles(entityId)
  ]);
  bankAccounts.value = bankResult.data;
  invoiceProfiles.value = invoiceResult.data;
};

const createEntityRow = async () => {
  if (!entityForm.value.entity_code || !entityForm.value.entity_name) {
    message("请填写实体编码和名称", { type: "warning" });
    return;
  }

  await createEntity({ ...entityForm.value });
  entityForm.value = { entity_code: "", entity_name: "", legal_person: "" };
  await loadEntities();
  message("实体创建成功", { type: "success" });
};

const createBankAccountRow = async () => {
  if (!selectedEntityId.value) {
    message("请先选择实体", { type: "warning" });
    return;
  }

  await createEntityBankAccount(selectedEntityId.value, { ...bankForm.value });
  bankForm.value = { bank_name: "", account_name: "", account_no: "" };
  await loadSubResources(selectedEntityId.value);
  message("银行账户创建成功", { type: "success" });
};

const createInvoiceProfileRow = async () => {
  if (!selectedEntityId.value) {
    message("请先选择实体", { type: "warning" });
    return;
  }

  await createEntityInvoiceProfile(selectedEntityId.value, { ...invoiceForm.value });
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

onMounted(loadEntities);
</script>

<template>
  <el-row :gutter="16">
    <el-col :md="10" :xs="24">
      <el-card shadow="never" header="实体管理">
        <el-form label-width="80px">
          <el-form-item label="实体编码">
            <el-input v-model="entityForm.entity_code" />
          </el-form-item>
          <el-form-item label="实体名称">
            <el-input v-model="entityForm.entity_name" />
          </el-form-item>
          <el-form-item label="法人">
            <el-input v-model="entityForm.legal_person" />
          </el-form-item>
          <el-button type="primary" @click="createEntityRow">新增实体</el-button>
        </el-form>

        <el-table
          :data="entities"
          highlight-current-row
          style="margin-top: 16px"
          @current-change="(row: Entity) => row && (selectedEntityId = row.id)"
        >
          <el-table-column prop="entity_code" label="编码" width="140" />
          <el-table-column prop="entity_name" label="名称" />
          <el-table-column prop="status" label="状态" width="100" />
        </el-table>
      </el-card>
    </el-col>

    <el-col :md="14" :xs="24">
      <el-card shadow="never" :header="`关联信息 - ${selectedEntity?.entity_name ?? '-'}`">
        <el-tabs>
          <el-tab-pane label="银行账户">
            <el-form inline>
              <el-form-item label="银行名">
                <el-input v-model="bankForm.bank_name" />
              </el-form-item>
              <el-form-item label="户名">
                <el-input v-model="bankForm.account_name" />
              </el-form-item>
              <el-form-item label="账号">
                <el-input v-model="bankForm.account_no" />
              </el-form-item>
              <el-button type="primary" @click="createBankAccountRow">
                新增账户
              </el-button>
            </el-form>
            <el-table :data="bankAccounts">
              <el-table-column prop="bank_name" label="银行" />
              <el-table-column prop="account_name" label="户名" />
              <el-table-column prop="account_no" label="账号" />
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="开票信息">
            <el-form label-width="90px">
              <el-form-item label="抬头">
                <el-input v-model="invoiceForm.invoice_title" />
              </el-form-item>
              <el-form-item label="税号">
                <el-input v-model="invoiceForm.tax_no" />
              </el-form-item>
              <el-form-item label="地址">
                <el-input v-model="invoiceForm.address" />
              </el-form-item>
              <el-form-item label="电话">
                <el-input v-model="invoiceForm.phone" />
              </el-form-item>
              <el-form-item label="开户行">
                <el-input v-model="invoiceForm.bank_name" />
              </el-form-item>
              <el-form-item label="银行账号">
                <el-input v-model="invoiceForm.bank_account" />
              </el-form-item>
              <el-button type="primary" @click="createInvoiceProfileRow">
                新增开票信息
              </el-button>
            </el-form>
            <el-table :data="invoiceProfiles" style="margin-top: 12px">
              <el-table-column prop="invoice_title" label="抬头" />
              <el-table-column prop="tax_no" label="税号" />
              <el-table-column prop="bank_name" label="开户行" />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </el-col>
  </el-row>
</template>
