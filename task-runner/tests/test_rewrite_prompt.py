import json
from runner.rewrite_prompt import build_rewrite_prompt


def test_build_rewrite_prompt_embeds_paragraphs_and_demands_json():
    payload = {"paragraphs": [{"id": "d#0", "text": "项目部建立质量管理体系。"}]}
    prompt = build_rewrite_prompt(payload)
    assert set(prompt.keys()) == {"system", "user"}
    assert "项目部建立质量管理体系。" in prompt["user"]
    assert "d#0" in prompt["user"]
    assert "rewrites" in prompt["user"]  # 要求严格 JSON 输出
    assert "降低" in prompt["system"] or "相似" in prompt["system"]


def test_build_rewrite_prompt_handles_empty():
    prompt = build_rewrite_prompt({"paragraphs": []})
    assert "rewrites" in prompt["user"]
