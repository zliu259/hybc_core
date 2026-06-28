import type { ParsedDoc, Sentence, Match, DedupResult } from "./types";
import { jaccard } from "./similarity";

interface InvertedIndex {
  byShingle: Map<number, Sentence[]>;
}

function flatten(doc: ParsedDoc): Sentence[] {
  return doc.paragraphs.flatMap((p) => p.sentences);
}

function buildIndex(sentences: Sentence[]): InvertedIndex {
  const byShingle = new Map<number, Sentence[]>();
  for (const s of sentences) {
    for (const sh of s.shingles) {
      const bucket = byShingle.get(sh);
      if (bucket) bucket.push(s);
      else byShingle.set(sh, [s]);
    }
  }
  return { byShingle };
}

// 倒排 shingle 索引：仅对"共享至少一个 shingle"的候选句对算 Jaccard，避免 O(n²)。
function bestMatch(
  sentence: Sentence,
  index: InvertedIndex,
  threshold: number,
): Match | null {
  const candidates = new Set<Sentence>();
  for (const sh of sentence.shingles) {
    const bucket = index.byShingle.get(sh);
    if (bucket) for (const cand of bucket) candidates.add(cand);
  }
  let best: Match | null = null;
  for (const cand of candidates) {
    const score = jaccard(sentence.shingles, cand.shingles);
    if (score >= threshold && (best === null || score > best.score)) {
      best = {
        masterSentenceId: cand.id,
        compareSentenceId: sentence.id,
        score,
      };
    }
  }
  return best;
}

export function compareToMaster(
  master: ParsedDoc,
  compare: ParsedDoc,
  threshold: number,
): DedupResult {
  const index = buildIndex(flatten(master));
  const compareSentences = flatten(compare);
  const matches: Match[] = [];
  let dupChars = 0;
  let totalChars = 0;
  let dupSentences = 0;
  for (const s of compareSentences) {
    totalChars += s.text.length;
    const m = bestMatch(s, index, threshold);
    if (m) {
      matches.push(m);
      dupChars += s.text.length;
      dupSentences++;
    }
  }
  // Rates are measured over the COMPARE document only (asymmetric by design):
  // "how much of this compare doc duplicates the master".
  return {
    compareDocId: compare.id,
    matches,
    charDuplicateRate: totalChars === 0 ? 0 : dupChars / totalChars,
    sentDuplicateRate:
      compareSentences.length === 0 ? 0 : dupSentences / compareSentences.length,
  };
}

// 对称的两两相似度：两侧被对方命中的句子字数之和 / 两侧总字数之和。
export function pairSimilarity(
  x: ParsedDoc,
  y: ParsedDoc,
  threshold: number,
): number {
  const xy = compareToMaster(y, x, threshold);
  const yx = compareToMaster(x, y, threshold);
  const xChars = flatten(x).reduce((n, s) => n + s.text.length, 0);
  const yChars = flatten(y).reduce((n, s) => n + s.text.length, 0);
  const total = xChars + yChars;
  return total === 0
    ? 0
    : (xy.charDuplicateRate * xChars + yx.charDuplicateRate * yChars) / total;
}

export function buildSimilarityMatrix(
  docs: ParsedDoc[],
  threshold: number,
): number[][] {
  return docs.map((di, i) =>
    docs.map((dj, j) => {
      if (i === j) return 1;
      return pairSimilarity(di, dj, threshold);
    }),
  );
}
