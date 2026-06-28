export type DocRole = "master" | "compare";

export interface Sentence {
  id: string; // `${docId}#${paraIdx}#${sentIdx}`
  text: string;
  norm: string;
  shingles: Set<number>;
}

export interface Para {
  idx: number;
  text: string;
  sentences: Sentence[];
}

export interface ParsedDoc {
  id: string;
  name: string;
  role: DocRole;
  paragraphs: Para[];
}

export interface Match {
  masterSentenceId: string;
  compareSentenceId: string;
  score: number;
}

export interface DedupResult {
  compareDocId: string;
  matches: Match[];
  charDuplicateRate: number;
  sentDuplicateRate: number;
}
