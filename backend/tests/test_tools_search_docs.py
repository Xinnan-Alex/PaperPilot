from __future__ import annotations

from typing import Any

import pytest

from paperpilot import tools
from paperpilot.providers import ModelSpec
from paperpilot.tools import search_docs


@pytest.fixture(autouse=True)
def isolate_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "REGISTRY", {})
    search_docs.register_tool()


async def test_search_documents_returns_chunks_with_span(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(search_docs.settings, "enable_query_rewrite", False)
    monkeypatch.setattr(search_docs.settings, "enable_rerank", False)
    monkeypatch.setattr(search_docs, "embed_queries", lambda qs: [[0.0] * 512 for _ in qs])

    async def fake_multi(
        session: Any,
        user_id: str,
        queries: list[str],
        embeddings: list[list[float]],
        pool: int,
        doc_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        assert user_id == "u-1"
        assert doc_ids == ["d-1"]
        return [
            {
                "id": "c-1",
                "document_id": "d-1",
                "ordinal": 0,
                "page": 7,
                "text": "On the hard test set the model reached 91 percent.",
                "filename": "paper.pdf",
            }
        ]

    monkeypatch.setattr(search_docs, "multi_query_search", fake_multi)

    ctx = tools.ToolContext(user_id="u-1", access_token="t", doc_ids=["d-1"], db_session=object())
    result = await tools.dispatch(
        "search_documents", {"query": "hard test set", "top_k": 3}, ctx
    )

    chunks = result["chunks"]
    assert len(chunks) == 1
    assert chunks[0]["chunk_id"] == "c-1"
    assert chunks[0]["page"] == 7
    assert chunks[0]["rerank_score"] == 0.0
    assert chunks[0]["span_start"] is not None
    assert chunks[0]["span_end"] is not None


async def test_search_documents_default_top_k_and_no_rewrite(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    monkeypatch.setattr(search_docs.settings, "enable_query_rewrite", False)
    monkeypatch.setattr(search_docs.settings, "enable_rerank", False)
    monkeypatch.setattr(search_docs, "embed_queries", lambda qs: [[0.0] * 512 for _ in qs])

    async def fake_multi(
        session: Any,
        user_id: str,
        queries: list[str],
        embeddings: list[list[float]],
        pool: int,
        doc_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        captured["queries"] = queries
        captured["pool"] = pool
        return []

    monkeypatch.setattr(search_docs, "multi_query_search", fake_multi)

    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=object())
    await tools.dispatch("search_documents", {"query": "hi"}, ctx)

    assert captured["queries"] == ["hi"]
    assert captured["pool"] == search_docs.settings.retrieval_candidate_pool


async def test_search_documents_rewrite_and_rerank(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(search_docs.settings, "enable_query_rewrite", True)
    monkeypatch.setattr(search_docs.settings, "enable_rerank", True)
    monkeypatch.setattr(search_docs.settings, "query_rewrite_variants", 2)

    async def fake_expand(query: str, litellm_id: str, n: int) -> list[str]:
        assert litellm_id == "p/m"
        return ["variant a", "variant b"]

    monkeypatch.setattr(search_docs, "expand_query", fake_expand)
    monkeypatch.setattr(search_docs, "embed_queries", lambda qs: [[0.0] * 512 for _ in qs])

    captured: dict[str, Any] = {}

    async def fake_multi(
        session: Any,
        user_id: str,
        queries: list[str],
        embeddings: list[list[float]],
        pool: int,
        doc_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        captured["queries"] = queries
        return [
            {"id": "c-1", "document_id": "d", "ordinal": 0, "page": 1, "text": "alpha", "filename": "f"},  # noqa: E501
            {"id": "c-2", "document_id": "d", "ordinal": 1, "page": 1, "text": "beta", "filename": "f"},  # noqa: E501
        ]

    monkeypatch.setattr(search_docs, "multi_query_search", fake_multi)
    monkeypatch.setattr(
        search_docs,
        "rerank_documents",
        lambda q, docs, top_k: [(1, 0.9), (0, 0.2)][:top_k],
    )

    spec = ModelSpec(
        id="m",
        litellm_id="p/m",
        provider="p",
        display_name="M",
        context_window=1000,
        api_key_env="X",
        retrieval_top_k=2,
    )
    ctx = tools.ToolContext(
        user_id="u", access_token="t", doc_ids=None, db_session=object(), model=spec
    )
    result = await tools.dispatch("search_documents", {"query": "orig"}, ctx)

    assert captured["queries"] == ["orig", "variant a", "variant b"]
    ids = [c["chunk_id"] for c in result["chunks"]]
    assert ids == ["c-2", "c-1"]
    assert result["chunks"][0]["rerank_score"] == 0.9
