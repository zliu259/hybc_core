/**
 * 我方实体名单实时调取（owner 08-04/08-05：AI 审查不得机械假定「恒越百川」，
 * 集团多主体签约，必须把本单我方主体与集团实体名单一并交给模型核对）。
 *
 * 供 contract_review 派发与审批 AI 关卡上下文使用；任何 DB 异常都不抛出，
 * 返回兜底文案——实体名单缺失只应降低核对精度，不允许阻断任务派发。
 */

export interface OurEntityContext {
  /** 本单我方签约主体名称；查不到时为空串 */
  our_entity: string;
  /** 集团全部有效实体名单（顿号分隔），供模型识别下属实体 */
  our_entities: string;
}

const FALLBACK_ENTITIES =
  "恒越百川建设集团有限公司及下属实体（实体表为空，按名称合理性判断）";

export const loadOurEntityContext = async (
  db: D1Database,
  entityId: number | null | undefined
): Promise<OurEntityContext> => {
  try {
    const rows = await db
      .prepare("SELECT id, entity_name FROM entity WHERE status = 'active' ORDER BY id ASC")
      .all<{ id: number; entity_name: string }>();
    const active = rows.results ?? [];
    const names = active
      .map((row) => row.entity_name?.trim())
      .filter((name): name is string => !!name);

    let ourEntity =
      active.find((row) => row.id === entityId)?.entity_name?.trim() ?? "";
    if (!ourEntity && entityId) {
      // 本单主体可能已停用，但历史合同仍以它签约——单独兜底查一次
      const row = await db
        .prepare("SELECT entity_name FROM entity WHERE id = ?")
        .bind(entityId)
        .first<{ entity_name: string }>();
      ourEntity = row?.entity_name?.trim() ?? "";
    }

    return {
      our_entity: ourEntity,
      our_entities: names.length > 0 ? names.join("、") : FALLBACK_ENTITIES
    };
  } catch (err) {
    console.error("loadOurEntityContext failed, using fallback:", err);
    return { our_entity: "", our_entities: FALLBACK_ENTITIES };
  }
};
