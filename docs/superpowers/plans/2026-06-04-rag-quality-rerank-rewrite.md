# RAG Quality (Rerank, Multi-Query, Citation Spans, Per-Model Budget) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shot `embed → hybrid_search → top 5` retrieval with a multi-stage pipeline (multi-query expansion → fused candidate pool → Voyage rerank → per-model budget → lexical citation spans), every new stage independently toggleable and self-degrading.

**Architecture:** Three new backend modules (`citation.py`, `query_rewrite.py`, `rerank.py`) plus additions to `embed.py`, `retrieve.py`, `llm.py`, `providers.py`, `config.py`. The `search_documents` tool orchestrates the pipeline; `ToolContext` carries the resolved model so the tool can read its per-model budget and `litellm_id`. Frontend gains optional citation-span fields and a `<mark>` highlight.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy async, Voyage AI SDK (embeddings + `rerank-2-lite`), LiteLLM, pytest (`asyncio_mode=auto`), React 19 + TypeScript + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-04-rag-quality-rerank-rewrite-design.md`

**Conventions (from existing tests):** Tests live in `backend/tests/`, run with `uv run pytest`. `asyncio_mode = "auto"` — async test functions need no decorator. Mock collaborators with `monkeypatch.setattr`. `settings` is a mutable pydantic instance — `monkeypatch.setattr(module.settings, "flag", value)` works. All backend commands run from `backend/`.

---

## File Structure

| File | Create / Modify | Responsibility |
|------|-----------------|----------------|
| `backend/src/paperpilot/config.py` | Modify | Retrieval pipeline settings (flags, defaults, pool size) |
| `backend/src/paperpilot/providers.py` | Modify | Optional per-model `retrieval_top_k` / `retrieval_context_chars` + `retrieval_budget()` |
| `backend/src/paperpilot/citation.py` | Create | Pure `best_span(text, query)` lexical highlighter |
| `backend/src/paperpilot/embed.py` | Modify | `embed_queries(list)` batch; `embed_query` delegates |
| `backend/src/paperpilot/retrieve.py` | Modify | `multi_query_search(...)` RRF fusion across query variants |
| `backend/src/paperpilot/llm.py` | Modify | `complete(...)` non-streaming helper |
| `backend/src/paperpilot/query_rewrite.py` | Create | `expand_query(...)` LLM multi-query expansion (degrades to `[]`) |
| `backend/src/paperpilot/rerank.py` | Create | `rerank_documents(...)` Voyage rerank (degrades to identity) |
| `backend/src/paperpilot/tools/__init__.py` | Modify | `ToolContext.model` field |
| `backend/src/paperpilot/agent.py` | Modify | Pass resolved `spec` into `ToolContext` |
| `backend/src/paperpilot/tools/search_docs.py` | Modify | Orchestrate the full pipeline |
| `backend/models.json` | Modify | Example per-model retrieval budgets |
| `frontend/src/lib/api.ts` | Modify | `SSESource.span_start` / `span_end` |
| `frontend/src/components/ChatBox.tsx` | Modify | `<mark>` span highlight in source card |
| `CLAUDE.md` | Modify | Update `retrieve.py` row + query-flow docs |

Test files: `backend/tests/test_citation.py` (new), `test_embed.py` (new), `test_query_rewrite.py` (new), `test_rerank.py` (new), `test_providers_budget.py` (new), `test_retrieve.py` (extend), `test_tools_search_docs.py` (rewrite).

---

## Task 1: Config settings

**Files:**
- Modify: `backend/src/paperpilot/config.py`

- [ ] **Step 1: Add retrieval settings**

In `backend/src/paperpilot/config.py`, immediately after the `agent_max_iterations: int = 5` line (the "Agent defaults" block), add:

```python
    # Retrieval pipeline
    rerank_model: str = "rerank-2-lite"
    enable_rerank: bool = True
    enable_query_rewrite: bool = True
    query_rewrite_variants: int = 2
    retrieval_top_k: int = 5
    retrieval_candidate_pool: int = 30
    retrieval_context_chars: int = 8000
```

- [ ] **Step 2: Verify it imports**

Run: `cd backend && uv run python -c "from paperpilot.config import settings; print(settings.rerank_model, settings.retrieval_top_k, settings.enable_rerank)"`
Expected: `rerank-2-lite 5 True`

- [ ] **Step 3: Commit**

```bash
git add backend/src/paperpilot/config.py
git commit -m "feat(config): add retrieval pipeline settings"
```

---

## Task 2: Per-model retrieval budget

**Files:**
- Modify: `backend/src/paperpilot/providers.py`
- Test: `backend/tests/test_providers_budget.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_providers_budget.py`:

```python
from __future__ import annotations

from paperpilot.config import settings
from paperpilot.providers import ModelSpec, retrieval_budget


def _spec(**kw: object) -> ModelSpec:
    base: dict[str, object] = dict(
        id="m",
        litellm_id="p/m",
        provider="p",
        display_name="M",
        context_window=1000,
        api_key_env="X",
    )
    base.update(kw)
    return ModelSpec(**base)  # type: ignore[arg-type]


def test_budget_global_default_when_unset() -> None:
    assert retrieval_budget(_spec()) == (
        settings.retrieval_top_k,
        settings.retrieval_context_chars,
    )


def test_budget_per_model_override() -> None:
    spec = _spec(retrieval_top_k=8, retrieval_context_chars=20000)
    assert retrieval_budget(spec) == (8, 20000)


def test_budget_none_spec_uses_global() -> None:
    assert retrieval_budget(None) == (
        settings.retrieval_top_k,
        settings.retrieval_context_chars,
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_providers_budget.py -v`
Expected: FAIL — `ImportError: cannot import name 'retrieval_budget'` (and `ModelSpec` rejects `retrieval_top_k`).

- [ ] **Step 3: Add fields + resolver**

In `backend/src/paperpilot/providers.py`, add two fields to `ModelSpec` (after the `default: bool = False` line):

```python
    retrieval_top_k: int | None = None
    retrieval_context_chars: int | None = None
```

Add the same two fields to `_ModelManifestEntry` (after its `default: bool = False` line):

```python
    retrieval_top_k: int | None = None
    retrieval_context_chars: int | None = None
```

In `_load_manifest`, where `ModelSpec(...)` is constructed inside the loop, add the two pass-through kwargs (after `default=m.default,`):

```python
                    retrieval_top_k=m.retrieval_top_k,
                    retrieval_context_chars=m.retrieval_context_chars,
```

Add this function at the end of the file (after `resolve`):

```python
def retrieval_budget(spec: ModelSpec | None) -> tuple[int, int]:
    """(top_k, context_chars) — per-model override or global default."""
    if spec is None:
        return settings.retrieval_top_k, settings.retrieval_context_chars
    top_k = spec.retrieval_top_k or settings.retrieval_top_k
    ctx = spec.retrieval_context_chars or settings.retrieval_context_chars
    return top_k, ctx
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_providers_budget.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Run existing provider tests (no regression)**

Run: `cd backend && uv run pytest tests/test_providers.py -v`
Expected: PASS (all existing tests).

- [ ] **Step 6: Commit**

```bash
git add backend/src/paperpilot/providers.py backend/tests/test_providers_budget.py
git commit -m "feat(providers): per-model retrieval budget with global fallback"
```

---

## Task 3: Citation best-span (pure function)

**Files:**
- Create: `backend/src/paperpilot/citation.py`
- Test: `backend/tests/test_citation.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_citation.py`:

```python
from __future__ import annotations

from paperpilot.citation import best_span


def test_best_span_finds_matching_sentence() -> None:
    text = "Intro text here. On the hard test set the model reached 91 percent. Future work."
    span = best_span(text, "how did the model do on the hard test set?")
    assert span is not None
    start, end = span
    assert text[start:end] == "On the hard test set the model reached 91 percent."


def test_best_span_no_overlap_returns_none() -> None:
    assert best_span("completely unrelated content.", "quantum chromodynamics") is None


def test_best_span_empty_inputs_return_none() -> None:
    assert best_span("", "q") is None
    assert best_span("text", "") is None


def test_best_span_only_stopwords_returns_none() -> None:
    assert best_span("Alpha beta gamma.", "the and of to") is None


def test_best_span_within_bounds() -> None:
    text = "Alpha beta. Gamma delta epsilon."
    span = best_span(text, "gamma epsilon")
    assert span is not None
    start, end = span
    assert 0 <= start < end <= len(text)
    assert text[start:end] == "Gamma delta epsilon."
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_citation.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'paperpilot.citation'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/paperpilot/citation.py`:

```python
from __future__ import annotations

import re

_WORD = re.compile(r"[a-z0-9]+")
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")
_STOP = frozenset(
    {
        "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is",
        "are", "was", "were", "be", "been", "by", "with", "as", "at", "that",
        "this", "it", "from", "how", "did", "do", "does", "what", "which",
        "who", "whom", "whose", "why", "when",
    }
)


def _tokens(s: str) -> set[str]:
    return {w for w in _WORD.findall(s.lower()) if w not in _STOP}


def best_span(text: str, query: str) -> tuple[int, int] | None:
    """Char offsets (start, end) of the sentence in `text` with the highest
    overlap of meaningful query terms. None when inputs are empty or nothing
    overlaps."""
    if not text or not query:
        return None
    q = _tokens(query)
    if not q:
        return None

    best: tuple[int, int] | None = None
    best_score = 0
    pos = 0
    for sentence in _SENT_SPLIT.split(text):
        start = text.find(sentence, pos)
        if start < 0:
            start = pos
        end = start + len(sentence)
        pos = end
        score = len(q & _tokens(sentence))
        if score > best_score:
            best_score = score
            best = (start, end)
    return best
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_citation.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/paperpilot/citation.py backend/tests/test_citation.py
git commit -m "feat(citation): lexical best-span highlighter"
```

---

## Task 4: Batch query embeddings

**Files:**
- Modify: `backend/src/paperpilot/embed.py`
- Test: `backend/tests/test_embed.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_embed.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_embed.py -v`
Expected: FAIL — `AttributeError: module 'paperpilot.embed' has no attribute 'embed_queries'`.

- [ ] **Step 3: Implement `embed_queries`, refactor `embed_query`**

In `backend/src/paperpilot/embed.py`, replace the entire `embed_query` function (lines 46-61) with:

```python
def embed_queries(texts: list[str], batch_size: int = 128) -> list[list[float]]:
    client: voyageai.Client = _get_client()
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch: list[str] = texts[i : i + batch_size]
        try:
            result = client.embed(
                batch,
                model=settings.embedding_model,
                input_type="query",
            )
        except Exception:
            _log.exception(
                "voyage_embed_queries_failed",
                model=settings.embedding_model,
                batch_index=i // batch_size,
                batch_size=len(batch),
            )
            raise
        all_embeddings.extend(result.embeddings)
    return all_embeddings


def embed_query(text: str) -> list[float]:
    return embed_queries([text])[0]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_embed.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/paperpilot/embed.py backend/tests/test_embed.py
git commit -m "feat(embed): batch query embeddings via embed_queries"
```

---

## Task 5: Multi-query fusion search

**Files:**
- Modify: `backend/src/paperpilot/retrieve.py`
- Test: `backend/tests/test_retrieve.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_retrieve.py`:

```python
async def test_multi_query_search_fuses_and_ranks(monkeypatch: pytest.MonkeyPatch) -> None:
    from paperpilot import retrieve

    async def fake_hybrid(
        session: Any,
        user_id: str,
        query: str,
        query_embedding: list[float],
        k: int = 5,
        doc_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        if query == "q1":
            return [{"id": "c-1", "text": "a"}, {"id": "c-2", "text": "b"}]
        return [{"id": "c-2", "text": "b"}, {"id": "c-3", "text": "c"}]

    monkeypatch.setattr(retrieve, "hybrid_search", fake_hybrid)
    rows = await retrieve.multi_query_search(
        cast(AsyncSession, object()),
        "u-1",
        ["q1", "q2"],
        [[0.0], [0.0]],
        pool=10,
    )
    ids = [r["id"] for r in rows]
    assert ids[0] == "c-2"  # found by both queries → highest fused score
    assert set(ids) == {"c-1", "c-2", "c-3"}
    assert len(ids) == 3


async def test_multi_query_search_respects_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    from paperpilot import retrieve

    async def fake_hybrid(
        session: Any,
        user_id: str,
        query: str,
        query_embedding: list[float],
        k: int = 5,
        doc_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        return [{"id": f"c-{i}", "text": "x"} for i in range(5)]

    monkeypatch.setattr(retrieve, "hybrid_search", fake_hybrid)
    rows = await retrieve.multi_query_search(
        cast(AsyncSession, object()), "u-1", ["q1"], [[0.0]], pool=3
    )
    assert len(rows) == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_retrieve.py -v`
Expected: FAIL — `AttributeError: module 'paperpilot.retrieve' has no attribute 'multi_query_search'`.

- [ ] **Step 3: Implement `multi_query_search`**

Append to `backend/src/paperpilot/retrieve.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_retrieve.py -v`
Expected: PASS (existing keyword test + 2 new tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/paperpilot/retrieve.py backend/tests/test_retrieve.py
git commit -m "feat(retrieve): multi-query RRF fusion search"
```

---

## Task 6: Non-streaming LLM helper

**Files:**
- Modify: `backend/src/paperpilot/llm.py`
- Test: `backend/tests/test_llm_complete.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_llm_complete.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_llm_complete.py -v`
Expected: FAIL — `AttributeError: module 'paperpilot.llm' has no attribute 'complete'`.

- [ ] **Step 3: Implement `complete`**

Append to `backend/src/paperpilot/llm.py`:

```python
async def complete(
    model: str,
    messages: list[dict[str, Any]],
    temperature: float = 0.0,
    max_tokens: int = 256,
) -> str:
    """Non-streaming completion → assistant message content (or "")."""
    log = get_logger().bind(component="llm", model=model)
    try:
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=False,
        )
    except Exception:
        log.exception("llm_complete_failed")
        raise
    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""
    return getattr(choices[0].message, "content", "") or ""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_llm_complete.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/paperpilot/llm.py backend/tests/test_llm_complete.py
git commit -m "feat(llm): non-streaming complete helper"
```

---

## Task 7: Query rewrite (multi-query expansion)

**Files:**
- Create: `backend/src/paperpilot/query_rewrite.py`
- Test: `backend/tests/test_query_rewrite.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_query_rewrite.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_query_rewrite.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'paperpilot.query_rewrite'`.

- [ ] **Step 3: Implement `expand_query`**

Create `backend/src/paperpilot/query_rewrite.py`:

```python
from __future__ import annotations

import json

from paperpilot.llm import complete
from paperpilot.logging import get_logger

_log = get_logger().bind(component="query_rewrite")

_SYSTEM = (
    "You rewrite a search query into alternative phrasings to improve document "
    "retrieval. Return ONLY a JSON array of distinct standalone query strings "
    "(no prose, no markdown). Each variant must preserve the original intent but "
    "vary wording, synonyms, or specificity."
)


async def expand_query(query: str, litellm_id: str, n: int) -> list[str]:
    """Up to `n` alternative phrasings of `query`. Best-effort: returns [] on
    any failure, malformed output, or non-positive n."""
    if n <= 0:
        return []
    try:
        raw = await complete(
            model=litellm_id,
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": f"Query: {query}\nReturn {n} variants."},
            ],
        )
        text = raw.strip()
        start, end = text.find("["), text.rfind("]")
        if start < 0 or end <= start:
            return []
        parsed = json.loads(text[start : end + 1])
        if not isinstance(parsed, list):
            return []
        variants = [str(v).strip() for v in parsed if str(v).strip()]
        return variants[:n]
    except Exception as exc:
        _log.warning("query_rewrite_failed", error=str(exc))
        return []
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_query_rewrite.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/paperpilot/query_rewrite.py backend/tests/test_query_rewrite.py
git commit -m "feat(query-rewrite): LLM multi-query expansion with graceful fallback"
```

---

## Task 8: Voyage reranker

**Files:**
- Create: `backend/src/paperpilot/rerank.py`
- Test: `backend/tests/test_rerank.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_rerank.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_rerank.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'paperpilot.rerank'`.

- [ ] **Step 3: Implement `rerank_documents`**

Create `backend/src/paperpilot/rerank.py`:

```python
from __future__ import annotations

import voyageai

from paperpilot.config import settings
from paperpilot.logging import get_logger

_client: voyageai.Client | None = None
_log = get_logger().bind(component="rerank")


def _get_client() -> voyageai.Client:
    global _client
    if _client is None:
        _client = voyageai.Client(api_key=settings.voyage_api_key)
    return _client


def rerank_documents(
    query: str, documents: list[str], top_k: int
) -> list[tuple[int, float]]:
    """(original_index, relevance_score) pairs, best-first, length <= top_k.
    Falls back to identity order on disabled flag, empty input, or any error."""
    if not documents:
        return []
    identity: list[tuple[int, float]] = [
        (i, 0.0) for i in range(min(top_k, len(documents)))
    ]
    if not settings.enable_rerank:
        return identity
    try:
        result = _get_client().rerank(
            query, documents, model=settings.rerank_model, top_k=top_k
        )
        return [(r.index, float(r.relevance_score)) for r in result.results]
    except Exception as exc:
        _log.warning("rerank_failed", error=str(exc))
        return identity
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_rerank.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/paperpilot/rerank.py backend/tests/test_rerank.py
git commit -m "feat(rerank): Voyage rerank-2-lite with identity fallback"
```

---

## Task 9: ToolContext.model field + agent wiring

**Files:**
- Modify: `backend/src/paperpilot/tools/__init__.py`
- Modify: `backend/src/paperpilot/agent.py:99-104`

- [ ] **Step 1: Add `model` field to `ToolContext`**

In `backend/src/paperpilot/tools/__init__.py`, in the `ToolContext` dataclass, add a defaulted field after `db_session`:

```python
@dataclass
class ToolContext:
    user_id: str
    access_token: str
    doc_ids: list[str] | None
    db_session: Any  # AsyncSession at runtime; Any to avoid import cycle in tests
    model: Any = None  # resolved ModelSpec; Any to avoid import cycle
```

- [ ] **Step 2: Pass `spec` from agent**

In `backend/src/paperpilot/agent.py`, the `ctx = tools.ToolContext(...)` constructor (around line 99) — add `model=spec` (the `spec` is already resolved at line 97 `spec = providers.resolve(model_id)`):

```python
    ctx = tools.ToolContext(
        user_id=user_id,
        access_token=access_token,
        doc_ids=doc_ids,
        db_session=db_session,
        model=spec,
    )
```

- [ ] **Step 3: Verify it imports + existing agent tests pass**

Run: `cd backend && uv run pytest tests/test_agent_loop.py -v`
Expected: PASS (all existing agent tests — adding a defaulted field does not break existing `ToolContext(...)` calls).

- [ ] **Step 4: Commit**

```bash
git add backend/src/paperpilot/tools/__init__.py backend/src/paperpilot/agent.py
git commit -m "feat(tools): carry resolved model on ToolContext"
```

---

## Task 10: Orchestrate the pipeline in `search_documents`

**Files:**
- Modify: `backend/src/paperpilot/tools/search_docs.py`
- Test: `backend/tests/test_tools_search_docs.py` (rewrite)

- [ ] **Step 1: Rewrite the tests for the new pipeline**

Replace the entire contents of `backend/tests/test_tools_search_docs.py` with:

```python
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

    assert captured["queries"] == ["hi"]  # rewrite disabled → original only
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
            {"id": "c-1", "document_id": "d", "ordinal": 0, "page": 1, "text": "alpha", "filename": "f"},
            {"id": "c-2", "document_id": "d", "ordinal": 1, "page": 1, "text": "beta", "filename": "f"},
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
    assert ids == ["c-2", "c-1"]  # reranked order
    assert result["chunks"][0]["rerank_score"] == 0.9
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_tools_search_docs.py -v`
Expected: FAIL — `_handle` still calls `embed_query`/`hybrid_search`; `embed_queries`/`multi_query_search`/`expand_query`/`rerank_documents` are not yet imported in `search_docs`.

- [ ] **Step 3: Rewrite `search_docs.py`**

Replace the entire contents of `backend/src/paperpilot/tools/search_docs.py` with:

```python
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
        variants = await expand_query(
            query, ctx.model.litellm_id, settings.query_rewrite_variants
        )
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_tools_search_docs.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full backend suite (no regressions)**

Run: `cd backend && uv run pytest -q`
Expected: PASS (all tests).

- [ ] **Step 6: Lint + type check**

Run: `cd backend && uv run ruff check src/ && uv run ruff format src/ && uv run mypy src/`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/paperpilot/tools/search_docs.py backend/tests/test_tools_search_docs.py
git commit -m "feat(search): rerank + multi-query + citation-span pipeline"
```

---

## Task 11: Example per-model budgets in models.json

**Files:**
- Modify: `backend/models.json`

- [ ] **Step 1: Add retrieval budgets to the two GPT-4o models**

In `backend/models.json`, add `retrieval_top_k` and `retrieval_context_chars` to the `gpt-4o` entry (128k context → larger budget). The entry becomes:

```json
        {
          "id": "gpt-4o",
          "litellm_id": "openai/gpt-4o",
          "display_name": "GPT-4o",
          "supports_tools": true,
          "context_window": 128000,
          "enabled": true,
          "retrieval_top_k": 8,
          "retrieval_context_chars": 16000
        },
```

And the `gpt-4o-mini` entry becomes:

```json
        {
          "id": "gpt-4o-mini",
          "litellm_id": "openai/gpt-4o-mini",
          "display_name": "GPT-4o mini",
          "supports_tools": true,
          "context_window": 128000,
          "enabled": true,
          "retrieval_top_k": 8,
          "retrieval_context_chars": 16000
        }
```

Leave `deepseek-chat` and `llama-3.3-70b` unchanged (they fall back to global defaults: top_k 5, 8000 chars).

- [ ] **Step 2: Verify the manifest still loads**

Run: `cd backend && uv run python -c "from paperpilot import providers; m = next(x for x in providers.MODELS if x.id == 'gpt-4o'); print(m.retrieval_top_k, m.retrieval_context_chars); d = next(x for x in providers.MODELS if x.id == 'deepseek-chat'); print(d.retrieval_top_k, d.retrieval_context_chars)"`
Expected: `8 16000` then `None None`.

- [ ] **Step 3: Commit**

```bash
git add backend/models.json
git commit -m "feat(models): per-model retrieval budgets for GPT-4o"
```

---

## Task 12: Frontend citation-span highlight

**Files:**
- Modify: `frontend/src/lib/api.ts:142-151`
- Modify: `frontend/src/components/ChatBox.tsx:385-390`

> No frontend test runner exists in this repo (audit item #6). Verification is via `pnpm build` (tsc + vite) and `pnpm lint`.

- [ ] **Step 1: Add span fields to `SSESource`**

In `frontend/src/lib/api.ts`, add two optional fields to the `SSESource` interface (after `source_url?: string;`):

```ts
  span_start?: number | null;
  span_end?: number | null;
```

- [ ] **Step 2: Add a span-aware renderer in ChatBox**

In `frontend/src/components/ChatBox.tsx`, add this module-level helper near the top of the file (after the imports, before the component). It must reference the `SSESource` type that is already imported:

```tsx
function renderSourceText(src: SSESource) {
  const { text } = src;
  const start = src.span_start;
  const end = src.span_end;
  if (
    start == null ||
    end == null ||
    start < 0 ||
    end > text.length ||
    start >= end
  ) {
    return text;
  }
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-sm bg-primary/20 px-0.5 text-foreground">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}
```

- [ ] **Step 3: Use the renderer in the source card**

In `frontend/src/components/ChatBox.tsx`, replace the source-text paragraph (currently `{src.text}` inside the `line-clamp-3` `<p>`):

```tsx
                <p className="mt-1 line-clamp-3 text-muted-foreground">
                  {src.text}
                </p>
```

with:

```tsx
                <p className="mt-1 line-clamp-3 text-muted-foreground">
                  {renderSourceText(src)}
                </p>
```

- [ ] **Step 4: Verify the type import**

Confirm `SSESource` is imported as a type in `ChatBox.tsx` (it already is: `type SSESource,` near line 6). If `renderSourceText` cannot see it, ensure the import line includes `type SSESource`.

- [ ] **Step 5: Build + lint**

Run: `cd frontend && pnpm build && pnpm lint`
Expected: build succeeds, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/ChatBox.tsx
git commit -m "feat(chat): highlight citation span in source cards"
```

---

## Task 13: Update CLAUDE.md docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the `retrieve.py` module row**

In `CLAUDE.md`, in the "RAG pipeline (backend)" table, replace the `retrieve.py` row:

```
| `retrieve.py` | Hybrid search: pgvector cosine similarity + Postgres full-text search (`tsvector`/`ts_rank_cd`), merged via Reciprocal Rank Fusion. |
```

with:

```
| `retrieve.py` | Hybrid search (pgvector cosine + Postgres FTS, merged via Reciprocal Rank Fusion). `multi_query_search` fuses results across LLM-expanded query variants. |
| `rerank.py` | Voyage `rerank-2-lite` reorders the fused candidate pool by query relevance. Degrades to identity order on failure. |
| `query_rewrite.py` | One LLM call expands a query into variants for higher recall. Degrades to the original query. |
| `citation.py` | Pure lexical `best_span` — char offsets of the best-matching sentence per chunk, for frontend highlighting. |
```

- [ ] **Step 2: Update the Query flow description**

In `CLAUDE.md`, under "### Query flow", replace:

```
`POST /query` (SSE) → verify JWT → embed query → hybrid search → build prompt → stream DeepSeek tokens → emit `sources` and `done` events.
```

with:

```
`POST /query` (SSE) → verify JWT → embed query → hybrid search → build prompt → stream DeepSeek tokens → emit `sources` and `done` events.

The agent's `search_documents` tool runs a fuller pipeline: query rewrite (multi-query expansion) → fused candidate pool → Voyage rerank → per-model `top_k`/context budget (`models.json` `retrieval_top_k`/`retrieval_context_chars`, global defaults in `config.py`) → lexical citation spans. Rerank and rewrite are independently toggleable via `enable_rerank` / `enable_query_rewrite`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document rerank/rewrite/citation retrieval pipeline"
```

---

## Final verification

- [ ] **Full backend test suite**

Run: `cd backend && uv run pytest -q`
Expected: all green.

- [ ] **Lint + types (backend)**

Run: `cd backend && uv run ruff check src/ && uv run mypy src/`
Expected: clean.

- [ ] **Frontend build + lint**

Run: `cd frontend && pnpm build && pnpm lint`
Expected: clean.

---

## Notes for the implementer

- **TDD order matters:** Tasks 3-8 are leaf modules with no cross-dependencies — build and test each in isolation before Task 10 wires them together.
- **Degradation is the contract:** `expand_query` and `rerank_documents` must NEVER raise — their tests assert `[]` / identity on exceptions. If you change their signatures, keep the swallow-and-fallback behavior.
- **`settings` is mutable:** tests flip `enable_rerank` / `enable_query_rewrite` via `monkeypatch.setattr(module.settings, ...)`. Always read these flags through `settings.<flag>` at call time, never cache them at import.
- **`ctx.model` may be None:** the `/query` legacy path and some tests build `ToolContext` without a model. `retrieval_budget(None)` and the `ctx.model is not None` rewrite guard both handle this — do not assume a model is present.
