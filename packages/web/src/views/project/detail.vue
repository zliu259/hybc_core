<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { message } from "@/utils/message";
import {
  createProjectSection,
  getProjectById,
  getProjectFinancialSummary,
  listProjectSections,
  type Project,
  type ProjectSection
} from "@/api/project";

defineOptions({
  name: "ProjectDetail"
});

const route = useRoute();
const projectId = computed(() => Number(route.params.id));
const project = ref<Project | null>(null);
const sections = ref<ProjectSection[]>([]);
const summary = ref<{
  outboundPaidAmount: number;
  inboundReceivedAmount: number;
  reimbursementAmount: number;
  note: string;
} | null>(null);

const sectionForm = ref({
  section_code: "",
  section_name: "",
  section_length: 0
});

const loadData = async () => {
  const [projectResult, sectionResult, summaryResult] = await Promise.all([
    getProjectById(projectId.value),
    listProjectSections(projectId.value),
    getProjectFinancialSummary(projectId.value)
  ]);

  project.value = projectResult.data;
  sections.value = sectionResult.data;
  summary.value = summaryResult.data;
};

const createSection = async () => {
  if (!sectionForm.value.section_code || !sectionForm.value.section_name) {
    message("请填写标段编码和名称", { type: "warning" });
    return;
  }

  await createProjectSection(projectId.value, {
    section_code: sectionForm.value.section_code,
    section_name: sectionForm.value.section_name,
    section_length: sectionForm.value.section_length
  });

  sectionForm.value = {
    section_code: "",
    section_name: "",
    section_length: 0
  };
  await loadData();
  message("标段新增成功", { type: "success" });
};

onMounted(loadData);
</script>

<template>
  <el-row :gutter="16">
    <el-col :md="14" :xs="24">
      <el-card shadow="never" header="项目基础信息">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="项目编号">
            {{ project?.project_code }}
          </el-descriptions-item>
          <el-descriptions-item label="项目名称">
            {{ project?.project_name }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            {{ project?.status }}
          </el-descriptions-item>
          <el-descriptions-item label="项目经理">
            {{ project?.manager_userid || "-" }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never" header="标段信息" style="margin-top: 12px">
        <el-form inline>
          <el-form-item label="标段编码">
            <el-input v-model="sectionForm.section_code" />
          </el-form-item>
          <el-form-item label="标段名称">
            <el-input v-model="sectionForm.section_name" />
          </el-form-item>
          <el-form-item label="里程(m)">
            <el-input-number v-model="sectionForm.section_length" :min="0" />
          </el-form-item>
          <el-button type="primary" @click="createSection">新增标段</el-button>
        </el-form>

        <el-table :data="sections" style="margin-top: 12px">
          <el-table-column prop="section_code" label="标段编码" width="140" />
          <el-table-column prop="section_name" label="标段名称" />
          <el-table-column prop="section_length" label="里程(m)" width="120" />
          <el-table-column prop="status" label="状态" width="120" />
        </el-table>
      </el-card>
    </el-col>

    <el-col :md="10" :xs="24">
      <el-card shadow="never" header="财务汇总（预留）">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="对外付款已支付">
            {{ summary?.outboundPaidAmount ?? 0 }}
          </el-descriptions-item>
          <el-descriptions-item label="收款已到账">
            {{ summary?.inboundReceivedAmount ?? 0 }}
          </el-descriptions-item>
          <el-descriptions-item label="报销累计">
            {{ summary?.reimbursementAmount ?? 0 }}
          </el-descriptions-item>
          <el-descriptions-item label="说明">
            {{ summary?.note ?? "-" }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </el-col>
  </el-row>
</template>
