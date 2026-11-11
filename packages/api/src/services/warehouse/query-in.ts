/**
 * D1 一条语句最多绑定 100 个参数，超过报 "too many SQL variables"。
 * 导入和单据最多 200 行，所以 `IN (...)` 列表要分段查再合并。
 */
export const D1_MAX_BOUND_PARAMS = 100;

/** 留出余量给 IN 前面的固定参数。 */
const CHUNK_SIZE = 90;

export const chunk = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size)
  );

/**
 * 分段执行 `IN` 查询。`buildSql` 拿到这一段的占位符（`?, ?, ?`），
 * `leading` 是 IN 前面的固定参数，每段都会带上。结果按段的顺序拼接，
 * 需要整体排序的调用方自己排。
 */
export const queryIn = async <Row>(
  db: D1Database,
  buildSql: (placeholders: string) => string,
  values: readonly (string | number)[],
  leading: readonly (string | number)[] = []
): Promise<Row[]> => {
  if (values.length === 0) return [];
  const parts = chunk(values, CHUNK_SIZE - leading.length);
  const results = await Promise.all(
    parts.map((part) =>
      db
        .prepare(buildSql(part.map(() => "?").join(", ")))
        .bind(...leading, ...part)
        .all<Row>()
    )
  );
  return results.flatMap((result) => result.results ?? []);
};
