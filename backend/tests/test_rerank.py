from __future__ import annotations

from typing import Any

import pytest

from paperpilot import rerank


class _Result:
    def __init__(self, index: int, score: float) -> None:
        self.index = index
        self.relevance_score = score


class _RerankResponse:
    def __init__(self, pairs: list[tuple[int, float]]) -> None:
        self.results = [_Result(i, s) for i, s in pairs]


class _FakeClient:
    def __init__(self, pairs: list[tuple[int, float]]) -> None:
        self._pairs = pairs

    def rerank(self, query: str, documents: list[str], model: str, top_k: int) -> _RerankResponse:
        return _RerankResponse(self._pairs[:top_k])


def test_rerank_reorders_by_score(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rerank.settings, "enable_rerank", True)
    monkeypatch.setattr(
        rerank, "_get_client", lambda: _FakeClient([(2, 0.9), (0, 0.8), (1, 0.1)])
    )
    out = rerank.rerank_documents("q", ["a", "b", "c"], top_k=2)
    assert out == [(2, 0.9), (0, 0.8)]


def test_rerank_disabled_returns_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rerank.settings, "enable_rerank", False)
    out = rerank.rerank_documents("q", ["a", "b", "c"], top_k=2)
    assert out == [(0, 0.0), (1, 0.0)]


def test_rerank_failure_returns_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(rerank.settings, "enable_rerank", True)

    class _Boom:
        def rerank(self, *a: Any, **k: Any) -> Any:
            raise RuntimeError("down")

    monkeypatch.setattr(rerank, "_get_client", lambda: _Boom())
    out = rerank.rerank_documents("q", ["a", "b"], top_k=5)
    assert out == [(0, 0.0), (1, 0.0)]


def test_rerank_empty_documents_returns_empty() -> None:
    assert rerank.rerank_documents("q", [], top_k=5) == []
