from __future__ import annotations

import os
from collections.abc import Iterator

import pytest


@pytest.fixture
def clear_provider_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for var in (
        "OPENAI_API_KEY",
        "DEEPSEEK_API_KEY",
        "GROQ_API_KEY",
        "MISTRAL_API_KEY",
        "TAVILY_API_KEY",
    ):
        monkeypatch.delenv(var, raising=False)
        os.environ.pop(var, None)
    yield
