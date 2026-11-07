from __future__ import annotations

import base64
import hashlib
import json
import logging
import mimetypes
import os

from .attachment_reader import IMAGE_BYTE_CAP, AttachmentReader
from .postprocess import postprocess_result
from .prompts import default_prompt_for_task
from .providers.base import AiProvider
from .providers.claude import ClaudeProvider
from .providers.openai_provider import OpenAIProvider
from .rewrite_prompt import build_rewrite_prompt

logger = logging.getLogger(__name__)

# 合同预审扫描件 OCR 页数上限：单次视觉转写的可行边界（超限拒绝，防审计漏页）
OCR_PAGE_CAP = 20
# 需要读附件的任务：payment_risk_assessment 也要读，否则「材料一致性」只能看文件名下结论
ATTACHMENT_TASK_TYPES = frozenset(
    {
        "contract_review",
        "approval_ai_gate",
        "ocr_extract",
        "contract_precheck_extract",
        "payment_risk_assessment",
        "risk_assessment",
    }
)


class TaskExecutor(AttachmentReader):
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
        evidence_coverage = payload.get("_evidence_coverage")
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
            raw_metadata = dict(result.metadata) if isinstance(result.metadata, dict) else {}
            # 覆盖信息先进 metadata：关卡裁决要据此判断证据是否足以支撑拦截
            if isinstance(evidence_coverage, dict):
                raw_metadata["evidence_coverage"] = evidence_coverage
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
        if task_type not in ATTACHMENT_TASK_TYPES:
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

        if task_type != "contract_precheck_extract":
            return self._prepare_review_payload(payload, normalized, len(received), duplicates_skipped)

        seen_digests: set[str] = set()

        enriched = dict(payload)
        text_blocks: list[dict[str, str]] = []
        image_data_urls: list[str] = []

        # 合同预审提取要的是可供法务审计的全文（服务端 MAX_TEXT 150000 仍是最终闸门）
        text_cap = 140000
        pdf_page_cap = 80

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
                else:
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
                continue

            if self._is_image(source, content_type):
                # 手机原图常超 5MB（Anthropic 单图硬限）：超限重编码压缩，失败则明确报错
                if len(data) > IMAGE_BYTE_CAP:
                    recompressed = self._recompress_image_to_jpeg(data)
                    if recompressed is None:
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
        if len(image_data_urls) > OCR_PAGE_CAP:
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
            if image_data_urls:
                # 提取转写要吃全部页面：放开 provider 默认 8 张的图片截断
                enriched["_image_part_cap"] = OCR_PAGE_CAP

        return enriched

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
                '"tax_no":string|null,"qr_code_text":string|null,"raw_text_summary":string,'
                '"document_type":"invoice|receipt|other"}. '
                "Use null when unknown. amount/amount_with_tax must be numeric when available. "
                "document_type: invoice for tax invoices, receipt for handwritten or printed receipts "
                "and expense vouchers, other for anything else."
            ),
        }
