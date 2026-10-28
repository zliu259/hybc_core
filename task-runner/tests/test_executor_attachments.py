"""executor 附件预处理：PDF 渲染像素上限 + 附件去重（2026-10-27 runner OOM 事故根治）。

事故复盘：一页 1837×2716pt（约 A4 的 9 倍）、无文字层的扫描 PDF 按 2.0x 渲染 PNG，
单页 pixmap ≈57 MiB、PNG ≈20 MB，合同与付款各挂一份同文件要渲染两遍，
lite 容器（256 MiB）里 runner 被 OOM 杀掉。
"""
from __future__ import annotations

import base64
import hashlib

import fitz  # PyMuPDF

from runner.executor import OCR_PAGE_CAP, TaskExecutor

# 事故页面尺寸（pt）
INCIDENT_PAGE_W = 1837
INCIDENT_PAGE_H = 2716
A4_W, A4_H = 595, 842
# 渲染输出长边上限（px）
MAX_EDGE_PX = 2000


def _raster_text_image() -> bytes:
    """渲染一张带文字的 A4 位图，作为"扫描件"的页面内容（文字已栅格化，无文字层）。"""
    source = fitz.open()
    page = source.new_page(width=A4_W, height=A4_H)
    for index in range(40):
        page.insert_text(
            (40, 40 + index * 19),
            f"Clause {index + 1}: rental of one pipe-jacking machine, rent due on the 5th. #{index}",
            fontsize=11,
        )
        page.draw_line((40, 48 + index * 19), (A4_W - 40, 48 + index * 19), width=0.3)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    image = pixmap.tobytes("png")
    source.close()
    return image


def _scan_pdf(width_pt: float, height_pt: float, pages: int = 1, seed: str = "") -> bytes:
    """生成扫描式 PDF：每页只有一张光栅图，pypdf 提不出任何文字。

    seed 会被写进文档元数据，用于造出"内容不同"的文件。
    """
    image = _raster_text_image()
    document = fitz.open()
    for _ in range(pages):
        page = document.new_page(width=width_pt, height=height_pt)
        page.insert_image(page.rect, stream=image)
    if seed:
        document.set_metadata({"title": seed})
    data = document.tobytes()
    document.close()
    return data


def _decode_data_url(data_url: str) -> tuple[str, bytes]:
    header, encoded = data_url.split(",", 1)
    mime = header[len("data:") :].split(";")[0]
    return mime, base64.b64decode(encoded)


def _image_size(image_bytes: bytes) -> tuple[int, int]:
    pixmap = fitz.Pixmap(image_bytes)
    return pixmap.width, pixmap.height


class _StubDownloads:
    """按 source 返回预置字节并计数，替代 HTTP 下载（网络边界）。"""

    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files
        self.calls: list[str] = []

    def __call__(self, source: str) -> bytes | None:
        self.calls.append(source)
        return self.files.get(source)


def _attachment(file_key: str, data: bytes, file_name: str | None = None, with_size: bool = True) -> dict[str, object]:
    meta: dict[str, object] = {
        "file_key": file_key,
        "file_name": file_name or file_key.rsplit("/", 1)[-1],
        "file_url": f"/api/v1/upload/object/{file_key}",
    }
    if with_size:
        meta["file_size"] = len(data)
    return meta


# ---------------------------------------------------------------------------
# 1. 渲染像素上限
# ---------------------------------------------------------------------------


def test_oversized_scan_page_render_is_capped_at_2000px_long_edge():
    """事故尺寸页面：输出长边 ≤2000px，像素数不到旧方案（2.0x）的 1/7，体积远小于旧 PNG。"""
    pdf = _scan_pdf(INCIDENT_PAGE_W, INCIDENT_PAGE_H)
    urls = TaskExecutor([])._render_pdf_pages_to_data_urls(pdf, max_pages=3)

    assert len(urls) == 1
    _mime, image = _decode_data_url(urls[0])
    width, height = _image_size(image)
    assert max(width, height) <= MAX_EDGE_PX
    # 用足上限：不是一刀切缩得更小
    assert max(width, height) >= MAX_EDGE_PX - 2
    # 旧方案 2.0x：3674×5432 ≈ 20MP
    old_pixels = int(INCIDENT_PAGE_W * 2) * int(INCIDENT_PAGE_H * 2)
    assert width * height * 7 <= old_pixels
    # 旧方案事故文件 PNG ≈20 MB；新方案单页必须控制在 1.5 MB 内
    assert len(image) < 1_500_000


def test_a4_page_render_keeps_full_2x_scale():
    """普通 A4 页面（2.0x 后长边 1684px）不触发上限，像素尺寸与直接 2.0x 渲染一致。"""
    pdf = _scan_pdf(A4_W, A4_H)
    document = fitz.open(stream=pdf, filetype="pdf")
    raw = document[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    expected = (raw.width, raw.height)
    document.close()

    urls = TaskExecutor([])._render_pdf_pages_to_data_urls(pdf, max_pages=3, matrix_scale=2.0)
    _mime, image = _decode_data_url(urls[0])
    assert _image_size(image) == expected
    assert expected == (A4_W * 2, A4_H * 2)


def test_preview_render_defaults_to_jpeg():
    """3 页预览路径（contract_review / approval_ai_gate / ocr_extract）默认 JPEG 而非 PNG。"""
    pdf = _scan_pdf(A4_W, A4_H)
    urls = TaskExecutor([])._render_pdf_pages_to_data_urls(pdf, max_pages=3)
    mime, image = _decode_data_url(urls[0])
    assert mime == "image/jpeg"
    assert image[:3] == b"\xff\xd8\xff"


def test_ai_gate_scan_attachment_goes_out_as_capped_jpeg():
    """端到端：approval_ai_gate 的扫描件附件经 _prepare_payload_for_task 后是 ≤2000px 的 JPEG。"""
    pdf = _scan_pdf(INCIDENT_PAGE_W, INCIDENT_PAGE_H)
    executor = TaskExecutor([])
    executor._download_attachment = _StubDownloads({"payment/1-scan.pdf": pdf})

    prepared = executor._prepare_payload_for_task(
        "approval_ai_gate",
        {"context": {"attachments": [_attachment("payment/1-scan.pdf", pdf)]}},
    )

    context = prepared["_attachment_context"]
    assert prepared["_hy_input_mode"] == "vision"
    assert len(context["image_data_urls"]) == 1
    mime, image = _decode_data_url(context["image_data_urls"][0])
    assert mime == "image/jpeg"
    assert max(_image_size(image)) <= MAX_EDGE_PX


def test_precheck_ocr_still_transcribes_every_page_within_cap():
    """contract_precheck_extract 整本转写语义不变：N 页全渲染、_image_part_cap=OCR_PAGE_CAP，
    但每页同样受像素上限约束。"""
    pdf = _scan_pdf(INCIDENT_PAGE_W, INCIDENT_PAGE_H, pages=3)
    executor = TaskExecutor([])
    executor._download_attachment = _StubDownloads({"contract-precheck/scan.pdf": pdf})

    prepared = executor._prepare_payload_for_task(
        "contract_precheck_extract", {"file_key": "contract-precheck/scan.pdf"}
    )

    urls = prepared["_attachment_context"]["image_data_urls"]
    assert len(urls) == 3
    assert prepared["_image_part_cap"] == OCR_PAGE_CAP
    assert prepared["_attachment_processing"]["image_pages"] == 3
    assert "_extract_error" not in prepared
    for url in urls:
        mime, image = _decode_data_url(url)
        assert mime == "image/jpeg"
        assert max(_image_size(image)) <= MAX_EDGE_PX


def test_precheck_ocr_page_cap_still_fails_closed():
    """超过 OCR_PAGE_CAP 页的扫描件仍整体拒绝，不渲染任何页面。"""
    pdf = _scan_pdf(A4_W, A4_H, pages=OCR_PAGE_CAP + 1)
    executor = TaskExecutor([])
    executor._download_attachment = _StubDownloads({"contract-precheck/big.pdf": pdf})

    prepared = executor._prepare_payload_for_task(
        "contract_precheck_extract", {"file_key": "contract-precheck/big.pdf"}
    )

    assert f"{OCR_PAGE_CAP + 1} 页" in prepared["_extract_error"]
    assert "_attachment_context" not in prepared


# ---------------------------------------------------------------------------
# 2. 附件去重
# ---------------------------------------------------------------------------


def test_ai_gate_same_name_and_size_in_merged_attachments_processed_once():
    """生产形态：服务端已按 file_key 合并（context.attachments），合同与付款各上传一份同文件
    → file_key 不同但 file_name+file_size 相同 → 只下载、只渲染一次。"""
    pdf = _scan_pdf(INCIDENT_PAGE_W, INCIDENT_PAGE_H)
    payment_item = _attachment("payment/1793-a.pdf", pdf, file_name="合同扫描件.pdf")
    contract_item = _attachment("contract/1792-b.pdf", pdf, file_name="合同扫描件.pdf")
    downloads = _StubDownloads({"payment/1793-a.pdf": pdf, "contract/1792-b.pdf": pdf})
    executor = TaskExecutor([])
    executor._download_attachment = downloads

    prepared = executor._prepare_payload_for_task(
        "approval_ai_gate",
        {
            "context": {
                "attachments": [contract_item, payment_item],
                "payment_attachments": [payment_item],
                "contract_attachments": [contract_item],
            }
        },
    )

    assert len(downloads.calls) == 1
    processing = prepared["_attachment_processing"]
    assert processing["image_pages"] == 1
    assert processing.get("attachments_received") == 2
    assert processing.get("duplicates_skipped") == 1


def test_ai_gate_fallback_merge_of_payment_and_contract_lists_dedups():
    """无 context.attachments 时由 payment_attachments + contract_attachments 合并，同样去重。"""
    pdf = _scan_pdf(A4_W, A4_H)
    downloads = _StubDownloads({"payment/1-a.pdf": pdf, "contract/2-b.pdf": pdf})
    executor = TaskExecutor([])
    executor._download_attachment = downloads

    prepared = executor._prepare_payload_for_task(
        "approval_ai_gate",
        {
            "context": {
                "payment_attachments": [_attachment("payment/1-a.pdf", pdf, file_name="scan.pdf")],
                "contract_attachments": [_attachment("contract/2-b.pdf", pdf, file_name="scan.pdf")],
            }
        },
    )

    assert len(downloads.calls) == 1
    assert prepared["_attachment_processing"]["image_pages"] == 1
    assert prepared["_attachment_processing"].get("duplicates_skipped") == 1


def test_ai_gate_identical_bytes_under_different_names_rendered_once():
    """元数据对不上（名字不同、无 file_size）但下载后 sha256 相同 → 第二份不再渲染。"""
    pdf = _scan_pdf(A4_W, A4_H)
    assert hashlib.sha256(pdf).hexdigest()  # 夹具可哈希
    downloads = _StubDownloads({"payment/1-a.pdf": pdf, "contract/2-b.pdf": pdf})
    executor = TaskExecutor([])
    executor._download_attachment = downloads

    prepared = executor._prepare_payload_for_task(
        "approval_ai_gate",
        {
            "context": {
                "attachments": [
                    _attachment("payment/1-a.pdf", pdf, file_name="付款凭证.pdf", with_size=False),
                    _attachment("contract/2-b.pdf", pdf, file_name="合同.pdf", with_size=False),
                ]
            }
        },
    )

    # 事前无法判定，两份都会下载；但内容一致只渲染一次
    assert len(downloads.calls) == 2
    assert prepared["_attachment_processing"]["image_pages"] == 1
    assert prepared["_attachment_processing"].get("duplicates_skipped") == 1


def test_ai_gate_distinct_attachments_are_all_processed():
    """同名不同内容/不同大小的文件不是重复：两份都要处理。"""
    pdf_a = _scan_pdf(A4_W, A4_H, seed="A")
    pdf_b = _scan_pdf(A4_W, A4_H, pages=2, seed="B")
    assert len(pdf_a) != len(pdf_b)
    downloads = _StubDownloads({"payment/1-a.pdf": pdf_a, "contract/2-b.pdf": pdf_b})
    executor = TaskExecutor([])
    executor._download_attachment = downloads

    prepared = executor._prepare_payload_for_task(
        "approval_ai_gate",
        {
            "context": {
                "attachments": [
                    _attachment("payment/1-a.pdf", pdf_a, file_name="scan.pdf"),
                    _attachment("contract/2-b.pdf", pdf_b, file_name="scan.pdf"),
                ]
            }
        },
    )

    assert len(downloads.calls) == 2
    processing = prepared["_attachment_processing"]
    assert processing["image_pages"] == 3
    assert processing.get("attachments_received") == 2
    assert processing.get("duplicates_skipped") == 0
