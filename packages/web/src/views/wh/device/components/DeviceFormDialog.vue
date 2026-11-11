<script setup lang="ts">
import { ref, watch } from "vue";

import { createDevice, updateDevice, type DeviceInput } from "@/api/wh/device";
import type { DeviceCategory, DeviceRow } from "@/api/wh/types";
import { useWhAction } from "../../shared/useWhAction";

const props = defineProps<{
  device: DeviceRow | null;
  categories: DeviceCategory[];
}>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [id: number] }>();

const MACHINE_TYPES = [
  "泥水平衡",
  "土压平衡",
  "岩石破碎",
  "卵石破碎",
  "泥水/土压两用"
];
const { busy, run } = useWhAction();
const form = ref<DeviceInput>({});

watch(visible, open => {
  if (!open) return;
  const d = props.device;
  form.value = d
    ? {
        name: d.name,
        alias: d.alias,
        category_id: d.category_id,
        machine_type: d.machine_type,
        diameter_mm: d.diameter_mm,
        manufacturer: d.manufacturer,
        model: d.model,
        serial_no: d.serial_no,
        spec: d.spec,
        ownership: d.ownership,
        purchased_date: d.purchased_date,
        storage_note: d.storage_note,
        remark: d.remark
      }
    : { ownership: "owned" };
});

const save = async () => {
  const data = { ...form.value };
  const result = props.device
    ? await run(
        () => updateDevice(props.device!.id, data).then(() => props.device!.id),
        { success: "已保存" }
      )
    : await run(() => createDevice(data).then(res => res.data.id), {
        success: "已建档"
      });
  if (result !== undefined) {
    visible.value = false;
    emit("saved", result);
  }
};
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="props.device ? '修改设备' : '新增设备'"
    width="640px"
    destroy-on-close
  >
    <el-form :model="form" label-width="90px">
      <el-form-item v-if="!props.device" label="编号">
        <el-input
          v-model="form.device_code"
          maxlength="30"
          placeholder="不填自动生成 SB-0001 这样的编号"
        />
      </el-form-item>
      <el-form-item label="名称" required>
        <el-input
          v-model="form.name"
          maxlength="80"
          placeholder="如 唐兴-NSPD1200泥水平衡顶管机"
        />
      </el-form-item>
      <el-form-item label="类别" required>
        <el-select
          v-model="form.category_id"
          placeholder="选择类别"
          style="width: 100%"
        >
          <el-option
            v-for="c in props.categories.filter(
              item => item.status === 'active'
            )"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="现场叫法">
        <el-input
          v-model="form.alias"
          maxlength="30"
          placeholder="如 DN1550-1"
        />
      </el-form-item>
      <el-form-item label="机型">
        <el-select
          v-model="form.machine_type"
          clearable
          filterable
          allow-create
          placeholder="顶管机才需要"
          style="width: 100%"
        >
          <el-option
            v-for="t in MACHINE_TYPES"
            :key="t"
            :label="t"
            :value="t"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="口径(毫米)">
        <el-input-number
          v-model="form.diameter_mm"
          :min="100"
          :max="6000"
          :step="50"
          controls-position="right"
        />
      </el-form-item>
      <el-form-item label="厂家">
        <el-input v-model="form.manufacturer" maxlength="50" />
      </el-form-item>
      <el-form-item label="型号">
        <el-input v-model="form.model" maxlength="50" />
      </el-form-item>
      <el-form-item label="出厂编号">
        <el-input v-model="form.serial_no" maxlength="50" />
      </el-form-item>
      <el-form-item label="规格">
        <el-input v-model="form.spec" maxlength="80" />
      </el-form-item>
      <el-form-item label="所有权">
        <el-radio-group v-model="form.ownership">
          <el-radio value="owned">自有</el-radio>
          <el-radio value="leased_in">租入</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="购入日期">
        <el-date-picker
          v-model="form.purchased_date"
          type="date"
          value-format="YYYY-MM-DD"
          clearable
        />
      </el-form-item>
      <el-form-item label="库位">
        <el-input v-model="form.storage_note" maxlength="50" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          v-model="form.remark"
          type="textarea"
          maxlength="300"
          :rows="2"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="busy" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>
