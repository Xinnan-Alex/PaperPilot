# Agentic Multi-Provider Chat — Design

**Status:** Approved (pending user review of this written spec)
**Date:** 2026-06-01
**Author:** Brainstorming session

---

## 1. Goal

Evolve PaperPilot from single-provider RAG (`POST /query` → DeepSeek with one retrieval step) into an agentic chat system that:

1. Supports multiple LLM providers (OpenAI, DeepSeek, Groq, Mistral at launch; registry future-proofed for Anthropic, Google, etc.).
2. Lets the model call tools mid-conversation (RAG retrieval, web search, document listing, document summary).
3. Lets the user pick which model handles each message.
4. Streams tool activity to the UI for transparency.

PaperPilot continues using the project's own provider API keys — not BYOK. Models are feature-flagged: if the corresponding env key is unset, the model never appears in the picker.

## 2. Non-goals

- All provider API keys are PaperPilot-owned, configured server-side via env vars. End users never supply keys.
- Cost tracking, token accounting, or usage dashboards.
- Auto-routing or model-fallback chains.
- Streaming provider-specific reasoning blocks (o1, DeepSeek-R1 thinking).
- Tool-result caching.
- Code interpreter / Python sandbox tool.
- Per-user model preferences persisted in DB (localStorage is enough).
- Per-tool rate limits beyond the existing endpoint-level limiter.

Anthropic, Google, and other non-OpenAI-compatible providers are **registry-ready but not enabled at launch** — add by appending to `MODELS` list and setting an env key. No code change required.

## 3. Architecture

```
backend/src/paperpilot/
├── llm.py            REPLACED   thin wrapper over litellm.acompletion
├── providers.py      NEW        model registry (id → provider, capabilities, env key)
├── tools/            NEW        tool registry + handlers
│   ├── __init__.py              ToolSpec, REGISTRY, dispatch(), openai_tools()
│   ├── search_docs.py           wraps retrieve.hybrid_search
│   ├── web_search.py            Tavily client
│   └── docs.py                  list_documents, get_document_summary
├── agent.py          NEW        agent control loop (replaces reader.answer for /chat)
├── reader.py         SHIM       3-line wrapper → agent.run with tools=[search_documents]
├── api.py            UPDATED    /chat, /models endpoints; /query stays as back-compat
└── config.py         UPDATED    per-provider api-key fields (optional)
```

Request flow for `/chat`:

```
client → POST /chat → auth → agent.run() → loop {
    litellm.acompletion (stream)
    if tool_calls → tools.dispatch() → append → continue
    else → done
} → SSE
```

`/query` flow is unchanged for callers; internally it now calls `agent.run` with a fixed model and a single tool (`search_documents`).

## 4. Provider abstraction (LiteLLM)

LiteLLM is chosen because:
- Single Python call (`litellm.acompletion`) targets 100+ providers.
- Tool-call format is normalized across providers — agent loop stays provider-agnostic.
- Streaming is async-native, matches current `AsyncIterator[str]` interface.
- Adding new providers later = one row in the model registry plus an env key.

### 4.1 Model registry (`providers.py`)

```python
@dataclass(frozen=True)
class ModelSpec:
    id: str                   # internal id, e.g. "gpt-4o-mini"
    litellm_id: str           # e.g. "openai/gpt-4o-mini"
    provider: str             # "openai" | "deepseek" | "groq" | "mistral"
    display_name: str
    supports_tools: bool
    context_window: int
    api_key_env: str          # e.g. "OPENAI_API_KEY"

MODELS: list[ModelSpec] = [
    ModelSpec("gpt-4o",        "openai/gpt-4o",               "openai",   "GPT-4o",        True, 128000, "OPENAI_API_KEY"),
    ModelSpec("gpt-4o-mini",   "openai/gpt-4o-mini",          "openai",   "GPT-4o mini",   True, 128000, "OPENAI_API_KEY"),
    ModelSpec("deepseek-chat", "deepseek/deepseek-chat",      "deepseek", "DeepSeek V3",   True,  64000, "DEEPSEEK_API_KEY"),
    ModelSpec("llama-3.3-70b", "groq/llama-3.3-70b-versatile","groq",     "Llama 3.3 70B", True, 128000, "GROQ_API_KEY"),
    ModelSpec("mistral-large", "mistral/mistral-large-latest","mistral",  "Mistral Large", True, 128000, "MISTRAL_API_KEY"),
]

def available_models() -> list[ModelSpec]:
    return [m for m in MODELS if os.getenv(m.api_key_env)]

def resolve(model_id: str) -> ModelSpec:
    for m in available_models():
        if m.id == model_id:
            return m
    raise HTTPException(404, f"Model {model_id} not available")
```

### 4.2 `/models` endpoint

```
GET /models
→ [{id, display_name, provider}, ...]
```

Returns only currently-enabled models. Frontend fetches once, populates picker.

### 4.3 `llm.py` refactor

`stream_chat` becomes a passthrough to `litellm.acompletion` with `stream=True`. The OpenAI-SDK `AsyncOpenAI` client is removed.

## 5. Tools

### 5.1 Registry (`tools/__init__.py`)

```python
class ToolSpec(TypedDict):
    name: str
    description: str
    parameters: dict                  # OpenAI tools JSON schema
    handler: Callable[..., Awaitable[dict]]

REGISTRY: dict[str, ToolSpec] = {}

@dataclass
class ToolContext:
    user_id: str
    access_token: str
    doc_ids: list[str] | None         # chat-scoped doc filter
    db_session: AsyncSession

def register(spec: ToolSpec) -> None: ...
def openai_tools() -> list[dict]: ... # returns OpenAI-format tool defs for current registry
async def dispatch(name: str, args: dict, ctx: ToolContext) -> dict: ...
```

Tool handlers receive a `ToolContext` so they can hit DB/Storage on behalf of the caller. Errors are caught inside `dispatch` and returned as `{"error": "..."}` — the agent loop sees the error and decides whether to retry or give up. Nothing throws to the SSE stream.

### 5.2 Launch tools

| Tool | Args | Returns |
|---|---|---|
| `search_documents` | `query: str, top_k: int = 5` | `{chunks: [{chunk_id, document_id, text, filename, page}]}` |
| `list_documents` | none | `{documents: [{id, filename, status}]}` |
| `get_document_summary` | `document_id: str` | `{summary: str}` — concatenation of the first 5 chunks of the document, truncated to 4000 chars |
| `web_search` | `query: str, max_results: int = 5` | `{results: [{title, url, snippet}]}` via Tavily |

`search_documents` honors `ctx.doc_ids` if set (chat-scoped filter). `web_search` only registers if `TAVILY_API_KEY` is set; otherwise tool is hidden from the agent.

## 6. Agent loop (`agent.py`)

```python
SYSTEM_PROMPT = """You are PaperPilot, a research assistant. The user has uploaded
documents; you have tools to search them, list them, summarize them, and search the
web. Use tools when they would give a better answer than your priors. Cite document
sources with [N] referring to chunks returned by search_documents. Refuse off-topic
or unsafe requests."""

async def run(
    messages: list[dict],
    user_id: str,
    model_id: str,
    doc_ids: list[str] | None,
    access_token: str,
    db_session: AsyncSession,
    max_iterations: int = 5,
) -> AsyncIterator[str]:
    spec = providers.resolve(model_id)
    ctx = ToolContext(user_id, access_token, doc_ids, db_session)
    tool_defs = tools.openai_tools()
    convo = [{"role": "system", "content": SYSTEM_PROMPT}, *messages]
    aggregated_sources: list[dict] = []

    for _ in range(max_iterations):
        stream = await litellm.acompletion(
            model=spec.litellm_id, messages=convo, tools=tool_defs,
            tool_choice="auto", stream=True, temperature=0.3,
        )

        accumulated_tool_calls: list = []
        assistant_text = ""

        async for delta in stream:
            d = delta.choices[0].delta
            if d.content:
                assistant_text += d.content
                yield sse("token", d.content)
            if d.tool_calls:
                merge_tool_call_deltas(accumulated_tool_calls, d.tool_calls)

        if not accumulated_tool_calls:
            if aggregated_sources:
                yield sse("sources", aggregated_sources)
            yield sse("done", "")
            return

        convo.append({
            "role": "assistant",
            "content": assistant_text or None,
            "tool_calls": accumulated_tool_calls,
        })

        for tc in accumulated_tool_calls:
            args = json.loads(tc.function.arguments)
            yield sse("tool_call", {"id": tc.id, "name": tc.function.name, "args": args})
            result = await tools.dispatch(tc.function.name, args, ctx)
            yield sse("tool_result", {"id": tc.id, "result": result})

            if tc.function.name == "search_documents" and "chunks" in result:
                aggregated_sources.extend(result["chunks"])

            convo.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": json.dumps(result),
            })

    yield sse("token", "[stopped: max tool iterations reached]")
    if aggregated_sources:
        yield sse("sources", aggregated_sources)
    yield sse("done", "")
```

### 6.1 SSE event surface

| Event | Payload | When |
|---|---|---|
| `token` | string | streamed assistant text |
| `tool_call` | `{id, name, args}` | model invoked a tool |
| `tool_result` | `{id, result}` | tool returned |
| `sources` | `[{chunk_id, document_id, ...}]` | emitted once before `done`, aggregated from `search_documents` calls |
| `done` | empty | stream end |

The legacy `confidence` event is dropped — it isn't meaningful when retrieval may happen 0..N times per turn.

## 7. API

### 7.1 `POST /chat` (new)

```
body: {
  session_id: uuid,
  messages: [{role, content, model?}, ...],     // full history, frontend sends each turn
  model_id: str,                                 // model for THIS turn
  doc_ids: uuid[] | null,                        // chat-scoped doc filter
}
→ text/event-stream
```

Rate limit: `30/hour` per user (matches existing `/query`).

Auth: existing `current_user` dependency. `access_token` is forwarded into `ToolContext`.

### 7.2 `GET /models` (new)

```
→ [{id, display_name, provider}, ...]
```

Returns currently-enabled models from `providers.available_models()`.

### 7.3 `POST /query` (kept)

Becomes a back-compat shim that calls `agent.run` with:
- `model_id = settings.default_model_id`
- A single registered tool: `search_documents` only.
- `max_iterations = 1` (matches old "retrieve once, answer" semantics).

Frontend can migrate to `/chat` and `/query` can be removed in a follow-up.

## 8. Persistence

No schema migration. `chat_sessions.messages` is JSONB; we extend the per-message shape:

```ts
type MessagePart =
  | { type: "text", text: string }
  | { type: "tool", id: string, name: string, args: object, result?: object, state: "running" | "done" | "error" };

type Message = {
  role: "user" | "assistant";
  content?: string;            // legacy field, kept for read-side migration
  parts?: MessagePart[];       // new — assistant messages use this
  model?: string;              // assistant messages only
  sources?: SourceChunk[];     // existing
  timestamp: string;
};
```

Read-side migration: if a stored message has `content` but no `parts`, render as a single `TextPart`. New messages always saved in the parts shape. No backfill.

`useChatSessions.ts` debounce window stays 1.5s; the only change is the message shape it serializes.

## 9. Frontend

### 9.1 New components

| File | Role |
|---|---|
| `components/ModelPicker.tsx` | dropdown, value bound to draft state. Uses `useModels()` (fetches `/models` once). Renders provider badge. |
| `components/ToolCallBubble.tsx` | inline pill between text segments. States: `running` (spinner, "Searching documents..."), `done` (✓ + short summary), `error` (✗). Props: `{name, args, result?, state}`. |

### 9.2 Updates

- `ChatBox.tsx`: render `<ModelPicker>` next to send button. Send chosen `model_id` with each turn. SSE handler adds cases for `tool_call` (push pending bubble) and `tool_result` (resolve matching bubble by id). Assistant message stores ordered `parts: (TextPart | ToolPart)[]`.
- `useChatSessions.ts`: serialize the new message shape; read-side migration for legacy `content` strings.
- `lib/api.ts`: add `chatStream()` posting to `/chat`. Keep `queryStream()` as deprecated until callers migrate.

### 9.3 Default model

Read `localStorage["paperpilot.lastModel"]`; if still in `/models` use it, else use first item. No backend default — fully client-driven.

## 10. Config / secrets

New env vars in `backend/.env`:

```
# LLM provider keys — presence enables the model in /models
OPENAI_API_KEY=
DEEPSEEK_API_KEY=         # already exists
GROQ_API_KEY=
MISTRAL_API_KEY=

# Tools
TAVILY_API_KEY=           # required for web_search; tool hidden if absent

# Defaults
DEFAULT_MODEL_ID=deepseek-chat
AGENT_MAX_ITERATIONS=5
```

`config.py` gains corresponding `str | None` fields (`default=None`). App startup logs a warning if zero LLM keys are set.

Existing `LLM_BASE_URL`, `LLM_MODEL` are unused after the refactor but kept for one release for back-compat.

If `DEFAULT_MODEL_ID` does not appear in `available_models()` at startup (e.g., its API key is unset), the app logs a warning and falls back to the first entry returned by `available_models()`. If zero models are available the `/query` shim returns HTTP 503.

Render deployment: add new env vars in the Render dashboard. LiteLLM is pure-Python — no Dockerfile change needed.

## 11. Testing

Backend (pytest):

| Test | Scope |
|---|---|
| `test_providers.py` | `available_models()` filters by env; `resolve()` raises on unknown id. |
| `test_tools_search_docs.py` | dispatcher wraps `hybrid_search`; returns expected chunks shape. |
| `test_tools_web_search.py` | Tavily client mocked; error path returns `{error}` not exception. |
| `test_agent_loop.py` | mock LiteLLM stream emitting tool_calls then final text → loop runs tools, appends results, terminates; `max_iterations` enforced. |
| `test_chat_endpoint.py` | end-to-end: POST /chat with mocked LiteLLM, asserts SSE event order (token → tool_call → tool_result → token → sources → done). |

LiteLLM is mocked via `monkeypatch` on `litellm.acompletion`. No live provider calls in CI.

Frontend: manual smoke test against the dev backend. No new test suite added (project has none today).

## 12. Rollout

Single feature branch with two logical chunks (split into two PRs if desired):

1. **Backend:** add `providers.py`, `tools/`, `agent.py`, `/chat`, `/models`; convert `reader.py` to shim; refactor `llm.py` to LiteLLM. Old `/query` keeps working.
2. **Frontend:** add `ModelPicker`, `ToolCallBubble`, parts-shaped message schema, `chatStream()`. Migrate `ChatBox` to `/chat`.

No data migration required. Existing chat sessions read fine via the legacy-content compatibility branch.

## 13. Open questions

None at this stage. Open follow-ups for later cycles:

- Add Anthropic + Google models (config-only change once decided).
- Decide on a deprecation horizon for `/query`.
- Decide if `LLM_BASE_URL` / `LLM_MODEL` env vars can be deleted.
