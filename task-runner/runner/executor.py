from __future__ import annotations

import base64
import hashlib
from io import BytesIO
import json
import logging
import mimetypes
import os
import re
from urllib.parse import quote, urljoin

import httpx

from .postprocess import postprocess_result
from .prompts import default_prompt_for_task
from .providers.base import AiProvider
from .providers.claude import ClaudeProvider
from .providers.openai_provider import OpenAIProvider
from .rewrite_prompt import build_rewrite_prompt

logger = logging.getLogger(__name__)

# 合同预审扫描件 OCR 页数上限：单次视觉转写的可行边界（超限拒绝，防审计漏页）
OCR_PAGE_CAP = 20
# 单张图片字节上限：Anthropic 硬限 5MB/图，留余量；超限用 PyMuPDF 重编码压缩
IMAGE_BYTE_CAP = 4 * 1024 * 1024
# PDF 页渲染输出长边上限（px）：2026-10-27 一页 1837×2716pt 的扫描件按 2.0x 渲染成
# 3674×5432 PNG（pixmap ≈57 MiB）把 256 MiB 的 lite 容器 OOM；A4@2.0x 长边 1684 不受影响
RENDER_MAX_EDGE_PX = 2000


class TaskExecutor:
    """Routes tasks to the appropriate AI provider and executes them."""

    def __init__(self, providers: list[AiProvider]) -> None:
        self.providers: list[AiProvider]
        self.providers = providers

    def execute(self, task: dict[str, object]) -> dict[str, object]:
        """Execute a task by finding a supporting provider.

        Args:
            task: Task dict with keys: task_type, payload, prompt (optional)

        Returns:
            Result dict matching TaskResultSubmission schema:
            {output, tokens_input, tokens_output, latency_ms, metadata}
        """
        task_type = task.get("task_type", "")
        payload = task.get("payload", task.get("payload_json", {}))
        prompt = task.get("prompt")
        preferred_provider_key = task.get("_provider_key")
        provider_config_raw = task.get("_provider")
        runtime_raw = task.get("_runner_runtime")

        # Parse payload if it's a string
        if isinstance(payload, str):
            try:
                parsed_payload: object = json.loads(payload)
                payload = parsed_payload
            except (json.JSONDecodeError, TypeError):
                payload = {"raw": payload}

        if not isinstance(task_type, str):
            task_type = ""

        if not isinstance(payload, dict):
            payload = {"raw": payload}

        payload = self._prepare_payload_for_task(task_type, payload)
        attachment_processing = payload.get("_attachment_processing")
        prepared_mode = payload.get("_hy_input_mode")

        if not isinstance(prompt, dict):
            prompt = None

        if prompt is None:
            prompt = self._default_prompt_for_task(task_type, payload)
            if prompt is None and task_type == "bidding_dedup_rewrite":
                prompt = build_rewrite_prompt(payload)

        if not isinstance(preferred_provider_key, str):
            preferred_provider_key = ""

        provider_config = provider_config_raw if isinstance(provider_config_raw, dict) else {}
        runtime = runtime_raw if isinstance(runtime_raw, dict) else {}

        if self._truthy(runtime.get("MOCK_AI_ONLY")):
            preferred_provider_key = "local"

        # 合同预审提取分流：有文字层走本地确定性拼接（零 AI 成本）；
        # 只有扫描件（仅图片、无文字层）才路由到视觉模型做 OCR 转写
        if task_type == "contract_precheck_extract":
            context = payload.get("_attachment_context")
            has_images = isinstance(context, dict) and bool(context.get("image_data_urls"))
            if not has_images or payload.get("_extract_error"):
                preferred_provider_key = "local"

        dynamic_provider = self._build_dynamic_provider(
            preferred_provider_key,
            provider_config,
            runtime,
        )

        provider = (
            dynamic_provider
            if dynamic_provider and dynamic_provider.supports(task_type)
            else self._find_provider(task_type, preferred_provider_key)
        )
        if not provider:
            raise ValueError(f"No provider supports task type: {task_type}")

        logger.info(
            "Executing task type=%s with provider=%s", task_type, type(provider).__name__
        )

        try:
            result = provider.execute(task_type, payload, prompt)
            raw_metadata = result.metadata if isinstance(result.metadata, dict) else {}
            # 审批域任务（AI关卡/付款风控/合同审查）的规范化出口：
            # 解析模型输出、设置 metadata.outcome、确定性计算风险分。
            # biz_type 供关卡拦截白名单裁决（payload.biz_type 即实例业务类型）。
            payload_biz_type = payload.get("biz_type")
            output, metadata = postprocess_result(
                task_type,
                result.output,
                raw_metadata,
                payload_biz_type if isinstance(payload_biz_type, str) else None,
            )
            if isinstance(attachment_processing, dict):
                metadata["attachment_processing"] = attachment_processing
            if isinstance(prepared_mode, str) and prepared_mode:
                metadata["prepared_input_mode"] = prepared_mode
            return {
                "output": output,
                "tokens_input": result.tokens_input,
                "tokens_output": result.tokens_output,
                "latency_ms": result.latency_ms,
                "metadata": metadata,
            }
        except Exception as exc:
            logger.error("Task execution failed: %s", exc)
            return {
                "output": "",
                "tokens_input": 0,
                "tokens_output": 0,
                "latency_ms": 0,
                "metadata": {"error": str(exc)},
            }

    def _find_provider(
        self, task_type: str, preferred_provider_key: str = ""
    ) -> AiProvider | None:
        if preferred_provider_key:
            for provider in self.providers:
                provider_key = getattr(provider, "provider_key", "")
                if provider_key == preferred_provider_key and provider.supports(task_type):
                    return provider
        for provider in self.providers:
            if provider.supports(task_type):
                return provider
        return None

    @staticmethod
    def _truthy(value: object) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return False

    def _build_dynamic_provider(
        self,
        provider_key: str,
        provider_config: dict[str, object],
        runtime: dict[str, object],
    ) -> AiProvider | None:
        provider_cfg_obj = provider_config.get("config")
        provider_cfg = provider_cfg_obj if isinstance(provider_cfg_obj, dict) else {}
        endpoint = provider_config.get("endpoint")
        model = provider_config.get("model")

        if provider_key == "openai":
            api_key = provider_cfg.get("api_key")
            if not isinstance(api_key, str) or not api_key:
                api_key = runtime.get("OPENAI_API_KEY")
            if not isinstance(api_key, str) or not api_key:
                api_key = os.getenv("OPENAI_API_KEY", "")
            if not isinstance(api_key, str) or not api_key:
                return None

            base_url = endpoint if isinstance(endpoint, str) and endpoint else runtime.get("OPENAI_BASE_URL")
            if not isinstance(base_url, str) or not base_url:
                base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

            selected_model = model if isinstance(model, str) and model else runtime.get("OPENAI_MODEL")
            if not isinstance(selected_model, str) or not selected_model:
                selected_model = os.getenv("OPENAI_MODEL", "gpt-5.5")

            model_overrides: dict[str, str] = {}
            runtime_map = runtime if isinstance(runtime, dict) else {}
            override_mapping = {
                "contract_review:text": "OPENAI_MODEL_CONTRACT_REVIEW_TEXT",
                "contract_review:vision": "OPENAI_MODEL_CONTRACT_REVIEW_VISION",
                "approval_ai_gate:text": "OPENAI_MODEL_APPROVAL_AI_GATE_TEXT",
                "approval_ai_gate:vision": "OPENAI_MODEL_APPROVAL_AI_GATE_VISION",
                "ocr_extract:text": "OPENAI_MODEL_OCR_EXTRACT_TEXT",
                "ocr_extract:vision": "OPENAI_MODEL_OCR_EXTRACT_VISION",
                "default:text": "OPENAI_MODEL",
                "default:vision": "OPENAI_MODEL_VISION_FALLBACK",
            }
            for key, env_key in override_mapping.items():
                value = runtime_map.get(env_key)
                if isinstance(value, str) and value.strip():
                    model_overrides[key] = value.strip()
                    continue
                env_val = os.getenv(env_key, "").strip()
                if env_val:
                    model_overrides[key] = env_val

            return OpenAIProvider(
                api_key=api_key,
                model=selected_model,
                base_url=base_url,
                model_overrides=model_overrides,
            )

        if provider_key == "claude":
            api_key = provider_cfg.get("api_key")
            if not isinstance(api_key, str) or not api_key:
                api_key = runtime.get("ANTHROPIC_API_KEY")
            if not isinstance(api_key, str) or not api_key:
                api_key = os.getenv("ANTHROPIC_API_KEY", "")
            if not isinstance(api_key, str) or not api_key:
                return None

            selected_model = model if isinstance(model, str) and model else runtime.get("ANTHROPIC_MODEL")
            if not isinstance(selected_model, str) or not selected_model:
                selected_model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")

            return ClaudeProvider(api_key=api_key, model=selected_model)

        return None

    def _prepare_payload_for_task(self, task_type: str, payload: dict[str, object]) -> dict[str, object]:
        if task_type not in {
            "contract_review",
            "approval_ai_gate",
            "ocr_extract",
            "contract_precheck_extract",
        }:
            return payload

        attachments: object = payload.get("attachments")
        # 合同预审提取：小程序无法本地解析 docx/pdf，由本节点下载原件提取全文
        if not attachments and task_type == "contract_precheck_extract":
            file_key = payload.get("file_key")
            if isinstance(file_key, str) and file_key.strip():
                attachments = [{"file_key": file_key.strip()}]
        if not attachments and task_type == "ocr_extract":
            file_key = payload.get("file_key")
            file_url = payload.get("file_url")
            normalized: list[dict[str, str]] = []
            if isinstance(file_key, str) and file_key.strip():
                normalized.append({"file_key": file_key.strip()})
            if isinstance(file_url, str) and file_url.strip():
                normalized.append({"url": file_url.strip()})
            if normalized:
                attachments = normalized
        if not attachments and task_type == "approval_ai_gate":
            context = payload.get("context")
            if isinstance(context, dict):
                attachments = context.get("attachments")
                if not attachments:
                    payment_attachments = context.get("payment_attachments")
                    contract_attachments = context.get("contract_attachments")
                    merged: list[object] = []
                    if isinstance(payment_attachments, list):
                        merged.extend(payment_attachments)
                    if isinstance(contract_attachments, list):
                        merged.extend(contract_attachments)
                    if merged:
                        attachments = merged

        received = self._normalize_attachments(attachments)
        if not received:
            return payload

        # 同一文件挂在合同与付款两侧时 file_key 不同（各自上传），服务端按 file_key 合并
        # 去不掉；按 file_name+file_size 先去重，下载后再按 sha256 兜底，只处理一次
        normalized, duplicates_skipped = self._dedupe_attachments_by_meta(received)
        seen_digests: set[str] = set()

        enriched = dict(payload)
        text_blocks: list[dict[str, str]] = []
        image_data_urls: list[str] = []

        # 合同预审提取要的是可供法务审计的全文，默认 24000 字/20 页会把长合同截断，
        # 该任务放宽上限（服务端 MAX_TEXT 150000 仍是最终闸门）
        is_full_text_task = task_type == "contract_precheck_extract"
        text_cap = 140000 if is_full_text_task else 24000
        pdf_page_cap = 80 if is_full_text_task else 20

        for attachment in normalized[:6]:
            source = attachment["source"]
            content_type = attachment["content_type"]
            data = self._download_attachment(source)
            if not data:
                continue

            digest = hashlib.sha256(data).hexdigest()
            if digest in seen_digests:
                duplicates_skipped += 1
                continue
            seen_digests.add(digest)

            if self._is_docx(source, content_type):
                text = self._extract_docx_text(data)
                if text:
                    text_blocks.append({"source": source, "text": text[:text_cap]})
                continue

            if self._is_doc(source, content_type):
                text = self._extract_doc_text(data)
                if text:
                    text_blocks.append({"source": source, "text": text[:text_cap]})
                continue

            if self._is_pdf(source, content_type):
                text = self._extract_pdf_text(data, max_pages=pdf_page_cap)
                if text and len(text.strip()) >= 200:
                    text_blocks.append({"source": source, "text": text[:text_cap]})
                elif is_full_text_task:
                    # 扫描件 OCR 支持：整本渲染成图片交视觉模型转写。
                    # 页数超上限则拒绝——只转写前 N 页会让审计漏看条款，宁失败勿截半
                    page_count = self._count_pdf_pages(data)
                    if page_count > OCR_PAGE_CAP:
                        enriched["_extract_error"] = (
                            f"扫描件共 {page_count} 页，超过 OCR 上限 {OCR_PAGE_CAP} 页，"
                            "请拆分后分别预审"
                        )
                    else:
                        image_data_urls.extend(
                            self._render_pdf_pages_to_data_urls(
                                data,
                                max_pages=OCR_PAGE_CAP,
                                matrix_scale=1.5,
                                fmt="jpeg",
                            )
                        )
                else:
                    # 审查/关卡/OCR 的 3 页预览：JPEG + 像素上限（见 RENDER_MAX_EDGE_PX）
                    image_data_urls.extend(self._render_pdf_pages_to_data_urls(data, max_pages=3))
                continue

            if self._is_image(source, content_type):
                # 手机原图常超 5MB（Anthropic 单图硬限）：超限重编码压缩，失败则明确报错
                if len(data) > IMAGE_BYTE_CAP:
                    recompressed = self._recompress_image_to_jpeg(data)
                    if recompressed is None:
                        if is_full_text_task:
                            enriched["_extract_error"] = (
                                "合同照片过大且压缩失败，请压缩到 4MB 以内后重试"
                            )
                        continue
                    image_data_urls.append(
                        f"data:image/jpeg;base64,{base64.b64encode(recompressed).decode('ascii')}"
                    )
                    continue
                mime = content_type or mimetypes.guess_type(source)[0] or "image/png"
                image_data_urls.append(f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}")

        # 总页数 fail-closed：provider 侧的图片切片是静默丢弃（fail-open），
        # 超上限的整本转写必须在此明确拒绝，防审计只看到前 N 页
        if is_full_text_task and len(image_data_urls) > OCR_PAGE_CAP:
            enriched["_extract_error"] = (
                f"扫描件合计 {len(image_data_urls)} 页，超过 OCR 上限 {OCR_PAGE_CAP} 页，"
                "请拆分后分别预审"
            )
            image_data_urls = []

        if text_blocks or image_data_urls:
            enriched["_attachment_context"] = {
                "text_blocks": text_blocks,
                "image_data_urls": image_data_urls,
            }
            enriched["_hy_input_mode"] = "vision" if image_data_urls else "text"
            enriched["_attachment_processing"] = {
                "text_blocks": len(text_blocks),
                "image_pages": len(image_data_urls),
                "attachments_received": len(received),
                "duplicates_skipped": duplicates_skipped,
            }
            if is_full_text_task and image_data_urls:
                # 提取转写要吃全部页面：放开 provider 默认 8 张的图片截断
                enriched["_image_part_cap"] = OCR_PAGE_CAP

        return enriched

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

    def _default_prompt_for_task(
        self, task_type: str, payload: dict[str, object]
    ) -> dict[str, str] | None:
        approval_prompt = default_prompt_for_task(task_type, payload)
        if approval_prompt is not None:
            return approval_prompt

        if task_type != "ocr_extract":
            return None

        return {
            "system": (
                "You are an OCR invoice extraction assistant. "
                "Return JSON only, without markdown."
            ),
            "user": (
                "Extract invoice fields from attachment evidence and output strict JSON: "
                '{"invoice_no":string|null,"invoice_code":string|null,"invoice_number":string|null,'
                '"check_code":string|null,"issue_date":string|null,"amount":number|null,'
                '"amount_with_tax":number|null,"seller_name":string|null,"buyer_name":string|null,'
                '"tax_no":string|null,"qr_code_text":string|null,"raw_text_summary":string}. '
                "Use null when unknown. amount/amount_with_tax must be numeric when available."
            ),
        }

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
            texts = [p.text.strip() for p in document.paragraphs if isinstance(p.text, str) and p.text.strip()]
            return "\n".join(texts)
        except Exception as exc:
            logger.warning("DOCX extraction failed: %s", exc)
            return ""

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
                page = document[page_index]
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
                rendered.append(
                    f"data:{mime};base64,{base64.b64encode(image_bytes).decode('ascii')}"
                )
            document.close()
            return rendered
        except Exception as exc:
            logger.warning("PDF image rendering failed: %s", exc)
            return []
