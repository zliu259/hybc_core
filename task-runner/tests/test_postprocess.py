import json

from runner.postprocess import (
    compute_risk_score,
    postprocess_gate_result,
    postprocess_payment_risk_result,
    postprocess_contract_review_result,
    postprocess_result,
    risk_level_for_score,
    tolerant_json_parse,
)


# ─── tolerant_json_parse ──────────


def test_tolerant_parse_plain_json():
    assert tolerant_json_parse('{"a": 1}') == {"a": 1}


def test_tolerant_parse_markdown_fenced():
    raw = '```json\n{"decision": "pass"}\n```'
    assert tolerant_json_parse(raw) == {"decision": "pass"}


def test_tolerant_parse_with_surrounding_prose():
    raw = '好的，以下是审查结果：\n{"decision": "reject", "summary": "x"}\n以上。'
    assert tolerant_json_parse(raw) == {"decision": "reject", "summary": "x"}


def test_tolerant_parse_garbage_returns_none():
    assert tolerant_json_parse("完全不是JSON") is None
    assert tolerant_json_parse("") is None
    assert tolerant_json_parse(None) is None


# ─── gate postprocess ──────────


def _gate_output(decision, findings, summary="测试结论"):
    return json.dumps(
        {
            "decision": decision,
            "risk_level": "high" if decision == "reject" else "low",
            "summary": summary,
            "findings": findings,
            "suggestions": ["建议一"],
        },
        ensure_ascii=False,
    )


def test_gate_pass_sets_approve_metadata():
    output, metadata = postprocess_gate_result(
        _gate_output(
            "pass",
            [{"dimension": "overpayment", "status": "pass", "detail": "无超付", "evidence": "e"}],
        ),
        {},
    )
    assert metadata["outcome"] == "approve"
    assert metadata["decision"] == "pass"
    assert metadata["needs_human_review"] is False
    assert metadata["comment"].startswith("AI审查通过")
    assert metadata["recommendations"] == ["建议一"]
    assert json.loads(output)["decision"] == "pass"


def test_gate_reject_with_block_capable_fail_rejects():
    """白名单内维度的 fail → reject 保留（付款域 duplicate_payment）。"""
    output, metadata = postprocess_gate_result(
        _gate_output(
            "reject",
            [
                {
                    "dimension": "duplicate_payment",
                    "status": "fail",
                    "detail": "两笔同额付款",
                    "evidence": "FK-1/FK-2 同为 5 万",
                }
            ],
        ),
        {},
        biz_type="payment_request",
    )
    assert metadata["outcome"] == "reject"
    assert metadata["comment"].startswith("AI审查不通过")
    assert "duplicate_payment" in metadata["comment"]
    assert json.loads(output)["decision"] == "reject"


def test_gate_reject_without_fail_finding_downgrades_to_warn():
    """守卫：模型给 reject 但没有 fail 级证据 → 降级放行 + 人工关注。"""
    _, metadata = postprocess_gate_result(
        _gate_output(
            "reject",
            [{"dimension": "overpayment", "status": "warn", "detail": "存疑", "evidence": "e"}],
        ),
        {},
        biz_type="payment_request",
    )
    assert metadata["outcome"] == "approve"
    assert metadata["decision"] == "warn"
    assert metadata["needs_human_review"] is True
    assert "降级" in metadata["comment"]


def test_gate_reject_out_of_whitelist_fail_downgrades():
    """fail 落在非白名单维度（越权/串域/编造）→ 降级，理由保留。"""
    _, metadata = postprocess_gate_result(
        _gate_output(
            "reject",
            [
                {
                    "dimension": "material_consistency",
                    "status": "fail",
                    "detail": "付款金额不符合合同约定付款节点",
                    "evidence": "e",
                }
            ],
        ),
        {},
        biz_type="payment_request",
    )
    assert metadata["outcome"] == "approve"
    assert metadata["decision"] == "warn"
    assert metadata["needs_human_review"] is True
    assert "超出" in metadata["comment"]
    assert "material_consistency" in metadata["comment"]


def test_gate_reject_whitelisted_dim_wrong_domain_downgrades():
    """subject_match 只在合同域有拦截权，付款域出现 → 降级。"""
    _, metadata = postprocess_gate_result(
        _gate_output(
            "reject",
            [{"dimension": "subject_match", "status": "fail", "detail": "d", "evidence": "e"}],
        ),
        {},
        biz_type="payment_request",
    )
    assert metadata["outcome"] == "approve"
    assert metadata["decision"] == "warn"


def test_gate_reject_without_biz_type_downgrades():
    """biz_type 未知 → 空白名单，reject 一律降级（fail-open 偏置）。"""
    _, metadata = postprocess_gate_result(
        _gate_output(
            "reject",
            [{"dimension": "duplicate_payment", "status": "fail", "detail": "d", "evidence": "e"}],
        ),
        {},
    )
    assert metadata["outcome"] == "approve"
    assert metadata["decision"] == "warn"


def test_gate_contract_domain_whitelist():
    """合同域白名单：subject_match / amount_terms 可拦，其余降级。"""
    _, metadata = postprocess_gate_result(
        _gate_output(
            "reject",
            [{"dimension": "subject_match", "status": "fail", "detail": "主体不符", "evidence": "e"}],
        ),
        {},
        biz_type="outbound_contract",
    )
    assert metadata["outcome"] == "reject"

    _, metadata = postprocess_gate_result(
        _gate_output(
            "reject",
            [{"dimension": "data_consistency", "status": "fail", "detail": "编号不一致", "evidence": "e"}],
        ),
        {},
        biz_type="outbound_contract",
    )
    assert metadata["outcome"] == "approve"
    assert metadata["decision"] == "warn"


def test_gate_warn_approves_with_human_review_flag():
    _, metadata = postprocess_gate_result(
        _gate_output(
            "warn",
            [{"dimension": "material_consistency", "status": "warn", "detail": "缺发票", "evidence": "e"}],
        ),
        {},
    )
    assert metadata["outcome"] == "approve"
    assert metadata["needs_human_review"] is True
    assert "material_consistency" in metadata["comment"]


def test_gate_unparseable_output_fails_open_with_note():
    _, metadata = postprocess_gate_result("模型抽风输出了散文", {})
    assert metadata["outcome"] == "approve"
    assert metadata["needs_human_review"] is True
    assert "无法解析" in metadata["comment"]


def test_gate_legacy_mock_wrapped_format_still_parses():
    """旧版 local mock 把 metadata 塞进 output JSON 里。"""
    legacy = json.dumps(
        {
            "output": "本地模拟AI关卡建议通过。",
            "metadata": {"outcome": "approve", "comment": "local-mock ai_gate approve"},
            "input": {},
        },
        ensure_ascii=False,
    )
    _, metadata = postprocess_gate_result(legacy, {})
    assert metadata["outcome"] == "approve"
    assert metadata["comment"] == "local-mock ai_gate approve"


def test_gate_legacy_outcome_field_maps_to_decision():
    """旧 DB 模板让模型直接输出 {outcome, comment}。"""
    legacy = json.dumps({"outcome": "approve", "comment": "一切正常", "summary": "OK"})
    _, metadata = postprocess_gate_result(legacy, {})
    assert metadata["outcome"] == "approve"
    assert metadata["decision"] == "pass"


def test_gate_legacy_outcome_reject_downgrades():
    """旧契约 {outcome:"reject"} 无 findings → 无证据即无拦截权，降级
    （2026-08-14 分级拦截：白名单裁决取代旧的「旧契约豁免」；
    服务端 ai-gate-result.ts 同一规则，两侧同步）。
    旧契约的推理在 comment 里，仍须保留进 summary。"""
    legacy = json.dumps(
        {"outcome": "reject", "comment": "审查摘要：金额超付；结论依据：超出合同余额"},
        ensure_ascii=False,
    )
    _, metadata = postprocess_gate_result(legacy, {}, biz_type="payment_request")
    assert metadata["outcome"] == "approve"
    assert metadata["decision"] == "warn"
    assert "超出合同余额" in metadata["summary"]


def test_gate_new_contract_reject_without_findings_downgrades():
    """新契约（有 decision 键）缺 findings 的 reject 无法验证证据 → 降级。"""
    raw = json.dumps({"decision": "reject", "summary": "感觉有问题"}, ensure_ascii=False)
    _, metadata = postprocess_gate_result(raw, {})
    assert metadata["outcome"] == "approve"
    assert metadata["decision"] == "warn"


def test_gate_metadata_contains_risk_level():
    _, metadata = postprocess_gate_result(
        _gate_output(
            "pass",
            [{"dimension": "overpayment", "status": "pass", "detail": "", "evidence": ""}],
        ),
        {},
    )
    assert metadata["risk_level"] == "low"


def test_gate_preserves_existing_metadata_keys():
    _, metadata = postprocess_gate_result(
        _gate_output("pass", []), {"input_mode": "multimodal"}
    )
    assert metadata["input_mode"] == "multimodal"


# ─── scoring ──────────


def test_score_weights_and_bands():
    assert compute_risk_score([]) == 0
    assert compute_risk_score([{"status": "pass"}]) == 0
    assert compute_risk_score([{"status": "warn"}]) == 20
    assert compute_risk_score([{"status": "fail"}]) == 50
    assert compute_risk_score([{"status": "fail"}, {"status": "fail"}, {"status": "warn"}]) == 100
    assert risk_level_for_score(0) == "low"
    assert risk_level_for_score(19) == "low"
    assert risk_level_for_score(20) == "medium"
    assert risk_level_for_score(49) == "medium"
    assert risk_level_for_score(50) == "high"


def test_warn_stacking_capped_below_fail_band():
    """警示项无论多少条都不允许把结果推进 fail 档（合计封顶 40）。"""
    warns = [{"status": "warn"}] * 5
    assert compute_risk_score(warns) == 40
    assert risk_level_for_score(compute_risk_score(warns)) == "medium"
    # fail 之上的 warn 仍按封顶后的合计叠加
    assert compute_risk_score([{"status": "fail"}, *warns]) == 90


# ─── payment risk postprocess ──────────


def test_payment_risk_score_is_computed_not_model_provided():
    raw = json.dumps(
        {
            "summary": "存在一笔疑似重复付款",
            "score": 3,  # 模型擅自给的分数必须被忽略
            "findings": [
                {"dimension": "duplicate_payment", "status": "fail", "detail": "两笔同额", "evidence": "e"},
                {"dimension": "overpayment", "status": "pass", "detail": "未超付", "evidence": "e"},
            ],
            "recommendations": ["人工复核"],
        },
        ensure_ascii=False,
    )
    output, metadata = postprocess_payment_risk_result(raw, {})
    parsed = json.loads(output)
    assert parsed["score"] == 50
    assert parsed["overall_risk"] == "high"
    assert parsed["score_basis"] == ["+50 重复支付：两笔同额"]
    assert parsed["findings"][0]["status"] == "fail"
    assert metadata["score"] == 50
    assert metadata["overall_risk"] == "high"


def test_payment_risk_all_pass_scores_zero_low():
    raw = json.dumps(
        {
            "summary": "未见异常",
            "findings": [
                {"dimension": "duplicate_payment", "status": "pass", "detail": "", "evidence": ""},
            ],
            "recommendations": [],
        }
    )
    output, _ = postprocess_payment_risk_result(raw, {})
    parsed = json.loads(output)
    assert parsed["score"] == 0
    assert parsed["overall_risk"] == "low"
    assert parsed["score_basis"] == []


def test_payment_risk_legacy_checks_schema_passthrough():
    legacy = json.dumps({"overall_risk": "low", "score": 16, "checks": {"a": 1}})
    output, metadata = postprocess_payment_risk_result(legacy, {"m": 1})
    assert output == legacy
    assert metadata == {"m": 1}


def test_payment_risk_legacy_without_checks_key_still_passthrough():
    """旧 schema 缺 checks 键时也必须透传——不能把模型的 high/81 重打成 low/0。"""
    legacy = json.dumps(
        {"overall_risk": "high", "score": 81, "frequency_check": {"status": "abnormal"}}
    )
    output, metadata = postprocess_payment_risk_result(legacy, {"m": 1})
    assert output == legacy
    assert metadata == {"m": 1}


def test_payment_risk_low_status_counts_as_pass():
    """模型把 status 写成风险词汇 low 时按 pass 计 0 分，不得虚增。"""
    raw = json.dumps(
        {
            "summary": "未见异常",
            "findings": [
                {"dimension": "duplicate_payment", "status": "low", "detail": "", "evidence": ""},
                {"dimension": "overpayment", "status": "low", "detail": "", "evidence": ""},
            ],
            "recommendations": [],
        }
    )
    output, _ = postprocess_payment_risk_result(raw, {})
    parsed = json.loads(output)
    assert parsed["score"] == 0
    assert parsed["overall_risk"] == "low"


def test_payment_risk_unparseable_passthrough():
    output, metadata = postprocess_payment_risk_result("非JSON", {"m": 1})
    assert output == "非JSON"
    assert metadata == {"m": 1}


# ─── contract review postprocess ──────────


def test_contract_review_score_from_clause_levels():
    raw = json.dumps(
        {
            "summary": "违约条款缺失",
            "clause_analysis": [
                {"clause": "违约责任", "risk_level": "high", "issue": "缺失", "suggestion": "补充"},
                {"clause": "付款条件", "risk_level": "medium", "issue": "含糊", "suggestion": "明确"},
            ],
            "amount_assessment": {"reasonableness": "medium", "basis": "b", "risk_points": []},
            "recommendations": ["法务复核"],
        },
        ensure_ascii=False,
    )
    output, metadata = postprocess_contract_review_result(raw, {})
    parsed = json.loads(output)
    assert parsed["score"] == 70
    assert parsed["overall_risk"] == "high"
    assert metadata["score"] == 70


def test_contract_review_empty_clauses_scores_zero():
    raw = json.dumps({"summary": "无问题", "clause_analysis": [], "recommendations": []})
    output, _ = postprocess_contract_review_result(raw, {})
    parsed = json.loads(output)
    assert parsed["score"] == 0
    assert parsed["overall_risk"] == "low"


def test_contract_review_medium_stacking_capped_and_low_free():
    """medium 条款堆叠封顶 40（不利条款不推进 fail 档）；low 条款列出但不计分。"""
    raw = json.dumps(
        {
            "summary": "多条关注项",
            "clause_analysis": [
                {"clause": f"条款{i}", "risk_level": "medium", "issue": "关注", "suggestion": "s"}
                for i in range(4)
            ]
            + [{"clause": "送达地址", "risk_level": "low", "issue": "仅列甲方", "suggestion": "补充"}],
            "recommendations": [],
        },
        ensure_ascii=False,
    )
    output, metadata = postprocess_contract_review_result(raw, {})
    parsed = json.loads(output)
    assert parsed["score"] == 40
    assert parsed["overall_risk"] == "medium"
    assert metadata["score"] == 40
    # low 条款保留在 clause_analysis 供人工参考，但不进 score_basis
    assert len(parsed["clause_analysis"]) == 5
    assert not any("送达地址" in line for line in parsed["score_basis"])
    assert any("上限 +40" in line for line in parsed["score_basis"])


# ─── dispatch ──────────


def test_dispatch_ignores_unknown_task_types():
    output, metadata = postprocess_result("log_summary", "任意文本", {"k": "v"})
    assert output == "任意文本"
    assert metadata == {"k": "v"}


def test_dispatch_routes_gate():
    _, metadata = postprocess_result("approval_ai_gate", _gate_output("pass", []), {})
    assert metadata["outcome"] == "approve"


def test_contract_review_score_basis_falls_back_to_chinese_label():
    """issue 缺失时 score_basis 兜底文案必须是中文，不能把 high/medium 直出给审批人。"""
    raw = json.dumps(
        {
            "summary": "s",
            "clause_analysis": [
                {"clause": "违约责任", "risk_level": "high", "issue": "", "suggestion": ""},
                {"clause": "付款条件", "risk_level": "medium", "issue": "", "suggestion": ""},
            ],
        },
        ensure_ascii=False,
    )
    output, _ = postprocess_contract_review_result(raw, {})
    parsed = json.loads(output)
    assert parsed["score_basis"] == [
        "+50 违约责任：高风险条款",
        "+20 付款条件：需人工关注条款",
    ]
