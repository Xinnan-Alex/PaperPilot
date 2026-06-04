from __future__ import annotations

from typing import Any

import pytest

from paperpilot import llm


class _Msg:
    def __init__(self, content: str) -> None:
        self.content = content


class _Choice:
    def __init__(self, content: str) -> None:
        self.message = _Msg(content)


class _Resp:
    def __init__(self, content: str) -> None:
        self.choices = [_Choice(content)]


async def test_complete_returns_message_content(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_acompletion(**kwargs: Any) -> _Resp:
        assert kwargs["stream"] is False
        return _Resp("hello world")

    monkeypatch.setattr(llm.litellm, "acompletion", fake_acompletion)
    out = await llm.complete("p/m", [{"role": "user", "content": "hi"}])
    assert out == "hello world"


async def test_complete_empty_choices_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Empty:
        choices: list[Any] = []

    async def fake_acompletion(**kwargs: Any) -> _Empty:
        return _Empty()

    monkeypatch.setattr(llm.litellm, "acompletion", fake_acompletion)
    out = await llm.complete("p/m", [{"role": "user", "content": "hi"}])
    assert out == ""
