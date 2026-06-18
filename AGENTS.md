# PaperPilot — Agent Context

An agentic RAG document-QA app. FastAPI backend + React/Vite frontend + Supabase (Postgres/pgvector/Auth/Storage). The assistant runs a tool-calling agent loop with multi-provider LLM support via LiteLLM.

## Repo Layout

- `backend/` — Python 3.11 FastAPI app. Package root is `paperpilot` under `backend/src/`.
- `frontend/` — React 19 + Vite + TypeScript + Tailwind v4 + shadcn/ui.
- `supabase/migrations/` — Postgres schema migrations. Deployed by CI on push to `main`.
- `.github/workflows/` — CI: `supabase-prod.yml` (migrations), `react-doctor.yml`, `deploy-backend.yml` (ECR + EC2 via SSM), `deploy-frontend.yml` (S3 + CloudFront).
- `render.yaml` — legacy Render config (pre-AWS), retained for reference only.

## Agent Loop

- `backend/src/paperpilot/agent.py` — Core `async run()` generator. Calls `stream_completion`, merges tool-call deltas, dispatches tools, loops up to `max_iterations` (default 5), then emits `done`.
- `backend/src/paperpilot/llm.py` — `stream_completion()` wraps `litellm.acompletion`. Yields raw OpenAI-format chunks regardless of provider.
- `backend/src/paperpilot/providers.py` — Loads `backend/models.json` at import (eager, fail-fast Pydantic validation). Exposes immutable `ProviderSpec` and `ModelSpec`. Public API: `available_models()`, `available_providers()`, `default_model()`, `resolve(model_id)` (raises 404). Availability gate is `provider.enabled && model.enabled && os.getenv(api_key_env)`.
- SSE events emitted by `agent.run`: `token`, `tool_call`, `tool_result`, `sources`, `done`.
- `POST /query` is a backward-compat shim: calls `agent.run` with `allowed_tools=["search_documents"]` and `max_iterations=1`.

## Tools

- `backend/src/paperpilot/tools/__init__.py` — `ToolSpec` TypedDict, `ToolContext` dataclass, `REGISTRY` dict, `register()`, `openai_tools()`, `async dispatch()` (catches all exceptions, returns `{"error": ...}`).
- `backend/src/paperpilot/tools/search_docs.py` — `search_documents`: multi-stage RAG. Query rewrite (`query_rewrite.expand_query`, multi-query expansion) → `embed_queries` → `multi_query_search` (per-variant `hybrid_search` of pgvector cosine + Postgres FTS `tsvector`/`ts_rank_cd`, RRF-fused into a candidate pool) → Voyage `rerank-2-lite` (`rerank.rerank_documents`) → per-model `top_k`/context budget → lexical citation spans (`citation.best_span`). Rerank and rewrite are independently toggleable (`enable_rerank`/`enable_query_rewrite`) and each degrades to the prior behaviour on failure.
- `backend/src/paperpilot/tools/docs.py` — `list_documents` and `get_document_summary` (first 5 chunks, 4000 chars).
- `backend/src/paperpilot/tools/web_search.py` — `web_search` via Tavily API. Only registered if `TAVILY_API_KEY` is set.
- Tools are registered at `api.py` module load time.

## LLM Providers

Providers and models are declared in `backend/models.json`. Each provider entry carries `display_name`, `enabled`, `api_key_env`, a `badge` (`{label, color}`), and a nested `models` array. Each model entry carries `id`, `litellm_id`, `display_name`, `supports_tools`, `context_window`, `enabled`, an optional `default: true` flag (at most one across the manifest), and optional per-model retrieval budgets `retrieval_top_k` / `retrieval_context_chars` (fall back to the global `retrieval_top_k` / `retrieval_context_chars` in `config.py` when unset).

Defaults shipped in `models.json`:

| Model ID | Provider | Env var |
|----------|----------|---------|
| `deepseek-chat` (manifest default) | DeepSeek | `DEEPSEEK_API_KEY` |
| `gpt-4o` | OpenAI | `OPENAI_API_KEY` |
| `gpt-4o-mini` | OpenAI | `OPENAI_API_KEY` |
| `llama-3.3-70b` | Groq | `GROQ_API_KEY` |
| `mistral-large` | Mistral | `MISTRAL_API_KEY` |

A model surfaces in `GET /models` only when `provider.enabled && model.enabled && os.getenv(api_key_env)`. The response shape is `{ default_model_id, providers: [{id, display_name, badge}], models: [{id, display_name, provider, supports_tools, context_window, default}] }`. To add or toggle a model, edit `backend/models.json` and restart the backend — no code change required. Malformed manifest entries fail server startup via Pydantic validation.

OpenAI account scoping: if your `OPENAI_API_KEY` is bound to an organization or project, also set `OPENAI_ORGANIZATION=org-…` and/or `OPENAI_PROJECT_ID=proj_…` in `backend/.env`. The OpenAI SDK (via LiteLLM) reads them from `os.environ` directly.

## Chat Sessions

- `chat_sessions` table in Supabase stores all chat history per user (`id, user_id, title, messages jsonb, doc_ids uuid[], created_at, updated_at`).
- `messages` JSONB stores an array of `{role, parts, model_id?}`. Each `parts` entry is a `MessagePart` union: `{type:"text", text}` or `{type:"tool", tool:{id, name, args, state, result?}}`.
- Legacy messages with `content: string` are migrated on read in `useChatSessions.ts` via `migrateMessage()`.
- Frontend hook `frontend/src/hooks/useChatSessions.ts` manages session state. Writes debounced 1.5s for messages, immediate for doc changes and deletes. Exposes `removeDocFromAllSessions(docId)` which strips a deleted doc's ID from every session's `doc_ids` and persists immediately.
- Each chat has its own set of attached document IDs.
- RLS policies on `chat_sessions` enforce user isolation.

## Backend

- **Package manager:** `uv`. Lockfile is `backend/uv.lock`. Always use `uv` commands from inside `backend/`.
- **Run dev server:** `uv run uvicorn paperpilot.api:app --reload`
- **Run CLI:** `uv run python -m paperpilot.cli` (subcommands: `ingest`, `ask`)
- **Lint:** `ruff` (line-length 100, target py311). Run `uv run ruff check .` and `uv run ruff format .` from `backend/`.
- **Typecheck:** `mypy` / `pyright` both configured to strict mode. Root `pyproject.toml` points pyright venv to `./backend/.venv`.
- **Tests:** `pytest` with `asyncio_mode = "auto"` — no need for `@pytest.mark.asyncio` on async test functions. Run `uv run pytest`.
- **Config:** `pydantic-settings`, reads `.env` in `backend/` (see `.env.example`). Never commit `.env`.
- **DB:** SQLAlchemy async + `asyncpg`. Engine uses `connect_args={"statement_cache_size": 0}` for pgbouncer compatibility.
- **Vector:** pgvector extension on Supabase Postgres.
- **Auth:** JWT verified against Supabase JWKS URL.
- **OCR deps:** Dockerfile installs `tesseract-ocr` and `poppler-utils` for `pytesseract`/`pdf2image`. Do not assume these are available in local venv.
- **Docker:** `backend/Dockerfile` uses `python:3.11-slim`, exposes port 10000, runs `uv run uvicorn paperpilot.api:app --host 0.0.0.0 --port 10000`.

## Frontend

- **Package manager:** `pnpm` (`frontend/pnpm-lock.yaml` present). Run all commands from `frontend/`.
- **Dev server:** `pnpm dev` (Vite, port 5173 by default).
- **Build:** `pnpm build` (`tsc -b && vite build`).
- **Lint:** `pnpm lint` (ESLint + typescript-eslint + react-hooks + react-refresh).
- **Health scan:** `pnpm doctor` (React Doctor; also runs in CI on every PR touching `frontend/`).
- **Tailwind:** v4 configured via `@theme` block in `src/index.css`. There is no `tailwind.config.ts`.
- **shadcn/ui:** Components live in `src/components/ui/`. Utility `cn` is in `src/lib/utils.tsx`.
- **Design system:** monochrome, Notion-style note app — **no chromatic accent colors**. Two layers: app chrome uses shadcn primitives + semantic `@theme` tokens (`bg-background`, `text-muted-foreground`, `border-border`, …); marketing/auth surfaces (`Login.tsx`) use the `.landing` scope + `l-*` helpers in `src/index.css`. Body font Geist (`font-sans`); Fraunces serif (`l-display`) for marketing headlines only. Soft shadows, `rounded-lg`, quiet hover. Color only for third-party brand marks and `destructive`. **Any new component/page must follow the `.claude/skills/frontend-design-system/` skill** (full token/helper reference + checklist).
- **Path alias:** `@/` maps to `./src/` in both Vite and TSConfig.
- **TSConfig quirks:** `verbatimModuleSyntax: true` — use `import type` for type-only imports.
- **Env vars (Vite):** `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Use `.env.local`.
- **Key components:** `ChatBox.tsx` handles SSE parsing, parts-based rendering, and per-chat document attachment; attached-doc chips read from a persistent `docId → filename` cache so labels stay visible after the picker closes or when a session reloads with existing `doc_ids`. `ModelProvider.tsx` is a React context mounted at the app root that fetches `/models` once, persists `selectedId` in `localStorage.paperpilot.lastModel`, and exposes `providers`, `models`, `modelsByProvider`, `selectedId`, `selectedModel`, `setSelected`, `getBadge`. `ModelPicker.tsx` is propless — it reads the context and renders an `<optgroup>` per provider plus a badge color dot for the current selection. `ToolCallBubble.tsx` renders tool activity inline. `BrandMark.tsx` is the single paper-plane logo reused across sidebar, chat empty-state, and landing header (`landing` prop swaps semantic tokens for `.landing` vars). `useThemeTransition.ts` is the shared circular clip-path theme-switch reveal (View Transitions API + animated-overlay fallback + `prefers-reduced-motion`); both the app `ThemeToggle` and the landing `ThemeIcon` consume it so theme switching behaves identically across the auth boundary.
- **API client:** `src/lib/api.ts` exports `getModels()`, `chatStream()`, `parseSSEStream()`, `deleteDocument()`. `chatStream` is the primary chat function; `streamQuery` is the legacy shim.

## Database & Migrations

- Migrations live in `supabase/migrations/`.
- CI workflow `.github/workflows/supabase-prod.yml` runs `supabase db push` on every push to `main`.
- CI workflow `.github/workflows/react-doctor.yml` runs React Doctor (`--diff` mode) on every PR touching `frontend/`.
- CI workflows `deploy-backend.yml` / `deploy-frontend.yml` deploy to AWS on push to `main` (see Deployment).
- Local dev: use `supabase db push` or the Supabase CLI to apply migrations to your linked project.

## Deployment

Hosted on **AWS** (region `ap-southeast-5`). GitHub Actions deploys both tiers on push to `main` via **GitHub OIDC → IAM role `paperpilot-ci`** — no AWS keys stored in GitHub.

- **Frontend:** S3 static bucket + CloudFront (domain `paperpilot.leongxinnan.com`). `deploy-frontend.yml` → `pnpm build` → `aws s3 sync --delete` → CloudFront invalidation. `VITE_*` are build-time GitHub repo secrets.
- **Backend:** EC2 `t4g` (ARM) running the Docker container on port 10000; image in **ECR**. `deploy-backend.yml` builds `linux/arm64` (QEMU on the x86 runner), pushes to ECR, then pulls + restarts on the box via **SSM Run Command** (no SSH). Domain `api.paperpilot.leongxinnan.com`, health check `/health`.
- **Secrets + config:** **SSM Parameter Store** under `/paperpilot/*` (SecureString). The container fetches every param into `/run/paperpilot.env` at start (`aws ssm get-parameters-by-path --with-decryption`); non-secret config (e.g. `FRONTEND_ORIGINS`, `SUPABASE_URL`) lives there too — anything absent falls back to `config.py` defaults, which is the usual cause of CORS/JWKS failures on the box. No plaintext `.env` on EC2.
- **Object storage:** S3 (`STORAGE_BACKEND=s3`); the EC2 instance profile grants bucket access, so no `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in env.
- **Observability:** container logs ship to CloudWatch `/paperpilot/backend` via the Docker `awslogs` driver; metric filter `{ $.level = "error" }` → CloudWatch alarm → SNS `paperpilot-alerts`. Logs are JSON when `ENV != local` (`logging.py`).
- **Supabase:** still Postgres (pgvector) + Auth. File storage migrated off to S3.
- **Infra as code:** AWS resources are imported into Terraform under `infra/` (remote state in S3). `terraform.yml` plans on PRs, applies on merge to `main` (OIDC roles `paperpilot-tf-plan` / `paperpilot-tf-apply`). SSM secret values and the Supabase DB are intentionally out of Terraform.

## Local Dev Setup

1. Backend: copy `backend/.env.example` to `backend/.env`, fill in keys. At minimum: `SUPABASE_*`, `VOYAGE_API_KEY`, and one LLM key.
2. Frontend: create `frontend/.env.local` with `VITE_API_URL=http://localhost:8000` and Supabase keys.
3. Ensure your Supabase project has the `pgvector` extension enabled and migrations applied.
4. Backend dev server (`uv run uvicorn ...`) expects to connect to the real Supabase DB URL.
5. `GET /models` returns `{ default_model_id, providers, models }`, filtered by `provider.enabled && model.enabled && api_key_env present`. If both lists are empty, no LLM keys are configured (or every model is disabled in `backend/models.json`).
