# Agentic Multi-Provider Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve PaperPilot from single-provider RAG into an agentic chat system supporting multiple LLM providers, per-message model selection, and four built-in tools (`search_documents`, `list_documents`, `get_document_summary`, `web_search`).

**Architecture:** Python backend gains a LiteLLM-based unified LLM interface (`llm.py`), a provider registry (`providers.py`), a tool registry (`tools/`), and an agent control loop (`agent.py`). A new `POST /chat` SSE endpoint streams `token`, `tool_call`, `tool_result`, `sources`, and `done` events. `POST /query` becomes a thin backward-compatible shim around `agent.run`. Frontend gains a `ModelPicker`, `ToolCallBubble`, a parts-shaped message schema, and a `chatStream()` helper.

**Tech Stack:** FastAPI · LiteLLM · SQLAlchemy async · React 19 + Vite · Tailwind v4 · Supabase

**Spec:** `docs/superpowers/specs/2026-06-01-agentic-multi-provider-chat-design.md`

---

## File Structure

**Backend (create):**
- `backend/src/paperpilot/providers.py` — model registry
- `backend/src/paperpilot/tools/__init__.py` — tool registry, dispatcher, `ToolSpec`, `ToolContext`
- `backend/src/paperpilot/tools/search_docs.py` — `search_documents` tool
- `backend/src/paperpilot/tools/docs.py` — `list_documents`, `get_document_summary` tools
- `backend/src/paperpilot/tools/web_search.py` — `web_search` tool (Tavily)
- `backend/src/paperpilot/agent.py` — agent loop
- `backend/tests/conftest.py` — pytest fixtures
- `backend/tests/test_providers.py`
- `backend/tests/test_tools_search_docs.py`
- `backend/tests/test_tools_docs.py`
- `backend/tests/test_tools_web_search.py`
- `backend/tests/test_agent_loop.py`
- `backend/tests/test_chat_endpoint.py`

**Backend (modify):**
- `backend/pyproject.toml` — add LiteLLM, pytest-asyncio, respx
- `backend/src/paperpilot/config.py` — add per-provider api keys, Tavily key, defaults
- `backend/src/paperpilot/llm.py` — replace OpenAI client with LiteLLM passthrough
- `backend/src/paperpilot/reader.py` — replace with shim that calls `agent.run`
- `backend/src/paperpilot/api.py` — add `/models` and `/chat`

**Frontend (create):**
- `frontend/src/hooks/useModels.ts`
- `frontend/src/components/ModelPicker.tsx`
- `frontend/src/components/ToolCallBubble.tsx`

**Frontend (modify):**
- `frontend/src/lib/api.ts` — add `getModels`, `chatStream`, new SSE event types
- `frontend/src/hooks/useChatSessions.ts` — extend message shape (parts + model), legacy read migration
- `frontend/src/components/ChatBox.tsx` — wire ModelPicker, render parts, handle new events

---

## Task 1: Add dependencies and config fields

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/src/paperpilot/config.py`

- [ ] **Step 1.1: Add LiteLLM, pytest-asyncio, respx to pyproject**

Edit `backend/pyproject.toml`:
- In `dependencies`, append:
  ```toml
  "litellm>=1.55.0",
  ```
- In `[dependency-groups]` `dev`, replace with:
  ```toml
  dev = [
    "pytest>=9.0.3",
    "pytest-asyncio>=0.24.0",
    "respx>=0.21.1",
    "ruff>=0.15.14",
  ]
  ```
- Append at the end:
  ```toml
  [tool.pytest.ini_options]
  asyncio_mode = "auto"
  testpaths = ["tests"]
  pythonpath = ["src"]
  ```

- [ ] **Step 1.2: Install deps**

Run: `cd backend && uv sync`
Expected: lockfile updated; no error.

- [ ] **Step 1.3: Add config fields**

Replace `backend/src/paperpilot/config.py` with:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    env: str = "local"

    # Supabase
    supabase_url: str = ""
    supabase_jwks_url: str = ""
    supabase_secret_key: str = ""
    supabase_publishable_key: str = ""
    supabase_db_url: str = ""
    supabase_storage_bucket: str = "documents"

    # Embeddings (Voyage)
    voyage_api_key: str = ""
    embedding_model: str = "voyage-3-lite"
    embedding_dim: int = 512

    # OCR / docs
    ocr_language: str = "eng"

    # CORS
    frontend_origins: str = "http://localhost:5173"

    # LLM provider keys — presence enables the model in /models
    openai_api_key: str = ""
    deepseek_api_key: str = ""
    groq_api_key: str = ""
    mistral_api_key: str = ""

    # Tool provider keys
    tavily_api_key: str = ""

    # Agent defaults
    default_model_id: str = "deepseek-chat"
    agent_max_iterations: int = 5

    # Eval / judge (existing)
    judge_model: str = "gpt-4o-mini"
    judge_base_url: str = "https://api.openai.com/v1"
    judge_api_key: str = ""

    # Deprecated (kept for one release for back-compat with /query path)
    llm_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-chat"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
```

- [ ] **Step 1.4: Lint and commit**

Run: `cd backend && uv run ruff check src/ && uv run ruff format src/`
Expected: no errors.

```bash
git add backend/pyproject.toml backend/uv.lock backend/src/paperpilot/config.py
git commit -m "chore(backend): add litellm + per-provider keys to config"
```

---

## Task 2: Provider registry (`providers.py`)

**Files:**
- Create: `backend/src/paperpilot/providers.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_providers.py`

- [ ] **Step 2.1: Write conftest**

Create `backend/tests/conftest.py`:

```python
from __future__ import annotations

import os
from collections.abc import Iterator

import pytest


@pytest.fixture
def clear_provider_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for var in (
        "OPENAI_API_KEY",
        "DEEPSEEK_API_KEY",
        "GROQ_API_KEY",
        "MISTRAL_API_KEY",
        "TAVILY_API_KEY",
    ):
        monkeypatch.delenv(var, raising=False)
        os.environ.pop(var, None)
    yield
```

- [ ] **Step 2.2: Write the failing test**

Create `backend/tests/test_providers.py`:

```python
from __future__ import annotations

import pytest
from fastapi import HTTPException

from paperpilot import providers


def test_available_models_filters_by_env(
    monkeypatch: pytest.MonkeyPatch, clear_provider_env: None
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    available = providers.available_models()
    ids = {m.id for m in available}
    assert "gpt-4o" in ids
    assert "gpt-4o-mini" in ids
    assert "deepseek-chat" not in ids
    assert "llama-3.3-70b" not in ids


def test_available_models_empty_when_no_keys(clear_provider_env: None) -> None:
    assert providers.available_models() == []


def test_resolve_known_model(monkeypatch: pytest.MonkeyPatch, clear_provider_env: None) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    spec = providers.resolve("deepseek-chat")
    assert spec.id == "deepseek-chat"
    assert spec.litellm_id == "deepseek/deepseek-chat"


def test_resolve_unknown_model_raises(clear_provider_env: None) -> None:
    with pytest.raises(HTTPException) as exc:
        providers.resolve("nonexistent-model")
    assert exc.value.status_code == 404


def test_resolve_disabled_model_raises(clear_provider_env: None) -> None:
    # gpt-4o is in MODELS but OPENAI_API_KEY is unset.
    with pytest.raises(HTTPException) as exc:
        providers.resolve("gpt-4o")
    assert exc.value.status_code == 404
```

- [ ] **Step 2.3: Run the test, expect ImportError**

Run: `cd backend && uv run pytest tests/test_providers.py -v`
Expected: collection failure or import error — `providers` module missing.

- [ ] **Step 2.4: Implement `providers.py`**

Create `backend/src/paperpilot/providers.py`:

```python
from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import HTTPException


@dataclass(frozen=True)
class ModelSpec:
    id: str
    litellm_id: str
    provider: str
    display_name: str
    supports_tools: bool
    context_window: int
    api_key_env: str


MODELS: list[ModelSpec] = [
    ModelSpec(
        id="gpt-4o",
        litellm_id="openai/gpt-4o",
        provider="openai",
        display_name="GPT-4o",
        supports_tools=True,
        context_window=128_000,
        api_key_env="OPENAI_API_KEY",
    ),
    ModelSpec(
        id="gpt-4o-mini",
        litellm_id="openai/gpt-4o-mini",
        provider="openai",
        display_name="GPT-4o mini",
        supports_tools=True,
        context_window=128_000,
        api_key_env="OPENAI_API_KEY",
    ),
    ModelSpec(
        id="deepseek-chat",
        litellm_id="deepseek/deepseek-chat",
        provider="deepseek",
        display_name="DeepSeek V3",
        supports_tools=True,
        context_window=64_000,
        api_key_env="DEEPSEEK_API_KEY",
    ),
    ModelSpec(
        id="llama-3.3-70b",
        litellm_id="groq/llama-3.3-70b-versatile",
        provider="groq",
        display_name="Llama 3.3 70B",
        supports_tools=True,
        context_window=128_000,
        api_key_env="GROQ_API_KEY",
    ),
    ModelSpec(
        id="mistral-large",
        litellm_id="mistral/mistral-large-latest",
        provider="mistral",
        display_name="Mistral Large",
        supports_tools=True,
        context_window=128_000,
        api_key_env="MISTRAL_API_KEY",
    ),
]


def available_models() -> list[ModelSpec]:
    return [m for m in MODELS if os.getenv(m.api_key_env)]


def resolve(model_id: str) -> ModelSpec:
    for m in available_models():
        if m.id == model_id:
            return m
    raise HTTPException(status_code=404, detail=f"Model '{model_id}' is not available")
```

- [ ] **Step 2.5: Run the tests, expect pass**

Run: `cd backend && uv run pytest tests/test_providers.py -v`
Expected: all 5 tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add backend/src/paperpilot/providers.py backend/tests/conftest.py backend/tests/test_providers.py
git commit -m "feat(backend): add provider registry with env-gated model availability"
```

---

## Task 3: Tool registry skeleton (`tools/__init__.py`)

**Files:**
- Create: `backend/src/paperpilot/tools/__init__.py`
- Create: `backend/tests/test_tools_registry.py`

- [ ] **Step 3.1: Write the failing test**

Create `backend/tests/test_tools_registry.py`:

```python
from __future__ import annotations

from typing import Any

import pytest

from paperpilot import tools


@pytest.fixture(autouse=True)
def isolate_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "REGISTRY", {})


async def _echo(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
    return {"echo": args}


def test_register_and_openai_tools() -> None:
    tools.register(
        tools.ToolSpec(
            name="echo",
            description="echoes",
            parameters={"type": "object", "properties": {"x": {"type": "string"}}},
            handler=_echo,
        )
    )
    defs = tools.openai_tools()
    assert len(defs) == 1
    assert defs[0]["type"] == "function"
    assert defs[0]["function"]["name"] == "echo"
    assert defs[0]["function"]["description"] == "echoes"
    assert defs[0]["function"]["parameters"]["type"] == "object"


async def test_dispatch_runs_handler() -> None:
    tools.register(
        tools.ToolSpec(
            name="echo",
            description="echoes",
            parameters={"type": "object", "properties": {}},
            handler=_echo,
        )
    )
    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=None)
    result = await tools.dispatch("echo", {"hello": "world"}, ctx)
    assert result == {"echo": {"hello": "world"}}


async def test_dispatch_unknown_tool_returns_error() -> None:
    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=None)
    result = await tools.dispatch("nope", {}, ctx)
    assert "error" in result
    assert "unknown tool" in result["error"].lower()


async def test_dispatch_handler_exception_returns_error() -> None:
    async def boom(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
        raise RuntimeError("kapow")

    tools.register(
        tools.ToolSpec(
            name="bad",
            description="bad",
            parameters={"type": "object", "properties": {}},
            handler=boom,
        )
    )
    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=None)
    result = await tools.dispatch("bad", {}, ctx)
    assert "error" in result
    assert "kapow" in result["error"]
```

- [ ] **Step 3.2: Run test, expect failure**

Run: `cd backend && uv run pytest tests/test_tools_registry.py -v`
Expected: ImportError — `tools` package missing.

- [ ] **Step 3.3: Implement `tools/__init__.py`**

Create `backend/src/paperpilot/tools/__init__.py`:

```python
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, TypedDict

logger = logging.getLogger(__name__)

ToolHandler = Callable[[dict[str, Any], "ToolContext"], Awaitable[dict[str, Any]]]


class ToolSpec(TypedDict):
    name: str
    description: str
    parameters: dict[str, Any]
    handler: ToolHandler


@dataclass
class ToolContext:
    user_id: str
    access_token: str
    doc_ids: list[str] | None
    db_session: Any  # AsyncSession at runtime; Any to avoid import cycle in tests


REGISTRY: dict[str, ToolSpec] = {}


def register(spec: ToolSpec) -> None:
    REGISTRY[spec["name"]] = spec


def openai_tools() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": s["name"],
                "description": s["description"],
                "parameters": s["parameters"],
            },
        }
        for s in REGISTRY.values()
    ]


async def dispatch(name: str, args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    spec = REGISTRY.get(name)
    if spec is None:
        return {"error": f"unknown tool: {name}"}
    try:
        return await spec["handler"](args, ctx)
    except Exception as exc:  # tool failures must never escape the agent loop
        logger.exception("tool_handler_failed", extra={"tool": name})
        return {"error": f"{type(exc).__name__}: {exc}"}
```

- [ ] **Step 3.4: Run tests, expect pass**

Run: `cd backend && uv run pytest tests/test_tools_registry.py -v`
Expected: all 4 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add backend/src/paperpilot/tools/__init__.py backend/tests/test_tools_registry.py
git commit -m "feat(backend): add tool registry, ToolContext, and dispatch"
```

---

## Task 4: `search_documents` tool

**Files:**
- Create: `backend/src/paperpilot/tools/search_docs.py`
- Create: `backend/tests/test_tools_search_docs.py`

- [ ] **Step 4.1: Write the failing test**

Create `backend/tests/test_tools_search_docs.py`:

```python
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
```

- [ ] **Step 4.2: Run test, expect failure**

Run: `cd backend && uv run pytest tests/test_tools_search_docs.py -v`
Expected: ImportError or test failure.

- [ ] **Step 4.3: Implement the tool**

Create `backend/src/paperpilot/tools/search_docs.py`:

```python
from __future__ import annotations

from typing import Any

from paperpilot.embed import embed_query
from paperpilot.retrieve import hybrid_search
from paperpilot.tools import ToolContext, ToolSpec, register


async def _handle(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    query = str(args["query"])
    top_k = int(args.get("top_k", 5))
    embedding = embed_query(query)
    rows = await hybrid_search(
        ctx.db_session,
        ctx.user_id,
        query,
        embedding,
        k=top_k,
        doc_ids=ctx.doc_ids,
    )
    return {
        "chunks": [
            {
                "chunk_id": str(r.get("id", "")),
                "document_id": str(r.get("document_id", "")),
                "ordinal": r.get("ordinal", 0),
                "page": r.get("page"),
                "text": r.get("text", ""),
                "filename": r.get("filename", "unknown"),
            }
            for r in rows
        ]
    }


SPEC: ToolSpec = {
    "name": "search_documents",
    "description": (
        "Search the user's uploaded documents for passages relevant to a query. "
        "Returns the top-k chunks with filename, page, and text. Use this whenever "
        "you need information that is likely contained in the user's documents."
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

- [ ] **Step 4.4: Run tests, expect pass**

Run: `cd backend && uv run pytest tests/test_tools_search_docs.py -v`
Expected: both tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add backend/src/paperpilot/tools/search_docs.py backend/tests/test_tools_search_docs.py
git commit -m "feat(backend): add search_documents tool wrapping hybrid_search"
```

---

## Task 5: `list_documents` + `get_document_summary` tools

**Files:**
- Create: `backend/src/paperpilot/tools/docs.py`
- Create: `backend/tests/test_tools_docs.py`

- [ ] **Step 5.1: Write the failing test**

Create `backend/tests/test_tools_docs.py`:

```python
from __future__ import annotations

from typing import Any

import pytest

from paperpilot import tools
from paperpilot.tools import docs as docs_tool


@pytest.fixture(autouse=True)
def isolate_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "REGISTRY", {})
    docs_tool.register_tools()


async def test_list_documents(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_list(session: Any, user_id: str) -> list[dict[str, Any]]:
        assert user_id == "u-1"
        return [
            {"id": "d-1", "filename": "a.pdf", "status": "ready", "created_at": "x"},
            {"id": "d-2", "filename": "b.pdf", "status": "pending", "created_at": "x"},
        ]

    monkeypatch.setattr(docs_tool, "list_documents", fake_list)
    ctx = tools.ToolContext(user_id="u-1", access_token="t", doc_ids=None, db_session=object())
    result = await tools.dispatch("list_documents", {}, ctx)
    assert result == {
        "documents": [
            {"id": "d-1", "filename": "a.pdf", "status": "ready"},
            {"id": "d-2", "filename": "b.pdf", "status": "pending"},
        ]
    }


async def test_get_document_summary_truncates(monkeypatch: pytest.MonkeyPatch) -> None:
    long_text = "x" * 2000

    async def fake_fetch(
        session: Any, user_id: str, document_id: str, limit: int
    ) -> list[dict[str, Any]]:
        assert user_id == "u-1"
        assert document_id == "d-1"
        assert limit == 5
        return [{"text": long_text} for _ in range(5)]

    monkeypatch.setattr(docs_tool, "_fetch_first_chunks", fake_fetch)
    ctx = tools.ToolContext(user_id="u-1", access_token="t", doc_ids=None, db_session=object())
    result = await tools.dispatch("get_document_summary", {"document_id": "d-1"}, ctx)
    assert "summary" in result
    assert len(result["summary"]) == 4000


async def test_get_document_summary_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_fetch(
        session: Any, user_id: str, document_id: str, limit: int
    ) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(docs_tool, "_fetch_first_chunks", fake_fetch)
    ctx = tools.ToolContext(user_id="u-1", access_token="t", doc_ids=None, db_session=object())
    result = await tools.dispatch("get_document_summary", {"document_id": "missing"}, ctx)
    assert "error" in result
```

- [ ] **Step 5.2: Run test, expect failure**

Run: `cd backend && uv run pytest tests/test_tools_docs.py -v`
Expected: ImportError.

- [ ] **Step 5.3: Implement the tools**

Create `backend/src/paperpilot/tools/docs.py`:

```python
from __future__ import annotations

from typing import Any

from sqlalchemy import text

from paperpilot.store import list_documents
from paperpilot.tools import ToolContext, ToolSpec, register

SUMMARY_CHUNK_LIMIT = 5
SUMMARY_CHAR_LIMIT = 4000


async def _list_handler(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    rows = await list_documents(ctx.db_session, ctx.user_id)
    return {
        "documents": [
            {"id": str(r["id"]), "filename": r["filename"], "status": r["status"]}
            for r in rows
        ]
    }


async def _fetch_first_chunks(
    session: Any, user_id: str, document_id: str, limit: int
) -> list[dict[str, Any]]:
    result = await session.execute(
        text(
            "SELECT text FROM chunks "
            "WHERE user_id = :user_id AND document_id = :document_id "
            "ORDER BY ordinal ASC LIMIT :limit"
        ),
        {"user_id": user_id, "document_id": document_id, "limit": limit},
    )
    return [{"text": row[0]} for row in result.fetchall()]


async def _summary_handler(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    document_id = str(args["document_id"])
    rows = await _fetch_first_chunks(
        ctx.db_session, ctx.user_id, document_id, SUMMARY_CHUNK_LIMIT
    )
    if not rows:
        return {"error": f"document {document_id} not found or has no chunks"}
    combined = "\n\n".join(r["text"] for r in rows)
    return {"summary": combined[:SUMMARY_CHAR_LIMIT]}


LIST_SPEC: ToolSpec = {
    "name": "list_documents",
    "description": "List the documents the user has uploaded. Returns id, filename, and status.",
    "parameters": {"type": "object", "properties": {}},
    "handler": _list_handler,
}

SUMMARY_SPEC: ToolSpec = {
    "name": "get_document_summary",
    "description": (
        "Get a short summary of a document by concatenating its first 5 chunks "
        "(truncated to 4000 characters). Use when you need an overview of a "
        "specific document without searching for a particular topic."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "document_id": {"type": "string", "description": "The document id (uuid)."}
        },
        "required": ["document_id"],
    },
    "handler": _summary_handler,
}


def register_tools() -> None:
    register(LIST_SPEC)
    register(SUMMARY_SPEC)
```

- [ ] **Step 5.4: Run tests, expect pass**

Run: `cd backend && uv run pytest tests/test_tools_docs.py -v`
Expected: all 3 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add backend/src/paperpilot/tools/docs.py backend/tests/test_tools_docs.py
git commit -m "feat(backend): add list_documents and get_document_summary tools"
```

---

## Task 6: `web_search` tool (Tavily)

**Files:**
- Create: `backend/src/paperpilot/tools/web_search.py`
- Create: `backend/tests/test_tools_web_search.py`

- [ ] **Step 6.1: Write the failing test**

Create `backend/tests/test_tools_web_search.py`:

```python
from __future__ import annotations

import httpx
import pytest
import respx

from paperpilot import tools
from paperpilot.tools import web_search


@pytest.fixture(autouse=True)
def isolate_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "REGISTRY", {})


async def test_register_skipped_without_key(
    monkeypatch: pytest.MonkeyPatch, clear_provider_env: None
) -> None:
    web_search.register_tool_if_enabled()
    assert "web_search" not in tools.REGISTRY


async def test_register_when_key_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    web_search.register_tool_if_enabled()
    assert "web_search" in tools.REGISTRY


@respx.mock
async def test_web_search_returns_results(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    web_search.register_tool_if_enabled()
    route = respx.post("https://api.tavily.com/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    {
                        "title": "Example",
                        "url": "https://example.com",
                        "content": "snippet content",
                    },
                    {"title": "T2", "url": "https://e2.com", "content": "c2"},
                ]
            },
        )
    )

    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=None)
    result = await tools.dispatch("web_search", {"query": "ai", "max_results": 2}, ctx)
    assert route.called
    assert result["results"] == [
        {"title": "Example", "url": "https://example.com", "snippet": "snippet content"},
        {"title": "T2", "url": "https://e2.com", "snippet": "c2"},
    ]


@respx.mock
async def test_web_search_handles_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    web_search.register_tool_if_enabled()
    respx.post("https://api.tavily.com/search").mock(
        return_value=httpx.Response(500, text="boom")
    )
    ctx = tools.ToolContext(user_id="u", access_token="t", doc_ids=None, db_session=None)
    result = await tools.dispatch("web_search", {"query": "x"}, ctx)
    assert "error" in result
```

- [ ] **Step 6.2: Run test, expect failure**

Run: `cd backend && uv run pytest tests/test_tools_web_search.py -v`
Expected: ImportError.

- [ ] **Step 6.3: Implement the tool**

Create `backend/src/paperpilot/tools/web_search.py`:

```python
from __future__ import annotations

import os
from typing import Any

import httpx

from paperpilot.tools import ToolContext, ToolSpec, register

TAVILY_URL = "https://api.tavily.com/search"


async def _handle(args: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return {"error": "web_search disabled: TAVILY_API_KEY not set"}

    query = str(args["query"])
    max_results = int(args.get("max_results", 5))
    payload = {
        "api_key": api_key,
        "query": query,
        "max_results": max_results,
        "search_depth": "basic",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(TAVILY_URL, json=payload)

    if resp.status_code >= 400:
        return {"error": f"tavily request failed: {resp.status_code} {resp.text[:200]}"}

    data = resp.json()
    results = data.get("results", [])
    return {
        "results": [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "snippet": r.get("content", ""),
            }
            for r in results[:max_results]
        ]
    }


SPEC: ToolSpec = {
    "name": "web_search",
    "description": (
        "Search the live web for recent or general information not covered in the "
        "user's uploaded documents. Use when the documents lack the answer or when "
        "the user explicitly asks about current information."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query."},
            "max_results": {
                "type": "integer",
                "description": "Max results to return (1-10).",
                "minimum": 1,
                "maximum": 10,
            },
        },
        "required": ["query"],
    },
    "handler": _handle,
}


def register_tool_if_enabled() -> None:
    if os.getenv("TAVILY_API_KEY"):
        register(SPEC)
```

- [ ] **Step 6.4: Run tests, expect pass**

Run: `cd backend && uv run pytest tests/test_tools_web_search.py -v`
Expected: 4 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add backend/src/paperpilot/tools/web_search.py backend/tests/test_tools_web_search.py
git commit -m "feat(backend): add web_search tool via Tavily (env-gated)"
```

---

## Task 7: Refactor `llm.py` to LiteLLM passthrough

**Files:**
- Modify: `backend/src/paperpilot/llm.py`

- [ ] **Step 7.1: Replace contents**

Replace `backend/src/paperpilot/llm.py` with:

```python
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import litellm


async def stream_completion(
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    temperature: float = 0.3,
    max_tokens: int = 1024,
) -> AsyncIterator[Any]:
    """Provider-agnostic streaming completion via LiteLLM.

    Yields raw chunks; the caller is responsible for handling token deltas and
    tool-call deltas. The chunk shape matches the OpenAI streaming format
    regardless of underlying provider.
    """
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"

    response = await litellm.acompletion(**kwargs)
    async for chunk in response:
        yield chunk
```

`reader.py` (still on disk) references the old `stream_chat` symbol. We will replace `reader.py` in Task 11, but to avoid a broken import in the meantime, run the lint step and confirm `reader.py` is not imported by anything that is currently exercised in tests. (Tests we have added so far do not import `reader`.)

- [ ] **Step 7.2: Lint**

Run: `cd backend && uv run ruff check src/paperpilot/llm.py`
Expected: no errors.

- [ ] **Step 7.3: Commit**

```bash
git add backend/src/paperpilot/llm.py
git commit -m "refactor(backend): replace openai client in llm.py with LiteLLM passthrough"
```

---

## Task 8: Agent loop (`agent.py`)

**Files:**
- Create: `backend/src/paperpilot/agent.py`
- Create: `backend/tests/test_agent_loop.py`

- [ ] **Step 8.1: Write the failing test**

Create `backend/tests/test_agent_loop.py`:

```python
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import pytest

from paperpilot import agent, tools


def _delta(content: str | None = None, tool_calls: list[dict[str, Any]] | None = None) -> Any:
    class D:
        def __init__(self) -> None:
            self.content = content
            self.tool_calls = tool_calls

    class Choice:
        def __init__(self) -> None:
            self.delta = D()
            self.finish_reason = None

    class Chunk:
        def __init__(self) -> None:
            self.choices = [Choice()]

    return Chunk()


def _tool_call_delta(idx: int, call_id: str, name: str, arg_fragment: str) -> dict[str, Any]:
    class F:
        def __init__(self) -> None:
            self.name = name
            self.arguments = arg_fragment

    class TC:
        def __init__(self) -> None:
            self.index = idx
            self.id = call_id
            self.type = "function"
            self.function = F()

    return TC()


@pytest.fixture(autouse=True)
def isolate_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(tools, "REGISTRY", {})


async def test_agent_no_tool_calls_streams_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")
    monkeypatch.setattr(tools, "REGISTRY", {})

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        yield _delta(content="Hello")
        yield _delta(content=" world")

    monkeypatch.setattr(agent, "stream_completion", fake_stream)

    events: list[str] = []
    async for raw in agent.run(
        messages=[{"role": "user", "content": "hi"}],
        user_id="u",
        model_id="deepseek-chat",
        doc_ids=None,
        access_token="t",
        db_session=object(),
        max_iterations=3,
    ):
        events.append(raw)

    joined = "".join(events)
    assert "event: token" in joined
    assert "Hello" in joined
    assert " world" in joined
    assert "event: done" in joined


async def test_agent_runs_one_tool_then_terminates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")

    called: list[dict[str, Any]] = []

    async def echo_handler(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
        called.append(args)
        return {"ok": True}

    tools.register(
        tools.ToolSpec(
            name="echo",
            description="echoes",
            parameters={"type": "object", "properties": {}},
            handler=echo_handler,
        )
    )

    iteration = 0

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        nonlocal iteration
        iteration += 1
        if iteration == 1:
            yield _delta(tool_calls=[_tool_call_delta(0, "c1", "echo", '{"a":1}')])
        else:
            yield _delta(content="final answer")

    monkeypatch.setattr(agent, "stream_completion", fake_stream)

    events: list[str] = []
    async for raw in agent.run(
        messages=[{"role": "user", "content": "hi"}],
        user_id="u",
        model_id="deepseek-chat",
        doc_ids=None,
        access_token="t",
        db_session=object(),
        max_iterations=3,
    ):
        events.append(raw)

    joined = "".join(events)
    assert called == [{"a": 1}]
    assert "event: tool_call" in joined
    assert "event: tool_result" in joined
    assert "final answer" in joined
    assert "event: done" in joined


async def test_agent_enforces_max_iterations(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")

    async def loop_handler(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
        return {"again": True}

    tools.register(
        tools.ToolSpec(
            name="loop",
            description="loops",
            parameters={"type": "object", "properties": {}},
            handler=loop_handler,
        )
    )

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        yield _delta(tool_calls=[_tool_call_delta(0, "c1", "loop", "{}")])

    monkeypatch.setattr(agent, "stream_completion", fake_stream)

    events: list[str] = []
    async for raw in agent.run(
        messages=[{"role": "user", "content": "hi"}],
        user_id="u",
        model_id="deepseek-chat",
        doc_ids=None,
        access_token="t",
        db_session=object(),
        max_iterations=2,
    ):
        events.append(raw)

    joined = "".join(events)
    assert "max tool iterations reached" in joined
    assert "event: done" in joined


async def test_agent_respects_allowed_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")

    async def _h(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
        return {}

    tools.register(
        tools.ToolSpec(
            name="a", description="", parameters={"type": "object", "properties": {}}, handler=_h
        )
    )
    tools.register(
        tools.ToolSpec(
            name="b", description="", parameters={"type": "object", "properties": {}}, handler=_h
        )
    )

    captured_tools: list[list[dict[str, Any]]] = []

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        captured_tools.append(kwargs.get("tools") or [])
        yield _delta(content="done")

    monkeypatch.setattr(agent, "stream_completion", fake_stream)

    async for _ in agent.run(
        messages=[{"role": "user", "content": "hi"}],
        user_id="u",
        model_id="deepseek-chat",
        doc_ids=None,
        access_token="t",
        db_session=object(),
        max_iterations=1,
        allowed_tools=["a"],
    ):
        pass

    names = {t["function"]["name"] for t in captured_tools[0]}
    assert names == {"a"}


async def test_agent_emits_sources_from_search_documents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")

    async def search_handler(args: dict[str, Any], ctx: tools.ToolContext) -> dict[str, Any]:
        return {
            "chunks": [
                {
                    "chunk_id": "c-1",
                    "document_id": "d-1",
                    "ordinal": 0,
                    "page": 3,
                    "text": "t",
                    "filename": "p.pdf",
                }
            ]
        }

    tools.register(
        tools.ToolSpec(
            name="search_documents",
            description="search",
            parameters={"type": "object", "properties": {}},
            handler=search_handler,
        )
    )

    iteration = 0

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        nonlocal iteration
        iteration += 1
        if iteration == 1:
            yield _delta(
                tool_calls=[_tool_call_delta(0, "c1", "search_documents", '{"query":"x"}')]
            )
        else:
            yield _delta(content="answer")

    monkeypatch.setattr(agent, "stream_completion", fake_stream)

    events: list[str] = []
    async for raw in agent.run(
        messages=[{"role": "user", "content": "hi"}],
        user_id="u",
        model_id="deepseek-chat",
        doc_ids=None,
        access_token="t",
        db_session=object(),
        max_iterations=3,
    ):
        events.append(raw)

    joined = "".join(events)
    assert "event: sources" in joined
    assert "c-1" in joined
```

- [ ] **Step 8.2: Run tests, expect failure**

Run: `cd backend && uv run pytest tests/test_agent_loop.py -v`
Expected: ImportError on `agent`.

- [ ] **Step 8.3: Implement the agent loop**

Create `backend/src/paperpilot/agent.py`:

```python
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from paperpilot import providers, tools
from paperpilot.llm import stream_completion

SYSTEM_PROMPT = (
    "You are PaperPilot, a research assistant. The user has uploaded documents; "
    "you have tools to search them, list them, summarize them, and (when enabled) "
    "search the web. Use tools when they would give a better answer than your priors. "
    "When you use search_documents, cite chunks in your reply with bracketed numbers "
    "like [1], [2] that match the order of returned chunks. Refuse off-topic or "
    "unsafe requests."
)


def _sse(event: str, data: Any) -> str:
    payload = data if isinstance(data, str) else json.dumps(data)
    return f"event: {event}\ndata: {payload}\n\n"


def _merge_tool_call_delta(buf: list[dict[str, Any]], delta_tcs: list[Any]) -> None:
    """Merge streamed tool-call deltas (OpenAI streaming format) into a buffer."""
    for d in delta_tcs:
        idx = getattr(d, "index", 0)
        while len(buf) <= idx:
            buf.append(
                {
                    "id": "",
                    "type": "function",
                    "function": {"name": "", "arguments": ""},
                }
            )
        slot = buf[idx]
        if getattr(d, "id", None):
            slot["id"] = d.id
        fn = getattr(d, "function", None)
        if fn is not None:
            if getattr(fn, "name", None):
                slot["function"]["name"] = fn.name
            if getattr(fn, "arguments", None):
                slot["function"]["arguments"] += fn.arguments


async def run(
    messages: list[dict[str, Any]],
    user_id: str,
    model_id: str,
    doc_ids: list[str] | None,
    access_token: str,
    db_session: Any,
    max_iterations: int = 5,
    allowed_tools: list[str] | None = None,
) -> AsyncIterator[str]:
    spec = providers.resolve(model_id)
    ctx = tools.ToolContext(
        user_id=user_id,
        access_token=access_token,
        doc_ids=doc_ids,
        db_session=db_session,
    )
    all_defs = tools.openai_tools()
    if allowed_tools is None:
        tool_defs = all_defs
    else:
        allowed_set = set(allowed_tools)
        tool_defs = [t for t in all_defs if t["function"]["name"] in allowed_set]
    convo: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}, *messages]
    aggregated_sources: list[dict[str, Any]] = []

    for _ in range(max_iterations):
        accumulated_tool_calls: list[dict[str, Any]] = []
        assistant_text = ""

        async for chunk in stream_completion(
            model=spec.litellm_id,
            messages=convo,
            tools=tool_defs or None,
        ):
            choice = chunk.choices[0] if chunk.choices else None
            if choice is None:
                continue
            d = choice.delta
            if getattr(d, "content", None):
                assistant_text += d.content
                yield _sse("token", d.content)
            tcs = getattr(d, "tool_calls", None)
            if tcs:
                _merge_tool_call_delta(accumulated_tool_calls, tcs)

        if not accumulated_tool_calls:
            if aggregated_sources:
                yield _sse("sources", aggregated_sources)
            yield _sse("done", "")
            return

        convo.append(
            {
                "role": "assistant",
                "content": assistant_text or None,
                "tool_calls": accumulated_tool_calls,
            }
        )

        for tc in accumulated_tool_calls:
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            name = tc["function"]["name"]
            yield _sse("tool_call", {"id": tc["id"], "name": name, "args": args})

            result = await tools.dispatch(name, args, ctx)
            yield _sse("tool_result", {"id": tc["id"], "result": result})

            if name == "search_documents" and isinstance(result, dict):
                chunks = result.get("chunks") or []
                aggregated_sources.extend(chunks)

            convo.append(
                {
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result),
                }
            )

    yield _sse("token", "[stopped: max tool iterations reached]")
    if aggregated_sources:
        yield _sse("sources", aggregated_sources)
    yield _sse("done", "")
```

- [ ] **Step 8.4: Run tests, expect pass**

Run: `cd backend && uv run pytest tests/test_agent_loop.py -v`
Expected: all 4 tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add backend/src/paperpilot/agent.py backend/tests/test_agent_loop.py
git commit -m "feat(backend): add agent loop with tool calling and SSE event surface"
```

---

## Task 9: `/models` endpoint

**Files:**
- Modify: `backend/src/paperpilot/api.py`
- Create: `backend/tests/test_models_endpoint.py`

- [ ] **Step 9.1: Write the failing test**

Create `backend/tests/test_models_endpoint.py`:

```python
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, clear_provider_env: None) -> TestClient:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    # Bypass auth dependency
    from paperpilot import api, auth

    api.app.dependency_overrides[auth.current_user] = lambda: "u-1"
    return TestClient(api.app)


def test_models_returns_only_enabled(client: TestClient) -> None:
    resp = client.get("/models", headers={"Authorization": "Bearer dummy"})
    assert resp.status_code == 200
    data = resp.json()
    ids = {m["id"] for m in data}
    assert "gpt-4o" in ids
    assert "gpt-4o-mini" in ids
    assert "deepseek-chat" not in ids
    for m in data:
        assert set(m.keys()) >= {"id", "display_name", "provider"}
```

- [ ] **Step 9.2: Run test, expect failure**

Run: `cd backend && uv run pytest tests/test_models_endpoint.py -v`
Expected: 404 — endpoint missing.

- [ ] **Step 9.3: Add the endpoint**

Edit `backend/src/paperpilot/api.py`. Near the other route definitions (e.g., right after the `/me` route), add:

```python
from paperpilot import providers as _providers  # add near top imports


@app.get("/models")
async def list_available_models(user_id: str = Depends(current_user)) -> list[dict[str, str]]:
    return [
        {"id": m.id, "display_name": m.display_name, "provider": m.provider}
        for m in _providers.available_models()
    ]
```

(Place the `import paperpilot.providers as _providers` with the existing module imports near the top of `api.py`. If the import already exists, do not duplicate it.)

- [ ] **Step 9.4: Run test, expect pass**

Run: `cd backend && uv run pytest tests/test_models_endpoint.py -v`
Expected: pass.

- [ ] **Step 9.5: Commit**

```bash
git add backend/src/paperpilot/api.py backend/tests/test_models_endpoint.py
git commit -m "feat(backend): add GET /models endpoint returning enabled models"
```

---

## Task 10: `/chat` endpoint

**Files:**
- Modify: `backend/src/paperpilot/api.py`
- Modify: `backend/src/paperpilot/models.py`
- Create: `backend/tests/test_chat_endpoint.py`

- [ ] **Step 10.1: Add request model**

Edit `backend/src/paperpilot/models.py`. Append:

```python
from pydantic import BaseModel, Field


class ChatMessageIn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    session_id: str | None = None
    messages: list[ChatMessageIn]
    model_id: str
    doc_ids: list[str] | None = None
    top_k: int = Field(default=5, ge=1, le=20)
```

(If `BaseModel`/`Field` are already imported at the top, do not add the import line a second time.)

- [ ] **Step 10.2: Write the failing test**

Create `backend/tests/test_chat_endpoint.py`:

```python
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi.testclient import TestClient


def _delta(content: str | None = None, tool_calls: list[Any] | None = None) -> Any:
    class D:
        def __init__(self) -> None:
            self.content = content
            self.tool_calls = tool_calls

    class Choice:
        def __init__(self) -> None:
            self.delta = D()

    class Chunk:
        def __init__(self) -> None:
            self.choices = [Choice()]

    return Chunk()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, clear_provider_env: None) -> TestClient:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    from paperpilot import agent, api, auth

    api.app.dependency_overrides[auth.current_user] = lambda: "u-1"

    async def fake_get_db() -> AsyncIterator[Any]:
        yield object()

    monkeypatch.setattr(api, "get_db", fake_get_db)

    async def fake_stream(**kwargs: Any) -> AsyncIterator[Any]:
        yield _delta(content="hi")

    monkeypatch.setattr(agent, "stream_completion", fake_stream)
    return TestClient(api.app)


def test_chat_streams_tokens(client: TestClient) -> None:
    body = {
        "messages": [{"role": "user", "content": "hello"}],
        "model_id": "deepseek-chat",
    }
    with client.stream("POST", "/chat", json=body, headers={"Authorization": "Bearer x"}) as resp:
        assert resp.status_code == 200
        text = "".join(resp.iter_text())
    assert "event: token" in text
    assert "hi" in text
    assert "event: done" in text


def test_chat_unknown_model_returns_404(client: TestClient) -> None:
    body = {
        "messages": [{"role": "user", "content": "hi"}],
        "model_id": "nope",
    }
    resp = client.post("/chat", json=body, headers={"Authorization": "Bearer x"})
    assert resp.status_code == 404
```

- [ ] **Step 10.3: Run test, expect failure**

Run: `cd backend && uv run pytest tests/test_chat_endpoint.py -v`
Expected: 404 or import error.

- [ ] **Step 10.4: Wire the endpoint**

Edit `backend/src/paperpilot/api.py`. Add near the `/query` route:

```python
from paperpilot import agent as _agent  # near other imports
from paperpilot.models import ChatRequest  # extend the existing models import


@app.post("/chat")
@limiter.limit("30/hour", key_func=get_user_key)
async def chat(
    request: Request,
    body: ChatRequest,
    user_id: str = Depends(current_user),
) -> StreamingResponse:
    spec = _providers.resolve(body.model_id)  # 404s if not available
    access_token = getattr(request.state, "access_token", "") or ""

    async def stream() -> AsyncIterator[str]:
        async for session in get_db():
            async for evt in _agent.run(
                messages=[m.model_dump() for m in body.messages],
                user_id=user_id,
                model_id=spec.id,
                doc_ids=body.doc_ids,
                access_token=access_token,
                db_session=session,
                max_iterations=settings.agent_max_iterations,
            ):
                yield evt

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

Also: at module top (after existing imports), register the built-in tools exactly once:

```python
from paperpilot.tools import docs as _docs_tool
from paperpilot.tools import search_docs as _search_docs_tool
from paperpilot.tools import web_search as _web_search_tool

_search_docs_tool.register_tool()
_docs_tool.register_tools()
_web_search_tool.register_tool_if_enabled()
```

(Place these once, near the top, after `configure_logging(settings.env)`.)

- [ ] **Step 10.5: Run tests, expect pass**

Run: `cd backend && uv run pytest tests/test_chat_endpoint.py -v`
Expected: both tests pass.

- [ ] **Step 10.6: Commit**

```bash
git add backend/src/paperpilot/api.py backend/src/paperpilot/models.py backend/tests/test_chat_endpoint.py
git commit -m "feat(backend): add POST /chat agentic endpoint with rate limit"
```

---

## Task 11: Replace `reader.py` with shim

**Files:**
- Modify: `backend/src/paperpilot/reader.py`

- [ ] **Step 11.1: Replace contents**

Replace `backend/src/paperpilot/reader.py` with:

```python
from __future__ import annotations

from collections.abc import AsyncIterator

from paperpilot import agent, providers
from paperpilot.config import settings
from paperpilot.db import get_db


async def answer(
    query: str,
    user_id: str,
    top_k: int = 5,
    doc_ids: list[str] | None = None,
) -> AsyncIterator[str]:
    """Backward-compatible /query path.

    Routes through the agent loop with a single tool (search_documents) and
    a single iteration so behavior matches the pre-agentic flow.
    """
    try:
        spec = providers.resolve(settings.default_model_id)
    except Exception:
        available = providers.available_models()
        if not available:
            yield "event: token\ndata: \"No LLM providers configured.\"\n\n"
            yield "event: done\ndata: \n\n"
            return
        spec = available[0]

    async for session in get_db():
        async for evt in agent.run(
            messages=[{"role": "user", "content": query}],
            user_id=user_id,
            model_id=spec.id,
            doc_ids=doc_ids,
            access_token="",
            db_session=session,
            max_iterations=1,
            allowed_tools=["search_documents"],
        ):
            yield evt
```

- [ ] **Step 11.2: Verify all existing tests still pass**

Run: `cd backend && uv run pytest -v`
Expected: all tests pass.

- [ ] **Step 11.3: Commit**

```bash
git add backend/src/paperpilot/reader.py
git commit -m "refactor(backend): reader.answer is now a shim over agent.run for /query"
```

---

## Task 12: Startup warning + Tavily reminder

**Files:**
- Modify: `backend/src/paperpilot/api.py`

- [ ] **Step 12.1: Add startup hook**

Edit `backend/src/paperpilot/api.py`. Below `configure_logging(settings.env)` add:

```python
import logging as _logging

_log = _logging.getLogger("paperpilot.startup")


@app.on_event("startup")
async def _startup_provider_check() -> None:
    enabled = [m.id for m in _providers.available_models()]
    if not enabled:
        _log.warning("no LLM provider API keys configured; /chat and /query will fail")
    else:
        _log.info("enabled LLM models: %s", ", ".join(enabled))
    if settings.default_model_id not in enabled and enabled:
        _log.warning(
            "DEFAULT_MODEL_ID=%s is not in enabled models; /query will fall back to %s",
            settings.default_model_id,
            enabled[0],
        )
```

- [ ] **Step 12.2: Smoke-run the API once**

Run: `cd backend && uv run uvicorn paperpilot.api:app --port 8000 &`
Then: `curl -s http://localhost:8000/health` → `{"status":"ok"}`
Stop the server (`kill %1` or `pkill -f uvicorn`).

Expected: server logs the warning if no keys set; no crash.

- [ ] **Step 12.3: Commit**

```bash
git add backend/src/paperpilot/api.py
git commit -m "feat(backend): log warning when LLM providers or DEFAULT_MODEL_ID missing"
```

---

## Task 13: Frontend — API client extensions

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 13.1: Replace SSEEvent type and add new helpers**

Edit `frontend/src/lib/api.ts`:

Replace the existing `SSEEvent` interface and `streamQuery` function with:

```typescript
export interface SSESource {
  chunk_id: string;
  document_id: string;
  ordinal: number;
  page: number | null;
  text: string;
  document_filename?: string;
  filename?: string;
  source_url?: string;
}

export interface ModelInfo {
  id: string;
  display_name: string;
  provider: string;
}

export interface ToolCallEvent {
  type: "tool_call";
  data: { id: string; name: string; args: Record<string, unknown> };
}

export interface ToolResultEvent {
  type: "tool_result";
  data: { id: string; result: Record<string, unknown> };
}

export type StreamEvent =
  | { type: "token"; data: string }
  | { type: "sources"; data: SSESource[] }
  | ToolCallEvent
  | ToolResultEvent
  | { type: "done" };

export interface ChatTurnMessage {
  role: "user" | "assistant";
  content: string;
}

export async function getModels(): Promise<ModelInfo[]> {
  return apiFetch("/models");
}

async function* parseSSEStream(
  res: Response,
): AsyncGenerator<StreamEvent> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (currentEvent === "token") {
            try {
              yield { type: "token", data: JSON.parse(payload) as string };
            } catch {
              yield { type: "token", data: payload };
            }
          } else if (currentEvent === "sources") {
            yield { type: "sources", data: JSON.parse(payload) as SSESource[] };
          } else if (currentEvent === "tool_call") {
            yield { type: "tool_call", data: JSON.parse(payload) };
          } else if (currentEvent === "tool_result") {
            yield { type: "tool_result", data: JSON.parse(payload) };
          } else if (currentEvent === "done") {
            yield { type: "done" };
          }
          currentEvent = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* chatStream(
  messages: ChatTurnMessage[],
  modelId: string,
  docIds?: string[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const token = await getToken();
  if (!token) throw new Error("No access token");

  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages,
      model_id: modelId,
      doc_ids: docIds,
    }),
    signal,
  });

  if (res.status === 401) {
    signOut("Session expired.");
    throw new Error("Unauthorized");
  }
  if (res.status === 429) {
    toast.error("Chat limit reached. Try again later.");
    throw new Error("Rate limited");
  }
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);

  try {
    for await (const ev of parseSSEStream(res)) yield ev;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    throw err;
  }
}
```

Keep the existing `streamQuery` export below (it stays a deprecated path until callers migrate). Replace any internal SSE parsing in `streamQuery` to also use `parseSSEStream` if convenient; not required.

- [ ] **Step 13.2: Type check**

Run: `cd frontend && pnpm tsc -b --noEmit`
Expected: no type errors.

- [ ] **Step 13.3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): add chatStream, getModels, and new SSE event types"
```

---

## Task 14: Frontend — `useModels` hook

**Files:**
- Create: `frontend/src/hooks/useModels.ts`

- [ ] **Step 14.1: Create hook**

Create `frontend/src/hooks/useModels.ts`:

```typescript
import { useEffect, useState } from "react";
import { getModels, type ModelInfo } from "@/lib/api";

const LAST_MODEL_KEY = "paperpilot.lastModel";

export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    return localStorage.getItem(LAST_MODEL_KEY);
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getModels();
        if (cancelled) return;
        setModels(list);
        setSelectedId((prev) => {
          if (prev && list.some((m) => m.id === prev)) return prev;
          return list[0]?.id ?? null;
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setSelected = (id: string) => {
    setSelectedId(id);
    localStorage.setItem(LAST_MODEL_KEY, id);
  };

  return { models, selectedId, setSelected, loading, error };
}
```

- [ ] **Step 14.2: Type check**

Run: `cd frontend && pnpm tsc -b --noEmit`
Expected: clean.

- [ ] **Step 14.3: Commit**

```bash
git add frontend/src/hooks/useModels.ts
git commit -m "feat(frontend): add useModels hook with localStorage persistence"
```

---

## Task 15: Frontend — `ModelPicker` component

**Files:**
- Create: `frontend/src/components/ModelPicker.tsx`

- [ ] **Step 15.1: Create component**

Create `frontend/src/components/ModelPicker.tsx`:

```tsx
import type { ModelInfo } from "@/lib/api";

interface ModelPickerProps {
  models: ModelInfo[];
  selectedId: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}

const PROVIDER_BADGE: Record<string, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  groq: "Groq",
  mistral: "Mistral",
};

export default function ModelPicker({
  models,
  selectedId,
  onChange,
  disabled,
}: ModelPickerProps) {
  if (models.length === 0) {
    return (
      <span className="text-xs text-muted-foreground" aria-live="polite">
        No models available
      </span>
    );
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only">Model</span>
      <select
        value={selectedId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="rounded-md border bg-card px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name} · {PROVIDER_BADGE[m.provider] ?? m.provider}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 15.2: Type check + lint**

Run: `cd frontend && pnpm tsc -b --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 15.3: Commit**

```bash
git add frontend/src/components/ModelPicker.tsx
git commit -m "feat(frontend): add ModelPicker component"
```

---

## Task 16: Frontend — `ToolCallBubble` component

**Files:**
- Create: `frontend/src/components/ToolCallBubble.tsx`

- [ ] **Step 16.1: Create component**

Create `frontend/src/components/ToolCallBubble.tsx`:

```tsx
import { Loader2, Check, X, Wrench } from "lucide-react";

export interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  state: "running" | "done" | "error";
}

const TOOL_LABEL: Record<string, string> = {
  search_documents: "Searching documents",
  list_documents: "Listing documents",
  get_document_summary: "Summarizing document",
  web_search: "Searching the web",
};

function shortArg(args: Record<string, unknown>): string {
  if (typeof args.query === "string") return `"${args.query}"`;
  if (typeof args.document_id === "string") return args.document_id.slice(0, 8);
  return "";
}

export default function ToolCallBubble({ tool }: { tool: ToolCallState }) {
  const label = TOOL_LABEL[tool.name] ?? tool.name;
  const detail = shortArg(tool.args);

  return (
    <div
      className="my-2 inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs"
      role="status"
      aria-live="polite"
    >
      {tool.state === "running" ? (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      ) : tool.state === "error" ? (
        <X className="h-3 w-3 text-destructive" />
      ) : tool.state === "done" ? (
        <Check className="h-3 w-3 text-muted-foreground" />
      ) : (
        <Wrench className="h-3 w-3 text-muted-foreground" />
      )}
      <span className="text-muted-foreground">{label}</span>
      {detail && (
        <span className="max-w-[12rem] truncate text-foreground/80">
          {detail}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 16.2: Type check**

Run: `cd frontend && pnpm tsc -b --noEmit`
Expected: clean.

- [ ] **Step 16.3: Commit**

```bash
git add frontend/src/components/ToolCallBubble.tsx
git commit -m "feat(frontend): add ToolCallBubble inline status component"
```

---

## Task 17: Frontend — message parts schema in `useChatSessions`

**Files:**
- Modify: `frontend/src/hooks/useChatSessions.ts`

- [ ] **Step 17.1: Extend the message types and migration helper**

Edit `frontend/src/hooks/useChatSessions.ts`. Replace the `ChatMessage` interface and `rowToSession` function (and add `migrateMessage` helper) with:

```typescript
import type { SSESource } from "@/lib/api";
import type { ToolCallState } from "@/components/ToolCallBubble";

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "tool"; tool: ToolCallState };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string; // canonical text (joined from text parts on write)
  parts?: MessagePart[]; // assistant messages
  model?: string;
  sources?: SSESource[];
  confidence?: number; // legacy field, kept for back-compat reads
}

function migrateMessage(raw: ChatMessage): ChatMessage {
  if (raw.role !== "assistant") return raw;
  if (raw.parts && raw.parts.length > 0) return raw;
  return {
    ...raw,
    parts: raw.content ? [{ type: "text", text: raw.content }] : [],
  };
}

function rowToSession(row: DbRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    messages: (row.messages ?? []).map(migrateMessage),
    docIds: row.doc_ids ?? [],
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}
```

The existing `DbRow` interface stays unchanged (its `messages: ChatMessage[]` type now reflects the extended `ChatMessage`).

- [ ] **Step 17.2: Type check**

Run: `cd frontend && pnpm tsc -b --noEmit`
Expected: ChatBox will have type errors at this point (next task fixes); other consumers of `ChatMessage` (if any outside ChatBox) should still compile.

If errors come only from `ChatBox.tsx`, that is expected and is resolved in the next task. Do not commit yet — bundle this change with Task 18.

---

## Task 18: Frontend — rewire `ChatBox` to `/chat`

**Files:**
- Modify: `frontend/src/components/ChatBox.tsx`

- [ ] **Step 18.1: Replace `streamQuery` call and message rendering**

Edit `frontend/src/components/ChatBox.tsx`:

1. Replace the import block at the top:

```tsx
import {
  getDocumentDownloadUrl,
  chatStream,
  submitFeedback,
  listDocuments,
  type SSESource,
  type StreamEvent,
} from "@/lib/api";
import ModelPicker from "./ModelPicker";
import ToolCallBubble, { type ToolCallState } from "./ToolCallBubble";
import { useModels } from "@/hooks/useModels";
import type { ChatMessage, MessagePart } from "@/hooks/useChatSessions";
import { useRef, useState, useEffect, useCallback } from "react";
```

2. Inside `ChatBox`, near other hooks, add:

```tsx
const { models, selectedId, setSelected, loading: modelsLoading } = useModels();
```

3. Replace the body of `handleSend` with this version that consumes `chatStream` and builds `parts`:

```tsx
const handleSend = async () => {
  const q = input.trim();
  if (!q || streaming) return;
  if (!selectedId) {
    toast.error("Pick a model first");
    return;
  }

  setInput("");
  if (textareaRef.current) textareaRef.current.style.height = "auto";

  const userMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: q,
  };
  const assistantId = crypto.randomUUID();
  const assistantMsg: ChatMessage = {
    id: assistantId,
    role: "assistant",
    content: "",
    parts: [],
    model: selectedId,
  };
  onMessagesChange((prev) => [...prev, userMsg, assistantMsg]);

  const turn = [
    ...messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: q },
  ];

  const controller = new AbortController();
  abortRef.current = controller;
  setStreaming(true);
  scrollToBottom();

  const updateAssistant = (mut: (m: ChatMessage) => ChatMessage) => {
    onMessagesChange((prev) =>
      prev.map((m) => (m.id === assistantId ? mut(m) : m)),
    );
  };

  const appendText = (text: string) => {
    updateAssistant((m) => {
      const parts: MessagePart[] = m.parts ? [...m.parts] : [];
      const last = parts[parts.length - 1];
      if (last && last.type === "text") {
        parts[parts.length - 1] = {
          type: "text",
          text: last.text + text,
        };
      } else {
        parts.push({ type: "text", text });
      }
      const content = parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");
      return { ...m, parts, content };
    });
  };

  const pushTool = (tool: ToolCallState) => {
    updateAssistant((m) => {
      const parts: MessagePart[] = m.parts ? [...m.parts] : [];
      parts.push({ type: "tool", tool });
      return { ...m, parts };
    });
  };

  const updateTool = (id: string, mut: (t: ToolCallState) => ToolCallState) => {
    updateAssistant((m) => {
      const parts = (m.parts ?? []).map((p) =>
        p.type === "tool" && p.tool.id === id
          ? { type: "tool" as const, tool: mut(p.tool) }
          : p,
      );
      return { ...m, parts };
    });
  };

  try {
    for await (const event of chatStream(
      turn,
      selectedId,
      docIds.length > 0 ? docIds : undefined,
      controller.signal,
    )) {
      handleStreamEvent(event, {
        appendText,
        pushTool,
        updateTool,
        onSources: (sources) => {
          sourcesRef.current.set(assistantId, sources);
          updateAssistant((m) => ({ ...m, sources }));
        },
      });
      scrollToBottom();
    }
  } catch (err: any) {
    if (err.name === "AbortError") {
      appendText(" [stopped]");
    } else {
      toast.error(err.message || "Chat failed");
      onMessagesChange((prev) => prev.filter((m) => m.id !== assistantId));
    }
  } finally {
    setStreaming(false);
    abortRef.current = null;
  }
};
```

4. Add a top-level helper `handleStreamEvent` (outside the component or as an internal helper above `ChatBox`):

```tsx
type EventHandlers = {
  appendText: (text: string) => void;
  pushTool: (tool: ToolCallState) => void;
  updateTool: (id: string, mut: (t: ToolCallState) => ToolCallState) => void;
  onSources: (sources: SSESource[]) => void;
};

function handleStreamEvent(event: StreamEvent, h: EventHandlers): void {
  if (event.type === "token") {
    h.appendText(event.data);
  } else if (event.type === "tool_call") {
    h.pushTool({
      id: event.data.id,
      name: event.data.name,
      args: event.data.args,
      state: "running",
    });
  } else if (event.type === "tool_result") {
    h.updateTool(event.data.id, (t) => ({
      ...t,
      result: event.data.result,
      state: "error" in event.data.result ? "error" : "done",
    }));
  } else if (event.type === "sources") {
    h.onSources(event.data);
  }
}
```

5. Replace the assistant message rendering block (the `<div className="flex-1 min-w-0">...</div>` for assistant messages) with logic that walks `parts`:

```tsx
<div className="flex-1 min-w-0">
  {msg.parts && msg.parts.length > 0 ? (
    <div className="space-y-1">
      {msg.parts.map((part, idx) =>
        part.type === "text" ? (
          <div
            key={idx}
            className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed"
          >
            {renderContext(part.text, msg.sources)}
          </div>
        ) : (
          <ToolCallBubble key={part.tool.id} tool={part.tool} />
        ),
      )}
      {streaming &&
        msg.id === messages[messages.length - 1]?.id &&
        (!msg.parts.length ||
          msg.parts[msg.parts.length - 1].type !== "text" ||
          (msg.parts[msg.parts.length - 1] as { type: "text"; text: string })
            .text === "") && <ThinkingBubble />}
    </div>
  ) : msg.content ? (
    <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">
      {renderContext(msg.content, msg.sources)}
    </div>
  ) : (
    streaming && <ThinkingBubble />
  )}
  {/* feedback buttons block stays unchanged */}
</div>
```

6. In the input footer (the `<div className="flex items-center justify-between px-3 pb-3">...`), insert `ModelPicker` to the left of the Send/Stop button group:

```tsx
<div className="flex items-center gap-2">
  <Button /* the existing "Add docs" button */ />
  <ModelPicker
    models={models}
    selectedId={selectedId}
    onChange={setSelected}
    disabled={streaming || modelsLoading}
  />
</div>
```

(Keep the existing `streaming ? Stop : Send` right-side button untouched.)

- [ ] **Step 18.2: Type check + lint + build**

Run: `cd frontend && pnpm tsc -b --noEmit && pnpm lint && pnpm build`
Expected: build succeeds.

- [ ] **Step 18.3: Smoke test against backend**

In a terminal:
- Backend: `cd backend && uv run uvicorn paperpilot.api:app --reload`
- Frontend: `cd frontend && pnpm dev`

Open `http://localhost:5173`, sign in, select a model in the picker, ask a question against an uploaded document. Verify:
- Picker shows only models for which keys are present.
- Tool bubble appears, transitions to done, then assistant text streams.
- Sources panel renders after the answer.

If any tool fails inline, the bubble shows the error icon and the agent continues.

- [ ] **Step 18.4: Commit**

```bash
git add frontend/src/hooks/useChatSessions.ts frontend/src/components/ChatBox.tsx
git commit -m "feat(frontend): wire /chat agent stream, ModelPicker, and parts-shaped messages"
```

---

## Task 19: Documentation + .env.example updates

**Files:**
- Modify: `backend/.env.example` (create if missing)
- Modify: `README.md` (if it documents env vars)

- [ ] **Step 19.1: Update `.env.example`**

Append (or create) `backend/.env.example` with:

```env
# LLM provider keys (set any subset; only set models appear in /models)
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
GROQ_API_KEY=
MISTRAL_API_KEY=

# Tool keys
TAVILY_API_KEY=

# Agent defaults
DEFAULT_MODEL_ID=deepseek-chat
AGENT_MAX_ITERATIONS=5
```

- [ ] **Step 19.2: Commit**

```bash
git add backend/.env.example
git commit -m "docs: document new LLM and tool env vars"
```

---

## Task 20: Final verification

- [ ] **Step 20.1: Full backend test suite**

Run: `cd backend && uv run pytest -v`
Expected: all tests pass.

- [ ] **Step 20.2: Backend lint + typecheck**

Run: `cd backend && uv run ruff check src/ tests/ && uv run mypy src/`
Expected: no errors.

- [ ] **Step 20.3: Frontend build**

Run: `cd frontend && pnpm build`
Expected: build succeeds.

- [ ] **Step 20.4: End-to-end smoke**

With backend and frontend running, perform manual flows:
1. Pick GPT-4o, ask "What documents do I have?" → expect `list_documents` tool bubble, then prose listing.
2. Pick DeepSeek, ask a question that requires `search_documents` → expect tool bubble + sources panel.
3. With `TAVILY_API_KEY` unset, verify `web_search` is never invoked (assistant does not mention it as available — system prompt only describes registered tools' behaviors).
4. With `TAVILY_API_KEY` set, ask "What's the latest news on X?" → expect `web_search` bubble with snippets.

- [ ] **Step 20.5: Confirm `/query` still works**

`curl -N -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"query":"hi","top_k":3}' http://localhost:8000/query`
Expected: SSE stream with `token`/`sources`/`done` events.

---

## Self-Review Notes (after writing)

The following spec sections map to plan tasks:

| Spec section | Task(s) |
|---|---|
| §3 architecture / file structure | 1, 2, 3, 8, 10 |
| §4 LiteLLM provider abstraction | 2, 7 |
| §4.2 `/models` endpoint | 9 |
| §4.3 llm.py refactor | 7 |
| §5 tool registry + ToolContext | 3 |
| §5.2 launch tools | 4, 5, 6 |
| §6 agent loop + SSE event surface | 8 |
| §7.1 `POST /chat` | 10 |
| §7.3 `/query` shim (max_iterations=1, single tool) | 11 |
| §8 message parts persistence + read-side migration | 17 |
| §9 ModelPicker, ToolCallBubble, ChatBox | 13, 14, 15, 16, 18 |
| §10 config / env vars | 1, 19 |
| §11 testing | 2, 3, 4, 5, 6, 8, 9, 10 |
| §12 rollout | covered by ordering; no separate task needed |

`/query` shim restricts the agent to `search_documents` only via the `allowed_tools` parameter on `agent.run`, exactly as the spec requires. `max_iterations=1` caps the loop to a single retrieve-then-answer round. Registry contents are unaffected, so `/chat` requests continue to see all registered tools.
