import { hashString } from "./hash";

// 字符级 k-gram，hash 成整数集合。短于 k 时整体作为一个 shingle。
export function toShingles(norm: string, k = 3): Set<number> {
  const out = new Set<number>();
  if (norm.length === 0) return out;
  if (norm.length <= k) {
    out.add(hashString(norm));
    return out;
  }
  for (let i = 0; i + k <= norm.length; i++) {
    out.add(hashString(norm.slice(i, i + k)));
  }
  return out;
}
