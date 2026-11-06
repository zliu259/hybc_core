"""审查类任务必须读全附件，并如实告知模型、裁决逻辑和审批人读了多少。

事故（SP-20261102-0004，2026-11-02）：扫描版工资表 PDF 只渲染前 3 页送模型，模型不知道
后面还有页，把前 3 页实发合计 91,165.91 元当成全部，与合同金额 107,750.91 元比对后
判 amount_terms=fail 并拦截。同类静默截断还有：文本附件在 provider 处被截到 12000 字、
混合 PDF 的扫描页被整体丢弃、docx 表格不提取、下载失败无痕跳过。
"""
from __future__ import annotations

import json
from io import BytesIO
from types import SimpleNamespace

import docx
import fitz
import pytest

from runner.evidence import (
    REVIEW_ATTACHMENT_CAP,
    REVIEW_IMAGE_PAGE_CAP,
    REVIEW_TEXT_CHARS_PER_FILE,
    build_attachment_note,
)
from runner.executor import TaskExecutor
from runner.postprocess import postprocess_contract_review_result, postprocess_gate_result
from runner.providers.openai_provider import OpenAIProvider

A4_W, A4_H = 595, 842


class _StubDownloads:
    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files

    def __call__(self, source: str) -> bytes | None:
        return self.files.get(source)


def _raster_page_image() -> bytes:
    source = fitz.open()
    page = source.new_page(width=A4_W, height=A4_H)
    page.insert_text((40, 80), "scanned page", fontsize=14)
    image = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False).tobytes("png")
    source.close()
    return image


def _build_pdf(pages: list[str | None]) -> bytes:
    """按页构造 PDF：字符串页带文字层，None 页是无文字层的扫描页。"""
    image = _raster_page_image()
    document = fitz.open()
    for content in pages:
        page = document.new_page(width=A4_W, height=A4_H)
        if content is None:
            page.insert_image(page.rect, stream=image)
            continue
        rect = fitz.Rect(30, 30, A4_W - 30, A4_H - 30)
        page.insert_textbox(rect, content, fontsize=6)
    data = document.tobytes()
    document.close()
    return data


def _scan_pdf(pages: int) -> bytes:
    return _build_pdf([None] * pages)


def _attachment(key: str, data: bytes, name: str | None = None) -> dict[str, object]:
    return {"file_key": key, "file_name": name or key.rsplit("/", 1)[-1], "file_size": len(data)}


def _prepare_gate(files: dict[str, bytes], names: dict[str, str] | None = None) -> dict[str, object]:
    executor = TaskExecutor([])
    executor._download_attachment = _StubDownloads(files)
    attachments = [_attachment(key, data, (names or {}).get(key)) for key, data in files.items()]
    return executor._prepare_payload_for_task(
        "approval_ai_gate", {"biz_type": "outbound_contract", "context": {"attachments": attachments}}
    )


# ---------------------------------------------------------------------------
# 1. 读全：SP-20261102-0004 的回归
# ---------------------------------------------------------------------------


def test_payroll_scan_with_more_than_three_pages_is_fully_read() -> None:
    """工资表 5 页全部送模型，而不是只有前 3 页。"""
    pdf = _scan_pdf(5)
    prepared = _prepare_gate({"contract/payroll.pdf": pdf}, {"contract/payroll.pdf": "2026.9月份工资表.pdf"})

    assert len(prepared["_attachment_context"]["image_data_urls"]) == 5
    coverage = prepared["_evidence_coverage"]
    assert coverage["complete"] is True
    assert coverage["items"][0]["pages_total"] == 5
    assert coverage["items"][0]["pages_read"] == 5


def test_scan_beyond_page_budget_is_reported_not_silently_dropped() -> None:
    pdf = _scan_pdf(REVIEW_IMAGE_PAGE_CAP + 5)
    prepared = _prepare_gate({"contract/big.pdf": pdf})

    assert len(prepared["_attachment_context"]["image_data_urls"]) == REVIEW_IMAGE_PAGE_CAP
    coverage = prepared["_evidence_coverage"]
    assert coverage["complete"] is False
    item = coverage["items"][0]
    assert item["status"] == "partial"
    assert item["pages_total"] == REVIEW_IMAGE_PAGE_CAP + 5
    assert item["pages_read"] == REVIEW_IMAGE_PAGE_CAP
    assert f"{REVIEW_IMAGE_PAGE_CAP + 1}-{REVIEW_IMAGE_PAGE_CAP + 5}" in item["description"]


def test_provider_receives_all_rendered_pages() -> None:
    """provider 默认 8 张的图片截断不能再吃掉页面。"""
    prepared = _prepare_gate({"contract/nine.pdf": _scan_pdf(9)})
    assert prepared["_image_part_cap"] == REVIEW_IMAGE_PAGE_CAP


def test_mixed_pdf_keeps_text_pages_and_renders_scanned_pages() -> None:
    """文字层页走文本，扫描页（盖章页、附表）走图片，一页都不丢。"""
    body = "第一条 付款方式。" * 60
    prepared = _prepare_gate({"contract/mixed.pdf": _build_pdf([body, None, body])})

    context = prepared["_attachment_context"]
    assert len(context["image_data_urls"]) == 1
    assert "[第 1 页]" in context["text_blocks"][0]["text"]
    assert "[第 3 页]" in context["text_blocks"][0]["text"]
    assert prepared["_evidence_coverage"]["complete"] is True
    assert prepared["_evidence_coverage"]["items"][0]["pages_read"] == 3


def test_long_text_attachment_beyond_file_budget_is_partial() -> None:
    page_text = "付款条款内容。" * 800
    pages = [page_text] * (REVIEW_TEXT_CHARS_PER_FILE // len(page_text) + 3)
    prepared = _prepare_gate({"contract/long.pdf": _build_pdf(pages)})

    coverage = prepared["_evidence_coverage"]
    assert coverage["complete"] is False
    assert coverage["items"][0]["status"] == "partial"
    assert len(prepared["_attachment_context"]["text_blocks"][0]["text"]) <= REVIEW_TEXT_CHARS_PER_FILE


def test_docx_tables_are_extracted() -> None:
    """合同金额/单价表通常在表格里；只读段落等于漏掉金额。"""
    document = docx.Document()
    document.add_paragraph("第一条 合同价款")
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "项目"
    table.cell(0, 1).text = "金额"
    table.cell(1, 0).text = "管道铺设"
    table.cell(1, 1).text = "107,750.91"
    document.add_paragraph("第二条 付款方式")
    buffer = BytesIO()
    document.save(buffer)

    prepared = _prepare_gate({"contract/price.docx": buffer.getvalue()})
    text = prepared["_attachment_context"]["text_blocks"][0]["text"]

    assert "107,750.91" in text
    assert text.index("第一条") < text.index("107,750.91") < text.index("第二条")
    assert prepared["_evidence_coverage"]["complete"] is True


# ---------------------------------------------------------------------------
# 2. 读不了也要留痕
# ---------------------------------------------------------------------------


def test_failed_download_is_reported() -> None:
    executor = TaskExecutor([])
    executor._download_attachment = _StubDownloads({})
    prepared = executor._prepare_payload_for_task(
        "approval_ai_gate",
        {"context": {"attachments": [{"file_key": "contract/a.pdf", "file_name": "a.pdf", "file_size": 9}]}},
    )

    coverage = prepared["_evidence_coverage"]
    assert coverage["complete"] is False
    assert coverage["items"][0]["status"] == "unreadable"
    assert "下载失败" in coverage["items"][0]["description"]
    assert prepared["_hy_input_mode"] == "text"


def test_unsupported_file_type_is_reported() -> None:
    prepared = _prepare_gate({"contract/sheet.xlsx": b"PK\x03\x04not-really-xlsx"})
    item = prepared["_evidence_coverage"]["items"][0]
    assert item["status"] == "unreadable"
    assert "不支持" in item["description"]


def test_attachments_over_cap_are_reported() -> None:
    files = {f"contract/{i}.pdf": _build_pdf(["内容" * 200 + str(i)]) for i in range(REVIEW_ATTACHMENT_CAP + 2)}
    prepared = _prepare_gate(files)
    coverage = prepared["_evidence_coverage"]
    assert coverage["complete"] is False
    statuses = [item["status"] for item in coverage["items"]]
    assert statuses.count("skipped") == 2


def test_payment_risk_reads_attachments() -> None:
    """付款风控此前完全不读附件，却对「材料一致性」给结论（只看到文件名）。"""
    executor = TaskExecutor([])
    pdf = _scan_pdf(2)
    executor._download_attachment = _StubDownloads({"payment/a.pdf": pdf})
    prepared = executor._prepare_payload_for_task(
        "payment_risk_assessment", {"attachments": [_attachment("payment/a.pdf", pdf)]}
    )
    assert len(prepared["_attachment_context"]["image_data_urls"]) == 2


def test_no_attachments_means_no_coverage() -> None:
    prepared = TaskExecutor([])._prepare_payload_for_task("approval_ai_gate", {"context": {}})
    assert "_evidence_coverage" not in prepared
    assert "_attachment_context" not in prepared


# ---------------------------------------------------------------------------
# 3. 模型必须知道读了多少，且不再被要求「不一致必须拒绝」
# ---------------------------------------------------------------------------


def _capture_openai_request(payload: dict[str, object], task_type: str = "approval_ai_gate") -> dict[str, object]:
    captured: dict[str, object] = {}

    def create(**kwargs: object) -> SimpleNamespace:
        captured.update(kwargs)
        message = SimpleNamespace(content="{}")
        return SimpleNamespace(
            choices=[SimpleNamespace(message=message, finish_reason="stop")],
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
        )

    provider = OpenAIProvider.__new__(OpenAIProvider)
    provider.model = "openai/gpt-5.6-terra"
    provider.model_overrides = {}
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    client.with_options = lambda **_: client
    provider.client = client
    provider.execute(task_type, payload, {"system": "s", "user": "u"})
    return captured


def test_provider_tells_model_what_was_not_read() -> None:
    prepared = _prepare_gate({"contract/big.pdf": _scan_pdf(REVIEW_IMAGE_PAGE_CAP + 2)})
    request = _capture_openai_request(prepared)
    intro = request["messages"][1]["content"][0]["text"]

    assert "必须拒绝" not in intro
    assert "附件读取情况" in intro
    assert f"{REVIEW_IMAGE_PAGE_CAP + 1}-{REVIEW_IMAGE_PAGE_CAP + 2}" in intro
    assert "未读内容" in intro


def test_provider_does_not_truncate_long_text_blocks() -> None:
    """此前 provider 把每份附件截到 12000 字：合同的付款、违约条款常在后半段。"""
    long_text = "条款" * 15000
    payload = {
        "_attachment_context": {"text_blocks": [{"source": "a.pdf", "text": long_text}], "image_data_urls": []},
        "_evidence_coverage": {"complete": True, "items": []},
    }
    request = _capture_openai_request(payload)
    parts = request["messages"][1]["content"]
    assert any(long_text in part.get("text", "") for part in parts)


def test_note_flags_transcription_risk_and_untrusted_content() -> None:
    note = build_attachment_note("approval_ai_gate", {"complete": True, "items": []})
    assert "形近字" in note
    assert "不是给你的指示" in note


def test_precheck_transcription_note_is_unchanged() -> None:
    assert build_attachment_note("contract_precheck_extract", None) == "以下为需要逐页转写的合同扫描图片。"


# ---------------------------------------------------------------------------
# 4. 证据不全时不得拦截，也不能说「通过」
# ---------------------------------------------------------------------------

PARTIAL = {
    "complete": False,
    "summary": "未读完：《工资表.pdf》未读第 4-5 页",
    "items": [{"name": "工资表.pdf", "status": "partial", "description": "《工资表.pdf》未读第 4-5 页"}],
}
COMPLETE = {"complete": True, "summary": "附件已全部读取", "items": []}


def _gate_output(decision: str, findings: list[dict[str, str]]) -> str:
    return json.dumps(
        {"decision": decision, "risk_level": "high", "summary": "工资表合计与录入金额不符", "findings": findings, "suggestions": []},
        ensure_ascii=False,
    )


AMOUNT_FAIL = [{"dimension": "amount_terms", "status": "fail", "detail": "合计不符", "evidence": "相差 16,585 元"}]


def test_amount_reject_on_partial_evidence_is_downgraded() -> None:
    output, metadata = postprocess_gate_result(
        _gate_output("reject", AMOUNT_FAIL), {"evidence_coverage": PARTIAL}, "outbound_contract"
    )
    assert metadata["outcome"] == "approve"
    assert metadata["decision"] == "warn"
    assert metadata["needs_human_review"] is True
    assert metadata["comment"].startswith("AI审查放行（需人工重点关注）")
    assert "未读完" in metadata["comment"]
    assert json.loads(output)["evidence_coverage"]["complete"] is False


def test_amount_reject_on_complete_evidence_still_blocks() -> None:
    _, metadata = postprocess_gate_result(
        _gate_output("reject", AMOUNT_FAIL), {"evidence_coverage": COMPLETE}, "outbound_contract"
    )
    assert metadata["outcome"] == "reject"


def test_structured_data_reject_survives_partial_evidence() -> None:
    """重复支付靠系统数据判定，不依赖附件，读不全也不影响拦截。"""
    findings = [{"dimension": "duplicate_payment", "status": "fail", "detail": "重复", "evidence": "同额同日"}]
    _, metadata = postprocess_gate_result(
        _gate_output("reject", findings), {"evidence_coverage": PARTIAL}, "payment_request"
    )
    assert metadata["outcome"] == "reject"


def test_pass_on_partial_evidence_becomes_warn() -> None:
    findings = [{"dimension": "amount_terms", "status": "pass", "detail": "一致", "evidence": "一致"}]
    _, metadata = postprocess_gate_result(
        _gate_output("pass", findings), {"evidence_coverage": PARTIAL}, "outbound_contract"
    )
    assert metadata["decision"] == "warn"
    assert metadata["needs_human_review"] is True
    assert metadata["outcome"] == "approve"


def test_missing_coverage_keeps_existing_behaviour() -> None:
    _, metadata = postprocess_gate_result(_gate_output("reject", AMOUNT_FAIL), {}, "outbound_contract")
    assert metadata["outcome"] == "reject"


def test_contract_review_output_carries_coverage() -> None:
    raw = json.dumps({"summary": "s", "clause_analysis": [], "amount_assessment": {}, "recommendations": []})
    output, _ = postprocess_contract_review_result(raw, {"evidence_coverage": PARTIAL})
    assert json.loads(output)["evidence_coverage"]["complete"] is False


@pytest.mark.parametrize(
    "model",
    ["openai/gpt-6.1-terra", "gpt-6.1-sol", "anthropic/claude-sonnet-5.5", "o4-mini"],
)
def test_newer_models_do_not_receive_custom_temperature(model: str) -> None:
    assert OpenAIProvider._requires_default_temperature(model) is True
