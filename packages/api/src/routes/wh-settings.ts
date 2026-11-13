import { Hono } from "hono";

import { requireRoles } from "../middleware/rbac";
import {
  ALL_ROLES,
  getWarehouseCapabilities,
  requireHuman,
  requireKeeper,
  requireSettingsManager
} from "../services/warehouse/access";
import { parseCodePrefix } from "../services/warehouse/device-code";
import { WarehouseError } from "../services/warehouse/errors";
import { getWarehouseHome } from "../services/warehouse/home";
import { getWarehouseOverview } from "../services/warehouse/overview";
import { getWarehouseSettings, saveWarehouseSettings } from "../services/warehouse/settings";
import { optionalNumber, requireEnum, requireText } from "../services/warehouse/validation";
import type { DeviceCategory, WarehouseMember, WarehouseMemberRole } from "../types/wh";
import { guarded, pathId, readJsonBody, type WhEnv } from "./wh-http";

export const whSettingsRoutes = new Hono<WhEnv>();

const MEMBER_ROLES: readonly WarehouseMemberRole[] = ["keeper", "doc_admin"];
const nowIso = () => new Date().toISOString();
const isUniqueViolation = (error: unknown) =>
  error instanceof Error && error.message.includes("UNIQUE constraint failed");

/** 设备类别撞了唯一约束：是名字重了，还是编号开头被别的类别用了。别的错返回 null。 */
const categoryConflict = (error: unknown): WarehouseError | null => {
  if (!isUniqueViolation(error)) return null;
  const onPrefix = error instanceof Error && error.message.includes("code_prefix");
  return new WarehouseError(409, onPrefix ? "这个编号开头已经被别的类别用了" : "类别已存在");
};

whSettingsRoutes.get(
  "/me",
  requireRoles(ALL_ROLES),
  guarded(async (c) =>
    c.json({ success: true, data: await getWarehouseCapabilities(c.env, c.get("auth")) })
  )
);

whSettingsRoutes.get(
  "/settings",
  requireRoles(ALL_ROLES),
  guarded(async (c) => c.json({ success: true, data: await getWarehouseSettings(c.env) }))
);

whSettingsRoutes.put(
  "/settings",
  requireHuman,
  requireSettingsManager,
  guarded(async (c) => {
    const body = await readJsonBody(c);
    const data = await saveWarehouseSettings(c.env, body, c.get("auth").sub);
    return c.json({ success: true, data });
  })
);

whSettingsRoutes.get(
  "/member",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const rows = await c.env.DB.prepare(
      "SELECT * FROM warehouse_member ORDER BY role ASC, created_at ASC"
    ).all<WarehouseMember>();
    return c.json({ success: true, data: rows.results ?? [] });
  })
);

whSettingsRoutes.post(
  "/member",
  requireHuman,
  requireSettingsManager,
  guarded(async (c) => {
    const body = await readJsonBody(c);
    const userid = requireText(body.userid, "成员", 64);
    const role = requireEnum(body.role, "成员角色", MEMBER_ROLES);
    const result = await c.env.DB.prepare(
      `INSERT INTO warehouse_member (userid, role, added_by_userid, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(userid, role) DO NOTHING`
    )
      .bind(userid, role, c.get("auth").sub, nowIso())
      .run();
    const created = Number(result.meta.changes ?? 0) > 0;
    return c.json({ success: true, data: { userid, role } }, created ? 201 : 200);
  })
);

whSettingsRoutes.delete(
  "/member/:userid/:role",
  requireHuman,
  requireSettingsManager,
  guarded(async (c) => {
    const role = requireEnum(c.req.param("role"), "成员角色", MEMBER_ROLES);
    await c.env.DB.prepare("DELETE FROM warehouse_member WHERE userid = ? AND role = ?")
      .bind(c.req.param("userid"), role)
      .run();
    return c.json({ success: true });
  })
);

whSettingsRoutes.get(
  "/device-category",
  requireRoles(ALL_ROLES),
  guarded(async (c) => {
    const rows = await c.env.DB.prepare(
      "SELECT * FROM device_category ORDER BY sort_order ASC, id ASC"
    ).all<DeviceCategory>();
    return c.json({ success: true, data: rows.results ?? [] });
  })
);

whSettingsRoutes.post(
  "/device-category",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const body = await readJsonBody(c);
    const name = requireText(body.name, "类别名称", 30);
    const sortOrder =
      optionalNumber(body.sort_order, "排序", { min: 0, max: 9999, integer: true }) ?? 0;
    const codePrefix = parseCodePrefix(body.code_prefix);
    const now = nowIso();
    try {
      const result = await c.env.DB.prepare(
        `INSERT INTO device_category (name, code_prefix, sort_order, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)`
      )
        .bind(name, codePrefix, sortOrder, now, now)
        .run();
      return c.json({ success: true, data: { id: Number(result.meta.last_row_id) } }, 201);
    } catch (error) {
      throw categoryConflict(error) ?? error;
    }
  })
);

whSettingsRoutes.put(
  "/device-category/:id",
  requireHuman,
  requireKeeper,
  guarded(async (c) => {
    const id = pathId(c, "id", "类别");
    const body = await readJsonBody(c);
    const name = "name" in body ? requireText(body.name, "类别名称", 30) : null;
    const sortOrder =
      "sort_order" in body
        ? optionalNumber(body.sort_order, "排序", { min: 0, max: 9999, integer: true })
        : null;
    const status =
      "status" in body ? requireEnum(body.status, "状态", ["active", "disabled"] as const) : null;
    // 编号开头有三种情况：没传（不动）、传了空的（清掉）、传了字母（改成它），所以单独拼
    const setsPrefix = "code_prefix" in body;
    const codePrefix = setsPrefix ? parseCodePrefix(body.code_prefix) : null;
    try {
      const result = await c.env.DB.prepare(
        `UPDATE device_category SET
           name = COALESCE(?, name),
           sort_order = COALESCE(?, sort_order),
           status = COALESCE(?, status),
           ${setsPrefix ? "code_prefix = ?," : ""}
           updated_at = ?
         WHERE id = ?`
      )
        .bind(name, sortOrder, status, ...(setsPrefix ? [codePrefix] : []), nowIso(), id)
        .run();
      if (Number(result.meta.changes ?? 0) === 0) throw new WarehouseError(404, "类别不存在");
      return c.json({ success: true });
    } catch (error) {
      throw categoryConflict(error) ?? error;
    }
  })
);

whSettingsRoutes.get(
  "/home",
  requireRoles(ALL_ROLES),
  guarded(async (c) =>
    c.json({ success: true, data: await getWarehouseHome(c.env, c.get("auth")) })
  )
);

whSettingsRoutes.get(
  "/overview",
  requireRoles(ALL_ROLES),
  guarded(async (c) => c.json({ success: true, data: await getWarehouseOverview(c.env) }))
);
