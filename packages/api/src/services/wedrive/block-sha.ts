/**
 * 微盘分块上传要的摘要和切块。
 * file_upload_init 的 block_sha：前面每一块填「到这块末尾为止的 SHA1 内部状态」（5 个寄存器各按小端写成十六进制），
 * 最后一块填整个文件的标准 SHA1。2026-11-12 在生产上实测过：按大端写会在传第 1 块时报 640049。
 */
import { createSha1Stream } from "../sha1-state";

/** 微盘规定的块大小，固定 2 MiB；只有最后一块可以小 */
export const WEDRIVE_BLOCK_BYTES = 2 * 1024 * 1024;

export interface BlockShaResult {
  block_sha: string[];
  sha1: string;
  size: number;
}

/** 把整个文件流过一遍，算出 block_sha 和整文件 SHA1。内存里只留流给的那一小段。 */
export const computeBlockSha = async (
  stream: ReadableStream<Uint8Array>
): Promise<BlockShaResult> => {
  const sha = createSha1Stream();
  const boundaryStates: string[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let offset = 0;
    while (offset < value.length) {
      // 只喂到下一个 2 MiB 的边界，在边界上记一次状态
      const untilBoundary = WEDRIVE_BLOCK_BYTES - (size % WEDRIVE_BLOCK_BYTES);
      const take = Math.min(untilBoundary, value.length - offset);
      sha.update(value.subarray(offset, offset + take));
      offset += take;
      size += take;
      if (size % WEDRIVE_BLOCK_BYTES === 0) boundaryStates.push(sha.stateHex("little"));
    }
  }
  const sha1 = sha.digestHex();
  // 文件正好结束在边界上时，最后那个边界就是最后一块：它要填整文件 SHA1，不是状态
  const endsOnBoundary = size > 0 && size % WEDRIVE_BLOCK_BYTES === 0;
  const states = endsOnBoundary ? boundaryStates.slice(0, -1) : boundaryStates;
  return { block_sha: [...states, sha1], sha1, size };
};

/**
 * 把流切成正好 2 MiB 一块（最后一块是余下的）依次交给 onBlock。
 * 交出去的那一块在 onBlock 返回之后会被复用，要留着就自己拷一份。
 */
export const forEachBlock = async (
  stream: ReadableStream<Uint8Array>,
  onBlock: (block: Uint8Array, index: number) => Promise<void>
): Promise<void> => {
  const buffer = new Uint8Array(WEDRIVE_BLOCK_BYTES);
  let filled = 0;
  let index = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.length) {
        const take = Math.min(WEDRIVE_BLOCK_BYTES - filled, value.length - offset);
        buffer.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === WEDRIVE_BLOCK_BYTES) {
          await onBlock(buffer, index);
          index += 1;
          filled = 0;
        }
      }
    }
    if (filled > 0) await onBlock(buffer.subarray(0, filled), index);
  } finally {
    reader.releaseLock();
  }
};
