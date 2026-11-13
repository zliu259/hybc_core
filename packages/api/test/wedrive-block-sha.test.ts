import { describe, expect, it } from "vitest";

import { sha1StateHex } from "../src/services/sha1-state";
import {
  computeBlockSha,
  forEachBlock,
  WEDRIVE_BLOCK_BYTES
} from "../src/services/wedrive/block-sha";

// 微盘分块上传要的 block_sha：前面每块是到这块末尾为止的 SHA1 内部状态（小端），最后一块是整文件 SHA1。

const MiB = 1024 * 1024;
const pattern = (length: number, seed = 13): Uint8Array =>
  new Uint8Array(length).map((_, index) => (index * 31 + seed) % 251);
const sha1Hex = async (bytes: Uint8Array): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
/** 把一段字节按 chunkSize 切开，做成流 */
const streamOf = (bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> => {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    }
  });
};

describe("computeBlockSha", () => {
  it("块的大小是 2 MiB", () => {
    expect(WEDRIVE_BLOCK_BYTES).toBe(2 * MiB);
  });

  it("3 MiB：两块，第一块是 2 MiB 处的小端状态，第二块是整文件 SHA1", async () => {
    const bytes = pattern(3 * MiB);
    const result = await computeBlockSha(streamOf(bytes, 70_000));
    expect(result.block_sha).toEqual([
      sha1StateHex(bytes.subarray(0, 2 * MiB), "little"),
      await sha1Hex(bytes)
    ]);
    expect(result.sha1).toBe(await sha1Hex(bytes));
    expect(result.size).toBe(3 * MiB);
  });

  it.each([1, 100, 2 * MiB - 1, 2 * MiB])("%i 字节：只有一块，就是整文件 SHA1", async (length) => {
    const bytes = pattern(length);
    const result = await computeBlockSha(streamOf(bytes, 65_536));
    expect(result.block_sha).toEqual([await sha1Hex(bytes)]);
    expect(result.size).toBe(length);
  });

  it("正好 4 MiB：两块，不会多出一个空块", async () => {
    const bytes = pattern(4 * MiB);
    const result = await computeBlockSha(streamOf(bytes, 1_000_003));
    expect(result.block_sha).toEqual([
      sha1StateHex(bytes.subarray(0, 2 * MiB), "little"),
      await sha1Hex(bytes)
    ]);
  });

  it("5 MiB + 1 字节：三块，前两块是 2、4 MiB 处的状态", async () => {
    const bytes = pattern(5 * MiB + 1);
    const result = await computeBlockSha(streamOf(bytes, 3 * MiB));
    expect(result.block_sha).toEqual([
      sha1StateHex(bytes.subarray(0, 2 * MiB), "little"),
      sha1StateHex(bytes.subarray(0, 4 * MiB), "little"),
      await sha1Hex(bytes)
    ]);
  });

  it("流怎么切都不影响结果", async () => {
    const bytes = pattern(3 * MiB + 77);
    const a = await computeBlockSha(streamOf(bytes, 1));
    const b = await computeBlockSha(streamOf(bytes, 5 * MiB));
    expect(a).toEqual(b);
  }, 30_000);
});

describe("forEachBlock", () => {
  const collect = async (bytes: Uint8Array, chunkSize: number) => {
    const blocks: { index: number; length: number; first: number; last: number }[] = [];
    await forEachBlock(streamOf(bytes, chunkSize), async (block, index) => {
      blocks.push({ index, length: block.length, first: block[0], last: block[block.length - 1] });
    });
    return blocks;
  };

  it("不管流怎么切，每块正好 2 MiB，最后一块是余下的", async () => {
    const bytes = pattern(5 * MiB + 3);
    for (const chunkSize of [70_000, 2 * MiB, 3 * MiB]) {
      const blocks = await collect(bytes, chunkSize);
      expect(blocks.map((block) => [block.index, block.length])).toEqual([
        [0, 2 * MiB],
        [1, 2 * MiB],
        [2, MiB + 3]
      ]);
      expect(blocks[1].first).toBe(bytes[2 * MiB]);
      expect(blocks[2].last).toBe(bytes[bytes.length - 1]);
    }
  });

  it("正好 4 MiB：两块；1 字节：一块；空流：一块都没有", async () => {
    expect((await collect(pattern(4 * MiB), 999_999)).map((block) => block.length)).toEqual([
      2 * MiB,
      2 * MiB
    ]);
    expect((await collect(pattern(1), 10)).map((block) => block.length)).toEqual([1]);
    expect(await collect(new Uint8Array(0), 10)).toEqual([]);
  });

  it("处理某一块时抛错：停下来，错误传出去", async () => {
    let seen = 0;
    await expect(
      forEachBlock(streamOf(pattern(5 * MiB), 70_000), async () => {
        seen += 1;
        if (seen === 2) throw new Error("这一块没传上");
      })
    ).rejects.toThrow("这一块没传上");
    expect(seen).toBe(2);
  });
});
