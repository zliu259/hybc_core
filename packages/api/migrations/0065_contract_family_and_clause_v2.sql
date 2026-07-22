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
