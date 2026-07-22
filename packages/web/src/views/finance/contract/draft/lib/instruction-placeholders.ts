// lib/instruction-placeholders.ts — 逐节个性化指令占位符示例（按 section_key 给出贴近该节业务的改写示范）。
const MAP: Record<string, string> = {
  payment: "例：改为月度计量60%，验收后90日内付清尾款，逾期按日万分之五",
  quantity_pricing: "例：单价改为4800元/米，超挖部分另行签证计价",
  duration: "例：工期压缩至45天，顺延事由增加雨季停工",
  quality_acceptance: "例：验收期改为3日，增加甲方逾期不验收视为合格",
  breach: "例：双向违约金上限调整为合同价的8%",
  geology_risk: "例：增加流砂层处置费用由甲方承担的表述",
  claim_visa: "例：签证提交时限放宽到14日，逾期不答复视为认可",
  dispute: "例：管辖改为北京仲裁委员会仲裁",
  farmer_wage: "例：明确按月10日前代发并附银行回单",
  equipment_schedule: "例：增加一台25T汽车吊，台班价3200元含操作人员",
  billing_idle: "例：停滞费改为800元/台·日，连续停滞7日可撤场",
  operator_duty: "例：明确夜间作业加班费由承租方另计",
  damage_loss: "例：增加设备被盗按重置价80%赔偿",
  scope_content: "例：作业范围增加管内清淤，单价另计",
  personnel: "例：人数上调至30人，电焊工须持证并报备名册",
  goods_spec: "例：质量标准明确为GB/T 11836-2023",
  delivery: "例：分三批交货，每批间隔15日，运费卖方承担",
  acceptance: "例：隐蔽缺陷异议期延长到发现后30日",
  quality_warranty: "例：质保期延长至24个月",
  idle_compensation: "例：窝工费改为350元/人·日",
  safety: "例：增加高处作业专项防护要求",
  invoice_tax: "例：改为13%专票，发票随货同行"
};
export const instructionPlaceholder = (sectionKey: string): string =>
  MAP[sectionKey] ?? "个性化指令（可选）：直接描述你想怎么改这一节";
