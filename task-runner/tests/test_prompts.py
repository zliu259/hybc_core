from runner.prompts import (
    build_gate_prompt,
    build_payment_risk_prompt,
    default_prompt_for_task,
)


def test_gate_prompt_selects_payment_checks():
    prompt = build_gate_prompt({"biz_type": "payment_request", "amount": 50000})
    assert "duplicate_payment" in prompt["user"]
    assert "overpayment" in prompt["user"]
    assert "对外付款审批" in prompt["user"]
    assert "decision" in prompt["user"]
    assert "AI 审查关卡" in prompt["system"]


def test_gate_prompt_selects_contract_checks():
    prompt = build_gate_prompt({"biz_type": "outbound_contract"})
    assert "clause_completeness" in prompt["user"]
    assert "duplicate_payment" not in prompt["user"]


def test_gate_prompt_selects_reimbursement_checks():
    prompt = build_gate_prompt({"biz_type": "reimbursement_batch"})
    assert "item_precheck" in prompt["user"]


def test_gate_prompt_unknown_biz_falls_back_to_generic():
    prompt = build_gate_prompt({"biz_type": "stock_order"})
    assert "data_consistency" in prompt["user"]


def test_gate_prompt_excludes_internal_underscore_keys():
    """_attachment_context 含 base64 图片，绝不能进提示词正文。"""
    prompt = build_gate_prompt(
        {
            "biz_type": "payment_request",
            "amount": 100,
            "_attachment_context": {"image_data_urls": ["data:image/png;base64,AAAA"]},
        }
    )
    assert "base64,AAAA" not in prompt["user"]
    assert '"amount": 100' in prompt["user"]


def test_payment_risk_prompt_forbids_model_scoring():
    prompt = build_payment_risk_prompt({"amount": 100})
    assert "不允许输出" in prompt["system"]
    assert "findings" in prompt["user"]


def test_default_prompt_dispatch():
    assert default_prompt_for_task("approval_ai_gate", {}) is not None
    assert default_prompt_for_task("payment_risk_assessment", {}) is not None
    assert default_prompt_for_task("risk_assessment", {}) is not None
    assert default_prompt_for_task("contract_review", {}) is not None
    assert default_prompt_for_task("log_summary", {}) is None
