import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWeComContacts } from "@/api/wecom";

vi.mock("@/api/wecom", () => ({ getWeComContacts: vi.fn() }));

const CACHE_KEY = "wecom:user-options:v1";

const contactsResponse = (users: { userid: string; name: string }[]) =>
  ({ data: { users } }) as unknown as Awaited<
    ReturnType<typeof getWeComContacts>
  >;

const mockContacts = vi.mocked(getWeComContacts);

describe("useWecomUserOptions", () => {
  // 模块里有最近一次通讯录的状态，每条用例重新加载，互不影响
  let useWecomUserOptions: typeof import("./useWecomUserOptions").useWecomUserOptions;

  beforeEach(async () => {
    window.localStorage.clear();
    mockContacts.mockReset();
    vi.resetModules();
    ({ useWecomUserOptions } = await import("./useWecomUserOptions"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("userNameOf", () => {
    it("账号换成通讯录里的名字", async () => {
      mockContacts.mockResolvedValue(
        contactsResponse([{ userid: "LiuPeng", name: "刘鹏" }])
      );
      const { loadWecomUsers, userNameOf } = useWecomUserOptions();

      await loadWecomUsers();

      expect(userNameOf("LiuPeng")).toBe("刘鹏");
    });

    it("通讯录里没有这个人（如已离职）时显示账号，不留空", async () => {
      mockContacts.mockResolvedValue(
        contactsResponse([{ userid: "LiuPeng", name: "刘鹏" }])
      );
      const { loadWecomUsers, userNameOf } = useWecomUserOptions();

      await loadWecomUsers();

      expect(userNameOf("Gone")).toBe("Gone");
    });

    it("通讯录里名字为空时也显示账号", async () => {
      mockContacts.mockResolvedValue(
        contactsResponse([{ userid: "NoName", name: "" }])
      );
      const { loadWecomUsers, userNameOf } = useWecomUserOptions();

      await loadWecomUsers();

      expect(userNameOf("NoName")).toBe("NoName");
    });

    it("没填账号时显示调用方给的占位文字", () => {
      const { userNameOf } = useWecomUserOptions();

      expect(userNameOf(null)).toBe("-");
      expect(userNameOf("")).toBe("-");
      expect(userNameOf(undefined, "未指定")).toBe("未指定");
    });

    it("通讯录还没回来时先用上次缓存的名字，不闪账号", () => {
      window.localStorage.setItem(
        CACHE_KEY,
        JSON.stringify([{ userid: "LiuPeng", name: "刘鹏" }])
      );
      const { userNameOf } = useWecomUserOptions();

      expect(userNameOf("LiuPeng")).toBe("刘鹏");
    });
  });

  describe("loadUserNames", () => {
    it("通讯录取不到时不抛错，只记日志，名字退回缓存或账号", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      mockContacts.mockRejectedValue(new Error("contacts down"));
      const { loadUserNames, userNameOf } = useWecomUserOptions();

      await expect(loadUserNames()).resolves.toBeUndefined();

      expect(userNameOf("LiuPeng")).toBe("LiuPeng");
      expect(logged).toHaveBeenCalledTimes(1);
      logged.mockRestore();
    });
  });

  describe("loadUserNames 的请求次数", () => {
    const contacts = contactsResponse([{ userid: "LiuPeng", name: "刘鹏" }]);

    it("几分钟内再打开别的表格或抽屉，直接用刚取到的通讯录", async () => {
      mockContacts.mockResolvedValue(contacts);
      await useWecomUserOptions().loadUserNames();

      const drawer = useWecomUserOptions();
      await drawer.loadUserNames();

      expect(mockContacts).toHaveBeenCalledTimes(1);
      expect(drawer.userNameOf("LiuPeng")).toBe("刘鹏");
    });

    it("超过五分钟后重新请求，通讯录有变化能看到", async () => {
      vi.useFakeTimers();
      mockContacts.mockResolvedValue(contacts);
      await useWecomUserOptions().loadUserNames();

      vi.advanceTimersByTime(5 * 60 * 1000);
      await useWecomUserOptions().loadUserNames();

      expect(mockContacts).toHaveBeenCalledTimes(2);
    });

    it("选人下拉框用的 loadWecomUsers 每次都取最新的", async () => {
      mockContacts.mockResolvedValue(contacts);
      await useWecomUserOptions().loadWecomUsers();
      await useWecomUserOptions().loadWecomUsers();

      expect(mockContacts).toHaveBeenCalledTimes(2);
    });

    it("上一次失败不算取到，下一次还会请求", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      mockContacts.mockRejectedValueOnce(new Error("contacts down"));
      mockContacts.mockResolvedValueOnce(contacts);
      await useWecomUserOptions().loadUserNames();

      const next = useWecomUserOptions();
      await next.loadUserNames();

      expect(next.userNameOf("LiuPeng")).toBe("刘鹏");
      logged.mockRestore();
    });
  });

  it("同一页面多处同时加载时只请求一次通讯录，各处都拿到结果", async () => {
    mockContacts.mockResolvedValue(
      contactsResponse([{ userid: "LiuPeng", name: "刘鹏" }])
    );
    const header = useWecomUserOptions();
    const panel = useWecomUserOptions();

    await Promise.all([header.loadWecomUsers(), panel.loadWecomUsers()]);

    expect(mockContacts).toHaveBeenCalledTimes(1);
    expect(header.userNameOf("LiuPeng")).toBe("刘鹏");
    expect(panel.userNameOf("LiuPeng")).toBe("刘鹏");
  });

  it("上一次失败后可以重新请求", async () => {
    mockContacts.mockRejectedValueOnce(new Error("contacts down"));
    mockContacts.mockResolvedValueOnce(
      contactsResponse([{ userid: "LiuPeng", name: "刘鹏" }])
    );
    const { loadWecomUsers, userNameOf } = useWecomUserOptions();

    await expect(loadWecomUsers()).rejects.toThrow("contacts down");
    await loadWecomUsers();

    expect(userNameOf("LiuPeng")).toBe("刘鹏");
  });
});
