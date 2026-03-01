from __future__ import annotations

import json
import logging
import os

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
        payload = task.get("payload", {})
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

        if not isinstance(prompt, dict):
            prompt = None

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
            return {
                "output": result.output,
                "tokens_input": result.tokens_input,
                "tokens_output": result.tokens_output,
                "latency_ms": result.latency_ms,
                "metadata": result.metadata,
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
                selected_model = os.getenv("OPENAI_MODEL", "gpt-4.1")

            return OpenAIProvider(api_key=api_key, model=selected_model, base_url=base_url)

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
