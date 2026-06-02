<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { createOperatorLog, smartFillOperatorLog } from "@/api/log";
import { useProjectOptions } from "@/composables/useProjectOptions";

defineOptions({ name: "OperatorLogForm" });

const router = useRouter();
const filling = ref(false);
const submitting = ref(false);
const { projects, loadProjects } = useProjectOptions();

const form = ref({
  project_id: undefined as number | undefined,
  section_id: undefined as number | undefined,
  log_date: "",
  shift: "day",
  weather: "",
  completed_pipe_count: 0,
  cumulative_pipe_count: 0,
  footage_m: undefined as number | undefined,
  cumulative_footage_m: undefined as number | undefined,
  cutter_current_text: "",
  cutter_frequency_hz: undefined as number | undefined,
  chamber_pressure_mpa: undefined as number | undefined,
  main_thrust_text: "",
  horizontal_deviation_direction: "",
  horizontal_deviation_mm: undefined as number | undefined,
  vertical_deviation_direction: "",
  vertical_deviation_mm: undefined as number | undefined,
  issue_summary: "",
  remark: ""
});

const horizontalDeviationOptions = [
  { label: "左偏", value: "left" },
  { label: "右偏", value: "right" }
];

const verticalDeviationOptions = [
  { label: "高", value: "high" },
  { label: "低", value: "low" }
];

const smartFill = async () => {
  if (!form.value.project_id || !form.value.log_date || !form.value.shift) {
    message("请先填写项目、日期、班次", { type: "warning" });
    return;
  }
  filling.value = true;
  try {
    const result = await smartFillOperatorLog({
      project_id: form.value.project_id,
      section_id: form.value.section_id ?? null,
      log_date: form.value.log_date,
      shift: form.value.shift,
      completed_pipe_count: form.value.completed_pipe_count,
      footage_m: form.value.footage_m
    });
    form.value.weather = result.data.prefill.weather || form.value.weather;
    form.value.issue_summary =
      result.data.prefill.issue_summary || form.value.issue_summary;
    form.value.cumulative_pipe_count =
      result.data.prefill.cumulative_pipe_count;
    form.value.cumulative_footage_m =
      result.data.prefill.cumulative_footage_m;
    message(`AI预填完成，任务ID: ${result.data.task_id}`, { type: "success" });
  } finally {
    filling.value = false;
  }
};

const submit = async () => {
  if (!form.value.project_id || !form.value.log_date) {
    message("请填写项目和日期", { type: "warning" });
    return;
  }
  submitting.value = true;
  try {
    await createOperatorLog({
      project_id: form.value.project_id,
      section_id: form.value.section_id,
      log_date: form.value.log_date,
      shift: form.value.shift,
      weather: form.value.weather || undefined,
      completed_pipe_count: form.value.completed_pipe_count,
      cumulative_pipe_count: form.value.cumulative_pipe_count,
      footage_m: form.value.footage_m,
      cumulative_footage_m: form.value.cumulative_footage_m,
      cutter_current_text: form.value.cutter_current_text || undefined,
      cutter_frequency_hz: form.value.cutter_frequency_hz,
      chamber_pressure_mpa: form.value.chamber_pressure_mpa,
      main_thrust_text: form.value.main_thrust_text || undefined,
      horizontal_deviation_direction:
        form.value.horizontal_deviation_direction || undefined,
      horizontal_deviation_mm: form.value.horizontal_deviation_mm,
      vertical_deviation_direction:
        form.value.vertical_deviation_direction || undefined,
      vertical_deviation_mm: form.value.vertical_deviation_mm,
      issue_summary: form.value.issue_summary || undefined,
      remark: form.value.remark || undefined,
      status: "submitted"
    });
    message("日志提交成功", { type: "success" });
    router.push("/construction/operator-log/list");
  } catch {
    message("提交失败", { type: "error" });
  } finally {
    submitting.value = false;
  }
};

onMounted(loadProjects);
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
        <span>操作员日志填报</span>
        <el-button :loading="filling" @click="smartFill">AI预填</el-button>
      </div>
    </template>

    <el-form label-width="120px">
      <el-form-item label="项目ID" required>
        <el-select
          v-model="form.project_id"
          filterable
          placeholder="按时间排序选择项目"
          style="width: 320px"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="`${item.project_name} (${item.project_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="标段ID">
        <el-input-number v-model="form.section_id" :min="1" />
      </el-form-item>
      <el-form-item label="日期" required>
        <el-date-picker
          v-model="form.log_date"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 220px"
        />
      </el-form-item>
      <el-form-item label="班次">
        <el-select v-model="form.shift" style="width: 160px">
          <el-option label="白班" value="day" />
          <el-option label="夜班" value="night" />
        </el-select>
      </el-form-item>
      <el-form-item label="天气">
        <el-input v-model="form.weather" style="width: 220px" />
      </el-form-item>
      <el-form-item label="当班下管数量">
        <el-input-number v-model="form.completed_pipe_count" :min="0" />
      </el-form-item>
      <el-form-item label="累计下管数量">
        <el-input-number v-model="form.cumulative_pipe_count" :min="0" />
      </el-form-item>
      <el-form-item label="当日进尺(m)">
        <el-input-number v-model="form.footage_m" :min="0" :precision="2" />
      </el-form-item>
      <el-form-item label="累计顶进(m)">
        <el-input-number
          v-model="form.cumulative_footage_m"
          :min="0"
          :precision="2"
        />
      </el-form-item>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="刀盘电流">
            <el-input v-model="form.cutter_current_text" placeholder="2*35A" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="刀盘频率(Hz)">
            <el-input-number
              v-model="form.cutter_frequency_hz"
              :min="0"
              :precision="2"
              style="width: 220px"
            />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="泥仓压力(MPa)">
            <el-input-number
              v-model="form.chamber_pressure_mpa"
              :min="0"
              :precision="3"
              style="width: 220px"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="顶力">
            <el-input v-model="form.main_thrust_text" placeholder="4×12MPa" />
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="水平偏差">
            <el-input-number
              v-model="form.horizontal_deviation_mm"
              :min="0"
              :precision="1"
              style="width: 120px"
            />
            <el-select
              v-model="form.horizontal_deviation_direction"
              clearable
              style="width: 120px; margin-left: 8px"
            >
              <el-option
                v-for="opt in horizontalDeviationOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="高程偏差">
            <el-input-number
              v-model="form.vertical_deviation_mm"
              :min="0"
              :precision="1"
              style="width: 120px"
            />
            <el-select
              v-model="form.vertical_deviation_direction"
              clearable
              style="width: 120px; margin-left: 8px"
            >
              <el-option
                v-for="opt in verticalDeviationOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="问题摘要">
        <el-input v-model="form.issue_summary" type="textarea" :rows="3" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="submitting" @click="submit"
          >提交</el-button
        >
        <el-button @click="router.push('/construction/operator-log/list')"
          >返回列表</el-button
        >
      </el-form-item>
    </el-form>
  </el-card>
</template>
