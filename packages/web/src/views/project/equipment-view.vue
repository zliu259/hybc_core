<script setup lang="ts">
import { onMounted, ref } from "vue";

import { listProjects, type Project } from "@/api/project";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import EquipmentPanel from "./workspace/equipment-panel.vue";

defineOptions({ name: "ProjectEquipmentView" });

const projects = ref<Project[]>([]);
const projectId = ref<number | undefined>(undefined);

onMounted(async () => {
  try {
    const result = await listProjects({ page: 1, pageSize: 100 });
    projects.value = result.data;
    projectId.value = projects.value[0]?.id;
  } catch (error) {
    message(resolveApiErrorMessage(error, "项目列表加载失败"), {
      type: "error"
    });
  }
});
</script>

<template>
  <div>
    <el-card shadow="never" style="margin-bottom: 16px">
      <el-form inline>
        <el-form-item label="项目">
          <el-select
            v-model="projectId"
            filterable
            style="width: 300px"
            placeholder="选择项目"
          >
            <el-option
              v-for="item in projects"
              :key="item.id"
              :label="item.project_name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>
    <EquipmentPanel v-if="projectId" :project-id="projectId" />
  </div>
</template>
