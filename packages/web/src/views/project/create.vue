<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { createProject } from "@/api/project";
import PhaseUpload from "@/components/PhaseUpload/index.vue";

defineOptions({
  name: "ProjectCreate"
});

const router = useRouter();
const saving = ref(false);
const attachments = ref<{ name: string; key: string; url: string }[]>([]);

const form = reactive({
  project_code: "",
  project_name: "",
  manager_userid: "",
  start_date: "",
  end_date: ""
});

const submit = async () => {
  if (!form.project_code || !form.project_name) {
    message("请填写项目编号和项目名称", { type: "warning" });
    return;
  }

  saving.value = true;
  try {
    await createProject({
      project_code: form.project_code,
      project_name: form.project_name,
      manager_userid: form.manager_userid || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null
    });

    message("项目立项成功", { type: "success" });
    router.push("/project/list");
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <el-card shadow="never" header="项目立项表单">
    <el-form label-width="120px">
      <el-form-item label="项目编号" required>
        <el-input v-model="form.project_code" />
      </el-form-item>
      <el-form-item label="项目名称" required>
        <el-input v-model="form.project_name" />
      </el-form-item>
      <el-form-item label="项目经理">
        <el-input v-model="form.manager_userid" placeholder="企微 userid" />
      </el-form-item>
      <el-form-item label="开始日期">
        <el-date-picker
          v-model="form.start_date"
          type="date"
          value-format="YYYY-MM-DD"
        />
      </el-form-item>
      <el-form-item label="结束日期">
        <el-date-picker
          v-model="form.end_date"
          type="date"
          value-format="YYYY-MM-DD"
        />
      </el-form-item>
      <el-form-item label="附件上传">
        <PhaseUpload v-model="attachments" category="project" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="submit"
          >提交立项</el-button
        >
        <el-button @click="router.push('/project/list')">返回列表</el-button>
      </el-form-item>
    </el-form>
  </el-card>
</template>
