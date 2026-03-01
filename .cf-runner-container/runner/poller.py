from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urljoin

import httpx

from runner.config import Settings

logger = logging.getLogger(__name__)


class TaskPoller:
    """Polls the API for tasks and submits results."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base_urls = [settings.api_base_url, *settings.api_base_url_fallbacks]
        self.headers = {
            "X-API-Key": settings.api_key,
            "User-Agent": "HYBC-Runner/1.0 (+https://runner.hybcdg.com)",
        }

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        errors: list[str] = []
        verify: bool | str = True
        cert: tuple[str, str] | str | None = None

        if self.settings.tls_ca_cert_path:
            verify = self.settings.tls_ca_cert_path
        if self.settings.tls_client_cert_path and self.settings.tls_client_key_path:
            cert = (
                self.settings.tls_client_cert_path,
                self.settings.tls_client_key_path,
            )

        headers = {**self.headers, **(extra_headers or {})}

        for base_url in self.base_urls:
            try:
                with httpx.Client(timeout=30.0, verify=verify, cert=cert) as client:
                    return client.request(
                        method,
                        urljoin(base_url, path),
                        params=params,
                        json=json_body,
                        headers=headers,
                    )
            except Exception as exc:
                errors.append(f"{base_url}: {exc}")

        raise RuntimeError("; ".join(errors) or "no base url available")

    def register_node(self) -> dict[str, Any] | None:
        """Register this compute node with the API."""
        try:
            resp = self._request(
                "post",
                "/api/v1/task/nodes/register",
                json_body={
                    "node_id": self.settings.node_id,
                    "node_name": self.settings.node_name,
                    "node_type": self.settings.node_type,
                    "capabilities": self.settings.capabilities,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info("Node registered: %s", self.settings.node_id)
            return data
        except Exception as exc:
            logger.warning("Node registration failed: %s", exc)
            return None

    def poll(self) -> dict[str, Any] | None:
        """Poll for a single task. Returns task dict or None."""
        try:
            resp = self._request(
                "get",
                "/api/v1/task/poll",
                params={
                    "node_id": self.settings.node_id,
                    "capabilities": ",".join(self.settings.capabilities),
                },
            )
            resp.raise_for_status()
            data = resp.json()
            payload = data.get("data", {}) if isinstance(data, dict) else {}
            task = payload.get("task") if isinstance(payload, dict) else None
            if isinstance(task, dict):
                provider = payload.get("provider")
                prompt = payload.get("prompt")
                runner_runtime = payload.get("runner_runtime")
                if isinstance(provider, dict):
                    provider_key = provider.get("key")
                    if isinstance(provider_key, str):
                        task["_provider_key"] = provider_key
                    task["_provider"] = provider
                if isinstance(prompt, dict):
                    task["prompt"] = prompt
                if isinstance(runner_runtime, dict):
                    task["_runner_runtime"] = runner_runtime
                logger.info("Received task: %s (type=%s)", task.get("id"), task.get("task_type"))
            return task if isinstance(task, dict) else None
        except Exception as exc:
            logger.warning("Poll failed: %s", exc)
            return None

    def submit_result(self, task_id: int, result: dict[str, Any]) -> None:
        """Submit task result to the API."""
        try:
            resp = self._request(
                "post",
                f"/api/v1/task/{task_id}/result",
                json_body=result,
                extra_headers={"x-node-id": self.settings.node_id},
            )
            resp.raise_for_status()
            logger.info("Result submitted for task %d", task_id)
        except Exception as exc:
            logger.error("Failed to submit result for task %d: %s", task_id, exc)

    def submit_error(self, task_id: int, error: str) -> None:
        """Submit task error to the API."""
        try:
            resp = self._request(
                "post",
                f"/api/v1/task/{task_id}/result",
                json_body={"output": "", "metadata": {"error": error}},
                extra_headers={"x-node-id": self.settings.node_id},
            )
            resp.raise_for_status()
            logger.info("Error submitted for task %d", task_id)
        except Exception as exc:
            logger.error("Failed to submit error for task %d: %s", task_id, exc)

    def close(self) -> None:
        """No-op for short-lived clients per request."""
        return

    def heartbeat(self) -> None:
        resp = self._request(
            "post",
            f"/api/v1/task/nodes/{self.settings.node_id}/heartbeat",
            json_body={
                "status": "online",
                "active_tasks": 0,
            },
        )
        resp.raise_for_status()
