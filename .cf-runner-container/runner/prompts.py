"""审批系统 AI 任务的默认提示词（代码内兜底）。

优先级：DB 提示词模板（ai_routing_rule.prompt_template_id，由 poll 响应下发）
> 本模块默认提示词 > provider 内部的裸 payload 兜底。

设计约束（owner 2026-08-04 拍板）：
- 结论优先、少废话：summary ≤60 字、finding.detail ≤40 字。
- 结构化判定：模型只输出 decision/findings 等事实字段；
  风险分数由 postprocess.py 依 findings 确定性计算，模型不允许自行打分。
- reject 必须有 status=fail 的 finding 支撑（postprocess 会强制降级不达标的 reject）。
"""

from __future__ import annotations

import json

GATE_DECISION_RULES = (
    "判定规则：\n"
    "- decision=reject 仅在存在至少一条 status=fail 且证据确凿的 finding 时使用；"
    "reject 会直接终止整个审批流程，必须慎用。\n"
    "- 数据不足以下结论时用 decision=warn 放行并交由人工把关，"
    "在 findings 中说明缺少什么，不要臆测。\n"
    "- 所有维度均无异常时用 decision=pass。\n"
    "- 每个检查维度必须输出一条 finding，即使 status=pass。\n"
    "- evidence 必须引用输入数据中的具体字段或数值，禁止编造。"
)

GATE_OUTPUT_SCHEMA = (
    "输出要求：只输出一个 JSON 对象，不要 Markdown 代码块，不要 JSON 以外的任何文字。\n"
    "{\n"
    '  "decision": "pass" | "warn" | "reject",\n'
    '  "risk_level": "low" | "medium" | "high",\n'
    '  "summary": "≤60字：先给结论，再给最关键的一条理由",\n'
    '  "findings": [\n'
    '    {"dimension": "维度名", "status": "pass" | "warn" | "fail",'
    ' "detail": "≤40字事实描述", "evidence": "引用输入中的具体字段/数值"}\n'
    "  ],\n"
    '  "suggestions": ["可执行建议，最多3条，没有则为空数组"]\n'
    "}\n" + GATE_DECISION_RULES
)

GATE_SYSTEM_PROMPT = (
    "你是恒越百川建设集团审批系统中的 AI 审查关卡（AI Gate）。"
    "你的判定会被系统直接执行：reject 终止该审批流程，pass/warn 放行给后续人工审批人。\n"
    "审查原则：\n"
    "1. 只基于输入数据和附件证据做判断，禁止使用输入之外的『常识』编造事实。\n"
    "2. 结论优先、表述精简：不要输出寒暄、复述题干或无信息量的套话。\n"
    "3. reject 必须有具体证据；拿不准时选 warn 放行并说明关注点，由人工把关。\n"
    "4. 严格按要求输出 JSON，不输出任何解释性文字。"
)

_GATE_CHECKS_PAYMENT = (
    "【检查维度】（dimension 必须使用下列英文标识）\n"
    "1. duplicate_payment 重复支付：对比 recent_payments 中金额相同或相近、"
    "时间接近的记录，识别疑似重复申请。\n"
    "2. overpayment 超付：本次 amount 加 contract.paid_amount 是否超过 "
    "contract.total_amount；无合同时基于事由判断金额是否明显异常。\n"
    "3. frequency_anomaly 频率异常：recent_payments 的时间分布是否异常密集"
    "（如短期内多笔同额付款）。\n"
    "4. counterparty_consistency 收款方一致性：付款事由（payment.content/category）"
    "与合同相对方（contract.counterparty）是否匹配。\n"
    "5. material_consistency 材料一致性：附件证据与申请内容是否一致、"
    "关键材料（如发票/进度确认）是否缺失。"
)

_GATE_CHECKS_CONTRACT = (
    "【检查维度】（dimension 必须使用下列英文标识）\n"
    "1. clause_completeness 条款完整性：付款节点、验收标准、违约责任、"
    "争议解决等关键条款是否齐备。\n"
    "2. amount_terms 金额条款：付款比例合计是否等于 100%、"
    "各节点金额与 total_amount 是否自洽。\n"
    "3. counterparty_info 对方主体：合同相对方（counterparty）信息是否完整明确。\n"
    "4. performance_risk 履约风险：工期、结算条件、单方解约条款等"
    "是否存在对我方明显不利的安排。"
)

_GATE_CHECKS_REIMBURSEMENT = (
    "【检查维度】（dimension 必须使用下列英文标识）\n"
    "1. item_precheck 预审汇总：reimbursement_item_reviews 中是否存在"
    "预审未通过（precheck_status 非通过）或 AI 合理性存疑的条目。\n"
    "2. duplicate_invoice 重复票据：各条目 invoice_no 是否重复。\n"
    "3. amount_reasonableness 金额合理性：单项金额与费用类别（category）"
    "是否明显不匹配。\n"
    "【本业务特别规则】本关卡目标是汇总单项 AI 结论并判断报销内容合理性，"
    "不是重新做票据真实性核验；不因『缺少可读附件正文』单独判 fail/reject。"
)

_GATE_CHECKS_GENERIC = (
    "【检查维度】（dimension 必须使用下列英文标识）\n"
    "1. data_consistency 数据一致性：各字段之间是否互相矛盾。\n"
    "2. completeness 材料完整性：做出审批判断所需的关键信息是否缺失。\n"
    "3. compliance 合规性：是否存在明显违反常规审批要求的内容。"
)

_GATE_BIZ_LABELS = {
    "payment_request": "对外付款审批",
    "outbound_contract": "对外合同（我方付款）审批",
    "inbound_contract": "收款合同审批",
    "reimbursement_batch": "报销批次审批",
    "invoice_request": "开票申请审批",
}


def _compact_payload_json(payload: dict[str, object]) -> str:
    """序列化 payload 供提示词引用；剔除 _ 前缀的内部键（含 base64 附件数据）。"""
    visible = {k: v for k, v in payload.items() if not str(k).startswith("_")}
    return json.dumps(visible, ensure_ascii=False, indent=1)


def _gate_checks_for(biz_type: str) -> str:
    if biz_type == "payment_request":
        return _GATE_CHECKS_PAYMENT
    if biz_type in ("outbound_contract", "inbound_contract"):
        return _GATE_CHECKS_CONTRACT
    if biz_type == "reimbursement_batch":
        return _GATE_CHECKS_REIMBURSEMENT
    return _GATE_CHECKS_GENERIC


def build_gate_prompt(payload: dict[str, object]) -> dict[str, str]:
    biz_type_raw = payload.get("biz_type")
    biz_type = biz_type_raw if isinstance(biz_type_raw, str) else ""
    biz_label = _GATE_BIZ_LABELS.get(biz_type, biz_type or "通用审批")

    user = (
        f"【业务类型】{biz_type or 'unknown'}（{biz_label}）\n"
        f"【任务】对以下审批单执行逐项审查并给出唯一判定。\n"
        f"{_gate_checks_for(biz_type)}\n"
        f"【业务数据】\n{_compact_payload_json(payload)}\n\n"
        f"{GATE_OUTPUT_SCHEMA}"
    )
    return {"system": GATE_SYSTEM_PROMPT, "user": user}


PAYMENT_RISK_SYSTEM_PROMPT = (
    "你是恒越百川建设集团的对外付款风控审查 AI。"
    "你的审查结果会展示给财务审批人作为决策参考。\n"
    "审查原则：\n"
    "1. 只基于输入数据做判断，evidence 必须引用具体字段或数值，禁止编造。\n"
    "2. 结论优先、表述精简：summary ≤60 字，finding.detail ≤40 字。\n"
    "3. 风险分数由系统根据你的 findings 确定性计算，"
    "你不需要也不允许输出任何分数字段。\n"
    "4. 严格按要求输出 JSON，不输出任何解释性文字。"
)

PAYMENT_RISK_OUTPUT_SCHEMA = (
    "输出要求：只输出一个 JSON 对象，不要 Markdown 代码块，不要 JSON 以外的任何文字。\n"
    "{\n"
    '  "summary": "≤60字：先给结论，再给最关键的一条理由",\n'
    '  "findings": [\n'
    '    {"dimension": "维度名", "status": "pass" | "warn" | "fail",'
    ' "detail": "≤40字事实描述", "evidence": "引用输入中的具体字段/数值"}\n'
    "  ],\n"
    '  "recommendations": ["可执行建议，最多3条，没有则为空数组"]\n'
    "}\n"
    "判定规则：\n"
    "- status=fail 必须有确凿证据（如两笔金额时间几乎相同的付款记录）。\n"
    "- 数据缺失导致某维度无法核验时该维度用 warn 并说明缺什么，不要臆测。\n"
    "- 每个检查维度必须输出一条 finding，即使 status=pass。"
)


def build_payment_risk_prompt(payload: dict[str, object]) -> dict[str, str]:
    user = (
        "【任务】对以下对外付款申请执行风控审查。\n"
        f"{_GATE_CHECKS_PAYMENT}\n"
        f"【付款数据】\n{_compact_payload_json(payload)}\n\n"
        f"{PAYMENT_RISK_OUTPUT_SCHEMA}"
    )
    return {"system": PAYMENT_RISK_SYSTEM_PROMPT, "user": user}


CONTRACT_REVIEW_SYSTEM_PROMPT = (
    "你是恒越百川建设集团的合同审查 AI。"
    "你的审查结果会展示给合同审批人作为决策参考。\n"
    "审查原则：\n"
    "1. 只基于合同数据与附件证据做判断，issue 必须指向具体条款或字段，禁止编造。\n"
    "2. 结论优先、表述精简：summary ≤60 字，单条 issue ≤50 字。\n"
    "3. 整体风险分数由系统根据 clause_analysis 确定性计算，你不允许输出分数。\n"
    "4. 严格按要求输出 JSON，不输出任何解释性文字。"
)

CONTRACT_REVIEW_OUTPUT_SCHEMA = (
    "输出要求：只输出一个 JSON 对象，不要 Markdown 代码块，不要 JSON 以外的任何文字。\n"
    "{\n"
    '  "summary": "≤60字：先给整体结论，再给最关键的一条风险",\n'
    '  "clause_analysis": [\n'
    '    {"clause": "条款名", "risk_level": "low" | "medium" | "high",'
    ' "issue": "≤50字问题描述", "suggestion": "≤50字修改建议"}\n'
    "  ],\n"
    '  "amount_assessment": {"reasonableness": "low" | "medium" | "high",'
    ' "basis": "判断依据", "risk_points": ["风险点，可为空数组"]},\n'
    '  "recommendations": ["可执行建议，最多3条，没有则为空数组"]\n'
    "}\n"
    "审查重点：付款节点与验收条件对应关系、违约责任对等性、"
    "争议解决与送达条款、金额/税率/发票类型一致性、对我方不利的单方条款。\n"
    "clause_analysis 只列存在问题或需要关注的条款，全部无问题时给空数组。"
)


def build_contract_review_prompt(payload: dict[str, object]) -> dict[str, str]:
    user = (
        "【任务】审查以下合同，识别条款风险、金额合理性与履约风险。\n"
        f"【合同数据】\n{_compact_payload_json(payload)}\n\n"
        f"{CONTRACT_REVIEW_OUTPUT_SCHEMA}"
    )
    return {"system": CONTRACT_REVIEW_SYSTEM_PROMPT, "user": user}


def default_prompt_for_task(
    task_type: str, payload: dict[str, object]
) -> dict[str, str] | None:
    """审批域任务的默认提示词；不认识的任务类型返回 None。"""
    if task_type == "approval_ai_gate":
        return build_gate_prompt(payload)
    if task_type in ("payment_risk_assessment", "risk_assessment"):
        return build_payment_risk_prompt(payload)
    if task_type == "contract_review":
        return build_contract_review_prompt(payload)
    return None
