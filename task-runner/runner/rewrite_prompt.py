from __future__ import annotations

import json


def build_rewrite_prompt(payload: dict[str, object]) -> dict[str, str]:
    """Build a system+user prompt that rewrites paragraphs to reduce literal
    duplication while preserving meaning. Output must be strict JSON."""
    paragraphs = payload.get("paragraphs")
    if not isinstance(paragraphs, list):
        paragraphs = []
    valid = [
        {"id": p["id"], "text": p["text"]}
        for p in paragraphs
        if isinstance(p, dict)
        and isinstance(p.get("id"), str)
        and p["id"]
        and isinstance(p.get("text"), str)
        and p["text"]
    ]
    paragraphs_json = json.dumps(valid, ensure_ascii=False, indent=2)
    system = (
        "你是投标文件润色专家。任务：在完整保留原意与专业表述的前提下，"
        "改写下列段落，使其与原文在字面上尽量不同（降低重复/雷同），"
        "可调整句式、措辞与顺序，但不得改变技术含义、数据与承诺。"
        "只输出严格 JSON，不要任何额外说明或 markdown。"
    )
    user = (
        "请改写以下段落（保持每段的 id 不变），并仅返回 JSON 对象，"
        '格式：{"rewrites":[{"id":"<原id>","text":"<改写后正文>"}]}。\n'
        f"待改写段落：\n{paragraphs_json}"
    )
    return {"system": system, "user": user}
