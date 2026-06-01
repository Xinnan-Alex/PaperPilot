from __future__ import annotations

from typing import Any

import pytest

from paperpilot import tools
from paperpilot.tools import search_docs


@pytest.fixture(autouse=True)
def isolate_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "REGISTRY", {})
    search_docs.register_tool()


async def test_search_documents_returns_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_embed(query: str) -> list[float]:
        return [0.0] * 512

    async def fake_hybrid_search(
        session: Any,
        user_id: str,
        query: str,
        query_embedding: list[float],
        k: int = 5,
        doc_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        assert user_id == "u-1"
        assert k == 3
        assert doc_ids == ["d-1"]
        return [
            {
                "id": "c-1",
                "document_id": "d-1",
                "ordinal": 0,
                "page": 7,
                "text": "the relevant text",
                "filename": "paper.pdf",
            }
        ]

    monkeypatch.setattr(search_docs, "embed_query", lambda q: [0.0] * 512)
    monkeypatch.setattr(search_docs, "hybrid_search", fake_hybrid_search)

    ctx = tools.ToolContext(user_id="u-1", access_token="t", doc_ids=["d-1"], db_session=object())
    result = await tools.dispatch("search_documents", {"query": "what?", "top_k": 3}, ctx)

    assert "chunks" in result
    chunks = result["chunks"]
    assert len(chunks) == 1
    assert chunks[0]["chunk_id"] == "c-1"
    assert chunks[0]["document_id"] == "d-1"
    assert chunks[0]["filename"] == "paper.pdf"
    assert chunks[0]["page"] == 7
    assert chunks[0]["text"] == "the relevant text"


async def test_search_documents_default_top_k(monkeypatch: pytest.MonkeyPatch) -> None:
    captured = {}

    async def fake_hybrid_search(
        session: Any,
        user_id: str,
        query: str,
        query_embedding: list[float],
        k: int = 5,
        doc_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        captured["k"] = k
        return []

    monkeypatch.setattr(search_docs, "embed_query", lambda q: [0.0] * 512)
    monkeypatch.setattr(search_docs, "hybrid_search", fake_hybrid_search)

    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=object())
    await tools.dispatch("search_documents", {"query": "hi"}, ctx)
    assert captured["k"] == 5
