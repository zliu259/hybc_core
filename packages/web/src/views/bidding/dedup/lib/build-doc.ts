import type { ParsedDoc, Para, Sentence, DocRole } from "./types";
import { splitSentences } from "./segment";
import { normalizeText } from "./normalize";
import { toShingles } from "./shingle";

export interface BuildDocInput {
  id: string;
  name: string;
  role: DocRole;
  paragraphTexts: string[];
}

export function buildParsedDoc(input: BuildDocInput): ParsedDoc {
  const paragraphs: Para[] = input.paragraphTexts
    .map((raw, paraIdx) => {
      const sentences: Sentence[] = splitSentences(raw)
        .map((text, sentIdx) => {
          const norm = normalizeText(text);
          return {
            id: `${input.id}#${paraIdx}#${sentIdx}`,
            text,
            norm,
            shingles: toShingles(norm),
          };
        })
        .filter((s) => s.norm !== "");
      return sentences.length > 0
        ? { idx: paraIdx, text: raw.trim(), sentences }
        : null;
    })
    .filter((p): p is Para => p !== null);
  return { id: input.id, name: input.name, role: input.role, paragraphs };
}
