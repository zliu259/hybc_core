import { closeRunningNodes } from "./close-running-nodes";
import { RESUBMITTABLE_STATUSES } from "./status";

/** 还没走到终态的实例：进行中，或退回、撤回后等发起人重提。 */
const OPEN_APPROVAL_STATUSES: readonly string[] = Array.from(
  new Set(["in_progress", ...RESUBMITTABLE_STATUSES])
);
const OPEN_APPROVAL_SQL_LIST = OPEN_APPROVAL_STATUSES.map((status) => `'${status}'`).join(", ");

export interface CloseOpenApprovalsInput {
  /** 这张业务单据可能用到的审批 biz_type；biz_id 在不同业务间会撞号，必须一起限定 */
  bizTypes: readonly string[];
  bizId: number;
  actorUserId: string;
  /** 写进审批记录，详情页靠它说明流程为什么停了 */
  reason: string;
  now: string;
}

/**
 * 业务单据被删除时，把挂在它上面还没结束的审批一并终止，返回被终止的实例 id。
 *
 * 不终止的话实例会一直停在进行中：审批人的待办挂着、打开报找不到单据，
 * 点了通过还会把已删除的单据回写成生效（SP-20261013-0005）。
 * 已经走完的实例保持原样。这里不发企微通知，和付款作废的做法一致。
 */
export const closeOpenApprovalsForBiz = async (
  db: D1Database,
  input: CloseOpenApprovalsInput
): Promise<number[]> => {
  if (input.bizTypes.length === 0) return [];

  const bizTypePlaceholders = input.bizTypes.map(() => "?").join(", ");
  const openRows = await db
    .prepare(
      `SELECT id FROM approval_instance
        WHERE biz_id = ?
          AND biz_type IN (${bizTypePlaceholders})
          AND status IN (${OPEN_APPROVAL_SQL_LIST})
        ORDER BY id`
    )
    .bind(input.bizId, ...input.bizTypes)
    .all<{ id: number }>();

  const closedIds: number[] = [];
  for (const { id: instanceId } of openRows.results ?? []) {
    await db
      .prepare(
        `UPDATE approval_task
            SET status = 'cancelled', updated_at = ?
          WHERE instance_id = ? AND status IN ('pending', 'in_progress')`
      )
      .bind(input.now, instanceId)
      .run();

    await closeRunningNodes(db, instanceId, input.now);

    // 状态条件再判一次：读到之后实例可能刚好走完，走完的不能改成取消
    const closed = await db
      .prepare(
        `UPDATE approval_instance
            SET status = 'cancelled',
                completed_at = COALESCE(completed_at, ?),
                updated_at = ?
          WHERE id = ? AND status IN (${OPEN_APPROVAL_SQL_LIST})`
      )
      .bind(input.now, input.now, instanceId)
      .run();
    if (closed.meta.changes === 0) continue;

    await db
      .prepare(
        `INSERT INTO approval_initiator_action
          (instance_id, action, userid, comment, created_at)
          VALUES (?, 'cancel', ?, ?, ?)`
      )
      .bind(instanceId, input.actorUserId, input.reason, input.now)
      .run();
    closedIds.push(instanceId);
  }
  return closedIds;
};
