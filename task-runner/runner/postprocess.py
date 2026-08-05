"""审批域 AI 任务结果的确定性后处理。

职责：
1. 容错解析模型输出（剥 Markdown 代码块、截取首尾花括号）。
2. approval_ai_gate：把模型 decision 规范化为服务端可执行的
   metadata.outcome（approve/reject），并强制『reject 必须有 fail finding』守卫；
   守卫不通过时降级为 warn 放行，避免模型幻觉直接终止审批流。
3. payment_risk_assessment / contract_review：依 findings/clause_analysis
   用固定权重计算风险分（模型不打分），保证分数可解释、可复现、跨单可比。

所有函数均返回新对象，不修改入参。
"""

from __future__ import annotations

import json
import re

APPROVAL_TASK_TYPES = frozenset(
    {"approval_ai_gate", "payment_risk_assessment", "risk_assessment", "contract_review"}
)

# 风险计分权重与分档（与前端展示口径一致，改动需同步 web 端说明与
# packages/api risk-score.ts）：单条 warn=20；warn 合计封顶 40——警示项只需
# 人工关注，无论多少条都不允许把结果推进 fail 档（owner 2026-08-05：
# 不利条款/琐碎问题堆分导致合同永远通不过）；单条 fail=50 → high；满分 100。
FINDING_WEIGHTS = {"pass": 0, "warn": 20, "fail": 50}
CLAUSE_WEIGHTS = {"low": 0, "medium": 20, "high": 50}
WARN_SCORE_CAP = 40
RISK_BANDS: tuple[tuple[int, str], ...] = ((50, "high"), (20, "medium"), (0, "low"))

# 维度中文名（与 web utils/ai-review.ts FINDING_DIMENSION_LABELS 同步）
DIMENSION_LABELS = {
    "duplicate_payment": "重复支付",
    "overpayment": "超付核验",
    "frequency_anomaly": "频率异常",
    "counterparty_consistency": "收款方一致性",
    "material_consistency": "材料一致性",
    "clause_completeness": "条款完整性",
    "amount_terms": "金额条款",
    "counterparty_info": "相对方信息",
    "subject_match": "签约主体",
    "performance_risk": "履约风险",
    "item_precheck": "预审汇总",
    "duplicate_invoice": "重复票据",
    "amount_reasonableness": "金额合理性",
    "data_consistency": "数据一致性",
    "completeness": "材料完整性",
    "compliance": "合规性",
}

_CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def tolerant_json_parse(raw: object) -> dict[str, object] | None:
    """尽力把模型输出解析成 dict；解析失败返回 None，绝不抛异常。"""
    if not isinstance(raw, str) or not raw.strip():
        return None
    stripped = _CODE_FENCE_RE.sub("", raw.strip()).strip()
    for candidate in (stripped, _extract_braced(stripped)):
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _extract_braced(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return text[start : end + 1]
    return ""


def _as_str(value: object, max_len: int = 200) -> str:
    if isinstance(value, str):
        return value.strip()[:max_len]
    if isinstance(value, (int, float)):
        return str(value)
    return ""


def _normalize_findings(raw: object) -> list[dict[str, str]]:
    """规范化 findings：status 收敛到 pass/warn/fail；无法识别的条目按 warn 保留。"""
    if not isinstance(raw, list):
        return []
    findings: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        status_raw = _as_str(item.get("status"), 20).lower()
        # "low" 计入 pass：模型常把 status 写成风险词汇（low/medium/high），
        # low 落进 warn 会把全绿结果确定性地打成高分
        if status_raw in ("pass", "ok", "normal", "low"):
            status = "pass"
        elif status_raw in ("fail", "failed", "high", "error"):
            status = "fail"
        else:
            status = "warn"
        findings.append(
            {
                "dimension": _as_str(item.get("dimension"), 60) or "unknown",
                "status": status,
                "detail": _as_str(item.get("detail") or item.get("message"), 120),
                "evidence": _as_str(item.get("evidence"), 200),
            }
        )
    return findings


def _normalize_string_list(raw: object, limit: int = 3) -> list[str]:
    if not isinstance(raw, list):
        return []
    items = [_as_str(item, 120) for item in raw if _as_str(item, 120)]
    return items[:limit]


def compute_risk_score(findings: list[dict[str, str]]) -> int:
    fail_score = sum(
        FINDING_WEIGHTS["fail"] for f in findings if f.get("status") == "fail"
    )
    warn_score = min(
        WARN_SCORE_CAP,
        sum(FINDING_WEIGHTS["warn"] for f in findings if f.get("status") == "warn"),
    )
    return min(fail_score + warn_score, 100)


def risk_level_for_score(score: int) -> str:
    for threshold, level in RISK_BANDS:
        if score >= threshold:
            return level
    return "low"


def _score_basis(findings: list[dict[str, str]]) -> list[str]:
    """分数构成说明——让『分数』可解释，而不是模型拍脑袋的数字。"""
    basis: list[str] = []
    warn_total = 0
    for finding in findings:
        weight = FINDING_WEIGHTS.get(finding["status"], 0)
        if weight > 0:
            label = DIMENSION_LABELS.get(finding["dimension"], finding["dimension"])
            detail = finding["detail"] or label
            basis.append(f"+{weight} {label}：{detail}")
        if finding["status"] == "warn":
            warn_total += FINDING_WEIGHTS["warn"]
    if warn_total > WARN_SCORE_CAP:
        basis.append(f"（警示项合计 +{warn_total}，按上限 +{WARN_SCORE_CAP} 计入总分）")
    return basis


# ─── approval_ai_gate ──────────


def postprocess_gate_result(
    output: str, metadata: dict[str, object]
) -> tuple[str, dict[str, object]]:
    """规范化 AI 关卡结果：返回 (normalized_output, new_metadata)。

    服务端（executors.ts / queue-handler.ts / engine.ts）只信任
    metadata.outcome/comment/summary/recommendations —— 这里是唯一的规范化出口。
    """
    parsed = tolerant_json_parse(output)
    if parsed is None:
        # 前缀属于跨端契约（前端据此推断三态），必须用标准 warn 前缀
        comment = (
            "AI审查放行（需人工重点关注）：AI输出无法解析，请人工重点审核。"
            f"原始输出：{_as_str(output, 100) or '(空)'}"
        )
        new_metadata = {
            **metadata,
            "outcome": "approve",
            "decision": "warn",
            "risk_level": "medium",
            "needs_human_review": True,
            "comment": comment,
            "summary": comment,
            "recommendations": [],
        }
        return output, new_metadata

    inner_metadata = parsed.get("metadata")
    if isinstance(inner_metadata, dict) and "decision" not in parsed:
        # 旧版 local mock 把 metadata 塞进 output JSON 里
        outcome = "reject" if inner_metadata.get("outcome") == "reject" else "approve"
        comment = _as_str(inner_metadata.get("comment"), 300) or _as_str(
            parsed.get("output"), 300
        )
        new_metadata = {
            **metadata,
            "outcome": outcome,
            "decision": "reject" if outcome == "reject" else "pass",
            "risk_level": "high" if outcome == "reject" else "low",
            "needs_human_review": False,
            "comment": comment or "AI关卡已完成",
            "summary": comment or "AI关卡已完成",
            "recommendations": [],
        }
        return output, new_metadata

    is_new_contract = "decision" in parsed
    decision_raw = _as_str(parsed.get("decision") or parsed.get("outcome"), 20).lower()
    findings_raw = parsed.get("findings")
    findings = _normalize_findings(findings_raw)
    # 旧契约 {outcome, comment}：模型的推理在 comment 里，必须保留
    summary = _as_str(parsed.get("summary") or parsed.get("comment"), 200)
    suggestions = _normalize_string_list(
        parsed.get("suggestions") or parsed.get("recommendations")
    )
    risk_level_raw = _as_str(parsed.get("risk_level"), 20).lower()
    risk_level = risk_level_raw if risk_level_raw in ("low", "medium", "high") else None

    if decision_raw in ("reject", "rejected", "deny"):
        decision = "reject"
    elif decision_raw in ("pass", "approve", "approved", "ok"):
        decision = "pass"
    else:
        decision = "warn"

    has_fail_evidence = any(f["status"] == "fail" for f in findings)
    # 守卫只对能验证证据的结果生效（新契约或带 findings 数组的输出）；
    # 旧契约 {outcome:"reject"} 无 findings 概念，reject 必须保留——
    # 与服务端 ai-gate-result.ts 同一规则，两侧改动必须同步。
    guard_applies = is_new_contract or isinstance(findings_raw, list)
    guard_note = ""
    if decision == "reject" and guard_applies and not has_fail_evidence:
        decision = "warn"
        guard_note = "（AI给出拒绝结论但未提供fail级证据，已降级为放行+人工关注）"

    outcome = "reject" if decision == "reject" else "approve"
    needs_human_review = decision == "warn"

    concerns = [
        f"{f['dimension']}：{f['detail'] or f['evidence']}"
        for f in findings
        if f["status"] in ("warn", "fail")
    ][:3]
    concern_text = "；".join(concerns)

    if decision == "reject":
        comment = f"AI审查不通过：{summary or '存在高风险问题'}"
        if concern_text:
            comment += f"｜依据：{concern_text}"
    elif decision == "warn":
        comment = f"AI审查放行（需人工重点关注）：{summary or '存在待人工确认的疑点'}"
        if concern_text:
            comment += f"｜关注点：{concern_text}"
        comment += guard_note
    else:
        comment = f"AI审查通过：{summary or '各项检查未见异常'}"

    effective_risk_level = risk_level or ("high" if decision == "reject" else "low")
    normalized_output = json.dumps(
        {
            "decision": decision,
            "risk_level": effective_risk_level,
            "summary": summary,
            "findings": findings,
            "suggestions": suggestions,
        },
        ensure_ascii=False,
    )
    new_metadata = {
        **metadata,
        "outcome": outcome,
        "decision": decision,
        "risk_level": effective_risk_level,
        "needs_human_review": needs_human_review,
        "comment": comment[:500],
        "summary": summary or comment[:200],
        "recommendations": suggestions,
    }
    return normalized_output, new_metadata


# ─── payment_risk_assessment ──────────


def postprocess_payment_risk_result(
    output: str, metadata: dict[str, object]
) -> tuple[str, dict[str, object]]:
    """规范化付款风控结果：分数由 findings 确定性计算，附 score_basis 说明。"""
    parsed = tolerant_json_parse(output)
    if parsed is None:
        return output, dict(metadata)

    findings = _normalize_findings(parsed.get("findings"))
    legacy_keys = (
        "checks",
        "frequency_check",
        "amount_check",
        "duplicate_check",
        "overall_risk",
        "score",
    )
    if not findings and any(key in parsed for key in legacy_keys):
        # 旧 schema（模型自带 overall_risk/score/各 *_check）原样透传，
        # 绝不能重打成 0 分低风险覆盖模型结论
        return output, dict(metadata)

    score = compute_risk_score(findings)
    overall_risk = risk_level_for_score(score)
    summary = _as_str(parsed.get("summary"), 200)
    recommendations = _normalize_string_list(parsed.get("recommendations"))

    normalized_output = json.dumps(
        {
            "overall_risk": overall_risk,
            "score": score,
            "score_basis": _score_basis(findings),
            "summary": summary,
            "findings": findings,
            "recommendations": recommendations,
        },
        ensure_ascii=False,
    )
    new_metadata = {
        **metadata,
        "summary": summary,
        "overall_risk": overall_risk,
        "score": score,
    }
    return normalized_output, new_metadata


# ─── contract_review ──────────


def postprocess_contract_review_result(
    output: str, metadata: dict[str, object]
) -> tuple[str, dict[str, object]]:
    """规范化合同审查结果：整体分由 clause_analysis 风险级别确定性计算。"""
    parsed = tolerant_json_parse(output)
    if parsed is None:
        return output, dict(metadata)

    clause_raw = parsed.get("clause_analysis")
    if not isinstance(clause_raw, list):
        return output, dict(metadata)

    clauses: list[dict[str, str]] = []
    high_score = 0
    medium_total = 0
    score_basis: list[str] = []
    for item in clause_raw:
        if not isinstance(item, dict):
            continue
        level_raw = _as_str(item.get("risk_level"), 20).lower()
        level = level_raw if level_raw in ("low", "medium", "high") else "medium"
        weight = CLAUSE_WEIGHTS[level]
        if level == "high":
            high_score += weight
        elif level == "medium":
            medium_total += weight
        clause_name = _as_str(item.get("clause"), 60)
        issue = _as_str(item.get("issue"), 150)
        if weight > 0:
            score_basis.append(f"+{weight} {clause_name or '未命名条款'}：{issue or level}")
        clauses.append(
            {
                "clause": clause_name,
                "risk_level": level,
                "issue": issue,
                "suggestion": _as_str(item.get("suggestion"), 150),
            }
        )
    # medium 与 finding-warn 同口径封顶：关注类条款不推进 fail 档
    if medium_total > WARN_SCORE_CAP:
        score_basis.append(
            f"（关注类条款合计 +{medium_total}，按上限 +{WARN_SCORE_CAP} 计入总分）"
        )
    score = min(high_score + min(medium_total, WARN_SCORE_CAP), 100)
    overall_risk = risk_level_for_score(score)
    summary = _as_str(parsed.get("summary"), 200)

    amount_assessment = (
        parsed.get("amount_assessment")
        if isinstance(parsed.get("amount_assessment"), dict)
        else {}
    )

    normalized_output = json.dumps(
        {
            "overall_risk": overall_risk,
            "score": score,
            "score_basis": score_basis,
            "summary": summary,
            "clause_analysis": clauses,
            "amount_assessment": amount_assessment,
            "recommendations": _normalize_string_list(parsed.get("recommendations")),
        },
        ensure_ascii=False,
    )
    new_metadata = {
        **metadata,
        "summary": summary,
        "overall_risk": overall_risk,
        "score": score,
    }
    return normalized_output, new_metadata


# ─── 统一入口 ──────────


def postprocess_result(
    task_type: str, output: str, metadata: dict[str, object]
) -> tuple[str, dict[str, object]]:
    """按任务类型分发后处理；异常绝不外抛（回退为原始结果）。"""
    try:
        if task_type == "approval_ai_gate":
            return postprocess_gate_result(output, metadata)
        if task_type in ("payment_risk_assessment", "risk_assessment"):
            return postprocess_payment_risk_result(output, metadata)
        if task_type == "contract_review":
            return postprocess_contract_review_result(output, metadata)
    except Exception:  # noqa: BLE001 — 后处理失败不能吞掉原始 AI 结果
        return output, dict(metadata)
    return output, dict(metadata)
