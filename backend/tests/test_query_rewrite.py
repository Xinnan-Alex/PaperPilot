from __future__ import annotations

from typing import Any

import pytest

from paperpilot import query_rewrite


async def test_expand_query_parses_json_array(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_complete(model: str, messages: list[Any], **kw: Any) -> str:
        return '["variant one", "variant two", "variant three"]'

    monkeypatch.setattr(query_rewrite, "complete", fake_complete)
    out = await query_rewrite.expand_query("orig", "p/m", 2)
    assert out == ["variant one", "variant two"]


async def test_expand_query_strips_code_fence(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_complete(model: str, messages: list[Any], **kw: Any) -> str:
        return '```json\n["a", "b"]\n```'

    monkeypatch.setattr(query_rewrite, "complete", fake_complete)
    out = await query_rewrite.expand_query("orig", "p/m", 5)
    assert out == ["a", "b"]


async def test_expand_query_malformed_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_complete(model: str, messages: list[Any], **kw: Any) -> str:
        return "not json at all"

    monkeypatch.setattr(query_rewrite, "complete", fake_complete)
    assert await query_rewrite.expand_query("orig", "p/m", 2) == []


async def test_expand_query_exception_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_complete(model: str, messages: list[Any], **kw: Any) -> str:
        raise RuntimeError("boom")

    monkeypatch.setattr(query_rewrite, "complete", fake_complete)
    assert await query_rewrite.expand_query("orig", "p/m", 2) == []


async def test_expand_query_zero_variants_returns_empty() -> None:
    assert await query_rewrite.expand_query("orig", "p/m", 0) == []
