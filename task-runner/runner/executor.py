from __future__ import annotations

import json
import logging

from .providers.base import AiProvider

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

        provider = self._find_provider(task_type, preferred_provider_key)
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
