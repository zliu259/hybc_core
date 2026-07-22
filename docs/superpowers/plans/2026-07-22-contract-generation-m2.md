# AI 合同起草 M2 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M2 落地：样本驱动的规则层 v2 与条款库 v2（合同族支持 + 设备租赁族）+ 定稿转正式合同（docx 走审查/审批闭环）+ 生成文档签名访问。**不做 PDF 导出**（owner 2026-07-22 指示：合同送对方审阅，可编辑 docx 才有意义）。

**Architecture:** 沿用 M1 全部机制。新增：`contract_clause_template`/`contract_draft` 增加 `family` 维度（表重建迁移）；`finalize`（服务端固化占位符+版本快照）→ web 生成 docx 上传 `contract-draft/` 前缀 → `convert`（建 contract + 挂附件 + 触发既有 contract_review）→ 跳转合同详情走现有审批。`GET /upload/object` 对 `contract-draft/` 前缀启用三模式鉴权（HMAC 签名 URL / JWT Bearer / TASK_API_KEY），其余前缀行为不变（全量收紧留 M3）。

**样本依据:** docs/superpowers/specs/2026-07-22-contract-sample-findings.md（生产 5 份可解析合同的拆解结论）。

---

## 前置须知（执行者必读）

- 包管理器 **pnpm**；worktree 无 node_modules 需从主检出符号链接（M1 计划同款命令）。
- 禁 `as any`/`@ts-ignore`；D1 生产无事务回滚（闸门前置+条件 UPDATE+显式补偿）；软删除；ISO8601 TEXT；金额大写后端生成。
- commit 本地提交、**不 push**、message 无 AI 署名 trailer。
- 基线（M1 合入后 main）：api 779 测试 / web 99 测试全绿。api 单测过滤：`pnpm test <路径>`（**不加 `--`**）。
- 迁移编号从 **0065** 起（执行前 `ls packages/api/migrations | sort | tail -1` 确认仍为 0064，被占用则顺延并同步全计划引用）。

## 文件结构

```
packages/api/
  migrations/0065_contract_family_and_clause_v2.sql   # 新建：family 重建 + 顶管族增强 + 设备租赁族 seed
  src/services/contract-draft-rules.ts                # 修改：规则 v2（样本驱动新模式）
  src/services/contract-draft-finalize.ts             # 新建：服务端占位符固化/关键字表
  src/types/contract-draft.ts                         # 修改：family 类型、finalize 相关类型
  src/routes/contract-draft.ts                        # 修改：family 贯通 + finalize/convert + regenerate 快照
  src/routes/upload.ts                                # 修改：contract-draft/ 前缀三模式鉴权 + sign-download
  test/contract-draft-rules-v2.test.ts                # 新建
  test/contract-draft-finalize.test.ts                # 新建
task-runner/runner/executor.py                        # 修改：附件下载带 x-api-key 头
packages/web/src/
  api/contract-draft.ts                               # 修改：family/finalize/convert wrapper
  api/upload.ts                                       # 修改：signDownloadUrl
  views/finance/contract/draft/draft-labels.ts        # 修改：draft 状态标签
  views/finance/contract/draft/components/DraftInitCard.vue   # 修改：合同族选择
  views/finance/contract/draft/components/ConvertDialog.vue   # 新建：定稿转化弹窗
  views/finance/contract/draft/index.vue              # 修改：定稿/转化流程 + readonly 态
  views/finance/contract/detail.vue                   # 修改：附件打开改签名 URL 流
doc/开发计划.md、doc/开发记录.md                        # 修改：文档同步（Task 6）
```

---

### Task 1: 规则层 v2（样本驱动新模式，TDD）

**Files:**
- Modify: `packages/api/src/services/contract-draft-rules.ts`（RULE_PATTERNS 数组扩充 + 质保金反序）
- Test: `packages/api/test/contract-draft-rules-v2.test.ts`（新建；不动 M1 的 contract-draft-rules.test.ts）

- [ ] **Step 1: 写失败测试（逐字）**

```ts
// packages/api/test/contract-draft-rules-v2.test.ts
// 规则层 v2：生产样本挖掘出的真实变体（见 docs/superpowers/specs/2026-07-22-contract-sample-findings.md）
import { describe, it, expect } from "vitest";
import { checkClauseText } from "../src/services/contract-draft-rules";

const hasLevel = (text: string, level: "red" | "yellow"): boolean =>
  checkClauseText(text).some(f => f.level === level);

describe("规则层 v2：背靠背变体", () => {
  it("字面『背靠背』红标", () => {
    expect(hasLevel("特别提示：背靠背，即建设单位不付款则甲方无须支付。", "red")).toBe(true);
  });
  it("『按回款进度同比例支付』红标", () => {
    expect(hasLevel("付款按照本工程回款进度同比例向乙方支付工程款。", "red")).toBe(true);
  });
  it("『以建设方拨付的工程进度款为依据』红标", () => {
    expect(hasLevel("劳务款支付以建设方拨付的工程进度款为依据。", "red")).toBe(true);
  });
  it("防御性条款『不得以第三方付款作为支付前提』不误报", () => {
    expect(checkClauseText("甲方不得以第三方付款作为向乙方支付的前提。")).toEqual([]);
  });
});

describe("规则层 v2：预先弃权与抗辩权放弃", () => {
  it("『不向甲方主张任何违约责任』红标", () => {
    expect(hasLevel("乙方承诺不向甲方主张任何违约责任、利息损失等赔偿责任。", "red")).toBe(true);
  });
  it("『不再支付任何形式的违约金』红标", () => {
    expect(hasLevel("发包人除支付必要的窝工费用以外，不再支付任何形式的违约金。", "red")).toBe(true);
  });
  it("『不得停止履行』黄标", () => {
    expect(hasLevel("乙方不得因甲方未支付款项而停止履行本合同义务。", "yellow")).toBe(true);
  });
});

describe("规则层 v2：绝对免责与责任主体固定", () => {
  it("『一切事故均与甲方无关』红标", () => {
    expect(hasLevel("乙方在施工过程中所发生的一切事故，均与甲方无关。", "red")).toBe(true);
  });
  it("『事故的责任主体为承包人』红标", () => {
    expect(hasLevel("必须明确事故的责任主体为承包人，不得将经济损失转移到发包人。", "red")).toBe(true);
  });
});

describe("规则层 v2：质保金反序与畸高日息", () => {
  it("『扣留20%的质保金』（比例在前）红标", () => {
    expect(hasLevel("每期结算扣留20%的质保金，待验收合格后支付。", "red")).toBe(true);
  });
  it("『3%的质保金』不误报", () => {
    expect(checkClauseText("预留3%的质保金，缺陷责任期满后返还。")).toEqual([]);
  });
  it("『每拖延一日按月租赁费的5%』黄标", () => {
    expect(hasLevel("每拖延一日乙方应当按照未进场设备月租赁费的5%向甲方支付违约金。", "yellow")).toBe(true);
  });
});

describe("规则层 v2：模糊账期与无限异议期", () => {
  it("『年底前支付』黄标", () => {
    expect(hasLevel("无预付款，工作完成后于年底前支付至合同总价的70%。", "yellow")).toBe(true);
  });
  it("『自发现之日起』异议期黄标", () => {
    expect(hasLevel("甲方有权在发现货物质量问题之日起15日内提出异议并索赔。", "yellow")).toBe(true);
  });
  it("正常付款条款不误报", () => {
    expect(checkClauseText("甲方应于验收合格后30日内支付工程款。")).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/api && pnpm test test/contract-draft-rules-v2.test.ts
```
Expected: FAIL（新模式尚未实现，多数用例返回空数组）。

- [ ] **Step 3: 扩充实现**

在 `contract-draft-rules.ts` 的 `RULE_PATTERNS` 数组末尾（`每日千分之X` 条目之后）追加：

```ts
  {
    re: /背靠背/,
    level: "red",
    reason: "背靠背付款条款：以第三方付款为付款前提，对中小企业无效",
    legal_basis: "最高人民法院2024年批复（法释〔2024〕11号）"
  },
  {
    re: /按(照)?[^。；]{0,8}回款进度[^。；]{0,8}(同比例)?[^。；]{0,12}支付/,
    level: "red",
    reason: "背靠背付款变体：付款与上游回款进度挂钩且无兜底期限",
    legal_basis: "最高人民法院2024年批复（法释〔2024〕11号）"
  },
  {
    re: /以[^。；]{0,14}(拨付|支付)的?[^。；]{0,8}(款项|工程款|进度款|计量款)[^。；]{0,6}(为依据|为前提|为条件)/,
    level: "red",
    reason: "背靠背付款变体：以上游拨付款项为付款依据",
    legal_basis: "最高人民法院2024年批复（法释〔2024〕11号）"
  },
  {
    re: /不(再)?(向[^。；]{0,6})?(支付|主张|承担)任何(形式的?)?(违约金|违约责任|利息|赔偿)/,
    level: "red",
    reason: "预先放弃/免除违约责任的条款：单方免责或迫使对方弃权",
    legal_basis: "《民法典》第497条（格式条款不合理免责无效）"
  },
  {
    re: /不得[^。；]{0,14}(拒绝|停止|中止)(履行|交付|供货|施工|作业)/,
    level: "yellow",
    reason: "预先放弃同时履行抗辩权：对方违约时我方仍被迫继续履行",
    legal_basis: "《民法典》第525-527条（履行抗辩权）"
  },
  {
    re: /一切(安全)?事故[^。；]{0,10}(均)?与[^。；]{0,6}无关/,
    level: "red",
    reason: "绝对免责条款：不区分过错方的事故免责",
    legal_basis: "《民法典》第506条"
  },
  {
    re: /(事故|安全)[^。；]{0,10}责任主体(为|是)(承包人|乙方|分包人|劳务企业)/,
    level: "red",
    reason: "以合同预先固定事故责任主体，法定安全责任不可约定转移",
    legal_basis: "《安全生产法》《民法典》第1165条",
  },
  {
    re: /每(拖延|逾期|延误)?一?(日|天)[^。；]{0,16}[0-9]+(?:\.[0-9]+)?\s*%/,
    level: "yellow",
    reason: "按日百分比违约金费率畸高（如5%/日月内即超本金），存在被调减风险",
    legal_basis: "《民法典》第585条"
  },
  {
    re: /年底前(支付|付清|结清|付款)/,
    level: "yellow",
    reason: "模糊账期：『年底前』无固定日期，存在被拖延的解释空间",
    legal_basis: ""
  },
  {
    re: /自?发现[^。；]{0,8}之日起[^。；]{0,10}(日|天)内[^。；]{0,10}(异议|索赔)/,
    level: "yellow",
    reason: "质量异议期以『发现之日』起算，责任敞口无实质时间边界",
    legal_basis: ""
  }
```

并在 `WARRANTY_RE` 定义行之后新增反序正则，且在 `checkClauseText` 的质保金检查段（现有 `for (const m of text.matchAll(WARRANTY_RE))` 循环之后）追加同款循环：

```ts
const WARRANTY_REVERSED_RE = /([0-9]+(?:\.[0-9]+)?)\s*%的?(质量保证金|质保金)/g;
```

```ts
  for (const m of text.matchAll(WARRANTY_REVERSED_RE)) {
    const ratio = Number(m[1]);
    if (Number.isFinite(ratio) && ratio > 3) {
      findings.push({
        text: m[0],
        level: "red",
        reason: "质量保证金超过结算总额3%上限，超出部分不受支持",
        legal_basis: "《建设工程质量保证金管理办法》",
        source: "rule"
      });
    }
  }
```

**实现注意**：
- `每日千分之X` 旧规则与新 `按日百分比` 规则可能同时命中不同文本，互不冲突；
- 新增模式全部加入后，**必须复跑 M1 测试** `test/contract-draft-rules.test.ts` 确认原 13 用例不回归（尤其"正常条款零命中"用例——若新正则误报，收紧字符窗口而不是改测试）；
- 条款库 seed 文本自身不得被误报：Step 4 有专项验证。

- [ ] **Step 4: 全绿验证 + seed 自检**

```bash
cd packages/api && pnpm test test/contract-draft-rules-v2.test.ts && pnpm test test/contract-draft-rules.test.ts && pnpm typecheck && pnpm lint
```
Expected: v2 全绿 + M1 的 13 用例不回归。
再做 seed 免误报抽查（0063 与本计划 0065 的正文均不应触发红标）——写一个临时 node 脚本或直接目检下列高危句：`不得将本协议工程转包或再分包`（party_b_duties outbound）、`甲方不得以第三方付款作为向乙方支付的前提`（0065 设备族 payment inbound 防御句）。若误报，收紧正则窗口。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/contract-draft-rules.ts packages/api/test/contract-draft-rules-v2.test.ts
git commit -m "feat(api): 合规规则v2——生产样本驱动的背靠背/弃权/免责/质保金反序/日息模式"
```

---

### Task 2: 迁移 0065 — 合同族支持 + 条款库 v2

**Files:**
- Create: `packages/api/migrations/0065_contract_family_and_clause_v2.sql`

要点：`contract_clause_template` 现有 `UNIQUE(section_key, direction)` 表级约束阻碍多族同名节，SQLite 需**表重建**迁移（新表 → 拷贝 → 换名）。`contract_draft` 用 ALTER 加列即可。既有数据 family 一律 `pipe_jacking`。

- [ ] **Step 1: 写迁移文件（逐字）**

```sql
-- 0065_contract_family_and_clause_v2.sql
-- ① contract_clause_template 表重建：加 family 列，唯一约束改为 (family, section_key, direction)
-- ② contract_draft 加 family 列
-- ③ 顶管族增强（送达/扣款程序/变更管理三节 + 既有节文案 v2）
-- ④ 新增设备租赁/机械施工族 equipment_lease（初稿，待管理层校准）
-- 样本依据：docs/superpowers/specs/2026-07-22-contract-sample-findings.md

CREATE TABLE IF NOT EXISTS contract_clause_template_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family TEXT NOT NULL DEFAULT 'pipe_jacking',
  section_key TEXT NOT NULL,
  direction TEXT NOT NULL,
  required_level TEXT NOT NULL,
  title TEXT NOT NULL,
  body_template TEXT NOT NULL,
  style_ref TEXT,
  risk_notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(family, section_key, direction)
);
INSERT INTO contract_clause_template_v2
  (id, family, section_key, direction, required_level, title, body_template, style_ref, risk_notes, sort_order, version, status, created_at, updated_at)
SELECT id, 'pipe_jacking', section_key, direction, required_level, title, body_template, style_ref, risk_notes, sort_order, version, status, created_at, updated_at
  FROM contract_clause_template;
DROP TABLE contract_clause_template;
ALTER TABLE contract_clause_template_v2 RENAME TO contract_clause_template;
CREATE INDEX IF NOT EXISTS idx_contract_clause_template_direction ON contract_clause_template(direction);
CREATE INDEX IF NOT EXISTS idx_contract_clause_template_family ON contract_clause_template(family);

ALTER TABLE contract_draft ADD COLUMN family TEXT NOT NULL DEFAULT 'pipe_jacking';

-- ── ③ 顶管族增强 ──
-- 既有节文案 v2（幂等 UPDATE）：价税分离 + 背靠背兜底 + 质保金返还期限
UPDATE contract_clause_template
   SET body_template = '本工程综合单价为人民币{{unit_price}}元/米，顶进长度{{length}}米，暂定总价人民币{{amount}}元（大写：{{amount_cn}}）。其中：不含税价款为{{amount_ex_tax}}元，增值税税率{{tax_rate}}%，税额{{tax_amount}}元。国家调整增值税税率的，双方签订补充协议相应调整税金。最终结算价 = 双方现场签认的实际贯通长度 × 综合单价；除双方书面签认的变更外，综合单价包干使用。',
       risk_notes = '价税分离四项分列+税率调整机制（源自生产样本机构模版）；大写金额由系统生成填入 {{amount_cn}}。工程量清单建议采用『计量规则+包含内容』三栏式（附表），压缩"是否包干"争议空间。',
       version = 2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE family='pipe_jacking' AND section_key='quantity_pricing' AND direction='both';

UPDATE contract_clause_template
   SET body_template = '（一）设备安装完毕具备顶进条件后{{advance_days}}日内，甲方支付乙方启动款人民币{{advance_amount}}元；（二）施工期间每月{{measure_day}}日双方计量，甲方于次月{{monthly_pay_day}}日前支付当月已完工程量的{{progress_ratio}}%；（三）竣工验收合格后{{settle_days}}日内双方完成结算，甲方付至结算总价的{{settle_ratio}}%；（四）剩余尾款甲方于{{final_pay_date}}前一次性付清。上述付款义务不以甲方收到任何第三方（含建设单位）付款为前提；即使双方另有回款联动安排，甲方最迟应于对应工程量签认后{{max_pay_days}}日内付清该期款项。甲方逾期付款的，每逾期一日按未付金额的{{late_fee_rate}}向乙方支付违约金，并不影响乙方依法主张停止施工及实际损失。',
       risk_notes = 'inbound 核心：付款节点必须为确定日期/期限；『背靠背兜底期限』条款（工程量签认后 N 日为最晚付款日）是对抗甲方模版背靠背的关键，公司口径建议60-90日（管理层会议待定）。逾期违约金建议不超过日万分之五。',
       version = 2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE family='pipe_jacking' AND section_key='payment' AND direction='inbound';

UPDATE contract_clause_template
   SET body_template = '（一）施工期间每月{{measure_day}}日双方计量，甲方于次月{{monthly_pay_day}}日前支付当月已完合格工程量的{{progress_ratio}}%；（二）竣工验收合格且乙方提交完整结算资料、合规发票及农民工工资支付凭证后{{settle_days}}日内，甲方付至结算总价的{{settle_ratio}}%；（三）预留质量保证金为结算总价的{{warranty_ratio}}%（不超过3%），缺陷责任期{{warranty_months}}个月届满且无质量问题后{{warranty_refund_days}}日内无息退还，逾期未退按逾期付款承担违约责任。',
       version = 2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE family='pipe_jacking' AND section_key='payment' AND direction='outbound';

-- 新增三节（幂等 INSERT OR IGNORE；顶管族）
INSERT OR IGNORE INTO contract_clause_template
  (family, section_key, direction, required_level, title, body_template, style_ref, risk_notes, sort_order, version, status, created_at, updated_at)
VALUES
('pipe_jacking','service_notice','both','recommended','送达条款',
 '双方确认本合同首部/落款载明的地址为有效送达地址，适用于非诉通知文书及争议解决阶段（含仲裁、一审、二审、再审与执行）司法文书的送达。一方变更送达地址的，应于变更后{{notice_days}}日内书面通知对方，未通知的，原地址仍视为有效送达地址。邮寄送达的，交邮后第三日视为送达；拒收、无人签收的，退回之日视为送达。',
 NULL,'覆盖诉讼全阶段的送达效力条款，源自生产样本机构模版；绝大多数中小合同缺失此节，缺失会导致"查无此人/拒收"送达僵局。',205,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('pipe_jacking','deduction_procedure','inbound','recommended','扣款与异议程序',
 '甲方依据本协议对乙方主张扣款、罚款或费用抵扣的，应于扣减前{{deduction_notice_days}}个工作日书面通知乙方并附计算依据与凭证；乙方有权在收到通知后{{objection_days}}个工作日内书面提出异议，异议期内争议部分暂不扣减，由双方核实或按争议解决条款处理。未经上述程序的单方扣减，乙方有权要求返还。',
 NULL,'inbound 防御条款：对抗甲方模版中"有权直接扣除"的分散扣款权（生产样本单份合同出现7处无程序扣款权）。',132,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('pipe_jacking','deduction_procedure','outbound','optional','扣款与异议程序',
 '甲方依据本协议对乙方主张扣款、罚款或费用抵扣的，应书面通知乙方并附计算依据；乙方可在{{objection_days}}个工作日内书面提出异议，无异议或异议不成立的，甲方有权自应付款项中扣减。',
 NULL,'outbound 立场：保留扣款权但配备最低程序，避免整条扣款权因无程序被认定不合理。',132,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('pipe_jacking','change_management','both','recommended','变更管理',
 '（一）非因乙方原因发生的设计变更、工程量增减或施工条件重大变化，价款与工期按签证程序据实调整；（二）因乙方原因造成的变更、返工，费用由乙方承担，工期不予顺延；（三）变更减少工程量的，减少部分按合同单价核减，已实际发生的合理投入据实签认。',
 NULL,'变更三分归责结构（非承包人原因/承包人原因/工程量减少），源自生产样本中少数较平衡的机构条款。',152,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ── ④ 设备租赁/机械施工族（equipment_lease，初稿待管理层校准） ──
-- inbound=我方出租方/带机施工（收款）；outbound=我方承租方（付款）
INSERT OR IGNORE INTO contract_clause_template
  (family, section_key, direction, required_level, title, body_template, style_ref, risk_notes, sort_order, version, status, created_at, updated_at)
VALUES
('equipment_lease','parties_basis','both','core','首部与签约依据',
 '甲方（承租方）：{{party_a}}，统一社会信用代码：{{party_a_credit_code}}。
乙方（出租方）：{{party_b}}，统一社会信用代码：{{party_b_credit_code}}。
根据《中华人民共和国民法典》租赁合同及相关规定，双方就{{project_name}}所需机械设备租赁（含配套作业服务）事宜，在平等自愿基础上订立本合同。',
 NULL,'设备族固定甲方=承租方、乙方=出租方；inbound 时我方为乙方（出租收款），outbound 时我方为甲方（承租付款）。',10,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','equipment_schedule','both','core','设备清单与计价',
 '租赁设备以《设备清单》为准，逐台载明：设备名称、规格型号、绑定工作内容、计价单位（台班/月）、数量、含税单价、单价是否含操作人员人工（{{with_operator}}）。设备经双方共同验收并签署《进场交接单》后起算。合同暂定总价人民币{{amount}}元（大写：{{amount_cn}}），最终按双方签认的实际台班/工作量结算。',
 '设备-工作内容-台班三元绑定计价表（序号/部位/设备名称/规格型号/工作内容/单位/工程量/含税单价/含税金额/税率），源自生产样本。',
 '『是否含操作人员』必须显式标注——样本合同"不含司机"字面与台班含人工实质矛盾，是结算争议高发点。',20,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','lease_term','both','core','租期与计费起止',
 '租赁期限自{{start_date}}起至{{end_date}}止。计费自设备进场验收合格之日起算；退租的，承租方应提前{{derent_notice_days}}日书面通知出租方，计费至设备实际退场之日止。租期届满双方未续签而承租方继续使用、出租方未提出异议的，本合同继续有效，租期变更为不定期。',
 NULL,'『提前通知+实际退场日止』的三层计费结构源自样本；防甲方"通知到达即停止计费、设备滞留现场"的时间差损失。',30,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','entry_exit','both','core','进出场',
 '设备进出场运输、装卸费用由{{entry_cost_bearer}}承担（进出场各一次）。因承租方原因需增加进出场次数的，增加费用由承租方承担。设备进出场时间以双方签认的交接单为准。',
 NULL,'大型设备（顶管机/吊车）二次进出场成本高，费用归属必须显式约定。',40,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','billing_idle','inbound','core','计费与停滞补偿',
 '设备实际作业按台班计费。因承租方原因（含现场不具备作业条件、交叉施工、指令等待、甲供配套不到位等）造成设备停滞的，按{{idle_rate}}元/台·日计取停滞费；连续停滞超过{{max_idle_days}}日的，出租方有权撤场并要求结清已发生费用。因不可抗力停工的，双方互不计费，租期顺延。',
 NULL,'inbound 必争条款：生产样本（我方为出租方）合同的最大空白就是无窝工保底——"未工作时段不计费"叠加甲方随时叫停，设备闲置成本全在我方。',50,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','billing_idle','outbound','core','计费与停机处理',
 '设备实际作业按台班计费，未作业时段不计费。设备故障的，出租方应在{{repair_hours}}小时内响应修复；故障停机时段不计费，累计故障停机超过{{max_fault_days}}日的，承租方有权要求更换设备或解除本合同。',
 NULL,'outbound 立场（我方承租）：不计费+故障响应时限+更换权。',50,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','operator_duty','inbound','core','操作人员与作业责任',
 '设备配备操作人员的，出租方保证操作人员持有效特种作业资格证书上岗，遵守现场安全管理规定并服从承租方统一调度安排；操作人员人工费{{operator_fee_included}}。因承租方违章指挥、强令冒险作业导致的事故及损失由承租方承担；因出租方操作人员违规操作导致的事故由出租方承担。操作人员有权拒绝违章指挥。',
 NULL,'湿租（带人作业）责任边界：违章指挥归承租方、违规操作归出租方，对称划分；样本合同将"一切安全事故"压给出租方属需谈判修正项。',60,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','operator_duty','outbound','core','操作人员与作业责任',
 '设备配备操作人员的，出租方保证操作人员持有效特种作业资格证书上岗并接受承租方现场安全交底；操作人员人工费{{operator_fee_included}}。因出租方操作人员违规操作或设备本身缺陷导致的事故及第三方损失，由出租方承担并赔偿；因承租方指令原因导致的，由承租方承担相应责任。',
 NULL,'outbound 镜像：设备缺陷与操作违规归出租方。',60,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','maintenance','both','core','维修保养与燃油',
 '设备日常维修、保养由{{maintenance_bearer}}负责并承担费用；燃油、辅油由{{fuel_bearer}}承担。设备发生故障的，责任方应在{{repair_hours}}小时内响应处理，保障施工正常进行。',
 NULL,NULL,70,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','damage_loss','inbound','core','设备损坏、丢失与风险',
 '租赁期间承租方对设备负妥善保管义务。因承租方原因（含保管不善、违章使用、现场管理缺失）造成设备损坏、丢失、被盗的，按{{compensation_basis}}向出租方赔偿；正常磨损除外。因不可抗力造成的设备毁损，双方互不承担违约责任，损失按保险及法律规定处理。未经出租方书面同意，承租方不得转租、出借、抵押设备。',
 NULL,'样本合同设备丢失/被盗责任完全空白——inbound（我方出租）必须补齐；『不得转租抵押』保护所有权。',80,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','damage_loss','outbound','core','设备损坏、丢失与风险',
 '租赁期间承租方在其保管范围内对设备尽合理保管义务；因承租方过错造成设备损坏的，按实际损失赔偿，正常磨损及设备自身缺陷除外。出租方应保证设备权属清晰、无查封抵押；因权属瑕疵导致承租方损失的，出租方承担赔偿责任。',
 NULL,'outbound 立场：赔偿以过错与实际损失为限，排除正常磨损与设备自身缺陷。',80,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','safety','both','core','安全管理',
 '双方按各自过错承担安全责任：现场统一安全管理由承租方（施工现场管理方）依法履行，安全技术交底后作业；出租方及其操作人员遵守现场安全规定。任何一方不得以合同约定免除其依法应承担的安全生产管理义务。',
 NULL,'法定安全责任不可约定转移（规则层拦截项），设备族按"现场管理方统一管理+各自过错"划分。',90,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','payment','inbound','core','租金结算与支付',
 '双方于每月{{measure_day}}日按签认的台班/工作量计量，承租方于次月{{monthly_pay_day}}日前支付当期租金。承租方的付款义务独立存在，甲方不得以第三方付款作为向乙方支付的前提；最迟应于当期计量签认后{{max_pay_days}}日内付清。逾期付款的，每逾期一日按未付金额的{{late_fee_rate}}支付违约金。如约定质保金的，比例不超过结算总额的3%，退租结算后{{warranty_refund_days}}日内无息返还。',
 NULL,'inbound 核心：背靠背兜底期限 + 质保金3%上限与返还期限（样本合同3%质保金无返还期限，属需补齐项）。',100,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','payment','outbound','core','租金结算与支付',
 '双方按月计量签认，承租方于次月{{monthly_pay_day}}日前支付经签认的当期租金。承租方对出租方主张的任何扣款，应书面通知并附依据，出租方有{{objection_days}}个工作日异议期。出租方按约提供合规发票后付款，发票品目应与合同性质一致。',
 NULL,'outbound 立场：付款以计量签认为准 + 扣款程序化。',100,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','invoice_tax','both','core','发票与税务',
 '出租方按{{tax_rate}}%税率向承租方提供增值税{{invoice_type}}发票，发票品目与合同实质一致：纯设备租赁（不含操作人员）按『有形动产经营租赁服务』开具；设备带操作人员按工序/台班作业的，按『建筑服务』开具并在备注栏注明项目名称与发生地。发票仅向本合同相对方开具，三流一致。',
 NULL,'湿租按建筑服务品目是税务合规关键（样本合同"名租实工"品目错配风险 + 聊城范本1%机械租赁发票同源问题）。',110,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','breach','both','core','违约责任',
 '出租方迟延交付设备或承租方迟延支付租金的，每迟延一日均按对应金额的{{late_fee_rate}}向对方支付违约金，双向累计均以对应金额的{{penalty_cap}}%为上限。任何一方违约给对方造成损失超过违约金的，守约方可就不足部分继续主张。',
 NULL,'双向对等+封顶：对抗样本合同"甲方活期利率封顶2% vs 乙方多档不封顶"的不对称结构。',120,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','service_notice','both','recommended','送达条款',
 '双方确认本合同载明地址为有效送达地址，适用于非诉通知及争议解决全部阶段司法文书送达；地址变更应于{{notice_days}}日内书面通知，未通知的原地址仍视为有效；邮寄交邮后第三日视为送达。',
 NULL,NULL,130,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','dispute','both','core','争议解决',
 '因本合同发生的争议，双方应友好协商解决；协商不成的，任何一方均有权向{{dispute_venue}}人民法院提起诉讼。',
 NULL,'inbound 立场建议约定我方所在地，避免样本中"甲方住所地"单边管辖。',140,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','misc_effective','both','core','其他与生效',
 '本合同自双方盖章并经法定代表人或授权代理人签字之日起生效。未尽事宜双方另行签订补充协议，与本合同具有同等效力。本合同一式{{copies}}份，甲方执{{party_a_copies}}份，乙方执{{party_b_copies}}份，扫描件与原件具有同等效力。合同任何空白栏目应在用印前填写完整，留白视为对相应事项未作约定。',
 NULL,'『留白视为未约定』提示条款源自样本教训：已盖章合同出现7处关键商业条款留白。',150,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','signature_block','both','core','落款',
 '甲方（盖章）：{{party_a}}
法定代表人/委托代理人：{{party_a_legal_person}}
统一社会信用代码：{{party_a_credit_code}}
开户银行：{{party_a_bank_name}}
账号：{{party_a_bank_account}}
签约日期：{{sign_date}}

乙方（盖章）：{{party_b}}
法定代表人/委托代理人：{{party_b_legal_person}}
统一社会信用代码：{{party_b_credit_code}}
开户银行：{{party_b_bank_name}}
账号：{{party_b_bank_account}}
签约日期：{{sign_date}}',
 NULL,NULL,160,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
```

- [ ] **Step 2: 本地应用并验证**

```bash
cd packages/api && pnpm db:migrate:local
npx wrangler d1 execute hybcdg-prod-db --local --command "SELECT family, COUNT(*) AS n FROM contract_clause_template GROUP BY family"
npx wrangler d1 execute hybcdg-prod-db --local --command "SELECT COUNT(*) AS n FROM contract_clause_template WHERE family='pipe_jacking' AND section_key IN ('service_notice','deduction_procedure','change_management')"
npx wrangler d1 execute hybcdg-prod-db --local --command "SELECT version FROM contract_clause_template WHERE family='pipe_jacking' AND section_key='payment' AND direction='inbound'"
```
Expected: `pipe_jacking=40`（36+4 新行）、`equipment_lease=19`；三节 COUNT=4（service_notice both / deduction inbound+outbound / change both）；payment inbound version=2。M1 既有草稿数据不受影响（contract_draft 新列默认 pipe_jacking）。

- [ ] **Step 3: 幂等复跑验证**

```bash
npx wrangler d1 execute hybcdg-prod-db --local --file migrations/0065_contract_family_and_clause_v2.sql
```
Expected: **报错**（表重建段的 `ALTER TABLE contract_draft ADD COLUMN` 重复执行会失败）——这是预期的：D1 迁移机制保证单次执行，本迁移**不要求可重跑**（与 0062 同类）。此步只为确认失败模式是"列已存在"而非数据损坏；执行后再查 `SELECT COUNT(*) FROM contract_clause_template` 应仍为 59。

- [ ] **Step 4: Commit**

```bash
git add packages/api/migrations/0065_contract_family_and_clause_v2.sql
git commit -m "feat(api): 条款库v2——合同族支持+顶管族增强+设备租赁族seed（样本驱动）"
```

---

### Task 3: 合同族贯通（types + API + web）

**Files:**
- Modify: `packages/api/src/types/contract-draft.ts`、`packages/api/src/routes/contract-draft.ts`
- Modify: `packages/web/src/api/contract-draft.ts`、`draft/components/DraftInitCard.vue`、`draft/index.vue`、`draft/draft-labels.ts`

- [ ] **Step 1: types/contract-draft.ts 加 family**

在 `draftDirections` 定义之后加：

```ts
export const contractFamilies = ["pipe_jacking", "equipment_lease"] as const;
export type ContractFamily = (typeof contractFamilies)[number];
```

`ContractDraft` 接口加字段 `family: ContractFamily;`（`direction` 之后）；`ContractClauseTemplate` 接口加 `family: ContractFamily;`（`section_key` 之前）。

- [ ] **Step 2: routes/contract-draft.ts family 贯通（4 处）**

(a) import `contractFamilies` 与 `ContractFamily`（并入既有 types/contract-draft import）；加判定函数（`isDirection` 旁）：

```ts
const isFamily = (value: unknown): value is ContractFamily =>
  typeof value === "string" && (contractFamilies as readonly string[]).includes(value);
```

(b) `GET /templates`：接受 `family` query（缺省 `pipe_jacking`，非法值 400），SQL 的 WHERE 加 `family = ?` 条件并 bind。

(c) `POST /`（创建草稿）：解析 `body.family`（缺省 `pipe_jacking`，非法 400）；INSERT contract_draft 列清单加入 `family`；默认节预载 SQL 的 WHERE 加 `family = ?`；默认标题按族：pipe_jacking 沿用现文案，equipment_lease 用 `设备租赁合同（对甲方出租）`/`设备租赁合同（对分包商/供应商承租）`。

(d) `POST /:id/sections`（从条款库加节）与 generate 端点里查 `contract_clause_template` 的两处 SQL：WHERE 都加 `family = ?`（bind `draft.family`）。

- [ ] **Step 3: web api wrapper**

`packages/web/src/api/contract-draft.ts`：
- 加 `export type ContractFamily = "pipe_jacking" | "equipment_lease";`
- `ContractDraft`/`ClauseTemplate` 类型各加 `family` 字段；
- `createDraft` 入参加 `family?: ContractFamily`；`listClauseTemplates(direction, family)` 二参（`{ params: { direction, family } }`）。

- [ ] **Step 4: DraftInitCard.vue 加族选择**

form 加 `family: "pipe_jacking" as ContractFamily`；emit payload 加 family；模板在"合同立场"之前加：

```html
      <el-form-item label="合同类型" required>
        <el-radio-group v-model="form.family">
          <el-radio-button value="pipe_jacking">顶管施工协议</el-radio-button>
          <el-radio-button value="equipment_lease">设备租赁/机械施工</el-radio-button>
        </el-radio-group>
      </el-form-item>
```

设备族说明文案（el-form-item 下方 el-text）：`inbound=我方出租设备/带机施工收款；outbound=我方向外承租付款`。

- [ ] **Step 5: index.vue 贯通**

`onCreate` 透传 family；`loadTemplates` 调 `listClauseTemplates(direction, family)`（draft.family）；页头显示族标签（draft-labels 加 `familyLabelMap = { pipe_jacking: "顶管施工", equipment_lease: "设备租赁/机械施工" }`）。

- [ ] **Step 6: 验证 + Commit**

```bash
cd packages/api && pnpm typecheck && pnpm lint && pnpm test
cd ../web && pnpm typecheck && pnpm test
```
Expected: 全绿（api 779+、web 99+ 不回归）。

```bash
git add packages/api/src/types/contract-draft.ts packages/api/src/routes/contract-draft.ts packages/web/src/api/contract-draft.ts packages/web/src/views/finance/contract/draft/
git commit -m "feat(contract-draft): 合同族贯通（顶管施工/设备租赁双族）"
```

---

### Task 4: 定稿转正式合同（finalize / convert，TDD）

**Files:**
- Create: `packages/api/src/services/contract-draft-finalize.ts` + Test: `packages/api/test/contract-draft-finalize.test.ts`
- Modify: `packages/api/src/routes/contract-draft.ts`（finalize/convert 端点 + regenerate 快照）
- Modify: `packages/web/src/api/contract-draft.ts`、`draft/index.vue`、`draft/draft-labels.ts`
- Create: `packages/web/src/views/finance/contract/draft/components/ConvertDialog.vue`

- [ ] **Step 1: 写失败测试（服务端固化纯函数，逐字）**

```ts
// packages/api/test/contract-draft-finalize.test.ts
import { describe, it, expect } from "vitest";
import {
  buildKeywordValues,
  fillPlaceholders,
  collectUnresolvedKeys
} from "../src/services/contract-draft-finalize";
import type { ContractDraft } from "../src/types/contract-draft";

const draftWith = (over: Partial<ContractDraft>): ContractDraft => ({
  id: 1,
  title: "t",
  direction: "inbound",
  family: "pipe_jacking",
  project_id: 1,
  entity_id: 1,
  counterparty_name: "对方公司",
  counterparty_credit_code: "91110000TEST",
  counterparty_legal_person: "张三",
  counterparty_address: null,
  counterparty_contact: null,
  counterparty_phone: null,
  counterparty_bank_name: null,
  counterparty_bank_account: null,
  keywords_json: JSON.stringify({ amount: "246400", sign_date: "2026-07-22" }),
  status: "drafting",
  completeness_status: null,
  completeness_task_id: null,
  completeness_result_json: null,
  ignored_hints_json: "[]",
  converted_contract_id: null,
  created_by_userid: "u1",
  created_at: "",
  updated_at: "",
  ...over
});

describe("buildKeywordValues", () => {
  it("inbound：对方=甲方、我方主体=乙方，amount_cn 自动生成", () => {
    const values = buildKeywordValues(
      draftWith({}),
      { entity_name: "我方公司", tax_id: "91110000OUR", legal_person: "李四", primary_bank_name: "X银行", primary_bank_account_no: "123" }
    );
    expect(values.party_a).toBe("对方公司");
    expect(values.party_b).toBe("我方公司");
    expect(values.party_a_credit_code).toBe("91110000TEST");
    expect(values.party_b_credit_code).toBe("91110000OUR");
    expect(values.amount).toBe("246400");
    expect(values.amount_cn).toBe("贰拾肆万陆仟肆佰元整");
  });
  it("outbound：我方主体=甲方、对方=乙方", () => {
    const values = buildKeywordValues(
      draftWith({ direction: "outbound" }),
      { entity_name: "我方公司", tax_id: null, legal_person: null, primary_bank_name: null, primary_bank_account_no: null }
    );
    expect(values.party_a).toBe("我方公司");
    expect(values.party_b).toBe("对方公司");
  });
  it("amount 非数字时不生成 amount_cn", () => {
    const values = buildKeywordValues(draftWith({ keywords_json: '{"amount":"面议"}' }), null);
    expect(values.amount_cn).toBeUndefined();
  });
});

describe("fillPlaceholders / collectUnresolvedKeys", () => {
  it("已知键替换、未知键原样保留", () => {
    expect(fillPlaceholders("甲方{{party_a}}与{{unknown}}", { party_a: "A公司" })).toBe("甲方A公司与{{unknown}}");
  });
  it("收集未解析键（去重）", () => {
    expect(collectUnresolvedKeys(["{{a}}和{{b}}", "{{b}}之外"], { a: "x" })).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd packages/api && pnpm test test/contract-draft-finalize.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现（逐字）**

```ts
// packages/api/src/services/contract-draft-finalize.ts
// 定稿固化：服务端关键字表构建（与 web 端 keywordValues 同口径）+ 占位符替换。
// 大写金额由本服务经 toAmountChinese 生成，AI 与前端不生成数字。
import { toAmountChinese } from "./amount-cn";
import type { ContractDraft } from "../types/contract-draft";

export interface OurEntityInfo {
  entity_name: string;
  tax_id: string | null;
  legal_person: string | null;
  primary_bank_name: string | null;
  primary_bank_account_no: string | null;
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

const setIf = (target: Record<string, string>, key: string, value: string | null | undefined): void => {
  if (typeof value === "string" && value.trim().length > 0) {
    target[key] = value.trim();
  }
};

/** 立场映射：inbound=我方乙方（收款），outbound=我方甲方（付款）。 */
export const buildKeywordValues = (
  draft: ContractDraft,
  ourEntity: OurEntityInfo | null
): Record<string, string> => {
  let keywords: Record<string, unknown> = {};
  try {
    keywords = JSON.parse(draft.keywords_json) as Record<string, unknown>;
  } catch {
    keywords = {};
  }
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(keywords)) {
    if (typeof v === "string" && v.trim().length > 0) values[k] = v.trim();
  }

  const our = {
    name: ourEntity?.entity_name ?? "",
    credit: ourEntity?.tax_id ?? "",
    legal: ourEntity?.legal_person ?? "",
    bank: ourEntity?.primary_bank_name ?? "",
    account: ourEntity?.primary_bank_account_no ?? ""
  };
  const cp = {
    name: draft.counterparty_name,
    credit: draft.counterparty_credit_code ?? "",
    legal: draft.counterparty_legal_person ?? "",
    address: draft.counterparty_address ?? "",
    phone: draft.counterparty_phone ?? "",
    bank: draft.counterparty_bank_name ?? "",
    account: draft.counterparty_bank_account ?? ""
  };
  const partyA = draft.direction === "inbound" ? cp : { ...our, address: "", phone: "" };
  const partyB = draft.direction === "inbound" ? { ...our, address: "", phone: "" } : cp;

  setIf(values, "party_a", partyA.name);
  setIf(values, "party_a_credit_code", partyA.credit);
  setIf(values, "party_a_legal_person", partyA.legal);
  setIf(values, "party_a_address", partyA.address);
  setIf(values, "party_a_phone", partyA.phone);
  setIf(values, "party_a_bank_name", partyA.bank);
  setIf(values, "party_a_bank_account", partyA.account);
  setIf(values, "party_b", partyB.name);
  setIf(values, "party_b_credit_code", partyB.credit);
  setIf(values, "party_b_legal_person", partyB.legal);
  setIf(values, "party_b_address", partyB.address);
  setIf(values, "party_b_phone", partyB.phone);
  setIf(values, "party_b_bank_name", partyB.bank);
  setIf(values, "party_b_bank_account", partyB.account);

  const amount = Number(values.amount);
  if (Number.isFinite(amount) && amount > 0) {
    values.amount_cn = toAmountChinese(amount);
  } else {
    delete values.amount_cn;
  }
  return values;
};

export const fillPlaceholders = (text: string, values: Record<string, string>): string =>
  text.replace(PLACEHOLDER_RE, (raw, key: string) => {
    const v = values[key];
    return v && v.length > 0 ? v : raw;
  });

export const collectUnresolvedKeys = (
  texts: string[],
  values: Record<string, string>
): string[] => {
  const unresolved = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      const key = m[1];
      if (!(values[key] && values[key].length > 0)) unresolved.add(key);
    }
  }
  return [...unresolved];
};
```

**实现注意**：`toAmountChinese` 的导出名与返回文案以 `services/amount-cn.ts` 实际为准（先读该文件确认签名与"整"字规则；若 246400 的期望大写与实现产出不一致，**以实现为准修正测试期望值**——该服务是全系统权威，测试只锁"调用了它"）。

- [ ] **Step 4: 测试通过**

```bash
cd packages/api && pnpm test test/contract-draft-finalize.test.ts && pnpm typecheck && pnpm lint
```

- [ ] **Step 5: routes/contract-draft.ts 加 finalize / convert 端点 + regenerate 快照**

(a) import 增补：`buildKeywordValues, collectUnresolvedKeys, fillPlaceholders`（./services/contract-draft-finalize）、`generateSerial`（../services/serial）、`writeAuditLog`（../services/audit-log）。

(b) **regenerate 快照**：generate 端点内、抢占 `ai_status='generating'` 成功之后，插入（关闭 M1 终审"regenerate 静默覆盖"遗留）：

```ts
  if (section.content.trim().length > 0 && section.source !== "default_template") {
    const allSections = await listSections(c.env, draft.id);
    await c.env.DB.prepare(
      `INSERT INTO contract_draft_revision (draft_id, snapshot_json, trigger_action, created_by_userid, created_at)
       VALUES (?, ?, 'regenerate', ?, ?)`
    )
      .bind(draft.id, JSON.stringify({ draft, sections: allSections }), auth.sub, nowIso())
      .run();
  }
```

(c) **POST /:id/finalize**（文件末尾、completeness-ignore 之后追加）：

```ts
contractDraftRoutes.post("/:id/finalize", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  if (!draft.entity_id || !draft.project_id || !draft.counterparty_name.trim()) {
    return c.json(
      { success: false, error: { message: "定稿前需补全：我方主体、关联项目、对方单位" } },
      400
    );
  }
  const sections = await listSections(c.env, draft.id);
  if (!sections.length || sections.every(s => !s.content.trim())) {
    return c.json({ success: false, error: { message: "草稿尚无条款正文" } }, 400);
  }
  const generating = sections.some(s => s.ai_status === "generating" || s.review_status === "generating");
  if (generating) {
    return c.json({ success: false, error: { message: "仍有节在生成/审查中，请稍候" } }, 400);
  }

  const entity = draft.entity_id
    ? await c.env.DB.prepare(
        "SELECT entity_name, tax_id, legal_person, primary_bank_name, primary_bank_account_no FROM entity WHERE id = ?"
      )
        .bind(draft.entity_id)
        .first<{
          entity_name: string;
          tax_id: string | null;
          legal_person: string | null;
          primary_bank_name: string | null;
          primary_bank_account_no: string | null;
        }>()
    : null;
  const values = buildKeywordValues(draft, entity);
  const fixedSections = sections.map(s => ({
    id: s.id,
    section_key: s.section_key,
    title: s.title,
    content: fillPlaceholders(s.content, values)
  }));
  const unresolved = collectUnresolvedKeys(sections.map(s => s.content), values);

  const now = nowIso();
  const claim = await c.env.DB.prepare(
    "UPDATE contract_draft SET status = 'finalized', updated_at = ? WHERE id = ? AND status = 'drafting'"
  )
    .bind(now, draft.id)
    .run();
  if (!claim.meta.changes) {
    return c.json({ success: false, error: { message: "当前状态不可定稿" } }, 409);
  }
  await c.env.DB.prepare(
    `INSERT INTO contract_draft_revision (draft_id, snapshot_json, trigger_action, created_by_userid, created_at)
     VALUES (?, ?, 'finalize', ?, ?)`
  )
    .bind(draft.id, JSON.stringify({ draft, sections: fixedSections, values }), auth.sub, now)
    .run();
  return c.json({
    success: true,
    data: { draft_id: draft.id, fixed_sections: fixedSections, unresolved_keys: unresolved }
  });
});
```

(d) **POST /:id/convert**：

```ts
contractDraftRoutes.post("/:id/convert", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);
  const contractType = typeof body.contract_type === "string" ? body.contract_type.trim().slice(0, 20) : "";
  const fileKey = typeof body.file_key === "string" ? body.file_key : "";
  const fileName = typeof body.file_name === "string" ? body.file_name : "合同草稿.docx";
  const fileSize = typeof body.file_size === "number" ? body.file_size : 0;
  if (!contractType) return c.json({ success: false, error: { message: "缺少合同类型" } }, 400);
  if (!fileKey.startsWith("contract-draft/")) {
    return c.json({ success: false, error: { message: "缺少定稿文档（需先上传 docx）" } }, 400);
  }
  let keywords: Record<string, unknown> = {};
  try {
    keywords = JSON.parse(draft.keywords_json) as Record<string, unknown>;
  } catch {
    keywords = {};
  }
  const totalAmount =
    typeof body.total_amount === "number" ? body.total_amount : Number(keywords.amount);
  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    return c.json({ success: false, error: { message: "合同金额无效：请在关键字 amount 填写数字金额" } }, 400);
  }
  const contractDate =
    typeof body.contract_date === "string" && body.contract_date.trim()
      ? body.contract_date.trim()
      : typeof keywords.sign_date === "string" && keywords.sign_date
        ? keywords.sign_date
        : nowIso().slice(0, 10);

  const now = nowIso();
  const claim = await c.env.DB.prepare(
    "UPDATE contract_draft SET status = 'converted', updated_at = ? WHERE id = ? AND status = 'finalized'"
  )
    .bind(now, draft.id)
    .run();
  if (!claim.meta.changes) {
    return c.json({ success: false, error: { message: "仅定稿状态的草稿可转正式合同" } }, 409);
  }

  try {
    const contractNo = await generateSerial(c.env.DB, "CT", "contract", "contract_no");
    const attachments = [{ file_key: fileKey, file_name: fileName, file_size: fileSize }];
    const insert = await c.env.DB.prepare(
      `INSERT INTO contract
         (contract_no, direction, project_id, entity_id, counterparty, contract_type,
          handler_userid, contract_date, total_amount, status, ai_review_status,
          attachments_json, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'pending', ?, ?, ?, ?)`
    )
      .bind(
        contractNo,
        draft.direction,
        draft.project_id,
        draft.entity_id,
        draft.counterparty_name,
        contractType,
        auth.sub,
        contractDate,
        totalAmount,
        JSON.stringify(attachments),
        `AI起草草稿#${draft.id}转化`,
        now,
        now
      )
      .run();
    const contractId = insert.meta.last_row_id;

    await createTask(c.env, {
      task_type: "contract_review",
      biz_type: "contract",
      biz_id: contractId,
      priority: 3,
      timeout_seconds: 600,
      payload: {
        contract_id: contractId,
        contract_no: contractNo,
        counterparty: draft.counterparty_name,
        contract_type: contractType,
        total_amount: totalAmount,
        attachments
      }
    });
    await c.env.DB.prepare(
      "UPDATE contract_draft SET converted_contract_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(contractId, nowIso(), draft.id)
      .run();
    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "contract_draft.convert",
      targetType: "contract_draft",
      targetId: draft.id,
      detail: { contract_id: contractId, contract_no: contractNo, contract_type: contractType, total_amount: totalAmount }
    });
    return c.json({ success: true, data: { contract_id: contractId, contract_no: contractNo } });
  } catch (err) {
    // 补偿：合同创建失败则回退草稿状态（D1 无事务）
    await c.env.DB.prepare(
      "UPDATE contract_draft SET status = 'finalized', updated_at = ? WHERE id = ? AND status = 'converted' AND converted_contract_id IS NULL"
    )
      .bind(nowIso(), draft.id)
      .run();
    return c.json(
      { success: false, error: { message: err instanceof Error ? err.message : "转化失败，请重试" } },
      500
    );
  }
});
```

**实现注意**：contract 表 `project_id/entity_id/contract_type/handler_userid/contract_date` 均 NOT NULL——finalize 阶段已闸门校验 entity/project；contract_review 的 payload 字段形状与 `routes/contract.ts` 创建合同时的入队完全一致（contract_id/contract_no/counterparty/contract_type/total_amount/attachments）。generateSerial 撞号（UNIQUE 冲突）会 throw → 走 catch 补偿回 finalized，用户重试即可。

- [ ] **Step 6: web 端定稿/转化流程**

(a) `api/contract-draft.ts` 加 wrapper：

```ts
export type FixedSection = { id: number; section_key: string; title: string; content: string };

export async function finalizeDraft(
  id: number
): Promise<{ draft_id: number; fixed_sections: FixedSection[]; unresolved_keys: string[] }> {
  const res = await http.request<{
    success: boolean;
    data: { draft_id: number; fixed_sections: FixedSection[]; unresolved_keys: string[] };
  }>("post", `/api/v1/contract-draft/${id}/finalize`, { data: {} });
  return res.data;
}

export async function convertDraft(
  id: number,
  payload: {
    contract_type: string;
    file_key: string;
    file_name: string;
    file_size: number;
    total_amount?: number;
    contract_date?: string;
  }
): Promise<{ contract_id: number; contract_no: string }> {
  const res = await http.request<{ success: boolean; data: { contract_id: number; contract_no: string } }>(
    "post",
    `/api/v1/contract-draft/${id}/convert`,
    { data: payload }
  );
  return res.data;
}
```

(b) 新建 `components/ConvertDialog.vue`（完整实现）：

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import { convertDraft, finalizeDraft, type ContractDraft, type FixedSection } from "@/api/contract-draft";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { buildDocxBuffer } from "@/views/bidding/dedup/lib/docx-export";

const CONTRACT_TYPE_OPTIONS = ["人工", "机械", "总包", "材料", "其他"];

const props = defineProps<{ visible: boolean; draft: ContractDraft }>();
const emit = defineEmits<{
  (e: "update:visible", v: boolean): void;
  (e: "converted", payload: { contract_id: number; contract_no: string }): void;
}>();

const step = ref<"confirm" | "working">("confirm");
const contractType = ref("机械");
const unresolvedKeys = ref<string[]>([]);
const fixedSections = ref<FixedSection[]>([]);
const finalized = ref(false);

const docxParagraphs = computed(() => {
  const paras: string[] = [props.draft.title];
  for (const s of fixedSections.value) {
    paras.push("");
    paras.push(s.title);
    paras.push(...s.content.split("\n"));
  }
  paras.push("");
  paras.push("【本文档由 AI 辅助起草，须经负责人审核后方可作为正式合同使用】");
  return paras;
});

async function runFinalize(): Promise<boolean> {
  const res = await finalizeDraft(props.draft.id);
  fixedSections.value = res.fixed_sections;
  unresolvedKeys.value = res.unresolved_keys;
  finalized.value = true;
  return true;
}

async function runConvert(): Promise<void> {
  step.value = "working";
  try {
    if (!finalized.value) await runFinalize();
    const buffer = await buildDocxBuffer(docxParagraphs.value);
    const fileName = `${props.draft.title || "合同草稿"}.docx`;
    const signRes = await createUploadSignature({ fileName, category: "contract-draft" });
    const uploadResp = await fetch(resolveUploadUrl(signRes.data.uploadUrl), {
      method: "PUT",
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      body: new Uint8Array(buffer)
    });
    if (!uploadResp.ok) throw new Error(`文档上传失败（HTTP ${uploadResp.status}）`);
    const converted = await convertDraft(props.draft.id, {
      contract_type: contractType.value,
      file_key: signRes.data.key,
      file_name: fileName,
      file_size: buffer.byteLength
    });
    ElMessage.success(`已生成正式合同 ${converted.contract_no}`);
    emit("converted", converted);
    emit("update:visible", false);
  } catch (e: unknown) {
    ElMessage.error(e instanceof Error ? e.message : "转化失败，请重试");
    step.value = "confirm";
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="定稿并转为正式合同"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="v => emit('update:visible', v)"
  >
    <el-alert
      type="warning"
      :closable="false"
      title="定稿后草稿锁定编辑；将固化关键字、生成 docx 并创建正式合同（自动触发 AI 审查），随后请在合同详情页提交审批。"
    />
    <el-form label-width="96px" class="convert-form">
      <el-form-item label="合同类型" required>
        <el-select v-model="contractType" style="width: 100%">
          <el-option v-for="t in CONTRACT_TYPE_OPTIONS" :key="t" :value="t" :label="t" />
        </el-select>
      </el-form-item>
    </el-form>
    <el-alert
      v-if="unresolvedKeys.length"
      type="error"
      :closable="false"
      :title="`仍有未填写的关键字：${unresolvedKeys.join('、')}（导出文档将保留占位符原样）`"
    />
    <template #footer>
      <el-button :disabled="step === 'working'" @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="step === 'working'" @click="runConvert">
        定稿并转正式合同
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.convert-form { margin-top: 12px; }
</style>
```

(c) `index.vue`：toolbar 加按钮（完整性检查按钮旁）`<el-button type="primary" :disabled="draft.status !== 'drafting'" @click="convertVisible = true">定稿转正式合同</el-button>`；引入 ConvertDialog（`v-model:visible="convertVisible"` `:draft="draft"` `@converted="onConverted"`）；

```ts
const convertVisible = ref(false);
const onConverted = (payload: { contract_id: number }) => {
  router.push(`/finance/contract/detail/${payload.contract_id}`);
};
```

草稿非 drafting 态时：SectionCard 操作禁用——给 SectionCard 加 prop `readonly?: boolean`（模板对四个操作按钮和编辑入口加 `:disabled="readonly || ..."`/`v-if="!readonly"`），index.vue 传 `:readonly="draft.status !== 'drafting'"`。

(d) `draft-labels.ts` 加：

```ts
export const draftStatusTagType: Record<string, DraftTagType> = {
  drafting: "info",
  finalized: "warning",
  converted: "success",
  deleted: "info"
};
export const draftStatusLabelMap: Record<string, string> = {
  drafting: "起草中",
  finalized: "已定稿",
  converted: "已转正式合同",
  deleted: "已删除"
};
```
index.vue 页头展示状态标签；converted 态额外给出跳转正式合同的链接按钮（converted_contract_id）。

- [ ] **Step 7: 验证 + Commit**

```bash
cd packages/api && pnpm typecheck && pnpm lint && pnpm test
cd ../web && pnpm typecheck && pnpm test
```
Expected: 全绿。

```bash
git add packages/api/src/services/contract-draft-finalize.ts packages/api/test/contract-draft-finalize.test.ts packages/api/src/routes/contract-draft.ts packages/web/src/api/contract-draft.ts packages/web/src/views/finance/contract/draft/
git commit -m "feat(contract-draft): 定稿固化+转正式合同闭环（docx上传/AI审查/审批衔接）"
```

---

### Task 5: 生成文档签名访问（contract-draft/ 前缀三模式鉴权）

**Files:**
- Modify: `packages/api/src/routes/upload.ts`（GET /object 前缀鉴权 + POST /sign-download）
- Modify: `packages/web/src/api/upload.ts`（signDownloadUrl）+ `packages/web/src/views/finance/contract/detail.vue`（附件打开改签名流）
- Modify: `task-runner/runner/executor.py`（下载带 x-api-key）

背景：`GET /upload/object/:key` 现状完全无鉴权。M2 仅对 `contract-draft/` 前缀（AI 生成的合同文书）强制鉴权，三模式任一放行：① HMAC 签名 query（`expires`+`signature`，签发用现有 `signObjectAccess`）；② `Authorization: Bearer` 有效 JWT（miniapp 已带）；③ `x-api-key` = `TASK_API_KEY`（runner 读附件）。其余前缀行为不变（全量收紧记入 M3 待办）。

- [ ] **Step 1: upload.ts GET /object 加前缀鉴权**

先读 `packages/api/src/routes/upload.ts` 全文与 `services/upload-signature.ts`，确认既有验签写法（PUT /object 的验签段可参照）。在 GET handler 解出 `key` 之后、`FILES.get` 之前插入：

```ts
  if (key.startsWith("contract-draft/")) {
    const expires = Number(c.req.query("expires") ?? 0);
    const signature = c.req.query("signature") ?? "";
    let allowed = false;
    if (expires > Math.floor(Date.now() / 1000) && signature) {
      const expected = await signObjectAccess(c.env.UPLOAD_SIGNING_SECRET, key, expires);
      allowed = expected === signature;
    }
    if (!allowed) {
      const apiKey = c.req.header("x-api-key");
      if (apiKey && apiKey === c.env.TASK_API_KEY) allowed = true;
    }
    if (!allowed) {
      const authz = c.req.header("authorization") ?? "";
      const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
      if (token) {
        try {
          await verify(token, c.env.JWT_SECRET, "HS256");
          allowed = true;
        } catch {
          allowed = false;
        }
      }
    }
    if (!allowed) {
      return c.json({ success: false, error: { message: "该文件需要授权访问" } }, 401);
    }
  }
```

顶部 import：`verify` 来自 `hono/jwt`（与 services/auth.ts 同源写法）；`signObjectAccess` 已在本文件 import 过则复用。`expires` 语义与既有签名工具保持一致（读 `signObjectAccess`/`buildSignedObjectUrl` 确认是秒级时间戳；若为毫秒，比较基准相应调整——以现有实现为准，不要双标准）。

- [ ] **Step 2: upload.ts 加 POST /sign-download（JWT 保护）**

参照本文件既有 `POST /sign`（L~35）的结构，在其后新增：

```ts
uploadRoutes.post("/sign-download", authMiddleware, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key : "";
  if (!key) return c.json({ success: false, error: { message: "缺少 key" } }, 400);
  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
  const signature = await signObjectAccess(c.env.UPLOAD_SIGNING_SECRET, key, expiresAt);
  return c.json({
    success: true,
    data: { url: buildSignedObjectUrl(key, expiresAt, signature, getUploadBaseUrl(c.env, c.req.url)) }
  });
});
```

（`authMiddleware`/`buildSignedObjectUrl`/`getUploadBaseUrl` 均为该文件或其 import 里已有设施；若 GET /object 路由挂载早于本端点导致 `:key{.+}` 吞掉 `sign-download` 路径，将本端点**注册在 GET /object 之前**。expiresAt 单位随 Step 1 的确认结论对齐。）

- [ ] **Step 3: web 签名流**

(a) `api/upload.ts` 加：

```ts
export const signDownloadUrl = (key: string) => {
  return http.request<{ success: boolean; data: { url: string } }>(
    "post",
    "/api/v1/upload/sign-download",
    { data: { key } }
  );
};
```

(b) `views/finance/contract/detail.vue`：现有 `fileUrl(fileKey)`（L~334，同步拼 URL）保留；附件表格两处 `:href="fileUrl(scope.row.file_key)"`（L~844/851）改为 click 事件：

```html
<el-link type="primary" @click="openAttachment(scope.row.file_key)">预览</el-link>
```

script 加：

```ts
const openAttachment = async (fileKey: string) => {
  try {
    const res = await signDownloadUrl(fileKey);
    window.open(resolveUploadUrl(res.data.url), "_blank");
  } catch {
    window.open(fileUrl(fileKey), "_blank");
  }
};
```

（catch 回退裸链接：非保护前缀文件在签名端点异常时不受影响。两处链接分别是预览/下载的话，下载处同样改造并保留 `download` 语义可用 `window.open`。）

- [ ] **Step 4: runner 下载带 x-api-key**

`task-runner/runner/executor.py` 的 `_download_attachment` 中 `httpx.get(url, timeout=25.0, follow_redirects=True)` 改为带头：先 grep 本文件/poller 现有 API 调用如何携带密钥（`x-api-key` 头及配置字段名，通常 `self.config.api_key` 或 `settings.api_key`），复用同一来源：

```python
response = httpx.get(url, timeout=25.0, follow_redirects=True, headers={"x-api-key": self._api_key()})
```

（`self._api_key()` 按仓库实际配置访问方式实现/内联；无配置时传空串——非保护前缀不受影响。）

- [ ] **Step 5: 验证 + Commit**

```bash
cd packages/api && pnpm typecheck && pnpm lint && pnpm test
cd ../web && pnpm typecheck && pnpm test
cd ../../task-runner && python3 -m py_compile runner/executor.py
```
Expected: 全绿；py_compile 无输出。

```bash
git add packages/api/src/routes/upload.ts packages/web/src/api/upload.ts packages/web/src/views/finance/contract/detail.vue task-runner/runner/executor.py
git commit -m "feat(upload): contract-draft前缀三模式签名访问+sign-download端点+runner鉴权头"
```

---

### Task 6: 端到端验证 + 文档同步

- [ ] **Step 1: 全量静态检查**（api typecheck/lint/test、web typecheck/test、改动 web/api 文件 prettier check——M1 教训：byte-exact 抽取后必须对新改文件跑 prettier --check，不齐则 --write 后复验）

- [ ] **Step 2: 本地端到端（MOCK）**：起 api+web dev；验证清单：
1. 新建草稿出现「合同类型」族选择；equipment_lease + inbound 预载节含 计费与停滞补偿/操作人员/设备损坏丢失/发票品目 等设备族节；
2. 顶管族 payment(inbound) 生成后正文含「不以…第三方…付款为前提」兜底句（默认模板 v2 生效）；
3. 规则层 v2：手工把某节内容改为「劳务款支付以建设方拨付的工程进度款为依据。」保存 → 红色高亮出现（规则层在 PUT 保存时重跑）；
4. 定稿转化全流程：填齐 entity/project/对方/amount → 定稿转正式合同 → 跳转合同详情页，合同号 CT-*、附件为 docx、ai_review_status=pending（本地 mock contract_review 由 runner 处理，本地无 runner 时任务停 pending 属预期——验证入队即可：task_queue 有 contract_review 行）；
5. 草稿页 converted 态：节操作禁用、显示已转合同链接；
6. 签名访问：`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/api/v1/upload/object/contract-draft%2F<真实key>` 无凭证 → 401；带 sign-download 签出的 URL → 200；带 `x-api-key: <本地TASK_API_KEY>` → 200；旧前缀（contract/…）无凭证仍 200（行为不变）；
7. 合同详情页附件「预览/下载」经签名 URL 正常打开。

- [ ] **Step 3: 文档同步**：`doc/开发计划.md` Phase 24 的 M2 勾选并按实际范围改写（无 PDF、含样本挖掘/合同族）；`doc/开发记录.md` append M2 条目（要点：样本挖掘 5 份→规则 v2 十类新模式、合同族+设备租赁族 19 节、定稿转化闭环、contract-draft/ 三模式签名访问、runner 下载鉴权头；遗留：其余前缀收紧 M3、扫描件 OCR 补样本、管理层校准双族条款）；`docs/superpowers/specs/2026-07-22-contract-generation-design.md` 增补一行 M2 范围修订注记（不做 PDF）。

- [ ] **Step 4: 收尾 Commit**

```bash
git add doc/开发计划.md doc/开发记录.md docs/superpowers/specs/2026-07-22-contract-generation-design.md
git commit -m "docs: AI合同起草M2文档同步"
```

---

## 发布清单（M2 合入 main 时执行）
1. 生产迁移 `npx wrangler d1 migrations apply hybcdg-prod-db --remote`（0065）；
2. push main 自动部署；健康检查 ok=true；
3. 生产冒烟：真实模型生成一节（核对 env.AI.run 响应契约——M1 遗留必做项）+ 定稿转化一单 + contract-draft/ 无凭证 401；
4. task-runner 重新部署（executor.py 改动）——Docker 节点 `docker-compose up -d --build`。

## Self-Review 结论（计划作者自查）
- 样本发现（findings §四/§五）逐条映射：规则 v2 十类 → Task 1；族+设备族+顶管增强 → Task 2；含操作人员标注/窝工保底/品目勾选 → 0065 设备族 seed 文本。
- M1 终审遗留闭环：regenerate 快照（Task 4 Step 5b）、/upload/object 鉴权（Task 5，范围=contract-draft/ 前缀）。
- 类型一致性：`FixedSection` 前后端一致；`family` 三处（types/api/web）同名同值；convert 的 contract INSERT 列与生产 contract 表 NOT NULL 列逐一对齐（contract_no/direction/project_id/entity_id/counterparty/contract_type/handler_userid/contract_date/total_amount/status/ai_review_status/attachments_json/remark/created_at/updated_at）。
- 已知取舍：docx 为纯文本段落版式（无原版式，M1 spec 既定取舍）；`GET /object` 全量收紧、草稿列表页、dict 驱动合同类型选项 → M3 待办。

