import json
from runner.providers.local_rules import LocalRulesProvider


def test_supports_bidding_dedup_rewrite():
    assert LocalRulesProvider().supports("bidding_dedup_rewrite") is True


def test_mock_rewrites_each_paragraph_preserving_ids_and_changing_text():
    provider = LocalRulesProvider()
    payload = {
        "paragraphs": [
            {"id": "d#0", "text": "项目部建立以项目经理为核心的质量管理体系。"},
            {"id": "d#1", "text": "落实三检制度。"},
        ]
    }
    result = provider.execute("bidding_dedup_rewrite", payload)
    parsed = json.loads(result.output)
    assert [r["id"] for r in parsed["rewrites"]] == ["d#0", "d#1"]
    # mock 必须产出非空且与原文不同的文本
    for original, rewritten in zip(payload["paragraphs"], parsed["rewrites"]):
        assert rewritten["text"]
        assert rewritten["text"] != original["text"]


def test_mock_skips_items_without_id():
    provider = LocalRulesProvider()
    payload = {
        "paragraphs": [{"text": "无 id 段落。"}, {"id": "d#1", "text": "正常。"}]
    }
    parsed = json.loads(provider.execute("bidding_dedup_rewrite", payload).output)
    assert [r["id"] for r in parsed["rewrites"]] == ["d#1"]
