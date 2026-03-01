from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class TaskResult:
    output: str
    tokens_input: int
    tokens_output: int
    latency_ms: int
    metadata: dict[str, object]


class BaseTaskProcessor(ABC):
    @abstractmethod
    def task_type(self) -> str: ...

    @abstractmethod
    def process(
        self,
        payload: dict[str, object],
        prompt_template: dict[str, str] | None = None,
    ) -> TaskResult: ...
