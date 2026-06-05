from __future__ import annotations

from typing import Any

import pytest

from paperpilot import embed


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[list[str], str]] = []

    def embed(self, batch: list[str], model: str, input_type: str) -> Any:
        self.calls.append((list(batch), input_type))

        class R:
            embeddings = [[0.1, 0.2, 0.3] for _ in batch]

        return R()


def test_embed_queries_uses_query_input_type(monkeypatch: pytest.MonkeyPatch) -> None:
    fc = FakeClient()
    monkeypatch.setattr(embed, "_get_client", lambda: fc)
    out = embed.embed_queries(["a", "b"])
    assert len(out) == 2
    assert fc.calls[0][1] == "query"
    assert fc.calls[0][0] == ["a", "b"]


def test_embed_query_delegates_to_embed_queries(monkeypatch: pytest.MonkeyPatch) -> None:
    fc = FakeClient()
    monkeypatch.setattr(embed, "_get_client", lambda: fc)
    out = embed.embed_query("hi")
    assert out == [0.1, 0.2, 0.3]
