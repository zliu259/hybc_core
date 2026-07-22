-- 0066_contract_family_v3_variants.sql
-- ① contract_clause_template 表重建 v3：加 variant_key/variant_label，唯一约束 (family, section_key, direction, variant_key)
-- ② 新增 labor_service（劳务分包）与 materials_sale（材料购销）两族（均双向，初稿待管理层校准）
-- ③ 既有两族补充真实模版变体（证明多变体机制）
-- ④ contract_draft_section 记录 variant_key；⑤ 起草提示词 v2（修改类注入现有正文）
-- 样本依据：docs/superpowers/specs/2026-07-22-contract-sample-findings.md

CREATE TABLE IF NOT EXISTS contract_clause_template_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  family TEXT NOT NULL DEFAULT 'pipe_jacking',
  section_key TEXT NOT NULL,
  direction TEXT NOT NULL,
  variant_key TEXT NOT NULL DEFAULT 'default',
  variant_label TEXT NOT NULL DEFAULT '默认',
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
  UNIQUE(family, section_key, direction, variant_key)
);
INSERT INTO contract_clause_template_v3
  (id, family, section_key, direction, variant_key, variant_label, required_level, title, body_template, style_ref, risk_notes, sort_order, version, status, created_at, updated_at)
SELECT id, family, section_key, direction, 'default', '默认', required_level, title, body_template, style_ref, risk_notes, sort_order, version, status, created_at, updated_at
  FROM contract_clause_template;
DROP TABLE contract_clause_template;
ALTER TABLE contract_clause_template_v3 RENAME TO contract_clause_template;
CREATE INDEX IF NOT EXISTS idx_contract_clause_template_direction ON contract_clause_template(direction);
CREATE INDEX IF NOT EXISTS idx_contract_clause_template_family ON contract_clause_template(family);

ALTER TABLE contract_draft_section ADD COLUMN variant_key TEXT NOT NULL DEFAULT 'default';

-- ── ② labor_service 族（inbound=我方劳务承包人收款；outbound=我方发包给劳务队付款） ──
INSERT OR IGNORE INTO contract_clause_template
  (family, section_key, direction, variant_key, variant_label, required_level, title, body_template, style_ref, risk_notes, sort_order, version, status, created_at, updated_at)
VALUES
('labor_service','parties_basis','both','default','默认','core','首部与签约依据',
 '甲方（发包人）：{{party_a}}，统一社会信用代码：{{party_a_credit_code}}。
乙方（劳务承包人）：{{party_b}}，统一社会信用代码：{{party_b_credit_code}}。
根据《中华人民共和国民法典》《中华人民共和国建筑法》《保障农民工工资支付条例》及相关规定，双方就{{project_name}}劳务作业事宜订立本合同。',
 NULL,'劳务分包合同法定依据需含建筑法与农民工工资条例。',10,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','scope_content','both','default','默认','core','劳务作业范围与内容',
 '劳务作业范围：{{work_scope}}。作业内容以双方确认的作业清单/图纸为准；甲方指令增加的作业内容按签证程序另行计价。乙方仅提供劳务作业，不承包主要材料。',
 NULL,'清包工模式边界：范围清单化，防"顺手活"无偿扩张。',20,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','quantity_pricing','both','default','默认','core','计价方式与合同价款',
 '本合同按清包工综合单价计价：{{unit_price_desc}}。合同暂估总价人民币{{amount}}元（大写：{{amount_cn}}），最终以双方现场计量确认的实际完成作业量×综合单价据实结算。综合单价已含工资、加班费、劳保、工具及税费，除签证变更外不作调整。',
 '根据清包工的承包形式，以约定综合单价形式办理结算。',NULL,30,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','duration','both','default','默认','core','作业期限',
 '计划作业期限自{{start_date}}起至{{end_date}}止，共{{total_days}}日历天；天数与日期不一致时以日历天数为准。因甲方原因、设计变更或不可抗力停工的，工期相应顺延并以双方签认为准。',
 '天数与日期不一致时以天数为准。',NULL,40,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','personnel','both','default','默认','core','劳务人员与实名制',
 '乙方投入劳务人员约{{worker_count}}人，均应年满16周岁且身体健康，特种作业人员持证上岗。双方按规定落实实名制管理：进出场登记、考勤记录，《工资表》《考勤表》按月由双方确认留存备查（至少保存两年）。人员信息仅用于本项目合规管理，不得挪作他用。',
 '实名制三表体系（工资表/考勤表/周统计表）+至少保存二年备查。',
 '实名制三表源自样本机构模版（合规级流程）；个人信息最小化条款为我方补充。',50,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','materials_tools','both','default','默认','recommended','材料与机具供应',
 '甲方提供：{{party_a_supplies}}。乙方自备：一般作业工具及{{party_b_supplies}}。甲供材料由双方共同清点签认，乙方妥善保管、合理使用；材料实际损耗超过双方约定控制率的，超出部分费用由乙方承担（不另加收罚金）。',
 '材料损耗率控制表：分品类设上限、结算时核对。',
 '损耗率表结构源自样本，但去掉了"另加5%罚金"的双重处罚。',60,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','payment','inbound','default','默认','core','劳务费结算与支付',
 '双方于每月{{measure_day}}日计量确认当月完成作业量，甲方于次月{{monthly_pay_day}}日前支付经确认劳务费的{{progress_ratio}}%。甲方的付款义务不以其收到任何第三方（含建设单位）款项为前提，最迟应于计量确认后{{max_pay_days}}日内付清当期款项。如约定质保金的，比例不超过结算总额的3%，且不得从涉及农民工工资的部分中扣留；缺陷责任期满后{{warranty_refund_days}}日内无息退还。甲方逾期付款的，每逾期一日按未付金额的{{late_fee_rate}}支付违约金。',
 NULL,
 'inbound 三道防线：背靠背兜底期限、质保金≤3%且不碰工资部分（对照样本20%质保金+背靠背的凶险组合）、逾期违约金对等。',70,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','payment','outbound','default','默认','core','劳务费结算与支付',
 '双方于每月{{measure_day}}日计量确认当月完成作业量；乙方按约提交考勤与工资发放凭证后，甲方于次月{{monthly_pay_day}}日前支付经确认劳务费的{{progress_ratio}}%；作业完成经验收合格且乙方结清农民工工资并提交凭证后{{settle_days}}日内结清尾款。甲方对乙方的任何扣款应书面通知并附依据，乙方有{{objection_days}}个工作日异议期。',
 NULL,'outbound：工资凭证前置是合法且必要的支付条件；扣款程序化。',70,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','farmer_wage','both','default','默认','core','农民工工资支付',
 '乙方依法按月足额支付农民工工资，落实实名制与工资专用账户相关规定，并按甲方要求提供支付凭证。因乙方拖欠农民工工资导致甲方被责令代付或垫付的，甲方有权自应付乙方款项中等额扣除并追偿；由此产生的行政处罚损失由责任方承担。任何情况下，涉及农民工工资的款项不适用付款前提、抵扣及质保金扣留安排。',
 '《北京市工程建设领域农民工工资保证金管理办法》具名引用式写法。',
 '“工资款不适用背靠背/抵扣”是从样本合规观察反推的我方标准条款；异地项目引用属地文件号。',80,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','idle_compensation','inbound','default','默认','recommended','窝工与停工',
 '因甲方原因（作业面不具备、甲供材料不到位、指令等待等）造成乙方窝工的，乙方应于当日书面报告，经双方签认后按{{idle_labor_fee}}元/人·日计取窝工费，随当期劳务费支付；连续停工超过{{max_idle_days}}日的，乙方有权要求撤场结算。',
 NULL,'对照样本"仅赔窝工费且不再支付任何违约金"的空转条款，费率与程序必须落实。',90,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','safety','both','default','默认','core','安全生产与文明施工',
 '甲方作为现场统一管理方依法履行安全管理与交底义务；乙方遵守现场安全规定，落实劳保穿戴与班前教育，接受检查并按期整改。双方按各自过错承担安全责任，任何一方不得以合同约定免除法定安全义务。乙方为其人员投保工伤保险或团体意外伤害保险。',
 NULL,'对照样本"事故责任主体固定为承包人"的无效倾向条款，按过错分担+法定义务不可让渡。',100,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','breach','both','default','默认','core','违约责任',
 '乙方无正当理由逾期完成作业的，每逾期一日按合同暂估总价的{{delay_penalty_rate}}向甲方支付违约金，累计不超过总价的{{penalty_cap}}%；甲方逾期支付经确认劳务费的，每逾期一日按未付金额的{{late_fee_rate}}向乙方支付违约金，同样不设不对称封顶。一方违约造成对方损失超过违约金的，可就不足部分继续主张。',
 NULL,'双向对等+封顶（对照样本"乙方多档不封顶 vs 甲方零违约金"）。',110,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','deduction_procedure','inbound','default','默认','recommended','扣款与异议程序',
 '甲方对乙方主张任何扣款、罚款的，应于扣减前{{deduction_notice_days}}个工作日书面通知并附计算依据与凭证；乙方有{{objection_days}}个工作日异议期，异议期内争议部分暂不扣减。未经上述程序的单方扣减，乙方有权要求返还。',
 NULL,'对照样本单份合同7处无程序扣款权。',120,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','service_notice','both','default','默认','recommended','送达条款',
 '双方确认本合同载明地址为有效送达地址，适用于非诉通知及争议解决全部阶段司法文书送达；地址变更应于{{notice_days}}日内书面通知，未通知的原地址仍视为有效；邮寄交邮后第三日视为送达。',
 NULL,NULL,130,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','dispute','both','default','默认','core','争议解决',
 '因本合同发生的争议，双方应友好协商解决；协商不成的，任何一方均有权向{{dispute_venue}}人民法院提起诉讼。',
 NULL,'inbound 避免约定对方注册地单边管辖。',140,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','misc_effective','both','default','默认','core','其他与生效',
 '本合同自双方盖章并经法定代表人或授权代理人签字之日起生效；合同生效不以任何一方缴纳保证金为前提。未尽事宜另签补充协议，与本合同同等效力。本合同一式{{copies}}份，甲方执{{party_a_copies}}份，乙方执{{party_b_copies}}份。任何空白栏目应在用印前填写完整，留白视为对相应事项未作约定。',
 NULL,'“生效不以保证金到账为前提”对照样本生效条款内部矛盾风险。',150,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('labor_service','signature_block','both','default','默认','core','落款',
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

-- ── materials_sale 族（inbound=我方卖方收款；outbound=我方买方付款） ──
INSERT OR IGNORE INTO contract_clause_template
  (family, section_key, direction, variant_key, variant_label, required_level, title, body_template, style_ref, risk_notes, sort_order, version, status, created_at, updated_at)
VALUES
('materials_sale','parties_basis','both','default','默认','core','首部与签约依据',
 '甲方（买方）：{{party_a}}，统一社会信用代码：{{party_a_credit_code}}。
乙方（卖方）：{{party_b}}，统一社会信用代码：{{party_b_credit_code}}。
根据《中华人民共和国民法典》买卖合同章及相关规定，双方就{{project_name}}所需{{goods_name}}购销事宜订立本合同。',
 NULL,'材料族固定甲方=买方、乙方=卖方；inbound 我方卖方，outbound 我方买方。',10,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','goods_spec','outbound','default','默认','core','标的、数量与质量标准',
 '货物名称、规格型号、数量、单价以《供货清单》为准。质量标准执行现行国家标准/行业标准{{quality_standard}}及双方确认的技术要求/图纸；无相应标准的，按双方书面封样为准。卖方保证货物为全新合格产品，权属清晰。',
 NULL,'outbound（我方采购）：质量标准必须外部化（国标/行标/封样），拒绝"以卖方说明书为准"的自证条款。',20,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','goods_spec','inbound','default','默认','core','标的、数量与质量标准',
 '货物名称、规格型号、数量、单价以双方确认的《供货清单》为准。质量标准按产品出厂标准及双方确认的技术参数执行；买方对特殊用途或更高标准有要求的，应在下单前书面明确并经卖方确认。',
 NULL,'inbound（我方销售）：质量承诺锚定出厂标准+书面确认的参数，防事后加码。',20,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','delivery','both','default','默认','core','交货与风险转移',
 '交货时间：{{delivery_date}}；交货地点：{{delivery_place}}；运输方式及费用承担：{{freight_bearer}}。货物毁损灭失风险自{{risk_transfer_point}}起由卖方转移至买方。卖方逾期交货的，每逾期一日按逾期部分货款的{{delay_penalty_rate}}向买方支付违约金。',
 NULL,'风险转移点必须显式约定（样本合同缺失导致物流扯皮）；单设逾期交付日违约金（样本缺失）。',30,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','acceptance','outbound','default','默认','core','验收与质量异议',
 '货物到达交货地点后，买方应于{{acceptance_days}}日内按约定标准验收外观与数量并签收。质量异议：表面瑕疵于验收期内提出；隐蔽缺陷自发现之日起{{hidden_defect_days}}日内提出，但最迟不超过质保期届满。异议经查证属实的，卖方应在{{replace_days}}日内无偿修理、更换或退货退款。',
 NULL,'outbound：隐蔽缺陷延伸异议期，对照样本"15个工作日逾期视为合格"的短窗锁死。',40,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','acceptance','inbound','default','默认','core','验收与质量异议',
 '货物到达交货地点后，买方应于{{acceptance_days}}日内验收并签收；逾期未提出书面异议的，视为货物数量与外观质量符合约定。质量异议应附具体证据，经双方或有资质第三方检验确认属实的，卖方负责修理、更换；检验费用由责任方承担。',
 NULL,'inbound：合理短异议期+逾期视为合格+第三方检验分担，平衡但保卖方确定性。',40,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','payment','outbound','default','默认','core','货款支付',
 '货款按节点分段支付：合同签订后{{advance_ratio}}%预付；货物到达并验收合格后{{delivery_ratio}}%；预留{{warranty_ratio}}%作为质保金，质保期满无质量问题后{{warranty_refund_days}}日内付清。卖方开具与实际交易一致的合规发票后，买方按上述节点付款。',
 NULL,'outbound：摆脱"付款发货"全款预付（样本坑），分段支付+质保尾款。',50,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','payment','inbound','default','默认','core','货款支付',
 '付款方式：{{payment_mode}}。买方逾期付款的，每逾期一日按未付金额的{{late_fee_rate}}向卖方支付违约金；累计逾期超过{{max_overdue_days}}日的，卖方有权暂停后续供货并要求结清全部到期款项。',
 NULL,'inbound：账期+逾期利息+暂停供货权；具体首选先款后货或短账期由业务谈判定。',50,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','ownership','inbound','default','默认','recommended','所有权保留',
 '买方付清全部货款前，货物所有权仍归卖方；买方在此之前不得转卖、抵押或以其他方式处分货物。买方逾期付款经催告仍不支付的，卖方有权取回货物，由此产生的费用由买方承担。',
 '所有权保留（付清货款前所有权归卖方）。','inbound 专属：源自样本卖方模版的合理条款，我方销售时直接采用。',60,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','quality_warranty','outbound','default','默认','core','质量保证与责任',
 '质保期{{warranty_months}}个月，自验收合格之日起算。质保期内因货物质量缺陷造成的损失，卖方承担修理、更换、退货责任，并赔偿因此给买方造成的合理直接损失（含拆装、返工费用），不以货物价值为限。',
 NULL,'outbound：质量责任不封顶于货值（样本"限产品价值范围"是买方最大坑——小额材料引发大额返工时责任错配）。',70,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','quality_warranty','inbound','default','默认','core','质量保证与责任',
 '质保期{{warranty_months}}个月，自验收合格之日起算。质保期内经确认属货物本身质量缺陷的，卖方负责修理或更换；卖方的赔偿责任以买方实际直接损失为限，且双方可约定赔偿上限为{{liability_cap}}。因保管不当、超范围使用或安装不当造成的损坏不属质保范围。',
 NULL,'inbound：责任限于直接损失+可约定上限+排除误用，保卖方风险可控。',70,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','invoice_tax','both','default','默认','core','发票与税务',
 '卖方向买方开具税率{{tax_rate}}%的增值税{{invoice_type}}发票，品目与货物实际交易一致，三流一致；发票随货或于交货后{{invoice_days}}日内送达。',
 NULL,NULL,80,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','breach','both','default','默认','core','违约责任',
 '除本合同已单独约定的逾期交付、逾期付款违约金外，一方根本违约致合同目的不能实现的，守约方有权解除合同并要求违约方赔偿实际损失。违约金不足以弥补实际损失的，可就不足部分继续主张。',
 NULL,'对照样本"任一方违约按总价20%"的一刀切，改为分项违约金+根本违约解除。',90,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','dispute','both','default','默认','core','争议解决',
 '因本合同发生的争议，双方应友好协商解决；协商不成的，任何一方均有权向{{dispute_venue}}人民法院提起诉讼。',
 '向"起诉方所在地"法院起诉（原告就地，双方对等）。','样本中"原告就地"是少见的对等管辖写法，可作 {{dispute_venue}} 的备选口径。',100,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','misc_effective','both','default','默认','core','其他与生效',
 '本合同自双方签字或盖章之日起生效。未尽事宜另签补充协议，与本合同同等效力。本合同一式{{copies}}份，双方各执{{party_a_copies}}份，传真件、扫描件与原件具有同等效力；合同内容涂改无效，任何空白栏目应在签署前填写完整。',
 NULL,NULL,110,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('materials_sale','signature_block','both','default','默认','core','落款',
 '甲方（盖章）：{{party_a}}
统一社会信用代码：{{party_a_credit_code}}
开户银行：{{party_a_bank_name}}
账号：{{party_a_bank_account}}
签约日期：{{sign_date}}

乙方（盖章）：{{party_b}}
统一社会信用代码：{{party_b_credit_code}}
开户银行：{{party_b_bank_name}}
账号：{{party_b_bank_account}}
签约日期：{{sign_date}}',
 NULL,NULL,120,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ── ③ 既有两族补真实变体（证明多变体机制） ──
INSERT OR IGNORE INTO contract_clause_template
  (family, section_key, direction, variant_key, variant_label, required_level, title, body_template, style_ref, risk_notes, sort_order, version, status, created_at, updated_at)
VALUES
('pipe_jacking','payment','inbound','monthly_simple','月度计量简版','core','价款结算与支付（月度计量简版）',
 '双方于每月{{measure_day}}日计量确认当月完成工程量，甲方于次月{{monthly_pay_day}}日前支付当月经确认工程款的{{progress_ratio}}%；竣工验收合格并完成结算后{{settle_days}}日内付清全部余款。上述付款义务不以甲方收到任何第三方款项为前提，最迟不晚于对应计量签认后{{max_pay_days}}日。甲方逾期付款的，每逾期一日按未付金额的{{late_fee_rate}}支付违约金。',
 NULL,'适用无启动款、纯月度计量的短平快项目；仍保留背靠背兜底与逾期违约金。',70,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('equipment_lease','equipment_schedule','both','dry_lease','纯干租版','core','设备清单与计价（纯干租）',
 '租赁设备以《设备清单》为准，逐台载明设备名称、规格型号、计价单位（台班/月）、数量与含税单价；本合同为纯设备租赁（不含操作人员），承租方自行配备持证操作人员并承担相应用工责任。设备经双方共同验收并签署《进场交接单》后起算。合同暂定总价人民币{{amount}}元（大写：{{amount_cn}}），按双方签认的实际使用量结算。',
 NULL,'干租版：操作人员责任整体在承租方侧，发票品目按有形动产经营租赁服务。',20,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- ── ⑤ 起草提示词 v2：修改类注入现有正文 ──
INSERT INTO ai_prompt_template
  (template_key, template_name, system_prompt, user_prompt_template, variables_schema, version, status, created_at, updated_at)
VALUES (
  'prompt-contract-draft-section-v1',
  '合同起草-单节生成',
  '你是恒越百川建设集团的建设工程合同起草助手，覆盖顶管施工、设备租赁、劳务分包、材料购销四类合同。你起草的是合同草稿中的单个条款节，必须以我方立场行文：direction=inbound 时我方是乙方（承包人/出租方/劳务承包人/卖方），条款须明确、可执行、避免含糊表述；direction=outbound 时我方是甲方（发包人/承租方/买方），在合法边界内合理传导责任。硬性合规红线：只允许引用现行有效的法律法规（严禁引用已废止的《中华人民共和国合同法》）；不得生成以下无效或违法条款：免除人身损害责任或免除故意及重大过失责任的免责条款（民法典第506条）、以第三方付款为付款前提的背靠背条款、转包或违法再分包安排、超过结算总额3%的质量保证金、将安全生产法定责任约定转移给他方的条款、预先放弃违约责任或抗辩权的条款；不得编造身份证号、银行账号等具体个人敏感信息，一律使用{{xxx}}占位符；正文中已有的{{xxx}}占位符必须原样保留。你必须只输出一个JSON对象（禁止markdown代码块），字段：content（该节完整正文，string）、risk_spans（数组，每项{"text":"必须是content中逐字出现的片段","level":"red或yellow","reason":"风险说明","legal_basis":"法条依据，可空字符串"}）。对我方存在风险、让步或可能被认定无效的表述，逐条列入risk_spans。',
  '合同方向={{direction}}。节标识={{section_key}}，节标题={{section_title}}。默认条款骨架：{{body_template}}。当前已有正文（若非空，本次任务是按补充指令在其基础上修改，保留未被指令涉及的内容）：{{current_content}}。范本风格参考（仅借鉴语言风格，不得照抄其中不合规内容；可能为空）：{{style_ref}}。工程关键信息JSON：{{keywords_json}}。使用者补充指令（可能为空）：{{instruction}}。请输出该节完整正文：已有正文非空且有补充指令时以修改为主；否则基于骨架起草。不得突破系统合规红线。',
  '{"direction":"string","section_key":"string","section_title":"string","body_template":"string","current_content":"string","style_ref":"string","keywords_json":"string","instruction":"string"}',
  2, 'active', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
)
ON CONFLICT(template_key) DO UPDATE SET
  system_prompt = excluded.system_prompt,
  user_prompt_template = excluded.user_prompt_template,
  variables_schema = excluded.variables_schema,
  version = excluded.version,
  status = 'active',
  updated_at = excluded.updated_at;
