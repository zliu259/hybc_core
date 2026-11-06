import { computed, ref } from "vue";
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

// 通讯录接口比较重，同一页面的头部和面板同时要时只发一次
let pendingUsers: Promise<WeComUser[]> | null = null;

// 只为显示名字的地方很多（表格、抽屉），几分钟内用同一份，不用每次打开都请求
const NAMES_FRESH_MS = 5 * 60 * 1000;
let freshUsers: { users: WeComUser[]; at: number } | null = null;

const fetchSortedUsers = (): Promise<WeComUser[]> => {
  pendingUsers ??= getWeComContacts()
    .then(result => {
      const sorted = [...result.data.users].sort((a, b) => {
        const aName = `${a.name || ""}`;
        const bName = `${b.name || ""}`;
        return aName.localeCompare(bName, "zh-Hans-CN");
      });
      safeStoreCachedUsers(sorted);
      freshUsers = { users: sorted, at: Date.now() };
      return sorted;
    })
    .finally(() => {
      pendingUsers = null;
    });
  return pendingUsers;
};

export function useWecomUserOptions() {
  const wecomUsers = ref<WeComUser[]>(safeLoadCachedUsers());

  const userNames = computed(
    () => new Map(wecomUsers.value.map(item => [item.userid, item.name]))
  );

  const loadWecomUsers = async () => {
    wecomUsers.value = await fetchSortedUsers();
  };

  /** 只为显示名字时用：通讯录取不到不影响页面，名字退回缓存或账号。 */
  const loadUserNames = async (): Promise<void> => {
    if (freshUsers && Date.now() - freshUsers.at < NAMES_FRESH_MS) {
      wecomUsers.value = freshUsers.users;
      return;
    }
    try {
      await loadWecomUsers();
    } catch (error) {
      console.error("[wecom-users] 通讯录加载失败，人员显示账号", error);
    }
  };

  /** 账号换成名字。通讯录里没有的人（如已离职）显示账号，不留空。 */
  const userNameOf = (
    userid: string | null | undefined,
    emptyText = "-"
  ): string => {
    if (!userid) return emptyText;
    return userNames.value.get(userid) || userid;
  };

  return {
    wecomUsers,
    loadWecomUsers,
    loadUserNames,
    userNameOf
  };
}
