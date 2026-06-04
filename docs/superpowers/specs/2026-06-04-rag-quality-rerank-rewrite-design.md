# RAG Quality: Reranking, Multi-Query Expansion, Citation Spans, Per-Model Budget

Date: 2026-06-04
Audit item: #3 — "Improve RAG quality with reranking and query rewriting"
References: `backend/src/paperpilot/retrieve.py`, `backend/src/paperpilot/tools/search_docs.py`, `backend/src/paperpilot/agent.py`

## Goal

Raise retrieval precision and answer grounding by upgrading the single-shot
`embed → hybrid_search → top 5` pipeline into a multi-stage pipeline:

```
query
  ─▶ multi-query expand        (1 cheap LLM call → 2 extra query variants)
  ─▶ embed each variant
  ─▶ hybrid_search ×N          (vector + Postgres FTS, existing)
  ─▶ RRF fuse                  (candidate pool, ~30 chunks)
  ─▶ Voyage rerank-2-lite      (vs original query → relevance scores)
  ─▶ keep top_k                (per-model budget)
  ─▶ context-char cap          (per-model budget)
  ─▶ best-span                 (lexical highlight offsets)
  ─▶ return
```

Every new external step (rewrite, rerank) is wrapped in try/except and degrades
to the prior behavior on failure. Worst case equals today's search; the new
features are pure upside, never a new failure mode.

## Scope (decided in brainstorming)

- **Reranking** — Voyage `rerank-2-lite` (reuses existing Voyage SDK + API key).
- **Query rewriting** — multi-query expansion (original + N variants, RRF-fused).
- **Citation spans** — best lexical span (char offsets) within each chunk; no
  migration, no API call.
- **Configurable top_k / context** — explicit optional per-model fields in
  `models.json`, falling back to global defaults in `config.py`.

Out of scope: absolute char offsets into the original source document (would need
an ingest-time migration); LLM-extracted citation quotes; local cross-encoder
rerankers.

## Architecture

### New modules (backend)

| File | Public surface | Responsibility | Depends on |
|------|----------------|----------------|------------|
| `query_rewrite.py` | `async expand_query(query: str, litellm_id: str, n: int) -> list[str]` | One non-streaming LLM call returns up to `n` standalone query variants. Returns `[]` on any failure or if disabled. | `llm.complete`, `config` |
| `rerank.py` | `rerank_documents(query: str, documents: list[str], top_k: int) -> list[tuple[int, float]]` | Voyage `rerank-2-lite`. Returns `(original_index, relevance_score)` pairs ordered best-first. Falls back to identity order `[(0, 0.0), (1, 0.0), …][:top_k]` on any failure or if disabled. | `voyageai`, `config` |
| `citation.py` | `best_span(text: str, query: str) -> tuple[int, int] | None` | Pure function. Finds the sentence-window in `text` with highest query-term overlap; returns `(start, end)` char offsets or `None`. No I/O. | stdlib only |

### Changed modules

**`llm.py`** — add a non-streaming helper used by query rewrite:
```python
async def complete(
    model: str,
    messages: list[dict[str, Any]],
    temperature: float = 0.0,
    max_tokens: int = 256,
) -> str:
    """Non-streaming completion → returns assistant message content (or "")."""
```
Wraps `litellm.acompletion(..., stream=False)`. Reuses the existing logging and
exception pattern from `stream_completion`.

**`embed.py`** — add batch query embedding:
```python
def embed_queries(texts: list[str], batch_size: int = 128) -> list[list[float]]:
    """Like embed_documents but input_type='query'. Embeds N variants in one call."""
```
`embed_query` becomes `embed_queries([text])[0]` to avoid duplication.

**`retrieve.py`** — add multi-query fusion on top of the existing `hybrid_search`:
```python
async def multi_query_search(
    session: AsyncSession,
    user_id: str,
    queries: list[str],
    query_embeddings: list[list[float]],
    pool: int,
    doc_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Run hybrid_search for each (query, embedding) pair, RRF-fuse all results
    into a unique-chunk candidate pool of size `pool`, ordered best-first."""
```
`hybrid_search` itself is unchanged. `multi_query_search` reuses the same RRF
math (`1 / (60 + rank)`), summing each chunk's contribution across every query's
result list, so chunks found by multiple variants rank higher.

**`providers.py` / `ModelSpec` / manifest** — add optional per-model retrieval
budget fields and a resolver:
```python
class ModelSpec(BaseModel):
    ...
    retrieval_top_k: int | None = None
    retrieval_context_chars: int | None = None

class _ModelManifestEntry(BaseModel):
    ...
    retrieval_top_k: int | None = None
    retrieval_context_chars: int | None = None

def retrieval_budget(spec: ModelSpec) -> tuple[int, int]:
    """(top_k, context_chars) — per-model value or global default from settings."""
    top_k = spec.retrieval_top_k or settings.retrieval_top_k
    ctx = spec.retrieval_context_chars or settings.retrieval_context_chars
    return top_k, ctx
```

**`config.py`** — new global settings (all overridable via `backend/.env`):
```python
# Retrieval pipeline
rerank_model: str = "rerank-2-lite"
enable_rerank: bool = True
enable_query_rewrite: bool = True
query_rewrite_variants: int = 2          # extra variants beyond the original
retrieval_top_k: int = 5                 # global default; per-model overrides
retrieval_candidate_pool: int = 30       # rerank input size (over-fetch target)
retrieval_context_chars: int = 8000      # global default; per-model overrides
```

**`tools/__init__.py` `ToolContext`** — add the resolved model so the tool can
read its retrieval budget and `litellm_id`:
```python
@dataclass
class ToolContext:
    user_id: str
    access_token: str
    doc_ids: list[str] | None
    db_session: Any
    model: Any = None   # resolved ModelSpec; typed Any to avoid import cycle
```

**`agent.py`** — `spec` is already resolved at line 97; pass it into the
`ToolContext(... , model=spec)` constructor. No other change.

**`tools/search_docs.py` `_handle`** — orchestrate the full pipeline (see below).
Output chunks gain three fields: `rerank_score`, `span_start`, `span_end`.

### Frontend (makes spans visible)

**`lib/api.ts` `SSESource`** — add optional fields:
```ts
export interface SSESource {
  ...
  span_start?: number | null;
  span_end?: number | null;
}
```

**`components/ChatBox.tsx`** — in the source card (currently renders `src.text`
in a `line-clamp-3` paragraph), wrap the `[span_start, span_end)` substring in a
`<mark>` when both offsets are present; otherwise render `src.text` unchanged.

## Data flow: `search_documents._handle`

```python
async def _handle(args, ctx):
    query = str(args["query"])
    top_k_budget, ctx_chars = providers.retrieval_budget(ctx.model)
    # LLM may request fewer, never more than the per-model budget
    requested = args.get("top_k")
    top_k = min(int(requested), top_k_budget) if requested else top_k_budget
    top_k = max(1, top_k)

    # 1. expand (degrades to [original] only)
    queries = [query]
    if settings.enable_query_rewrite and ctx.model:
        queries += await expand_query(query, ctx.model.litellm_id,
                                      settings.query_rewrite_variants)
    queries = dedupe(queries)[: settings.query_rewrite_variants + 1]

    # 2. embed all variants in one Voyage call
    embeddings = embed_queries(queries)

    # 3+4. multi-query hybrid search → RRF candidate pool
    candidates = await multi_query_search(
        ctx.db_session, ctx.user_id, queries, embeddings,
        pool=settings.retrieval_candidate_pool, doc_ids=ctx.doc_ids,
    )

    # 5. rerank vs ORIGINAL query (degrades to candidate order)
    order = rerank_documents(query, [c["text"] for c in candidates], top_k) \
            if (settings.enable_rerank and candidates) else \
            [(i, 0.0) for i in range(min(top_k, len(candidates)))]
    ranked = [{**candidates[i], "rerank_score": score} for i, score in order]

    # 6. context-char cap (drop lowest-ranked past budget)
    kept, used = [], 0
    for c in ranked:
        used += len(c["text"])
        if kept and used > ctx_chars:
            break
        kept.append(c)

    # 7. best-span per kept chunk (degrades to null)
    for c in kept:
        span = best_span(c["text"], query)
        c["span_start"], c["span_end"] = span if span else (None, None)

    return {"chunks": [project(c) for c in kept]}   # adds rerank_score, span_*
```

Notes:
- Rerank uses the **original** query (canonical user intent), not the variants.
- The candidate pool is built from variants (recall); rerank decides final order
  (precision).
- Context cap always keeps at least one chunk even if it alone exceeds the budget.

## Error handling / degradation

| Step fails (API down, timeout, no key, bad JSON) | Fallback |
|---|---|
| `expand_query` | returns `[]` → search uses original query only |
| `embed_queries` | propagates (today's `embed_query` already can raise; unchanged contract) |
| `rerank_documents` | returns identity order → candidate (hybrid) order preserved |
| `best_span` | returns `None` → `span_*` = null, full chunk text shown |

`expand_query` and `rerank_documents` each own their try/except and log a warning
via the existing `get_logger()` pattern. The tool dispatcher in
`tools/__init__.py` already catches any escaped exception and returns
`{"error": ...}`, so the agent loop is never broken.

## Testing

Backend unit tests (pytest), no live API calls:

| Test | Covers |
|------|--------|
| `test_citation.py` | `best_span`: exact match, no-overlap → `None`, span within bounds, multi-sentence selection, empty query/text |
| `test_query_rewrite.py` | `expand_query` parses variant list from a mocked `llm.complete`; returns `[]` on malformed output and on raised exception |
| `test_rerank.py` | `rerank_documents` reorders by mocked Voyage scores; identity fallback when client raises / disabled; respects `top_k` |
| `test_retrieve_multi.py` | `multi_query_search` RRF fusion: chunk in multiple variant results outranks single-variant chunk; pool size capped; dedupe by chunk id |
| `test_providers_budget.py` | `retrieval_budget` returns per-model value when set, global default otherwise |

Mock Voyage (`rerank.py`) and `llm.complete` via monkeypatch. `best_span` and
`retrieval_budget` are pure → direct assertions.

## Config / ops

- No new API key — Voyage rerank reuses `voyage_api_key`.
- No DB migration — citation spans are computed at query time.
- Rollback / kill-switches: `enable_rerank=false` and `enable_query_rewrite=false`
  independently revert to today's behavior with zero code change.
- Latency budget per search: +1 small LLM call (rewrite) + N query embeds (one
  batched Voyage call) + N hybrid searches + 1 Voyage rerank call. Bounded by
  `query_rewrite_variants=2` (3 queries total).

## Implementation order

1. `config.py` settings + `ModelSpec`/manifest fields + `retrieval_budget`.
2. `citation.py` + tests (pure, isolated).
3. `embed.py` `embed_queries`; `retrieve.py` `multi_query_search` + tests.
4. `llm.py` `complete`; `query_rewrite.py` + tests.
5. `rerank.py` + tests.
6. `ToolContext.model` + `agent.py` wiring.
7. `tools/search_docs.py` pipeline orchestration.
8. Frontend `SSESource` fields + `ChatBox` `<mark>` highlight.
9. `models.json`: set example per-model `retrieval_top_k` / `retrieval_context_chars`.
10. `CLAUDE.md`: update `retrieve.py` row + query-flow description.
