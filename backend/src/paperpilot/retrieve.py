from __future__ import annotations

from typing import Any

from rank_bm25 import BM25Okapi
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from paperpilot.store import search_vectors


def _tokenize(text: str) -> list[str]:
    return text.lower().split()


async def bm25_search(
    session: AsyncSession,
    user_id: str,
    query: str,
    k: int = 5,
    doc_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    stmt = text("""
        SELECT id, ordinal, page, text, document_id
        FROM chunks
        WHERE user_id = :user_id
    """)
    params: dict[str, Any] = {"user_id": user_id}
    if doc_ids:
        stmt = text(stmt.text + " AND document_id = ANY(CAST(:doc_ids AS uuid[]))")
        params["doc_ids"] = doc_ids

    result = await session.execute(stmt, params)
    rows: list[dict[str, Any]] = [dict(row._mapping) for row in result.fetchall()]

    if not rows:
        return []

    corpus: list[str] = [r["text"] for r in rows]
    tokenized_corpus: list[list[str]] = [_tokenize(t) for t in corpus]
    bm25 = BM25Okapi(tokenized_corpus)
    tokenized_query: list[str] = _tokenize(query)
    scores: list[float] = bm25.get_scores(tokenized_query)

    for r, score in zip(rows, scores):
        r["bm25_score"] = float(score)

    rows.sort(key=lambda r: r.get("bm25_score", 0), reverse=True)
    return rows[:k]


async def hybrid_search(
    session: AsyncSession,
    user_id: str,
    query: str,
    query_embedding: list[float],
    k: int = 5,
    doc_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    vector_results: list[dict[str, Any]] = await search_vectors(session, user_id, query_embedding, k=k * 2, doc_ids=doc_ids)
    bm25_results: list[dict[str, Any]] = await bm25_search(session, user_id, query, k=k * 2, doc_ids=doc_ids)

    scores: dict[str, float] = {}

    for rank, r in enumerate(vector_results):
        key: str = r["id"]
        scores[key] = scores.get(key, 0) + 1.0 / (60 + rank + 1)

    for rank, r in enumerate(bm25_results):
        key = r["id"]
        scores[key] = scores.get(key, 0) + 1.0 / (60 + rank + 1)

    merged: dict[str, dict[str, Any]] = {r["id"]: r for r in vector_results}
    for r in bm25_results:
        if r["id"] not in merged:
            merged[r["id"]] = r

    ranked: list[dict[str, Any]] = sorted(merged.values(), key=lambda r: scores.get(r["id"], 0), reverse=True)
    return ranked[:k]