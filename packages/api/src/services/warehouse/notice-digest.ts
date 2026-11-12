/** 每日摘要的卡片：发给全体库管一张，只列有内容的那几项。内容在投递那一刻现算。 */
import type { Env } from "../../types/env";
import { listKeeperUserids } from "./access";
import { collectDigest, isEmptyDigest, type DigestSection, type WarehouseDigest } from "./digest";
import { NOTICE_PAGES } from "./notice-cards";
import type { NoticeDraft } from "./notice-deliver";

const withExamples = (lead: string, part: DigestSection): string =>
  part.examples.length > 0 ? `${lead}：${part.examples.join("、")}` : lead;

const digestLines = (digest: WarehouseDigest): { keyname: string; value: string }[] => {
  const certs = [
    digest.certs_soon.count > 0 ? `${digest.certs_soon.count} 份快到期` : "",
    digest.certs_expired.count > 0 ? `${digest.certs_expired.count} 份已过期` : ""
  ].filter(Boolean);
  return [
    digest.low_stock.count > 0
      ? { keyname: "低库存", value: withExamples(`${digest.low_stock.count} 种`, digest.low_stock) }
      : null,
    digest.overdue_tasks.count > 0
      ? {
          keyname: "超期任务",
          value: withExamples(`${digest.overdue_tasks.count} 个`, digest.overdue_tasks)
        }
      : null,
    digest.stale_inspections.count > 0
      ? {
          keyname: "待检设备",
          value: withExamples(
            `${digest.stale_inspections.count} 台超过 3 天`,
            digest.stale_inspections
          )
        }
      : null,
    certs.length > 0 ? { keyname: "证书", value: certs.join("，") } : null
  ].filter((line): line is { keyname: string; value: string } => line !== null);
};

/** 摘要为空时返回空数组（不发）；没有库管时返回收件人为空的一张（调用方按没有收件人处理）。 */
export const digestDrafts = async (env: Env, now: Date): Promise<NoticeDraft[]> => {
  const digest = await collectDigest(env, now);
  if (isEmptyDigest(digest)) return [];
  const lines = digestLines(digest);
  return [
    {
      // 摘要没有操作人，不排除任何人
      touser: await listKeeperUserids(env),
      input: {
        title: "库房每日摘要",
        desc: `${digest.date.slice(5)} 有 ${lines.length} 项要处理`,
        lines,
        pagePath: NOTICE_PAGES.home,
        webPath: "/wh/overview"
      }
    }
  ];
};
