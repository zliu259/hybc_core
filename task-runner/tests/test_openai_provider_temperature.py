"""_requires_default_temperature 必须兼容 AI Gateway 目录模型名（provider/model 前缀）。

背景：切换到 CF AI Gateway compat 端点后，模型名形如 openai/gpt-5.6-terra；
GPT-5 系列只接受默认 temperature，前缀导致识别失败会把 temperature=0.2
发给模型并收到 400 unsupported_value。
"""

import pytest

from runner.providers.openai_provider import OpenAIProvider


@pytest.mark.parametrize(
    ("model", "expected"),
    [
        # 直连时代的裸模型名（既有行为，不得回归）
        ("gpt-5.5", True),
        ("gpt-5-mini", True),
        ("gpt-4o", False),
        # AI Gateway 目录名：provider 前缀必须剥掉后再判
        ("openai/gpt-5.6-terra", True),
        ("openai/gpt-5.6-luna", True),
        ("openai/gpt-4o", False),
        ("anthropic/claude-sonnet-5", False),
        # 大小写与空白容错（沿用既有 strip/lower 语义）
        ("  OPENAI/GPT-5.6-TERRA  ", True),
    ],
)
def test_requires_default_temperature(model: str, expected: bool) -> None:
    assert OpenAIProvider._requires_default_temperature(model) is expected
