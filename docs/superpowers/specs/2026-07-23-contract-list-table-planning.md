# 合同清单表格支持 — 规划方案（待 owner 拍板）

- 日期：2026-07-23
- 背景：owner 指出设备租赁/材料购销合同的"设备清单/材料清单"是表格结构，需调研历史合同后规划。
- 调研依据：样本挖掘报告、条款库 seed 的 style_ref（团队从生产样本逐字提取的列名）、现有数据模型与 docx 能力。

## 现状结论

清单目前是"文字提及、附件外置"——`equipment_schedule`/`goods_spec` 节正文写"以《设备清单》/《供货清单》为准，逐台/逐项载明…"，但那张表的**真实行数据在系统里没有结构化落点**。这正是样本事故的温床（同一合同两处大写金额矛盾、7 处关键条款留白）。

## 设备清单列结构（湿租）

序号(算) · 部位/作业区域 · 设备名称(必填) · 规格型号(必填) · 工作内容-绑定工序(湿租必填/干租隐藏) · 计价单位台班或月(必填枚举) · 数量/工程量暂定(必填) · 含税单价(必填) · 含税金额(=数量×单价,算) · **是否含操作人员(湿租必填枚举,最强调字段)** · 税率%(默认,与发票品目联动) · 备注

**干租变体**：删掉"工作内容"与"是否含操作人员"两列。列差异由 variant_key 驱动，不硬编码。

## 材料清单列结构

序号(算) · 货物名称(必填) · 规格型号/材质(必填) · 单位(必填枚举) · 数量暂定(必填) · 含税单价-含包装运杂到场价(必填) · 含税金额(算) · 税率%(默认13) · 交货期(可选) · 质量标准(默认表级) · 备注

## 推荐方案 C：table_json + `{{__table__}}` 占位符 + 定稿 docx 渲染真表格

- **DB**：`contract_draft_section` 加 `table_json TEXT`（nullable，仅 equipment_schedule/goods_spec 用）。
- **正文**：对应节 body_template 放哨兵 `{{__table__}}` 标记表格插入位置，条款文字在表前后。
- **table_json 形状**：`{preset: equipment_wet|equipment_dry|goods, columns:[列schema快照], rows:[...], summary:{amount_total}}`（固定预设列，不做自由列，才能自动算/校验/渲染/喂 AI）。
- **落地陷阱（必处理）**：finalize 的 `fillPlaceholders`/`collectUnresolvedKeys` 用 `\{\{(\w+)\}\}`，`__table__` 会被误吞——必须特判跳过，否则定稿恒报"未解析关键字 __table__"。
- **金额权威**：合计行由行求和只读；定稿校验 sum(rows.amount) 与 `{{amount}}` 一致（不一致高亮）；大写仍后端 amount-cn 权威。

**方案对比**：A 纯文字（现状，无结构化/不能算/docx 无真表）✗；B 附件 Excel（脱离系统、AI 看不到、金额与正文割裂——正是"附件与正文金额不符"事故源）✗；**C 推荐**（结构化+可算+可校验+内联 docx+AI 可读+纳入版本快照）。

## UI

SectionCard 检测 section_key ∈ {equipment_schedule, goods_spec} → 在 `{{__table__}}` 位渲染 `TableEditor.vue`（el-table 可编辑行+加删行+拖拽+含税金额只读自动算+合计行+"合计 vs 合同总价"一致性徽标）。列集由 preset 决定（湿租显示 工作内容/operator，干租隐藏）。税率默认按发票品目联动。定稿后只读。miniapp（M3）改卡片式行编辑，不照搬宽表。

## AI 交互

- 喂 AI：table_json → markdown 表格注入 prompt 上下文（复用 current_content 机制）。
- **AI 不生成数字**（守铁律）：只生成/润色表格周围条款文字 + **审查表格自洽性**（operator 标注 vs 发票品目/税率是否矛盾=名租实工税务风险、单位合法性、合计=总价、湿租漏填 operator）。
- 进阶可选：AI 从用户粘贴的报价文本抽取成行（先正则后 LLM 兜底，需用户确认）。

## 落地优先级与工作量

**MVP（手工填表 + docx 渲染，独立可用）**：迁移加 table_json(S) + 后端 finalize/collectUnresolvedKeys 特判 __table__ + 类型(S–M) + 前端 TableEditor + table-presets 三预设 + SectionCard 集成 + **docx builder 升级为 Table 渲染**(M–L) + 合计一致性校验(S) + 测试(S–M)。
**进阶**：table→markdown 喂 AI + 合规审查读表(M)；AI 抽取行(M–L)；miniapp(L)。

**风险**：① __table__ 被 \w+ 误吞（必排除）；② 合计联动保持后端 amount-cn 权威（web/api 双实现同步）；③ docx 中文字体+宽表 A4 宽度（可能需横向/缩字号）；④ 干湿租列差异由 variant 驱动；⑤ 是给既有节补表格，非新建族，改动面收敛。

## 待 owner 决策

1. 是否按方案 C 做（table_json + docx 真表格）？
2. 先做 MVP（手工填表+docx渲染），还是一步到位含 AI 审表？
3. 设备清单湿租 operator 列强制——认可否？
