/**
 * 一个项目多份清单时，项目的已发数按清单确认先后依次分给各行：先确认的先分满。
 * 这样每份清单的"已发、待发"加起来等于项目总数，不会重复计。
 */

/** 物资 `m:<material_id>`，设备类别 `c:<device_category_id>`。 */
export type AllocKey = string;

export interface AllocLine {
  line_id: number;
  key: AllocKey;
  planned: number;
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** `lines` 由调用方按清单确认时间、清单 id、行顺序排好。返回 行 id → 分到的已发数。 */
export const allocateShipped = (
  lines: readonly AllocLine[],
  shipped: ReadonlyMap<AllocKey, number>
): Map<number, number> => {
  const remaining = new Map<AllocKey, number>();
  for (const [key, value] of shipped) remaining.set(key, Math.max(0, value));
  return new Map(
    lines.map((line) => {
      const left = remaining.get(line.key) ?? 0;
      const take = round3(Math.min(left, Math.max(0, line.planned)));
      remaining.set(line.key, round3(left - take));
      return [line.line_id, take];
    })
  );
};
