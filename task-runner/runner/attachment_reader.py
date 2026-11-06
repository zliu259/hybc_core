"""审批域任务的附件读取：下载、按格式取证（文字层 / 扫描页渲染）与覆盖记录。"""

from __future__ import annotations

import base64
import gc
import hashlib
import logging
import mimetypes
import os
import re
from dataclasses import dataclass
from io import BytesIO
from urllib.parse import quote, urljoin

import httpx

from .evidence import (
    MIN_PAGE_TEXT_CHARS,
    REVIEW_ATTACHMENT_CAP,
    REVIEW_IMAGE_CHARS_TOTAL,
    REVIEW_IMAGE_PAGE_CAP,
    REVIEW_PDF_PAGE_CAP,
    REVIEW_TEXT_CHARS_PER_FILE,
    REVIEW_TEXT_CHARS_TOTAL,
    STATUS_COMPLETE,
    STATUS_PARTIAL,
    STATUS_SKIPPED,
    STATUS_UNREADABLE,
    AttachmentCoverage,
    build_coverage,
)

logger = logging.getLogger(__name__)

# 单张图片字节上限：Anthropic 硬限 5MB/图，留余量；超限用 PyMuPDF 重编码压缩
IMAGE_BYTE_CAP = 4 * 1024 * 1024
# PDF 页渲染输出长边上限（px）：2026-10-27 一页 1837×2716pt 的扫描件按 2.0x 渲染成
# 3674×5432 PNG（pixmap ≈57 MiB）把 256 MiB 的 lite 容器 OOM；A4@2.0x 长边 1684 不受影响
RENDER_MAX_EDGE_PX = 2000


@dataclass(frozen=True)
class _PdfEvidence:
    text: str
    images: tuple[str, ...]
    coverage: AttachmentCoverage


class AttachmentReader:
    """TaskExecutor 的基类；方法保持原名，便于测试替换下载边界。"""

    def _prepare_review_payload(
        self,
        payload: dict[str, object],
        attachments: list[dict[str, str]],
        attachments_received: int,
        duplicates_skipped: int,
    ) -> dict[str, object]:
        """审查类任务读取附件：尽量读全，读不全的如实记入覆盖信息。"""
        text_blocks: list[dict[str, str]] = []
        image_data_urls: list[str] = []
        items: list[AttachmentCoverage] = []
        seen_digests: set[str] = set()
        text_chars_left = REVIEW_TEXT_CHARS_TOTAL
        image_chars_left = REVIEW_IMAGE_CHARS_TOTAL

        for attachment in attachments[:REVIEW_ATTACHMENT_CAP]:
            source = attachment["source"]
            name = self._display_name(attachment)
            data = self._download_attachment(source)
            if not data:
                items.append(
                    AttachmentCoverage(name, STATUS_UNREADABLE, reason="附件下载失败")
                )
                continue

            digest = hashlib.sha256(data).hexdigest()
            if digest in seen_digests:
                duplicates_skipped += 1
                continue
            seen_digests.add(digest)

            kind = self._attachment_kind(attachment)
            if kind == "pdf":
                evidence = self._read_pdf_for_review(
                    name,
                    data,
                    text_chars_left,
                    REVIEW_IMAGE_PAGE_CAP - len(image_data_urls),
                    image_chars_left,
                )
                items.append(evidence.coverage)
                if evidence.text:
                    text_blocks.append({"source": name, "text": evidence.text})
                    text_chars_left -= len(evidence.text)
                image_data_urls.extend(evidence.images)
                image_chars_left -= sum(len(url) for url in evidence.images)
                continue

            if kind in ("docx", "doc"):
                text = (
                    self._extract_docx_text(data)
                    if kind == "docx"
                    else self._extract_doc_text(data)
                )
                kept, coverage = self._cap_document_text(name, text, kind, text_chars_left)
                items.append(coverage)
                if kept:
                    text_blocks.append({"source": name, "text": kept})
                    text_chars_left -= len(kept)
                continue

            if kind == "image":
                url = self._image_data_url(source, attachment["content_type"], data)
                if url is None:
                    items.append(
                        AttachmentCoverage(name, STATUS_UNREADABLE, reason="图片过大且压缩失败")
                    )
                elif (
                    len(image_data_urls) >= REVIEW_IMAGE_PAGE_CAP or len(url) > image_chars_left
                ):
                    items.append(
                        AttachmentCoverage(name, STATUS_SKIPPED, reason="超出单次审查的图片上限")
                    )
                else:
                    image_data_urls.append(url)
                    image_chars_left -= len(url)
                    items.append(AttachmentCoverage(name, STATUS_COMPLETE))
                continue

            items.append(
                AttachmentCoverage(name, STATUS_UNREADABLE, reason="暂不支持读取该文件类型")
            )

        for attachment in attachments[REVIEW_ATTACHMENT_CAP:]:
            items.append(
                AttachmentCoverage(
                    self._display_name(attachment),
                    STATUS_SKIPPED,
                    reason="超出单次审查的附件数上限",
                )
            )

        enriched = dict(payload)
        enriched["_attachment_context"] = {
            "text_blocks": text_blocks,
            "image_data_urls": image_data_urls,
        }
        enriched["_evidence_coverage"] = build_coverage(
            items, attachments_received, duplicates_skipped
        )
        enriched["_hy_input_mode"] = "vision" if image_data_urls else "text"
        enriched["_attachment_processing"] = {
            "text_blocks": len(text_blocks),
            "image_pages": len(image_data_urls),
            "attachments_received": attachments_received,
            "duplicates_skipped": duplicates_skipped,
        }
        if image_data_urls:
            enriched["_image_part_cap"] = REVIEW_IMAGE_PAGE_CAP
        return enriched

    def _read_pdf_for_review(
        self,
        name: str,
        data: bytes,
        text_chars_left: int,
        image_pages_left: int,
        image_chars_left: int,
    ) -> _PdfEvidence:
        """逐页取证：有文字层的页走文本，扫描页/盖章页渲染成图片，超预算的页记为未读。"""
        page_count = self._count_pdf_pages(data)
        if page_count <= 0:
            return _PdfEvidence(
                "",
                (),
                AttachmentCoverage(
                    name, STATUS_UNREADABLE, reason="PDF 无法解析，可能已加密或损坏"
                ),
            )

        readable_pages = min(page_count, REVIEW_PDF_PAGE_CAP)
        page_texts = self._extract_pdf_page_texts(data, readable_pages)
        text_budget = min(REVIEW_TEXT_CHARS_PER_FILE, text_chars_left)
        chunks: list[str] = []
        scan_pages: list[int] = []
        unread: list[int] = list(range(readable_pages + 1, page_count + 1))
        reason = "超出单次审查的页数上限" if unread else ""
        used = 0
        for index in range(readable_pages):
            page_text = page_texts[index].strip() if index < len(page_texts) else ""
            if len(page_text) < MIN_PAGE_TEXT_CHARS:
                scan_pages.append(index)
                continue
            chunk = f"[第 {index + 1} 页]\n{page_text}"
            if used + len(chunk) > text_budget:
                unread.append(index + 1)
                reason = "超出单次审查的文字上限"
                continue
            chunks.append(chunk)
            used += len(chunk)

        rendered = self._render_pdf_page_indices(
            data, scan_pages[: max(image_pages_left, 0)], image_chars_left
        )
        rendered_indices = {index for index, _ in rendered}
        missed = [index + 1 for index in scan_pages if index not in rendered_indices]
        if missed:
            unread.extend(missed)
            reason = reason or "超出单次审查的图片上限"

        unread_pages = tuple(sorted(unread))
        coverage = AttachmentCoverage(
            name,
            STATUS_PARTIAL if unread_pages else STATUS_COMPLETE,
            pages_total=page_count,
            pages_read=page_count - len(unread_pages),
            unread_pages=unread_pages,
            reason=reason if unread_pages else "",
        )
        return _PdfEvidence("\n".join(chunks), tuple(url for _, url in rendered), coverage)

    @staticmethod
    def _cap_document_text(
        name: str, text: str, kind: str, text_chars_left: int
    ) -> tuple[str, AttachmentCoverage]:
        if not text.strip():
            return "", AttachmentCoverage(
                name, STATUS_UNREADABLE, reason="未能从文档提取到文字"
            )
        budget = min(REVIEW_TEXT_CHARS_PER_FILE, text_chars_left)
        kept = text[: max(budget, 0)]
        if len(kept) < len(text):
            return kept, AttachmentCoverage(
                name,
                STATUS_PARTIAL,
                chars_total=len(text),
                chars_read=len(kept),
                reason="超出单次审查的文字上限",
            )
        if kind == "doc":
            # 旧版 .doc 只能按字节尽力抓取文字，表格/页序可能丢失，不能当作读全
            return kept, AttachmentCoverage(
                name, STATUS_PARTIAL, reason="旧版 .doc 只能尽力提取文字，建议转存为 PDF 或 docx"
            )
        return kept, AttachmentCoverage(name, STATUS_COMPLETE)

    def _image_data_url(self, source: str, content_type: str, data: bytes) -> str | None:
        if len(data) > IMAGE_BYTE_CAP:
            recompressed = self._recompress_image_to_jpeg(data)
            if recompressed is None:
                return None
            return f"data:image/jpeg;base64,{base64.b64encode(recompressed).decode('ascii')}"
        mime = content_type or mimetypes.guess_type(source)[0] or "image/png"
        return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"

    @staticmethod
    def _display_name(attachment: dict[str, str]) -> str:
        return attachment.get("file_name") or attachment["source"].rsplit("/", 1)[-1]

    def _attachment_kind(self, attachment: dict[str, str]) -> str:
        """file_key 常带扩展名，但手工挂载的附件可能只有 file_name 才有。"""
        content_type = attachment["content_type"]
        for probe in (attachment["source"], attachment.get("file_name", "")):
            if self._is_docx(probe, content_type):
                return "docx"
            if self._is_doc(probe, content_type):
                return "doc"
            if self._is_pdf(probe, content_type):
                return "pdf"
            if self._is_image(probe, content_type):
                return "image"
        return "other"

    def _normalize_attachments(self, attachments: object) -> list[dict[str, str]]:
        if not isinstance(attachments, list):
            return []

        normalized: list[dict[str, str]] = []
        for item in attachments:
            if isinstance(item, str) and item.strip():
                normalized.append({"source": item.strip(), "content_type": ""})
                continue

            if isinstance(item, dict):
                raw_source = item.get("url") or item.get("key") or item.get("file_key") or item.get("path")
                if not raw_source:
                    raw_source = item.get("file_url")
                source = raw_source.strip() if isinstance(raw_source, str) else ""
                if not source:
                    continue
                content_type = item.get("contentType") or item.get("content_type")
                file_name = item.get("file_name") or item.get("name")
                file_size = item.get("file_size") or item.get("size")
                normalized.append(
                    {
                        "source": source,
                        "content_type": content_type.strip() if isinstance(content_type, str) else "",
                        "file_name": file_name.strip() if isinstance(file_name, str) else "",
                        "file_size": self._size_key(file_size),
                    }
                )

        return normalized

    @staticmethod
    def _size_key(value: object) -> str:
        """file_size 规整为正整数字符串；缺失/非法返回空串（不参与去重）。"""
        if isinstance(value, bool):
            return ""
        if isinstance(value, (int, float)) and value > 0:
            return str(int(value))
        if isinstance(value, str) and value.strip().isdigit() and int(value) > 0:
            return str(int(value))
        return ""

    @staticmethod
    def _dedupe_attachments_by_meta(attachments: list[dict[str, str]]) -> tuple[list[dict[str, str]], int]:
        """按 file_name+file_size 去重（两者都有才算同一文件），返回去重后列表与跳过数。"""
        kept: list[dict[str, str]] = []
        seen: set[tuple[str, str]] = set()
        skipped = 0
        for attachment in attachments:
            file_name = attachment.get("file_name", "")
            file_size = attachment.get("file_size", "")
            if not file_name or not file_size:
                kept.append(attachment)
                continue
            key = (file_name, file_size)
            if key in seen:
                skipped += 1
                continue
            seen.add(key)
            kept.append(attachment)
        return kept, skipped

    def _download_attachment(self, source: str) -> bytes | None:
        candidate_urls: list[str] = []
        if source.startswith("http://") or source.startswith("https://"):
            candidate_urls.append(source)
        else:
            normalized_key = source.lstrip("/")
            raw_fallbacks = os.getenv("API_BASE_URL_FALLBACKS", "")
            configured_fallbacks = [v.strip() for v in raw_fallbacks.split(",") if v.strip()]
            base_urls = [
                os.getenv("API_BASE_URL", "http://127.0.0.1:8787"),
                *configured_fallbacks,
                "https://api.hybcdg.com",
            ]
            de_duplicated_base_urls: list[str] = []
            for base in base_urls:
                if base and base not in de_duplicated_base_urls:
                    de_duplicated_base_urls.append(base)
            for base_url in de_duplicated_base_urls:
                if normalized_key.startswith("api/v1/upload/object/"):
                    candidate_urls.append(urljoin(base_url, f"/{normalized_key}"))
                else:
                    candidate_urls.append(
                        urljoin(base_url, f"/api/v1/upload/object/{quote(normalized_key, safe='')}")
                    )

        # 与 poller 同源的 API key（runner/config.py Settings.api_key ← API_KEY 环境变量）：
        # contract-draft/ 前缀附件需鉴权；其余前缀带上该头也无副作用。
        headers = {"X-API-Key": os.getenv("API_KEY", "local-dev-task-api-key")}
        for url in candidate_urls:
            try:
                response = httpx.get(
                    url, timeout=25.0, follow_redirects=True, headers=headers
                )
                response.raise_for_status()
                return response.content
            except Exception as exc:
                logger.warning("Failed to download attachment source=%s url=%s error=%s", source, url, exc)
        return None

    @staticmethod
    def _is_docx(source: str, content_type: str) -> bool:
        lower_source = source.lower()
        lower_content_type = content_type.lower()
        return lower_source.endswith(".docx") or "wordprocessingml.document" in lower_content_type

    @staticmethod
    def _is_pdf(source: str, content_type: str) -> bool:
        lower_source = source.lower()
        lower_content_type = content_type.lower()
        return lower_source.endswith(".pdf") or "application/pdf" in lower_content_type

    @staticmethod
    def _is_doc(source: str, content_type: str) -> bool:
        lower_source = source.lower()
        lower_content_type = content_type.lower()
        return lower_source.endswith(".doc") or "application/msword" in lower_content_type

    @staticmethod
    def _is_image(source: str, content_type: str) -> bool:
        lower_source = source.lower()
        lower_content_type = content_type.lower()
        return (
            lower_source.endswith(".png")
            or lower_source.endswith(".jpg")
            or lower_source.endswith(".jpeg")
            or "image/" in lower_content_type
        )

    def _extract_docx_text(self, data: bytes) -> str:
        try:
            docx_module = __import__("docx")
            document = docx_module.Document(BytesIO(data))
            # 按文档顺序取段落与表格：金额/单价表常在表格里，document.paragraphs 不含表格
            lines: list[str] = []
            for block in document.iter_inner_content():
                if hasattr(block, "rows"):
                    lines.extend(self._docx_table_lines(block))
                    continue
                text = block.text.strip() if isinstance(block.text, str) else ""
                if text:
                    lines.append(text)
            return "\n".join(lines)
        except Exception as exc:
            logger.warning("DOCX extraction failed: %s", exc)
            return ""

    @staticmethod
    def _docx_table_lines(table: object) -> list[str]:
        lines: list[str] = []
        for row in table.rows:
            cells: list[str] = []
            for cell in row.cells:
                text = " ".join(cell.text.split())
                # 合并单元格会在 row.cells 里重复出现，相邻去重即可
                if text and (not cells or cells[-1] != text):
                    cells.append(text)
            if cells:
                lines.append(" | ".join(cells))
        return lines

    def _extract_doc_text(self, data: bytes) -> str:
        chunks: list[str] = []
        try:
            latin_text = data.decode("latin-1", errors="ignore")
            chunks.extend(re.findall(r"[\u4e00-\u9fffA-Za-z0-9，。！？；：《》、“”‘’（）()\-_,.:;@#$%&*+/\\\s]{20,}", latin_text))
        except Exception:
            pass

        try:
            utf16_text = data.decode("utf-16le", errors="ignore")
            chunks.extend(re.findall(r"[\u4e00-\u9fffA-Za-z0-9，。！？；：《》、“”‘’（）()\-_,.:;@#$%&*+/\\\s]{20,}", utf16_text))
        except Exception:
            pass

        normalized = "\n".join(piece.strip() for piece in chunks if piece and piece.strip())
        return normalized[:32000]

    def _extract_pdf_text(self, data: bytes, max_pages: int = 20) -> str:
        try:
            pypdf_module = __import__("pypdf")
            reader = pypdf_module.PdfReader(BytesIO(data))
            chunks: list[str] = []
            for page in reader.pages[:max_pages]:
                page_text = page.extract_text() or ""
                page_text = page_text.strip()
                if page_text:
                    chunks.append(page_text)
            return "\n".join(chunks)
        except Exception as exc:
            logger.warning("PDF text extraction failed: %s", exc)
            return ""

    def _extract_pdf_page_texts(self, data: bytes, max_pages: int) -> list[str]:
        """逐页提取文字层；单页失败按空串处理（后续会走图片渲染），整本失败返回空列表。"""
        try:
            pypdf_module = __import__("pypdf")
            reader = pypdf_module.PdfReader(BytesIO(data))
            texts: list[str] = []
            for page in reader.pages[:max_pages]:
                try:
                    texts.append(page.extract_text() or "")
                except Exception as exc:
                    logger.warning("PDF page text extraction failed: %s", exc)
                    texts.append("")
            return texts
        except Exception as exc:
            logger.warning("PDF text extraction failed: %s", exc)
            return []

    def _recompress_image_to_jpeg(self, data: bytes) -> bytes | None:
        """超大照片重编码：PyMuPDF 打开任意常见图片格式，等比缩放 + JPEG q80。"""
        try:
            fitz = __import__("fitz")
            document = fitz.open(stream=data)
            page = document[0]
            # 目标长边约 2200px（A4@1.5x 同级），足够 OCR 且体积可控
            scale = min(1.0, 2200 / max(page.rect.width, page.rect.height))
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            try:
                result = pixmap.tobytes("jpeg", jpg_quality=80)
            except Exception:
                result = pixmap.tobytes("png")
            document.close()
            if len(result) > IMAGE_BYTE_CAP:
                return None
            return result
        except Exception as exc:
            logger.warning("Image recompression failed: %s", exc)
            return None

    def _count_pdf_pages(self, data: bytes) -> int:
        try:
            fitz = __import__("fitz")
            document = fitz.open(stream=data, filetype="pdf")
            count = len(document)
            document.close()
            return count
        except Exception as exc:
            logger.warning("PDF page count failed: %s", exc)
            return 0

    def _render_pdf_page_indices(
        self, data: bytes, page_indices: list[int], chars_budget: int
    ) -> list[tuple[int, str]]:
        """渲染指定页，累计 data URL 字符数超预算即停，返回 (页下标, data URL)。"""
        if not page_indices:
            return []
        rendered: list[tuple[int, str]] = []
        used = 0
        try:
            fitz = __import__("fitz")
            for page_index in page_indices:
                # 每页重开文档并清空 MuPDF 缓存：缓存默认可到 256 MB，而 lite 容器总内存
                # 只有 256 MiB。解码后的扫描图不随页面对象释放，不清理就会逐页累积到 OOM。
                document = fitz.open(stream=data, filetype="pdf")
                try:
                    url = self._page_to_data_url(
                        fitz, document[page_index], 2.0, "jpeg", RENDER_MAX_EDGE_PX
                    )
                finally:
                    document.close()
                    fitz.TOOLS.store_shrink(100)
                    gc.collect()
                if used + len(url) > chars_budget:
                    break
                rendered.append((page_index, url))
                used += len(url)
        except Exception as exc:
            logger.warning("PDF image rendering failed: %s", exc)
        return rendered

    @staticmethod
    def _page_to_data_url(
        fitz: object, page: object, matrix_scale: float, fmt: str, max_edge_px: int
    ) -> str:
        """单页渲染：缩放取 matrix_scale 与"长边 ≤ max_edge_px"中较小者。"""
        long_edge_pt = max(page.rect.width, page.rect.height)
        scale = matrix_scale
        if long_edge_pt > 0:
            scale = min(matrix_scale, max_edge_px / long_edge_pt)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        if fmt == "jpeg":
            # JPEG 体积约为 PNG 的 1/4，防请求超限
            try:
                image_bytes = pixmap.tobytes("jpeg", jpg_quality=80)
                mime = "image/jpeg"
            except Exception:
                image_bytes = pixmap.tobytes("png")
                mime = "image/png"
        else:
            image_bytes = pixmap.tobytes("png")
            mime = "image/png"
        return f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"

    def _render_pdf_pages_to_data_urls(
        self,
        data: bytes,
        max_pages: int,
        matrix_scale: float = 2.0,
        fmt: str = "jpeg",
        max_edge_px: int = RENDER_MAX_EDGE_PX,
    ) -> list[str]:
        """按页渲染成 data URL；缩放取 matrix_scale 与"长边 ≤ max_edge_px"中较小者。"""
        try:
            fitz = __import__("fitz")
            document = fitz.open(stream=data, filetype="pdf")
            rendered: list[str] = []
            for page_index in range(min(max_pages, len(document))):
                rendered.append(
                    self._page_to_data_url(fitz, document[page_index], matrix_scale, fmt, max_edge_px)
                )
            document.close()
            return rendered
        except Exception as exc:
            logger.warning("PDF image rendering failed: %s", exc)
            return []
