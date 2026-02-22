<script setup lang="ts">
import dayjs from "dayjs";
import type { UploadFile } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  getCurrentUser,
  listMyBankAccounts,
  type MyBankAccount
} from "@/api/user";
import {
  listReimbursementEnvelopes,
  type ReimbursementEnvelope
} from "@/api/reimbursement";

defineOptions({
  name: "Welcome"
});

const router = useRouter();
const loading = ref(false);
const username = ref("");
const reimbursements = ref<ReimbursementEnvelope[]>([]);

const bankCards = ref<MyBankAccount[]>([]);

const certificates = ref<
  Array<{ id: number; name: string; issueDate: string; expireDate: string }>
>([
  {
    id: 1,
    name: "特种设备操作证",
    issueDate: "2024-07-01",
    expireDate: "2026-07-01"
  },
  {
    id: 2,
    name: "安全培训证书",
    issueDate: "2023-09-10",
    expireDate: "2026-03-15"
  }
]);

const pendingCount = computed(
  () => reimbursements.value.filter(item => item.status !== "paid").length
);

const certStatus = (expireDate: string) => {
  const remainDays = dayjs(expireDate).diff(dayjs(), "day");
  if (remainDays < 0) return { type: "danger", text: "已过期" } as const;
  if (remainDays <= 30) return { type: "warning", text: "即将到期" } as const;
  return { type: "success", text: "有效" } as const;
};

const reimbursementTagType = (status: string) => {
  if (status === "paid") return "success";
  if (status === "approved") return "primary";
  if (status === "rejected") return "danger";
  if (status === "cancelled") return "info";
  return "warning";
};

const loadData = async () => {
  loading.value = true;
  try {
    const me = await getCurrentUser();
    username.value = me.data.username;
    const [reimbursementResult, bankAccountResult] = await Promise.all([
      listReimbursementEnvelopes({
        creator_id: "me",
        page: 1,
        pageSize: 8
      }),
      listMyBankAccounts()
    ]);
    reimbursements.value = reimbursementResult.data;
    bankCards.value = bankAccountResult.data;
    if (!bankCards.value.length) {
      bankCards.value = [
        {
          id: 0,
          bank_name: "待补充",
          account_name: "--",
          account_no: "请在个人设置中绑定银行卡"
        }
      ];
    }
  } finally {
    loading.value = false;
  }
};

const reimbursementStatusLabel = (status: string) => {
  if (status === "paid") return "已打款";
  if (status === "approved") return "审核通过";
  if (status === "rejected") return "已驳回";
  if (status === "cancelled") return "已取消";
  if (status === "submitted") return "审核中";
  return "待处理";
};

const formatAmount = (amount: number) => {
  return amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const maskCardNo = (cardNo: string) => {
  if (cardNo.length <= 8) return cardNo;
  return `${cardNo.slice(0, 4)} **** **** ${cardNo.slice(-4)}`;
};

onMounted(async () => {
  await loadData();
});

const onCertUpload = (file: UploadFile) => {
  certificates.value.push({
    id: Date.now(),
    name: file.name,
    issueDate: dayjs().format("YYYY-MM-DD"),
    expireDate: dayjs().add(365, "day").format("YYYY-MM-DD")
  });
};

</script>

<template>
  <div class="workspace" v-loading="loading">
    <el-card shadow="never" class="welcome-card">
      <div class="welcome-card__title">你好，{{ username || "同事" }}</div>
      <div class="welcome-card__sub">今天待处理事项 {{ pendingCount }} 条</div>
      <div class="welcome-card__actions">
        <el-button type="primary" @click="router.push('/finance/reimbursement')"
          >发起报销</el-button
        >
        <el-button @click="router.push('/construction/operator-log/form')"
          >填报日志</el-button
        >
        <el-button @click="router.push('/approval/unified-tasklist')"
          >待我审批</el-button
        >
      </div>
    </el-card>

    <div class="workspace__row">
      <el-card shadow="never" class="bank-card-block">
        <template #header>
          <div class="card-header">我的收款卡</div>
        </template>
        <div v-for="card in bankCards" :key="card.id" class="bank-card">
          <div class="bank-card__bank">{{ card.bank_name }}</div>
          <div class="bank-card__no">{{ maskCardNo(card.account_no) }}</div>
          <div class="bank-card__holder">持卡人：{{ card.account_name }}</div>
        </div>
      </el-card>

      <el-card shadow="never" class="timeline-card">
        <template #header>
          <div class="card-header">我的报销进度</div>
        </template>
        <el-empty v-if="!reimbursements.length" description="暂无报销记录" />
        <el-timeline v-else>
          <el-timeline-item
            v-for="item in reimbursements"
            :key="item.id"
            :timestamp="item.updated_at"
          >
            <div class="timeline-item">
              <span>{{ item.envelope_no }} · ¥{{ formatAmount(item.amount) }}</span>
              <el-tag :type="reimbursementTagType(item.status)">
                {{ reimbursementStatusLabel(item.status) }}
              </el-tag>
            </div>
          </el-timeline-item>
        </el-timeline>
      </el-card>
    </div>

    <el-card shadow="never" class="cert-card">
      <template #header>
        <div class="card-header">个人资质与证书</div>
      </template>

      <el-upload drag :auto-upload="false" :show-file-list="false" :on-change="onCertUpload">
        <div>拖拽证书文件到此处，或点击上传（PDF/图片）</div>
      </el-upload>

      <div class="cert-grid">
        <el-card v-for="cert in certificates" :key="cert.id" shadow="never" class="cert-item">
          <div class="cert-item__name">{{ cert.name }}</div>
          <div class="cert-item__meta">颁发：{{ cert.issueDate }}</div>
          <div class="cert-item__meta">有效期：{{ cert.expireDate }}</div>
          <el-tag :type="certStatus(cert.expireDate).type">
            {{ certStatus(cert.expireDate).text }}
          </el-tag>
        </el-card>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.workspace {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.welcome-card {
  border-color: #d9ceb9;
  background: #fffaf2;
}

.welcome-card__title {
  font-size: 22px;
  font-weight: 700;
  color: #2a241d;
}

.welcome-card__sub {
  margin-top: 6px;
  color: #6e6458;
}

.welcome-card__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.workspace__row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.card-header {
  font-weight: 700;
  color: #2a241d;
}

.bank-card-block,
.timeline-card,
.cert-card {
  border-color: #d9ceb9;
}

.bank-card {
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  padding: 12px;
  background: #fff;
}

.bank-card__bank {
  font-weight: 700;
  color: #2a241d;
}

.bank-card__no,
.bank-card__holder,
.cert-item__meta {
  margin-top: 6px;
  color: #6e6458;
}

.timeline-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.cert-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.cert-item {
  border-color: #d9ceb9;
}

.cert-item__name {
  margin-bottom: 8px;
  font-weight: 700;
  color: #2a241d;
}

@media (max-width: 980px) {
  .workspace__row,
  .cert-grid {
    grid-template-columns: 1fr;
  }
}
</style>
