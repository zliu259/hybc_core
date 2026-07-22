-- 0063_contract_clause_seed.sql — 顶管施工协议条款库（inbound=我方乙方 / outbound=我方甲方）
INSERT OR IGNORE INTO contract_clause_template
  (section_key, direction, required_level, title, body_template, style_ref, risk_notes, sort_order, version, status, created_at, updated_at)
VALUES
-- ─── 立场中性（both） ───
('parties_basis','both','core','首部与签约依据',
 '甲方（发包方）：{{party_a}}，统一社会信用代码：{{party_a_credit_code}}。
乙方（承包方）：{{party_b}}，统一社会信用代码：{{party_b_credit_code}}。
根据《中华人民共和国民法典》及相关法律法规，甲乙双方在平等自愿、协商一致的基础上，就{{project_name}}顶管施工事宜订立本协议，共同遵守。涉及营业线铁路施工的，同时遵守《中华人民共和国铁路法》《铁路运输安全保护条例》及铁路管理单位的施工安全管理规定。',
 '根据《中华人民共和国民法典》和相关法律法规等规定，为明确双方在工程承包中的权利、义务和责任，确保工程任务的全面完成，在自愿、平等、互利的原则下，经甲乙双方协商同意签订本协议。',
 '法律引用只允许现行有效法律；范本一曾引用已废止的《合同法》，属校验规则拦截项。',10,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('project_overview','both','core','工程概况',
 '（一）工程名称：{{project_name}}。（二）工程地点：{{location}}。（三）施工内容：{{pipe_spec}}管道土压平衡顶进施工，顶进长度约{{length}}米，完工后按实际贯通长度据实结算。（四）施工工艺与技术要求：按施工图纸、地勘报告及经批准的施工方案执行。',
 '施工内容: D1800*2000*180 钢承口混凝土管道土压平衡顶进施工、长度 88 米',
 '顶管专业参数（管径×节长×壁厚、顶进长度、工艺）必须明确，避免"按实际情况"类含糊表述。',20,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('quantity_pricing','both','core','工程量与计价',
 '本工程综合单价为人民币{{unit_price}}元/米（含{{tax_rate}}%税金），顶进长度{{length}}米，暂定总价人民币{{amount}}元（大写：{{amount_cn}}）。最终结算价 = 双方现场签认的实际贯通长度 × 综合单价。除双方书面签认的变更外，综合单价包干使用。',
 '顶管施工综合单价：按约定单价（含9%税金），总金额 = 长度 × 单价，总价另附人民币大写。',
 '大写金额由系统后端生成填入 {{amount_cn}}，AI 不得自行推算大写。',40,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('duration','both','core','工程期限',
 '开工日期：{{start_date}}；竣工日期：{{end_date}}。因非责任方原因（发包方未按约提供施工条件、设计变更、不可抗力等）停工的，工期相应顺延，顺延天数以双方签认的工程联系单为准。',
 NULL,
 '校验规则：竣工日期不得早于开工日期（范本一曾出现工期倒挂笔误）。',50,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('invoice_tax','both','recommended','发票与税务',
 '乙方向甲方提供税率为{{tax_rate}}%的增值税{{invoice_type}}发票，发票品目与本协议施工内容（建筑服务）一致，备注栏注明工程名称、建筑服务发生地及本协议编号。发票仅向本协议甲方开具；甲方付款仅支付至乙方本协议载明的对公账户。',
 NULL,
 '三流一致硬约束：范本一约定向第三方直接开票（虚开风险）、范本二以1%机械租赁发票开建筑服务（品目错配），均属校验规则拦截项。',80,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('civilized_construction','both','optional','文明施工',
 '乙方按甲方现场整体规划组织文明施工，作业垃圾运至指定地点，做到工完场清；加强现场与住宿区域管理，不得违章作业、野蛮施工。甲方为文明施工提供必要的场地与设施条件。',
 NULL,NULL,100,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('force_majeure','both','recommended','不可抗力与工期顺延',
 '因不可抗力不能履行本协议的，根据影响程度部分或全部免除责任。遭遇不可抗力的一方应及时通知对方，并在合理期限内提供证明。不可抗力造成的损失由双方各自承担，工期相应顺延；停工期间必要的现场看护费用由{{fm_guard_cost_bearer}}承担。',
 NULL,'两份范本均缺失本节，属遗漏提示重点。',160,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('handover_protection','both','optional','成品保护与移交',
 '管道贯通并经检验后，乙方向甲方办理书面移交，移交后成品保护责任由甲方承担；移交前因乙方原因造成的损坏由乙方负责修复并承担费用。',
 NULL,NULL,180,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('insurance','both','optional','保险',
 '乙方为其进场施工人员投保工伤保险或建筑施工人员团体意外伤害保险并承担保费。工程一切险的投保安排：{{insurance_arrangement}}。',
 NULL,NULL,190,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('dispute','both','core','争议解决',
 '因本协议发生的争议，双方应友好协商解决；协商不成的，任何一方均有权向{{dispute_venue}}人民法院提起诉讼。',
 '因履行本合同发生的一切争议，由当事人双方协商或调解解决，协商或调解不成，依法向人民法院提起诉讼。',
 'inbound 立场建议 {{dispute_venue}} 填我方所在地（避免范本一"工程所在地"的客场条款）；outbound 立场同理填我方所在地。',200,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('misc_effective','both','core','其他与生效',
 '本协议自双方盖章并经法定代表人或授权代理人签字之日起生效。未尽事宜双方另行签订补充协议，补充协议与本协议具有同等效力。本协议一式{{copies}}份，甲方执{{party_a_copies}}份，乙方执{{party_b_copies}}份，扫描件、传真件与原件具有同等效力。',
 '本合同一式四份，甲方执二份，乙方执二份，扫描传真文件也同样有效。',NULL,210,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('signature_block','both','core','落款',
 '甲方（盖章）：{{party_a}}
法定代表人/委托代理人：{{party_a_legal_person}}
地址：{{party_a_address}}
统一社会信用代码：{{party_a_credit_code}}
开户银行：{{party_a_bank_name}}
账号：{{party_a_bank_account}}
联系电话：{{party_a_phone}}
签约日期：{{sign_date}}

乙方（盖章）：{{party_b}}
法定代表人/委托代理人：{{party_b_legal_person}}
地址：{{party_b_address}}
统一社会信用代码：{{party_b_credit_code}}
开户银行：{{party_b_bank_name}}
账号：{{party_b_bank_account}}
联系电话：{{party_b_phone}}
签约日期：{{sign_date}}',
 NULL,'个人证件号码一律不进正文（范本一曾固化收款代理人身份证号，属拦截项）。',220,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

-- ─── inbound（我方=乙方/承包人） ───
('scope_interface','inbound','core','承包方式与工作界面',
 '甲方提供：施工手续、施工图纸、地勘报告、地下物探资料、安全及技术交底、顶进工作坑与接收坑（含后背墙、安全爬梯、防护及防水防洪措施）、合格管材及接口配件并卸管至工作坑施工范围、施工用水用电、土方外弃、进出场道路畅通。乙方提供：顶管设备及辅助设备、起重设备、施工人员、减阻材料、管道内土方运输至地面。双方工作界面交接以书面签认为准。',
 '甲方提供施工图纸、地勘报告、顶进工作坑、接收坑、满足施工要求合格的管材、施工用水用电、土方外弃；乙方提供顶管设备、起重设备、施工人员、减阻材料。',
 'inbound 立场：甲供清单越明确越好，甲供不到位即触发停窝工与顺延条款。',30,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('quality_acceptance','inbound','core','工程质量与验收',
 '工程质量标准：合格，按国家现行施工及验收规范执行。管道贯通后，乙方书面提请验收，甲方应在{{acceptance_days}}日内组织竣工验收并出具验收单；甲方逾期不组织验收的，视为本工程质量合格，自乙方提请验收之日起满{{acceptance_days}}日即为验收合格之日。',
 '验收时间：管道贯通后2日内组织竣工验收，逾期不组织竣工验收，则视为本工程质量全部合格。',
 '"逾期视为合格"是范本中对乙方有利的成熟条款，inbound 保留。',60,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('payment','inbound','core','价款结算与支付',
 '（一）设备安装完毕具备顶进条件后{{advance_days}}日内，甲方支付乙方启动款人民币{{advance_amount}}元；（二）施工期间每月{{measure_day}}日双方计量，甲方于次月{{monthly_pay_day}}日前支付当月已完工程量的{{progress_ratio}}%；（三）竣工验收合格后{{settle_days}}日内双方完成结算，甲方付至结算总价的{{settle_ratio}}%；（四）剩余尾款甲方于{{final_pay_date}}前一次性付清。甲方逾期付款的，每逾期一日按未付金额的{{late_fee_rate}}向乙方支付违约金，并不影响乙方主张停止施工及实际损失。',
 '本工程无预付款，设备安装完毕具备顶进条件支付10万元，计量款每月22号计量，次月15日前支付完成量的60%工程款，尾款分节点付清。',
 'inbound 立场核心条款：付款节点必须为确定日期/期限，逾期违约金费率建议不超过日万分之五（范本"日千分之三"有被调减风险，规则层黄标）。',70,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('safety','inbound','core','安全施工',
 '（一）甲方不得要求乙方违反安全管理规定施工；因甲方提供的资料、场地、设施缺陷或甲方指令原因导致的安全事故，由甲方承担相应责任及费用。（二）乙方遵守工程建设安全生产管理规定，按安全标准组织施工，落实安全教育、分项交底与防护措施，随时接受依法实施的监督检查；因乙方安全措施不力造成事故的责任和费用由乙方承担。（三）双方现场人员执行"自控、互控、他控"保安措施，保障施工人身与设备安全。',
 '甲方不得要求乙方违反安全管理的规定进行施工。因甲方原因导致的安全事故，由甲方承担相应责任及发生的费用。',
 NULL,90,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('party_a_duties','inbound','core','甲方责任与义务',
 '甲方应：（一）按约提供工作界面条款所列全部施工条件，并保证资料真实、完整、及时；（二）对顶管轴线和高程进行复测确认；（三）根据工程进度保证管材等甲供材料供应；因甲方管材供应不足、场地或手续原因造成乙方停窝工的，人员窝工与机械停滞费用由甲方承担；（四）按本协议约定及时足额支付工程款。',
 '根据工程进度确保所需材料，由于管材供应不足原因造成乙方的人员费用、机械租赁费用由甲方承担。',
 NULL,110,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('party_b_duties','inbound','core','乙方责任与义务',
 '乙方应：（一）按甲方通知及时组织人员设备进场，进场前派技术人员完成开工准备；（二）严格按施工图纸、操作规程、施工规范与验收标准施工并做好记录；（三）主动配合甲方阶段性质量安全检查与验收；（四）对施工人员进行安全生产、消防、社会治安教育；（五）妥善保护成品半成品，爱护使用甲方设施。',
 '在本合同生效后，乙方应派技术人员到现场做好开工前的准备工作；严格按照施工图纸操作规程、施工规范、验收标准等施工。',
 NULL,120,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('breach','inbound','core','违约责任',
 '任何一方违约给对方造成损失的，应承担赔偿责任。甲方逾期付款按价款结算条款承担违约金；甲方逾期提供施工条件致乙方无法施工累计超过{{max_idle_days}}日的，乙方有权书面解除本协议，甲方应结算已完工程量并承担乙方进出场费用。约定违约金不足以弥补守约方实际损失的，守约方有权就不足部分继续主张。',
 NULL,
 '违约金畸高（明显超过损失30%）有被民法典第585条调减的风险，生成时黄标提示。',130,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('geology_risk','inbound','recommended','地质条件与地下障碍物风险',
 '甲方提供的地勘、物探资料是乙方施工的依据。施工中遇地下障碍物、土质与地勘资料严重不符、地下水异常等非乙方原因的地质风险，乙方应及时通知甲方并采取合理措施防止损失扩大；由此增加的费用（含障碍物处理、工艺调整、停窝工损失）由甲方承担，工期相应顺延，双方以工程联系单据实签认。',
 NULL,
 '顶管行业最大风险点，两份范本均未约定，inbound 必须争取归甲方。',140,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('claim_visa','inbound','recommended','签证与索赔',
 '发生设计变更、施工条件变化或甲方指令增加工作内容的，乙方应于事件发生后{{visa_days}}日内向甲方提交签证或索赔资料，甲方应在收到后{{visa_reply_days}}日内书面答复；逾期不答复的，视为认可乙方提交的签证内容。经签认的签证费用随最近一期进度款一并支付。',
 NULL,
 '"逾期视为认可"对乙方关键；时限自身也要可完成（建议 7/14 日）。',150,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('idle_compensation','inbound','optional','停窝工补偿',
 '因甲方原因（含管材供应不足、工作坑不具备条件、手续未办妥、场地道路不通）造成乙方停窝工的，人员窝工费按{{idle_labor_fee}}元/人·日、设备停滞费按{{idle_machine_fee}}元/台班计，经双方现场签认后随进度款支付。',
 NULL,NULL,170,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

-- ─── outbound（我方=甲方/发包人，对分包商） ───
('scope_interface','outbound','core','承包方式与工作界面',
 '甲方提供：施工图纸及技术交底、{{party_a_supplies}}。乙方（分包商）提供：{{party_b_supplies}}，并对其提供的人员、设备、材料的合规性与适用性负责。乙方进场前应对甲方提供的施工条件进行核对并书面确认；双方工作界面交接以书面签认为准。',
 NULL,
 'outbound 立场：乙供清单及其合规责任要写实，甲供最小化并以书面签认为界。',30,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('quality_acceptance','outbound','core','工程质量与验收',
 '工程质量标准：合格，按国家现行施工及验收规范执行。乙方完工后书面提请验收，甲方在{{acceptance_days}}日内组织验收；验收不合格的，乙方应按甲方要求限期返工整改，费用由乙方承担，工期不予顺延；返工后仍不合格的，甲方有权另行委托第三方处理，费用自应付乙方款项中扣除。',
 NULL,
 'outbound 不写"逾期视为合格"（该条款只对承包方有利）。',60,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('payment','outbound','core','价款结算与支付',
 '（一）施工期间每月{{measure_day}}日双方计量，甲方于次月{{monthly_pay_day}}日前支付当月已完合格工程量的{{progress_ratio}}%；（二）竣工验收合格且乙方提交完整结算资料、合规发票及农民工工资支付凭证后{{settle_days}}日内，甲方付至结算总价的{{settle_ratio}}%；（三）预留质量保证金为结算总价的{{warranty_ratio}}%（不超过3%），缺陷责任期{{warranty_months}}个月届满且无质量问题后{{warranty_refund_days}}日内无息退还。',
 NULL,
 '合规红线：不得以"业主/上游付款"作为向分包商付款的前提（背靠背条款，最高法2024批复对中小企业无效）；付款期限必须独立确定。质保金不超过结算总额3%。',70,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('safety','outbound','core','安全施工',
 '（一）乙方在其分包范围内对施工安全负直接管理责任，遵守安全生产法律法规及标准规范，落实安全教育、分项交底、劳保穿戴与防护措施，并如实做好记录。（二）甲方依法对施工现场实施统一协调与监督检查，乙方应接受检查并按期完成整改；危及安全时甲方有权责令停工，乙方不得拒绝。（三）双方现场人员执行"自控、互控、他控"保安措施。',
 '乙方施工前应按甲方书面施工组织、安全措施、技术交底进行安装，并经甲方核准后方可顶进施工；顶管作业人员严格劳保穿戴。',
 NULL,90,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('safety_transfer','outbound','core','安全责任承担与追偿',
 '因乙方违章作业、防护缺失或管理不善造成的安全事故，其损失及对第三方的赔偿责任由乙方最终承担；甲方依法先行承担或垫付的，有权向乙方全额追偿，并有权自应付乙方款项中等额扣除。本条不免除甲方依法应承担的统一协调管理义务。',
 NULL,
 '合法传导写法：不写"安全责任全部由乙方承担、与甲方无关"（法定责任不可约定转移，属拦截项），写"先行承担+内部追偿"。',92,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('farmer_wage','outbound','core','农民工工资支付',
 '乙方应依法落实农民工实名制管理与工资专用账户制度，按月足额支付农民工工资并留存支付凭证备查，按甲方要求定期报送。因乙方拖欠农民工工资导致甲方被责令代付或先行垫付的，甲方有权自应付乙方款项中等额扣除并向乙方追偿；由此产生的行政处罚及其他损失由乙方承担。',
 NULL,
 '《保障农民工工资支付条例》要求，outbound 必备节。',95,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('party_a_duties','outbound','core','甲方责任与义务',
 '甲方应：（一）提供施工图纸、技术资料并组织交底；（二）按约提供其承诺的施工条件；（三）对工程质量、进度、安全实施检查与监督；（四）按本协议约定支付经计量签认的工程款。',
 NULL,NULL,110,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('party_b_duties','outbound','core','乙方责任与义务',
 '乙方应：（一）按甲方通知及时组织具备相应资格的人员与合规设备进场；（二）严格按施工图纸、经甲方核准的施工组织方案、操作规程与验收标准施工，服从甲方现场统一管理；（三）不得将本协议工程转包或再分包；（四）对其施工人员进行安全生产教育并依法为其缴纳工伤保险或投保意外伤害保险；（五）妥善保护现场成品半成品及甲方设施，造成损坏的照价赔偿。',
 NULL,
 '禁止转包/再分包必须显性写入（建筑法第28-29条）。',120,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('breach','outbound','core','违约责任',
 '乙方逾期完工的，每逾期一日按协议总价的{{delay_penalty_rate}}向甲方支付违约金；乙方施工质量不合格拒不整改、擅自停工撤场累计超过{{abandon_days}}日的，甲方有权解除协议并要求乙方赔偿由此造成的损失（含甲方对上游承担的违约责任）。甲方无正当理由逾期支付经签认工程款的，每逾期一日按未付金额的{{late_fee_rate}}向乙方支付违约金。因乙方原因造成的一切损失，甲方有权自应付款项中抵扣，不足部分另行追偿。',
 NULL,
 '双向违约金要平衡设置，畸高会被调减；抵扣权是 outbound 立场关键。',130,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('geology_risk','outbound','recommended','地质条件核实义务',
 '乙方进场前应对甲方提供的地勘、物探资料及现场施工条件进行核对，并书面确认具备施工条件；乙方未尽核对义务即施工的，因可合理预见的地质情况增加的费用与工期由乙方承担。确因地勘资料无法预见的地下障碍物等重大异常，双方另行签认处理方案与费用分担。',
 NULL,
 'outbound 镜像：把核实义务放到分包商侧，但重大不可预见异常仍需双方签认（完全转嫁有失公平被判无效风险）。',140,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('claim_visa','outbound','recommended','签证与变更管理',
 '未经甲方书面签认的任何额外工作量、赶工或措施费用，甲方不予认可。乙方主张签证或索赔的，应于事件发生后{{visa_days}}日内提交完整资料，逾期视为放弃该项权利。甲方应在收到后{{visa_reply_days}}日内书面答复。',
 NULL,
 'outbound 镜像："逾期视为放弃"约束分包商；甲方答复期限仍需明确（完全不答复条款有格式条款风险）。',150,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('performance_bond','outbound','recommended','履约保证金',
 '乙方于进场前向甲方缴纳履约保证金人民币{{bond_amount}}元。乙方全面履行本协议且无违约情形的，甲方于竣工验收合格并结清后{{bond_refund_days}}日内无息退还；乙方违约的，甲方有权自保证金中扣除违约金及损失赔偿，不足部分另行追偿。',
 NULL,NULL,125,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('unilateral_termination','outbound','recommended','甲方单方解除权',
 '乙方有下列情形之一的，甲方有权书面通知解除本协议并要求乙方赔偿损失：（一）转包或违法再分包的；（二）施工质量不合格且拒不整改的；（三）擅自停工、撤场累计超过{{abandon_days}}日的；（四）发生较大及以上安全事故，或存在重大安全隐患拒不整改的；（五）拖欠农民工工资引发群体性事件的。协议解除后，已完合格工程量据实结算，乙方应在{{exit_days}}日内退场并移交现场。',
 NULL,NULL,137,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')),

('counter_claim','outbound','optional','反索赔与损失抵扣',
 '因乙方原因造成工期延误、质量缺陷、安全事故或导致甲方对上游发包方承担违约责任的，甲方有权就实际损失向乙方主张赔偿，并有权自应付乙方的任何款项中予以抵扣；抵扣不足部分，甲方保留继续追偿的权利。',
 NULL,NULL,135,1,'active',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
