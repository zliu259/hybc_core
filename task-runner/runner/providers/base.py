from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class ProviderResult:
    """Result from an AI provider execution."""

    output: str
    tokens_input: int = 0
    tokens_output: int = 0
    latency_ms: int = 0
    metadata: dict = field(default_factory=dict)


class AiProvider(ABC):
    """Abstract base class for AI providers."""

    @abstractmethod
    def execute(
        self,
        task_type: str,
        payload: dict,
        prompt: dict | None = None,
    ) -> ProviderResult:
        """Execute a task and return the result."""
        ...

    @abstractmethod
    def supports(self, task_type: str) -> bool:
        """Check if this provider supports the given task type."""
        ...
