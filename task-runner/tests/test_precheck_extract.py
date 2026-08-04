import json

from runner.executor import TaskExecutor
from runner.providers.local_rules import LocalRulesProvider


def test_supports_contract_precheck_extract():
    assert LocalRulesProvider().supports("contract_precheck_extract") is True


def test_extract_returns_joined_text_from_attachment_context():
    provider = LocalRulesProvider()
    payload = {
        "file_key": "contract-precheck/x.docx",
        "_attachment_context": {
            "text_blocks": [
                {"source": "a", "text": "第一条 租赁设备：顶管机一台。"},
                {"source": "b", "text": "第二条 付款方式：每月5日前支付。"},
            ],
            "image_data_urls": [],
        },
    }
    parsed = json.loads(provider.execute("contract_precheck_extract", payload).output)
    assert "顶管机一台" in parsed["text"]
    assert "每月5日前支付" in parsed["text"]
    assert parsed["chars"] == len(parsed["text"])


def test_extract_reports_error_when_no_text_layer():
    """扫描件/图片型 PDF：executor 抽不出文字层，需明确回报原因而不是静默空串。"""
    provider = LocalRulesProvider()
    parsed = json.loads(
        provider.execute(
            "contract_precheck_extract",
            {"file_key": "contract-precheck/scan.pdf", "_attachment_context": {"text_blocks": []}},
        ).output
    )
    assert parsed["text"] == ""
    assert "扫描件" in parsed["error"]


def test_extract_task_builds_attachment_from_file_key():
    """无 attachments 字段时应由 file_key 派生（小程序建单只传 file_key）。"""
    executor = TaskExecutor([])
    prepared = executor._prepare_payload_for_task(
        "contract_precheck_extract", {"file_key": "contract-precheck/x.docx"}
    )
    # 下载会失败（无服务），但不应抛错，且原 payload 键保留
    assert prepared["file_key"] == "contract-precheck/x.docx"


def test_executor_routes_extract_to_local_rules():
    executor = TaskExecutor([LocalRulesProvider()])
    result = executor.execute(
        {
            "task_type": "contract_precheck_extract",
            "payload": {
                "file_key": "contract-precheck/x.docx",
                "_attachment_context": {
                    "text_blocks": [{"source": "a", "text": "合同正文内容。"}]
                },
            },
        }
    )
    parsed = json.loads(result["output"])
    assert parsed["text"] == "合同正文内容。"
