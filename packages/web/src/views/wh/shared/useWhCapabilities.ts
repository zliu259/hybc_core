import { ref, type Ref } from "vue";

import { getWhMe } from "@/api/wh/settings";
import type { WarehouseCapabilities } from "@/api/wh/types";

/** 当前用户在库房里能做什么，决定按钮显示。取不到时按"什么都不能做"处理。 */
export const useWhCapabilities = (): {
  caps: Ref<WarehouseCapabilities | null>;
  load: () => Promise<void>;
} => {
  const caps = ref<WarehouseCapabilities | null>(null);
  const load = async () => {
    try {
      caps.value = (await getWhMe()).data;
    } catch (error) {
      console.error("[warehouse] 读取库房权限失败", error);
      caps.value = null;
    }
  };
  return { caps, load };
};
