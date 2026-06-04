from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from paperpilot.store import search_vectors


async def keyword_search(
    session: AsyncSession,
    user_id: str,
    query: str,
    k: int = 5,
    doc_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    stmt = text("""
        WITH q AS (
            SELECT websearch_to_tsquery('english', :query) AS query
        )
        SELECT c.id, c.document_id, c.ordinal, c.page, c.text,
               ts_rank_cd(c.search_vector, q.query) AS keyword_score,
               d.filename, d.storage_path
        FROM chunks c
        JOIN documents d ON c.document_id = d.id
        CROSS JOIN q
        WHERE c.user_id = :user_id
          AND c.search_vector @@ q.query
    """)
    params: dict[str, Any] = {"user_id": user_id, "query": query, "k": k}
    if doc_ids:
        stmt = text(stmt.text + " AND c.document_id = ANY(CAST(:doc_ids AS uuid[]))")
        params["doc_ids"] = doc_ids

    stmt = text(stmt.text + " ORDER BY keyword_score DESC, c.created_at DESC LIMIT :k")
    result = await session.execute(stmt, params)
    return [
        {key: (str(value) if isinstance(value, uuid.UUID) else value) for key, value in row.items()}
        for row in (dict(row._mapping) for row in result.fetchall())
    ]


async def hybrid_search(
    session: AsyncSession,
    user_id: str,
    query: str,
    query_embedding: list[float],
    k: int = 5,
    doc_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    vector_results: list[dict[str, Any]] = await search_vectors(
        session, user_id, query_embedding, k=k * 2, doc_ids=doc_ids
    )
    keyword_results: list[dict[str, Any]] = await keyword_search(
        session, user_id, query, k=k * 2, doc_ids=doc_ids
    )

    scores: dict[str, float] = {}

    for rank, r in enumerate(vector_results):
        key: str = r["id"]
        scores[key] = scores.get(key, 0) + 1.0 / (60 + rank + 1)

    for rank, r in enumerate(keyword_results):
        key = r["id"]
        scores[key] = scores.get(key, 0) + 1.0 / (60 + rank + 1)

    merged: dict[str, dict[str, Any]] = {r["id"]: r for r in vector_results}
    for r in keyword_results:
        if r["id"] not in merged:
            merged[r["id"]] = r

    ranked: list[dict[str, Any]] = sorted(
        merged.values(), key=lambda r: scores.get(r["id"], 0), reverse=True
    )
    return ranked[:k]


async def multi_query_search(
    session: AsyncSession,
    user_id: str,
    queries: list[str],
    query_embeddings: list[list[float]],
    pool: int,
    doc_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Run hybrid_search for each (query, embedding) pair and RRF-fuse all
    results into a unique-chunk candidate pool of size `pool`."""
    scores: dict[str, float] = {}
    merged: dict[str, dict[str, Any]] = {}
    per_query_k = max(pool, 5)
    for query, embedding in zip(queries, query_embeddings):
        results = await hybrid_search(
            session, user_id, query, embedding, k=per_query_k, doc_ids=doc_ids
        )
        for rank, r in enumerate(results):
            cid: str = r["id"]
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (60 + rank + 1)
            merged.setdefault(cid, r)
    ranked: list[dict[str, Any]] = sorted(
        merged.values(), key=lambda r: scores[r["id"]], reverse=True
    )
    return ranked[:pool]
