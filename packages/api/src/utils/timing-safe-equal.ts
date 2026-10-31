/**
 * 常数时间字符串比较：不因首个不同字符提前返回，避免按字节爆破标记/令牌的计时侧信道。
 * 长度差异先并入累加器，再对两串按 max 长度逐位异或（越界位取哨兵值），
 * 使耗时只与较长串长度相关，而与「前多少位相同」无关。
 *
 * 由 services/agent-replay.ts（重放标记）与 utils/client-ip.ts（可信中转令牌）共用。
 */
export const timingSafeEqual = (a: string, b: string): boolean => {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    // 越界位用 -1，保证与任何合法 charCode 都不相等，且不提前退出循环。
    const left = i < a.length ? a.charCodeAt(i) : -1;
    const right = i < b.length ? b.charCodeAt(i) : -1;
    diff |= left ^ right;
  }
  return diff === 0;
};
