// 轻量拼音检索工具：把候选文案编译成「按字符的候选串」槽位数组，
// 再用锚定式匹配器判断用户输入是否命中。支持中文子串、全拼、首字母，
// 并正确处理多音字（如 银行=yínháng、成都=chéngdū）。
// 数据来自 utils/pinyin-data.js（pinyin-pro 预生成的「音节 -> 汉字串」分组表，含多音）。
// 运行时懒加载一次反查表（汉字 -> 读音数组），零网络、零外部依赖。

const GROUPED = require("./pinyin-data");

let charReadings = null;

function ensureIndex() {
  if (charReadings) return charReadings;
  const map = {};
  Object.keys(GROUPED).forEach((syllable) => {
    const chars = GROUPED[syllable] || "";
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i];
      if (!map[ch]) map[ch] = [];
      if (map[ch].indexOf(syllable) === -1) map[ch].push(syllable);
    }
  });
  charReadings = map;
  return map;
}

// 全角 ASCII（U+FF01–FF5E）折半角、全角空格折普通空格；其余原样（含非 BMP）。
function foldWidth(text) {
  let out = "";
  for (const ch of String(text == null ? "" : text)) {
    const code = ch.codePointAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else if (code === 0x3000) {
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

// 把一条文案编译成槽位数组：每个字符一个槽，slot.cands 是该字符可被查询消费的候选串。
// 汉字：全部读音 + 各读音首字母 + 汉字本身（支持中文子串）。
// 字母/数字：折半角小写自身。空白字符直接丢弃，避免阻断连续匹配。
function buildSlots(text) {
  const map = ensureIndex();
  const folded = foldWidth(text);
  const slots = [];
  for (const ch of folded) {
    if (/\s/.test(ch)) continue;
    const readings = map[ch];
    if (readings && readings.length) {
      const cands = [];
      const push = (s) => {
        if (s && cands.indexOf(s) === -1) cands.push(s);
      };
      readings.forEach((r) => {
        push(r);
        push(r[0]);
      });
      push(ch);
      slots.push({ cands });
    } else {
      slots.push({ cands: [ch.toLowerCase()] });
    }
  }
  return slots;
}

// 归一化用户输入：折半角、去空格、小写。
function normalizeQuery(query) {
  return foldWidth(query).trim().toLowerCase().replace(/\s+/g, "");
}

// slots 是否命中 normalizedQuery（应先经 normalizeQuery）。空 query 视为全部命中。
// 语义：query 能从某个槽起、被连续若干槽各消费一个候选串、完整消费掉。
function matches(slots, normalizedQuery) {
  const q = normalizedQuery;
  if (!q) return true;
  const n = slots ? slots.length : 0;
  if (!n) return false;
  const qlen = q.length;
  // memo[si*(qlen+1)+qi]: 0 未知, 1 可行, 2 不可行
  const memo = new Int8Array(n * (qlen + 1));

  const canConsume = (si, qi) => {
    if (qi === qlen) return true;
    if (si === n) return false;
    const key = si * (qlen + 1) + qi;
    const cached = memo[key];
    if (cached) return cached === 1;
    const cands = slots[si].cands;
    let res = false;
    for (let c = 0; c < cands.length; c += 1) {
      const cand = cands[c];
      if (cand && q.startsWith(cand, qi) && canConsume(si + 1, qi + cand.length)) {
        res = true;
        break;
      }
    }
    memo[key] = res ? 1 : 2;
    return res;
  };

  for (let si = 0; si < n; si += 1) {
    if (canConsume(si, 0)) return true;
  }
  return false;
}

module.exports = {
  buildSlots,
  normalizeQuery,
  matches
};
