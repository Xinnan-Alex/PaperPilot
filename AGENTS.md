# PaperPilot — Agent Context

A RAG document-QA app. FastAPI backend + React/Vite frontend + Supabase (Postgres/pgvector/Auth/Storage).

## Repo Layout

- `backend/` — Python 3.11 FastAPI app. Package root is `paperpilot` under `backend/src/`.
- `frontend/` — React 19 + Vite + TypeScript + Tailwind v4 + shadcn/ui.
- `supabase/migrations/` — Postgres schema migrations. Deployed by CI on push to `main`.
- `render.yaml` — Render web service config (Docker, rootDir `backend/`).

## Chat Sessions

- `chat_sessions` table in Supabase stores all chat history per user (`id, user_id, title, messages jsonb, doc_ids uuid[], created_at, updated_at`).
- Frontend hook `frontend/src/hooks/useChatSessions.ts` manages session state. Reads from Supabase on mount; writes are debounced 1.5s for messages (to avoid per-token DB writes during streaming), immediate for doc changes and deletes.
- Each chat has its own set of attached document IDs. Users pick docs from the "Add docs" button in the chat input — no re-upload needed.
- RLS policies on `chat_sessions` enforce user isolation.

## Backend

- **Package manager:** `uv`. Lockfile is `backend/uv.lock`. Always use `uv` commands from inside `backend/`.
- **Run dev server:** `uv run uvicorn paperpilot.api:app --reload`
- **Run CLI:** `uv run python -m paperpilot.cli` (subcommands: `ingest`, `ask`)
- **Lint:** `ruff` (line-length 100, target py311). Run `uv run ruff check .` and `uv run ruff format .` from `backend/`.
- **Typecheck:** `mypy` / `pyright` both configured to strict mode. Root `pyproject.toml` points pyright venv to `./backend/.venv`.
- **Tests:** `pytest` (dev dependency). No test files exist yet.
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
- **Tailwind:** v4 configured via `@theme` block in `src/index.css`. There is no `tailwind.config.ts`.
- **shadcn/ui:** Components live in `src/components/ui/`. Utility `cn` is in `src/lib/utils.tsx`.
- **Path alias:** `@/` maps to `./src/` in both Vite and TSConfig.
- **TSConfig quirks:** `verbatimModuleSyntax: true` — use `import type` for type-only imports.
- **Env vars (Vite):** `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Use `.env.local`.

## Database & Migrations

- Migrations live in `supabase/migrations/`.
- CI workflow `.github/workflows/supabase-prod.yml` runs `supabase db push` on every push to `main`.
- Local dev: use `supabase db push` or the Supabase CLI to apply migrations to your linked project.

## Deployment

- **Frontend:** Vercel (static site, domain `paperpilot.leongxinnan.com`).
- **Backend:** Render (Docker web service, domain `api.paperpilot.leongxinnan.com`, health check `/health`).
- **Supabase:** Stores data, auth, and file storage.

## Local Dev Setup

1. Backend: copy `backend/.env.example` to `backend/.env`, fill in keys.
2. Frontend: create `frontend/.env.local` with `VITE_API_URL=http://localhost:8000` and Supabase keys.
3. Ensure your Supabase project has the `pgvector` extension enabled and migrations applied.
4. Backend dev server (`uv run uvicorn ...`) expects to connect to the real Supabase DB URL.
