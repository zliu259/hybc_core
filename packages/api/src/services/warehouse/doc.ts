/**
 * 库房单入口：校验、幂等重放、按类型组批、执行。
 * 期初和入库在这里；发货、返库、转场在 doc-move.ts；报废和冲销有各自的入口。
 */
import type { Env } from "../../types/env";
import { executeDoc, findReplay, adjustMaterial, insertLine, type WhDocResult } from "./doc-core";
import {
  DOC_TYPES,
  loadActiveMaterials,
  parseDocInput,
  requireClientRequestId,
  type ParsedDoc
} from "./doc-input";
import { badRequest } from "./errors";
import { requireEnum } from "./validation";

export type { WhDocResult };
export type WhDocType = ParsedDoc["doc_type"];

const NOT_DIRECT = new Set<WhDocType>(["adjust", "scrap", "unscrap"]);

const createInbound = async (
  env: Env,
  doc: ParsedDoc,
  operatorUserid: string
): Promise<WhDocResult> => {
  if (doc.device_lines.length > 0) throw badRequest("入库单不能包含设备");
  await loadActiveMaterials(env, doc.material_lines);
  return executeDoc(env, {
    clientRequestId: doc.client_request_id,
    operatorUserid,
    header: { ...doc, reverses_doc_id: null },
    build: async (now) =>
      doc.material_lines.flatMap((line) => [
        adjustMaterial(env.DB, line.material_id, line.quantity, now),
        insertLine(
          env.DB,
          doc.client_request_id,
          {
            device_id: null,
            material_id: line.material_id,
            quantity: line.quantity,
            outcome: "normal",
            stock_delta: line.quantity,
            project_id: null,
            project_delta: 0,
            usage_meters: null,
            soil_type: null,
            note: line.note
          },
          now
        )
      ])
  });
};

export const createWhDoc = async (
  env: Env,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<WhDocResult> => {
  const docType = requireEnum(input.doc_type, "单据类型", DOC_TYPES);
  if (NOT_DIRECT.has(docType)) throw badRequest("不能直接创建这种单据");
  const replay = await findReplay(env, requireClientRequestId(input.client_request_id));
  if (replay) return replay;
  const doc = parseDocInput(input, docType);
  if (docType === "opening" || docType === "inbound")
    return createInbound(env, doc, operatorUserid);
  throw badRequest("暂不支持这种单据");
};
