# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PaperPilot is a RAG document-QA app. Upload PDFs/DOCX, ask questions, get streaming answers with inline citations and source provenance.

**Stack:** Python 3.11 FastAPI backend · React 19 + Vite + TypeScript + Tailwind v4 + shadcn/ui frontend · `streamdown` for LLM-streaming markdown · Supabase (Postgres + pgvector + Auth + Storage) · Voyage AI embeddings · DeepSeek LLM

**Infra:** Vercel (frontend) · Render via Docker (backend, port 10000) · Supabase CI migrations

---

## Commands

All backend commands run from `backend/`. All frontend commands run from `frontend/`.

### Backend

```bash
uv run uvicorn paperpilot.api:app --reload     # dev server (localhost:8000)
uv run python -m paperpilot.cli ingest <file> --user-id <uuid>
uv run python -m paperpilot.cli ask "<query>" --user-id <uuid>
uv run ruff check src/ && uv run ruff format src/
uv run mypy src/
```

### Frontend

```bash
pnpm dev       # dev server (localhost:5173)
pnpm build     # tsc -b && vite build
pnpm lint      # ESLint
pnpm doctor    # React Doctor health scan (npx react-doctor@latest)
```

### Database

```bash
supabase db reset   # rebuild local DB from migrations (local dev)
supabase db push    # apply migrations to hosted Supabase project
```

CI (`supabase-prod.yml`) runs `supabase db push` automatically on every push to `main`.

---

## Architecture

### RAG pipeline (backend)

Each module has a single responsibility; they compose in `reader.py` and `api.py`:

| Module | Role |
|--------|------|
| `ingest.py` | Extract text from PDF/DOCX/HTML/TXT. Falls back to Tesseract OCR for image-only PDF pages. |
| `chunk.py` | Recursive semantic split (~800 chars, 100-char overlap). |
| `embed.py` | Voyage AI `voyage-3-lite` API (512-dim). Batches 128 texts per call. |
| `store.py` | Raw SQL via SQLAlchemy async — insert documents/chunks, update status, vector search, hard-delete document + chunks. |
| `retrieve.py` | Hybrid search (pgvector cosine + Postgres FTS, merged via Reciprocal Rank Fusion). `multi_query_search` fuses results across LLM-expanded query variants. |
| `rerank.py` | Voyage `rerank-2-lite` reorders the fused candidate pool by query relevance. Degrades to identity order on failure. |
| `query_rewrite.py` | One LLM call expands a query into variants for higher recall. Degrades to the original query. |
| `citation.py` | Pure lexical `best_span` — char offsets of the best-matching sentence per chunk, for frontend highlighting. |
| `llm.py` | DeepSeek `deepseek-chat` via OpenAI-compatible SDK. **All LLM calls go through here only.** |
| `reader.py` | Builds prompt, streams SSE events: `token`, `sources`, `confidence`, `done`. |
| `auth.py` | JWKS-based asymmetric JWT verification (ES256/RS256) using `PyJWKClient`. |
| `api.py` | FastAPI app, CORS, all HTTP routes. |
| `config.py` | `pydantic-settings` reads from `backend/.env`. |
| `db.py` | SQLAlchemy async engine with `statement_cache_size=0` (pgbouncer compatibility). |

### Document ingestion flow

`POST /upload` → saves to Supabase Storage, inserts `documents` row as `pending` → `POST /ingest` → background task: extract → chunk → embed → insert chunks → update status to `ready`. Frontend polls `GET /documents/{id}` every 2s.

### Query flow

`POST /query` (SSE) → verify JWT → embed query → hybrid search → build prompt → stream DeepSeek tokens → emit `sources` and `done` events.

The agent's `search_documents` tool runs a fuller pipeline: query rewrite (multi-query expansion) → fused candidate pool → Voyage rerank → per-model `top_k`/context budget (`models.json` `retrieval_top_k`/`retrieval_context_chars`, global defaults in `config.py`) → lexical citation spans. Rerank and rewrite are independently toggleable via `enable_rerank` / `enable_query_rewrite`.

### Chat sessions

Stored directly in Supabase `chat_sessions` table (`id, user_id, title, messages jsonb, doc_ids uuid[]`) via the frontend JS client — **no backend routes for sessions**. `useChatSessions.ts` hook manages state: message writes are debounced 1.5s (avoid per-token DB writes during streaming); doc changes and deletes are immediate. `ChatBox` caches `docId → filename` for attachment chips so labels stay visible after the picker closes or when reopening a session with existing `doc_ids`.

### Frontend structure

- `pages/` — `AppPage.tsx`, `Login.tsx`
- `components/` — `ChatBox.tsx`, `Sidebar.tsx`, `UploadBox.tsx`, `ThemeToggle.tsx`, `ThemeProvider.tsx`, `MarkdownContent.tsx` (Streamdown wrapper), `ErrorBoundary.tsx`, `ToolCallBubble.tsx`, `ModelPicker.tsx`
- `hooks/` — `useSession.ts` (Supabase auth), `useChatSessions.ts` (chat state), `useModels.ts`
- `lib/` — API client (typed fetch with auth header), Supabase JS client init, `remarkCitations.ts` remark plugin (`[N]` → `<citation-marker>`), utils

### Frontend design system

**Aesthetic: monochrome, Notion-style note app.** Black/white/gray only — no chromatic accent colors. Two surface layers:

- **App chrome** (authed app: `AppPage`, `Sidebar`, `ChatBox`, dialogs) → shadcn primitives in `components/ui/` styled with the semantic `@theme` tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `border-border`, …). Never hardcode hex.
- **Marketing / auth** (logged-out `Login.tsx` landing, future marketing pages) → the `.landing` scope + `l-*` helper classes in `src/index.css` (`l-display`, `l-cta`, `l-surface`, `l-mark`, `l-rise`, …) with the `--ink`/`--paper`/`--line`/`--btn` vars.

Type: Geist (`font-sans`) for body/UI; **Fraunces** serif (via `l-display`) for marketing headlines only — loaded in `index.html`. Soft shadows + quiet hover (`translateY(-1px)`), `rounded-lg` default. Color only for third-party brand marks (Google's `G`) and `destructive` states.

**When building any new component or page, follow the [`frontend-design-system`](.claude/skills/frontend-design-system/SKILL.md) skill** — it has the full token/helper reference and a pre-finish checklist.

### Markdown rendering

Assistant messages render through `MarkdownContent.tsx`, which wraps `streamdown` (Vercel's drop-in for `react-markdown` purpose-built for partial LLM token streams). Streamdown bundles `remark-gfm`, `remend` for unterminated blocks, and `rehype-harden` + `rehype-sanitize` for safety. Citations (`[N]`) are converted to interactive buttons via the local `remarkCitations` plugin; the custom `<citation-marker>` tag is whitelisted through the sanitizer with `allowedTags={{ "citation-marker": ["n"] }}`.

The LLM is constrained by the system prompt in `agent.py` to a **restricted Markdown subset**: paragraphs, `**bold**`, `- bullets`, `1. ordered`, inline + fenced code, `[N]` citations. Headings (`#`, `##`, …), horizontal rules (`---`), and italic are **forbidden** — section labels become `**Bold Label**` paragraphs. This keeps render output consistent across providers (DeepSeek, OpenAI, Groq, Mistral) which otherwise emit divergent malformed markdown.

---

## Key constraints

**Tailwind v4:** configured via `@theme` block in `src/index.css`. There is no `tailwind.config.ts`. Do not create one. The CSS also declares `@source "../node_modules/streamdown/dist/*.js"` so Tailwind scans Streamdown's compiled utility classes.

**Doc-picker scope:** when the user selects documents via the chat picker, `chat_sessions.doc_ids` is sent on `POST /chat` and reaches every tool through `ctx.doc_ids`. `search_documents`, `list_documents`, and `get_document_summary` all honour it — agents cannot read outside the selected scope. The system prompt is also rebuilt per-request to inform the LLM which document IDs are in scope.

**TypeScript:** `verbatimModuleSyntax: true` — use `import type` for type-only imports.

**Path alias:** `@/` maps to `./src/` in both Vite and TSConfig.

**OCR:** `pytesseract` + `pdf2image` require Tesseract and Poppler system binaries. On macOS: `brew install tesseract poppler`. They are installed in the Dockerfile for Render. OCR is skipped silently if binaries are missing.

**Auth model:** Backend uses Supabase service role key (bypasses RLS). JWT verification in `auth.py` is the primary auth gate. RLS on `documents`, `chunks`, `feedback` tables is defense-in-depth. Never send the service role key to the frontend.

**Supabase key types:** `sb_publishable_...` is frontend-safe (replaces legacy `anon`). `sb_secret_...` is backend-only (replaces legacy `service_role`).

**Migrations:** `supabase/migrations/` is the source of truth. Never change schema in the Supabase dashboard directly. Workflow: `supabase migration new <name>` → write SQL → `supabase db reset` (local test) → commit → push.

---

## Environment

| File | Purpose |
|------|---------|
| `backend/.env` | Backend secrets (copy from `backend/.env.example`) |
| `frontend/.env.local` | `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |

For local dev, get Supabase local URLs/keys via `supabase status -o env` and use those instead of the hosted project values.
