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
  const paragraphs: Para[] = [];
  input.paragraphTexts.forEach((raw, paraIdx) => {
    const sentenceTexts = splitSentences(raw);
    if (sentenceTexts.length === 0) return;
    const sentences: Sentence[] = sentenceTexts.map((text, sentIdx) => {
      const norm = normalizeText(text);
      return {
        id: `${input.id}#${paraIdx}#${sentIdx}`,
        text,
        norm,
        shingles: toShingles(norm),
      };
    });
    paragraphs.push({ idx: paraIdx, text: raw.trim(), sentences });
  });
  return { id: input.id, name: input.name, role: input.role, paragraphs };
}
