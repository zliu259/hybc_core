import { ref } from "vue";
import { getWeComContacts, type WeComUser } from "@/api/wecom";

export function useWecomUserOptions() {
  const wecomUsers = ref<WeComUser[]>([]);

  const loadWecomUsers = async () => {
    const result = await getWeComContacts();
    wecomUsers.value = [...result.data.users].sort((a, b) => {
      const aName = `${a.name || ""}`;
      const bName = `${b.name || ""}`;
      return aName.localeCompare(bName, "zh-Hans-CN");
    });
  };

  return {
    wecomUsers,
    loadWecomUsers
  };
}
