# Project Improvement Audit

Date: 2026-06-03

Scope: PaperPilot backend, frontend, Supabase schema, RAG architecture, and comparable document-QA/RAG products.

## Top Priorities

1. ~~Harden tenant isolation and Supabase permissions~~ — DONE

   - ~~References: `backend/src/paperpilot/db.py`, `backend/src/paperpilot/store.py`, `supabase/migrations/*.sql`~~
   - ~~Backend relies heavily on manual `WHERE user_id = :user_id` checks while using privileged DB access.~~
   - ~~Migrations grant broad privileges to `anon` and `authenticated`, which increases blast radius if a future policy or table is misconfigured.~~
   - ~~Improve by using least-privileged DB access where possible, tightening grants, adding cross-user access tests, and enforcing ownership with DB constraints.~~
   - Shipped (migration `20260613120000_tighten_grants_and_constraints`): `REVOKE ALL` from `anon`/`authenticated` on `documents`/`chunks`/`feedback` (backend-only via service_role); narrowed `chat_sessions` `authenticated` grant from `ALL` → `SELECT/INSERT/UPDATE/DELETE`; revoked `anon` on `chat_sessions`. Ownership enforced at the DB: composite FK `chunks(document_id, user_id) → documents(id, user_id)` makes cross-user chunk smuggling impossible. Cross-user regression tests in `backend/tests/test_store_isolation.py` lock in that every `store.py` read/delete/insert is `user_id`-scoped. RLS retained as defense-in-depth.

2. ~~Move keyword retrieval out of Python~~

   - ~~Reference: `backend/src/paperpilot/retrieve.py:16-50`~~
   - ~~BM25 currently loads all user chunks into memory and ranks in Python.~~
   - ~~This will degrade as document volume grows.~~
   - ~~Use Postgres full-text search with `tsvector` and a GIN index, then combine with pgvector in SQL or an RPC.~~

3. ~~Improve RAG quality with reranking and query rewriting~~ — DONE

   - ~~References: `backend/src/paperpilot/retrieve.py`, `backend/src/paperpilot/tools/search_docs.py`, `backend/src/paperpilot/agent.py`~~
   - ~~Similar tools commonly separate rewrite, retrieve, rerank, and synthesize stages.~~
   - ~~Add query rewriting, reranking, exact citation spans, and configurable `top_k` and context limits per model.~~
   - Shipped: `query_rewrite.py` (multi-query expansion), `rerank.py` (Voyage rerank-2-lite + identity fallback), `citation.py` (lexical best-span), per-model `retrieval_top_k`/`retrieval_context_chars`, citation-span highlight in source cards.

4. ~~Fix chat document attachment display bug~~ — DONE

   - ~~Reference: `frontend/src/components/ChatBox.tsx:316-341,436-453`~~
   - ~~Attached document chips depend on `availableDocs`, but that list is cleared when the picker closes.~~
   - ~~Attached document names can disappear even though document IDs remain attached.~~
   - ~~Keep a `docId -> filename` cache or persist ready documents outside picker state.~~
   - Shipped: `docNameByIdRef` cache in `ChatBox` keeps chip labels visible after picker closes / on session reopen.

5. ~~Harden SSE streaming and error UX~~ — DONE

   - ~~References: `frontend/src/lib/api.ts`, `frontend/src/components/ChatBox.tsx:227-256`~~
   - ~~Frontend removes the assistant response on stream failure and only shows a toast.~~
   - ~~Add a tested SSE parser, preserve partial output, show inline retry/error state, and avoid duplicate parsers.~~
   - Shipped: exported, hardened `parseSSEStream` (normalises `\r\n`/`\r`, optional colon-space, ignores comment/blank lines, wraps every `JSON.parse` in try/catch so one malformed event can't kill the stream) with 18 unit tests. On stream failure ChatBox now **keeps** the partial assistant message and renders an inline error row + **Retry** (re-streams the stored turn via a shared `runStream` helper) instead of deleting the message. Failure state is local (never persisted to DB).

6. ~~Add frontend tests~~ — DONE

   - ~~Reference: `frontend/package.json`~~
   - ~~No frontend test script or test files were found.~~
   - ~~Start with SSE parser tests, `useChatSessions`, chat cancellation/errors, document picker, and upload/delete flows.~~
   - Shipped: Vitest + Testing Library + jsdom test infra (`vitest.config.ts`, `src/test/setup.ts`, `pnpm test` / `pnpm test:watch`). 32 tests: `src/lib/api.test.ts` (SSE parser — event types, chunk-split reassembly, line endings, malformed-event resilience), `src/hooks/useChatSessions.test.ts` (load/create/delete/title derivation), `src/components/ChatBox.test.tsx` (partial-output preservation + Retry on stream failure). Test files excluded from `tsc -b` build.

7. ~~Improve mobile drawer accessibility~~ — DONE

   - ~~References: `frontend/src/pages/AppPage.tsx`, `frontend/src/components/Sidebar.tsx`~~
   - ~~Mobile panels behave like modals but are plain `div` elements.~~
   - ~~Use Radix `Dialog` with focus trap, Escape handling, `aria-modal`, and focus return.~~
   - Shipped: new `components/ui/dialog.tsx` (Radix Dialog wrapper, `side="left|right|center"` drawer/modal variants, always-present accessible title). Mobile sidebar and mobile documents panel now render through Radix `Dialog` (focus trap, Escape, `aria-modal`, focus return, managed overlay); manual backdrops removed. Desktop layout unchanged.

8. ~~Add destructive confirmation for chat deletion~~ — DONE

   - ~~Reference: `frontend/src/components/Sidebar.tsx`~~
   - ~~Document deletion has confirmation, but chat deletion is immediate.~~
   - ~~Add a confirmation modal or undo toast.~~
   - Shipped: new `components/ui/alert-dialog.tsx` (Radix AlertDialog wrapper). The per-chat trash button now opens a confirmation modal ("Delete chat? … can't be undone") before calling `onDeleteChat`; keyboard-accessible via Radix.

9. ~~Make ingestion reliable and observable~~ — DONE

   - ~~Reference: `backend/src/paperpilot/api.py:308-368`~~
   - ~~Ingestion runs as a FastAPI background task with limited retry and diagnostics.~~
   - ~~Similar projects use workers or job queues.~~
   - ~~Add parse/OCR/embed statuses, retries, error details, and cleanup for orphaned storage objects.~~
   - Shipped: per-stage tracking (`documents.stage`: downloading → extracting → chunking → embedding → storing) surfaced live in `UploadBox`; persisted `error_detail` shown on failed docs; `retry_count` + `updated_at` columns (migration `20260605120000`). Exponential-backoff retries on download and embed (run off the event loop via `asyncio.to_thread`); typed `_IngestError` carries the failing stage into the DB. Orphaned-storage cleanup: `upload` deletes the Storage object if the `documents` insert fails. A still-queued/processing job stays pollable; failed docs are re-ingestable (status reset clears stage/error). Job-queue/worker migration deferred — background task is sufficient at current scale.

10. ~~Tighten DB constraints and indexes~~ — DONE

    - ~~References: `supabase/migrations/*.sql`~~
    - ~~Add constraints for `documents.status`, `chunks.embedding NOT NULL`, `UNIQUE(document_id, ordinal)`, `UNIQUE(storage_path)`, and a composite ownership FK for `chunks(document_id, user_id)`.~~
    - ~~Add indexes such as `documents(user_id, created_at DESC)` and `chunks(user_id, document_id, ordinal)`.~~
    - Shipped (migration `20260613120000`): CHECK on `documents.status` and `documents.stage`; `chunks.embedding SET NOT NULL`; `UNIQUE(chunks.document_id, ordinal)`; `UNIQUE(documents.storage_path)`; composite FK `chunks(document_id, user_id) → documents(id, user_id)` (with `UNIQUE(documents.id, user_id)` as its target); indexes `documents(user_id, created_at DESC)` and `chunks(user_id, document_id, ordinal)`. **Pre-deploy note:** `embedding SET NOT NULL` fails if any existing prod rows have NULL embeddings — run `SELECT count(*) FROM chunks WHERE embedding IS NULL;` and clean up before `db push`.

## Medium Priorities

11. Split large frontend feature components

    - Reference: `frontend/src/components/ChatBox.tsx`
    - `ChatBox` handles streaming, composer, sources, tools, feedback, scrolling, and document picking.
    - Split into `features/chat`, `features/documents`, `features/models`, plus a `useChatStream` hook.

12. Enable stricter frontend TypeScript

    - Reference: `frontend/tsconfig.app.json`
    - Backend uses strict typing; frontend does not.
    - Enable `strict`, remove `any`, and add typed API/SSE contracts.

13. Improve upload UX

    - Reference: `frontend/src/components/UploadBox.tsx`
    - Add multiple-file support or clearly state one file.
    - Show size/type limits, per-file progress, retry actions, and parse/OCR/embed status.

14. Improve source-grounded answer UI

    - References: `frontend/src/components/ChatBox.tsx`, `frontend/src/components/MarkdownContent.tsx`
    - Similar tools emphasize source verification.
    - Add a source side panel, quoted chunk highlights, page/chunk preview, relevance scores, and click-through source locations.

15. Respect reduced motion and focus states

    - References: `frontend/src/components/ChatBox.tsx`, `frontend/src/index.css`
    - Smooth scrolling and thinking animation should respect `prefers-reduced-motion`.
    - Replace `outline-none` without focus replacement and avoid `transition-all`.

16. Add URL-addressable chat state

    - Reference: `frontend/src/hooks/useChatSessions.ts`
    - Current app selects the newest chat after load.
    - Add `/chat/:id`, optional docs panel state, and shareable deep links.

17. Add RAG evaluation

    - No evaluation harness was found.
    - Add curated Q&A sets, retrieval precision, answer faithfulness, and citation correctness checks.
    - Tools like Ragas are commonly used for this.

## Product Improvements From Similar Projects

18. Add NotebookLM-style document guides

    - After upload, generate summary, key topics, suggested questions, glossary, and study prompts.

19. Introduce workspaces or notebooks

    - AnythingLLM and NotebookLM organize around workspaces/notebooks, not only per-chat document attachments.
    - Useful abstraction: workspace = documents + chats + default model + instructions.

20. Add custom assistants

    - Onyx and AnythingLLM expose custom agents.
    - Let users configure instructions, allowed tools, default model, tone, and source set.

21. Add generated outputs beyond chat

    - Examples: study guide, FAQ, glossary, quiz, flashcards, executive summary, and slide outline.

22. Add model routing

    - Use cheaper/faster models for simple Q&A and stronger models for multi-hop reasoning or summaries.

23. Add observability for every run

    - Track model, tokens, tool calls, retrieved chunk IDs, latency, cost, and errors.
    - This will make debugging RAG quality much easier.

## Recommended Implementation Order

1. ~~Security, tenant hardening, and DB constraints.~~ — DONE (item 1 + item 10).
2. ~~Retrieval scalability: Postgres full-text search~~ — DONE (FTS + supporting indexes).
3. ~~SSE/chat reliability fixes.~~ — DONE (hardened `parseSSEStream`, partial-output preservation, inline retry).
4. Frontend tests ~~and component split~~. _(Tests DONE; `ChatBox` component split — item 11 — still pending.)_
5. Ingestion worker/status improvements.
6. ~~RAG quality: reranking, query rewriting, and better citations.~~ — DONE
7. Notebook/workspace/product differentiators.

## Comparable Projects Reviewed

- AnythingLLM: workspace-centered RAG, agents, model routing.
- Onyx/Danswer: connectors, background indexing, team search, RBAC, analytics.
- Quivr: configurable RAG workflows and query rewriting.
- Verba: ingestion configurability, async ingestion, source management.
- PrivateGPT: API-first document-QA workbench.
- NotebookLM: source-grounded UX, document guides, generated study artifacts.
- LangChain and LlamaIndex RAG examples: retriever/postprocessor/synthesizer separation and agentic-vs-chain tradeoffs.
