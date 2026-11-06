/**
 * 流程被取消、撤回、作废时，把还在进行的节点一并收口。否则节点永远停在 in_progress：
 * 详情页显示「进行中」，超时巡检也会一直把它当成超时节点。
 * 未走到的 pending 节点保持原样，界面按实例状态显示成「未执行」。
 */
export const closeRunningNodes = async (
  db: D1Database,
  instanceId: number,
  now: string
): Promise<void> => {
  await db
    .prepare(
      `UPDATE approval_node_instance
          SET status = 'cancelled', completed_at = ?, updated_at = ?
        WHERE instance_id = ? AND status = 'in_progress'`
    )
    .bind(now, now, instanceId)
    .run();
};
