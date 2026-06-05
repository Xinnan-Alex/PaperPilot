from __future__ import annotations

from typing import Any

from paperpilot import providers
from paperpilot.citation import best_span
from paperpilot.config import settings
from paperpilot.embed import embed_queries
from paperpilot.query_rewrite import expand_query
from paperpilot.rerank import rerank_documents
from paperpilot.retrieve import multi_query_search
from paperpilot.tools import ToolContext, ToolSpec, register


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for it in items:
        key = it.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(it)
    return out


async def _handle(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    query = str(args["query"])
    top_k_budget, ctx_chars = providers.retrieval_budget(ctx.model)
    requested = args.get("top_k")
    top_k = min(int(requested), top_k_budget) if requested else top_k_budget
    top_k = max(1, top_k)

    queries = [query]
    if settings.enable_query_rewrite and ctx.model is not None:
        variants = await expand_query(query, ctx.model.litellm_id, settings.query_rewrite_variants)
        queries = _dedupe([query, *variants])[: settings.query_rewrite_variants + 1]

    embeddings = embed_queries(queries)
    candidates = await multi_query_search(
        ctx.db_session,
        ctx.user_id,
        queries,
        embeddings,
        pool=settings.retrieval_candidate_pool,
        doc_ids=ctx.doc_ids,
    )

    if settings.enable_rerank and candidates:
        order = rerank_documents(query, [c.get("text", "") for c in candidates], top_k)
    else:
        order = [(i, 0.0) for i in range(min(top_k, len(candidates)))]
    ranked = [{**candidates[i], "rerank_score": score} for i, score in order]

    kept: list[dict[str, Any]] = []
    used = 0
    for c in ranked:
        used += len(c.get("text", ""))
        if kept and used > ctx_chars:
            break
        kept.append(c)

    chunks: list[dict[str, Any]] = []
    for c in kept:
        span = best_span(c.get("text", ""), query)
        start, end = span if span else (None, None)
        chunks.append(
            {
                "chunk_id": str(c.get("id", "")),
                "document_id": str(c.get("document_id", "")),
                "ordinal": c.get("ordinal", 0),
                "page": c.get("page"),
                "text": c.get("text", ""),
                "filename": c.get("filename", "unknown"),
                "rerank_score": c.get("rerank_score", 0.0),
                "span_start": start,
                "span_end": end,
            }
        )
    return {"chunks": chunks}


SPEC: ToolSpec = {
    "name": "search_documents",
    "description": (
        "USE WHEN: the user asks a question whose answer is likely inside their "
        "uploaded documents. Performs semantic + keyword search and returns the "
        "top-k matching passages (with filename, page, and text). "
        "DO NOT USE for: listing what documents exist (use list_documents), "
        "getting a whole document's overview (use get_document_summary), or "
        "looking up information not in the user's documents (use web_search)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "A natural-language search query."},
            "top_k": {
                "type": "integer",
                "description": "Maximum number of chunks to return (1-20).",
                "minimum": 1,
                "maximum": 20,
            },
        },
        "required": ["query"],
    },
    "handler": _handle,
}


def register_tool() -> None:
    register(SPEC)
