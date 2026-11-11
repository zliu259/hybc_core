/**
 * SHA1 处理完若干个 64 字节块后的内部状态（h0..h4），不做结尾填充。
 *
 * 企微微盘分块上传要求每个中间块报"累积 sha"：对前面所有块依次 sha1_update 之后的 state。
 * Web Crypto 只给最终摘要，拿不到中间状态，所以这里自己实现压缩函数。
 * 文档没说明 state 转十六进制时每个 32 位字按什么字节序，big 和 little 两种都给出，由调用方试。
 */

const INITIAL_STATE = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0] as const;

const rotl = (value: number, bits: number): number => (value << bits) | (value >>> (32 - bits));

const compress = (state: number[], block: Uint8Array, offset: number): void => {
  const w = new Array<number>(80);
  for (let i = 0; i < 16; i += 1) {
    const base = offset + i * 4;
    w[i] =
      ((block[base] << 24) | (block[base + 1] << 16) | (block[base + 2] << 8) | block[base + 3]) >>>
      0;
  }
  for (let i = 16; i < 80; i += 1) {
    w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1) >>> 0;
  }

  let [a, b, c, d, e] = state;
  for (let i = 0; i < 80; i += 1) {
    let f: number;
    let k: number;
    if (i < 20) {
      f = (b & c) | (~b & d);
      k = 0x5a827999;
    } else if (i < 40) {
      f = b ^ c ^ d;
      k = 0x6ed9eba1;
    } else if (i < 60) {
      f = (b & c) | (b & d) | (c & d);
      k = 0x8f1bbcdc;
    } else {
      f = b ^ c ^ d;
      k = 0xca62c1d6;
    }
    const temp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
    e = d;
    d = c;
    c = rotl(b, 30) >>> 0;
    b = a;
    a = temp;
  }

  state[0] = (state[0] + a) >>> 0;
  state[1] = (state[1] + b) >>> 0;
  state[2] = (state[2] + c) >>> 0;
  state[3] = (state[3] + d) >>> 0;
  state[4] = (state[4] + e) >>> 0;
};

const wordHex = (word: number, wordEndian: "big" | "little"): string => {
  const big = word.toString(16).padStart(8, "0");
  if (wordEndian === "big") return big;
  return big.match(/../g)?.reverse().join("") ?? big;
};

/** SHA1 处理完 bytes 后的内部状态（5 个 32 位寄存器），不做结尾填充。bytes 长度必须是 64 的倍数。 */
export const sha1StateHex = (bytes: Uint8Array, wordEndian: "big" | "little"): string => {
  if (bytes.length % 64 !== 0) {
    throw new Error(`sha1StateHex: length must be a multiple of 64, got ${bytes.length}`);
  }
  const state = [...INITIAL_STATE];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    compress(state, bytes, offset);
  }
  return state.map((word) => wordHex(word, wordEndian)).join("");
};
