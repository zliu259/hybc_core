/** 发货、返库、转场（以及它们的冲销）的通知：发给项目负责人，点开是项目在场页。 */
import type { Env } from "../../types/env";
import type { WhDocType } from "../../types/wh";
import { getWhDoc } from "./doc-query";
import { NOTICE_PAGES, recipientsExcept } from "./notice-cards";
import type { NameOf, NoticeDraft } from "./notice-deliver";

const MOVE_TITLES: Partial<Record<WhDocType, string>> = {
  out: "库房已发货",
  back: "项目物资已返库",
  transfer: "设备物资转场"
};

interface ProjectRef {
  id: number;
  name: string;
  manager: string | null;
}

const loadProject = async (env: Env, id: number | null): Promise<ProjectRef | null> => {
  if (id === null) return null;
  const row = await env.DB.prepare(
    "SELECT id, project_name, manager_userid FROM project WHERE id = ?"
  )
    .bind(id)
    .first<{ id: number; project_name: string; manager_userid: string | null }>();
  return row ? { id: Number(row.id), name: row.project_name, manager: row.manager_userid } : null;
};

/** 其他类型的单（入库、期初、调账、报废）返回空数组，不通知。单不存在返回 null。 */
export const docDrafts = async (
  env: Env,
  docId: number,
  actorUserid: string,
  nameOf: NameOf
): Promise<NoticeDraft[] | null> => {
  const doc = await getWhDoc(env, docId);
  if (!doc) return null;
  const moveTitle = MOVE_TITLES[doc.doc_type];
  if (!moveTitle) return [];

  const [from, to, original] = await Promise.all([
    loadProject(env, doc.project_id),
    loadProject(env, doc.to_project_id),
    doc.reverses_doc_id === null
      ? null
      : env.DB.prepare("SELECT doc_no FROM wh_doc WHERE id = ?")
          .bind(doc.reverses_doc_id)
          .first<{ doc_no: string }>()
  ]);
  if (!from) return [];

  const count = (ids: (number | null)[]): number =>
    new Set(ids.filter((id): id is number => id !== null)).size;
  const devices = count(doc.lines.map((line) => line.device_id));
  const materials = count(doc.lines.map((line) => line.material_id));
  const lost = count(doc.lines.map((line) => (line.outcome === "lost" ? line.material_id : null)));
  const reversal = doc.reverses_doc_id !== null;
  const lines = reversal
    ? [
        { keyname: "原单", value: original?.doc_no ?? "" },
        { keyname: "冲销单", value: doc.doc_no }
      ]
    : [
        { keyname: "单号", value: doc.doc_no },
        { keyname: "设备", value: devices > 0 ? `${devices} 台` : "" },
        { keyname: "物资", value: materials > 0 ? `${materials} 项` : "" },
        { keyname: "报损", value: doc.doc_type === "back" && lost > 0 ? `${lost} 项` : "" },
        { keyname: "经手人", value: nameOf(doc.operator_userid) }
      ];
  const title = reversal ? "库房单已冲销" : moveTitle;
  const desc = to ? `${from.name} → ${to.name}` : from.name;

  // 转场两边的负责人各看各的项目页；两边是同一个人时只发一张。
  const targets = to && to.manager !== from.manager ? [from, to] : [from];
  return targets.map((project) => ({
    touser: recipientsExcept([project.manager], actorUserid),
    input: {
      title,
      desc,
      lines,
      pagePath: NOTICE_PAGES.project(project.id),
      webPath: `/wh/kit/project/${project.id}`
    }
  }));
};
