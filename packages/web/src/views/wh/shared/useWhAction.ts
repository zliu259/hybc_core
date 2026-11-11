import { ref, type Ref } from "vue";

import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";

/** 库房页面统一的"调接口 + 提示"：失败弹后端给的中文错误，busy 一定复位。 */
export const useWhAction = (): {
  busy: Ref<boolean>;
  run: <T>(
    action: () => Promise<T>,
    options?: { success?: string }
  ) => Promise<T | undefined>;
} => {
  const busy = ref(false);
  const run = async <T>(
    action: () => Promise<T>,
    options: { success?: string } = {}
  ): Promise<T | undefined> => {
    busy.value = true;
    try {
      const result = await action();
      if (options.success) message(options.success, { type: "success" });
      return result;
    } catch (error) {
      message(resolveApiErrorMessage(error, "操作失败，请稍后重试"), {
        type: "error"
      });
      return undefined;
    } finally {
      busy.value = false;
    }
  };
  return { busy, run };
};
