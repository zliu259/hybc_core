import { ref } from "vue";
import { getWeComContacts, type WeComUser } from "@/api/wecom";

const WE_COM_USERS_CACHE_KEY = "wecom:user-options:v1";

const safeLoadCachedUsers = (): WeComUser[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WE_COM_USERS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WeComUser[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const safeStoreCachedUsers = (users: WeComUser[]) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WE_COM_USERS_CACHE_KEY, JSON.stringify(users));
  } catch {}
};

export function useWecomUserOptions() {
  const wecomUsers = ref<WeComUser[]>(safeLoadCachedUsers());

  const loadWecomUsers = async () => {
    const result = await getWeComContacts();
    const sorted = [...result.data.users].sort((a, b) => {
      const aName = `${a.name || ""}`;
      const bName = `${b.name || ""}`;
      return aName.localeCompare(bName, "zh-Hans-CN");
    });
    wecomUsers.value = sorted;
    safeStoreCachedUsers(sorted);
  };

  return {
    wecomUsers,
    loadWecomUsers
  };
}
