from __future__ import annotations

import base64
from io import BytesIO
import json
import logging
import mimetypes
import os
import re
from urllib.parse import quote, urljoin

import httpx

from .providers.base import AiProvider
from .providers.claude import ClaudeProvider
from .providers.openai_provider import OpenAIProvider

logger = logging.getLogger(__name__)


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
            prompt = self._default_prompt_for_task(task_type)

        if not isinstance(preferred_provider_key, str):
            preferred_provider_key = ""

        provider_config = provider_config_raw if isinstance(provider_config_raw, dict) else {}
        runtime = runtime_raw if isinstance(runtime_raw, dict) else {}

        if self._truthy(runtime.get("MOCK_AI_ONLY")):
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
            metadata = result.metadata if isinstance(result.metadata, dict) else {}
            if isinstance(attachment_processing, dict):
                metadata["attachment_processing"] = attachment_processing
            if isinstance(prepared_mode, str) and prepared_mode:
                metadata["prepared_input_mode"] = prepared_mode
            return {
                "output": result.output,
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
                selected_model = os.getenv("OPENAI_MODEL", "gpt-5.2")

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
        if task_type not in {"contract_review", "approval_ai_gate", "ocr_extract"}:
            return payload

        attachments: object = payload.get("attachments")
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

        normalized = self._normalize_attachments(attachments)
        if not normalized:
            return payload

        enriched = dict(payload)
        text_blocks: list[dict[str, str]] = []
        image_data_urls: list[str] = []

        for attachment in normalized[:6]:
            source = attachment["source"]
            content_type = attachment["content_type"]
            data = self._download_attachment(source)
            if not data:
                continue

            if self._is_docx(source, content_type):
                text = self._extract_docx_text(data)
                if text:
                    text_blocks.append({"source": source, "text": text[:24000]})
                continue

            if self._is_doc(source, content_type):
                text = self._extract_doc_text(data)
                if text:
                    text_blocks.append({"source": source, "text": text[:24000]})
                continue

            if self._is_pdf(source, content_type):
                text = self._extract_pdf_text(data)
                if text and len(text.strip()) >= 200:
                    text_blocks.append({"source": source, "text": text[:24000]})
                else:
                    image_data_urls.extend(self._render_pdf_pages_to_data_urls(data, max_pages=3))
                continue

            if self._is_image(source, content_type):
                mime = content_type or mimetypes.guess_type(source)[0] or "image/png"
                image_data_urls.append(f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}")

        if text_blocks or image_data_urls:
            enriched["_attachment_context"] = {
                "text_blocks": text_blocks,
                "image_data_urls": image_data_urls,
            }
            enriched["_hy_input_mode"] = "vision" if image_data_urls else "text"
            enriched["_attachment_processing"] = {
                "text_blocks": len(text_blocks),
                "image_pages": len(image_data_urls),
            }

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
                normalized.append(
                    {
                        "source": source,
                        "content_type": content_type.strip() if isinstance(content_type, str) else "",
                    }
                )

        return normalized

    def _default_prompt_for_task(self, task_type: str) -> dict[str, str] | None:
        if task_type != "ocr_extract":
            return None

        return {
            "system": (
                "You are an OCR invoice extraction assistant. "
                "Return JSON only, without markdown."
            ),
            "user": (
                "Extract invoice fields from attachment evidence and output strict JSON: "
                '{"invoice_no":string|null,"invoice_number":string|null,"issue_date":string|null,'
                '"amount":number|null,"amount_with_tax":number|null,"seller_name":string|null,'
                '"buyer_name":string|null,"tax_no":string|null,"raw_text_summary":string}. '
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

        for url in candidate_urls:
            try:
                response = httpx.get(url, timeout=25.0, follow_redirects=True)
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

    def _extract_pdf_text(self, data: bytes) -> str:
        try:
            pypdf_module = __import__("pypdf")
            reader = pypdf_module.PdfReader(BytesIO(data))
            chunks: list[str] = []
            for page in reader.pages[:20]:
                page_text = page.extract_text() or ""
                page_text = page_text.strip()
                if page_text:
                    chunks.append(page_text)
            return "\n".join(chunks)
        except Exception as exc:
            logger.warning("PDF text extraction failed: %s", exc)
            return ""

    def _render_pdf_pages_to_data_urls(self, data: bytes, max_pages: int) -> list[str]:
        try:
            fitz = __import__("fitz")
            document = fitz.open(stream=data, filetype="pdf")
            rendered: list[str] = []
            for page_index in range(min(max_pages, len(document))):
                page = document[page_index]
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                image_bytes = pixmap.tobytes("png")
                rendered.append(f"data:image/png;base64,{base64.b64encode(image_bytes).decode('ascii')}")
            document.close()
            return rendered
        except Exception as exc:
            logger.warning("PDF image rendering failed: %s", exc)
            return []
