<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  listDuplicateCenter,
  type DuplicateCenterItem
} from "@/api/reimbursement";

defineOptions({ name: "ReimbursementDuplicateCenter" });

const router = useRouter();
const loading = ref(false);
const list = ref<DuplicateCenterItem[]>([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  risk_level: ""
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listDuplicateCenter({
      risk_level: filters.value.risk_level || undefined,
      page: page.value,
      pageSize: pageSize.value
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>查重中心</span>
        <el-button @click="router.push('/finance/reimbursement')"
          >返回信封列表</el-button
        >
      </div>
    </template>

    <el-form inline>
      <el-form-item label="风险等级">
        <el-select v-model="filters.risk_level" clearable style="width: 160px">
          <el-option label="高" value="high" />
          <el-option label="中" value="medium" />
          <el-option label="低" value="low" />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="envelope_no" label="信封编号" width="160" />
      <el-table-column prop="match_type" label="匹配类型" width="120" />
      <el-table-column prop="risk_level" label="风险等级" width="100" />
      <el-table-column
        prop="matched_invoice_no"
        label="匹配发票号"
        width="200"
      />
      <el-table-column prop="amount" label="金额" width="110" />
      <el-table-column prop="summary" label="说明" min-width="260" />
      <el-table-column label="详情" width="100" fixed="right">
        <template #default="scope">
          <el-button
            link
            type="primary"
            @click="
              router.push(
                `/finance/reimbursement/detail/${scope.row.envelope_id}`
              )
            "
          >
            打开
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      background
      layout="prev, pager, next, total"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="
        (val: number) => {
          page = val;
          loadData();
        }
      "
    />
  </el-card>
</template>
