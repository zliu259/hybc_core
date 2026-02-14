from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from runner.config import Settings

logger = logging.getLogger(__name__)


class TaskPoller:
    """Polls the API for tasks and submits results."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = httpx.Client(
            base_url=settings.api_base_url,
            headers={"X-API-Key": settings.api_key},
            timeout=30.0,
        )

    def register_node(self) -> dict[str, Any] | None:
        """Register this compute node with the API."""
        try:
            resp = self.client.post(
                "/api/v1/task/nodes/register",
                json={
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
            resp = self.client.get(
                "/api/v1/task/poll",
                params={
                    "node_id": self.settings.node_id,
                    "capabilities": ",".join(self.settings.capabilities),
                },
            )
            resp.raise_for_status()
            data = resp.json()
            task = data.get("data", {}).get("task")
            if task:
                logger.info("Received task: %s (type=%s)", task.get("id"), task.get("task_type"))
            return task if task else None
        except Exception as exc:
            logger.warning("Poll failed: %s", exc)
            return None

    def submit_result(self, task_id: int, result: dict[str, Any]) -> None:
        """Submit task result to the API."""
        try:
            resp = self.client.post(
                f"/api/v1/task/{task_id}/result",
                json=result,
            )
            resp.raise_for_status()
            logger.info("Result submitted for task %d", task_id)
        except Exception as exc:
            logger.error("Failed to submit result for task %d: %s", task_id, exc)

    def submit_error(self, task_id: int, error: str) -> None:
        """Submit task error to the API."""
        try:
            resp = self.client.post(
                f"/api/v1/task/{task_id}/result",
                json={"output": "", "metadata": {"error": error}},
            )
            resp.raise_for_status()
            logger.info("Error submitted for task %d", task_id)
        except Exception as exc:
            logger.error("Failed to submit error for task %d: %s", task_id, exc)

    def close(self) -> None:
        """Close the HTTP client."""
        self.client.close()
