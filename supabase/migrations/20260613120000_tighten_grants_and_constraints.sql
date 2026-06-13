-- Audit items 1 & 10: tighten Supabase grants and add DB constraints/indexes.
--
-- GRANTS: apply least-privilege. The backend exclusively uses the service_role
-- key for documents/chunks/feedback, so anon and authenticated don't need any
-- access to those tables. The frontend JS client uses the authenticated role
-- only for chat_sessions; narrow it to DML (no broader GRANT ALL).
-- RLS policies on documents/chunks/feedback are preserved as defense-in-depth,
-- but the grant revocation is the primary tenant-isolation tightening.
--
-- CONSTRAINTS: add CHECK constraints for status/stage enums, UNIQUE constraints
-- to enforce data integrity, and a composite FK so a chunk's user_id is always
-- consistent with its parent document's owner.
--
-- All constraint statements are idempotent: each one drops the constraint by
-- name (IF EXISTS) before adding it, so the file survives repeated `supabase
-- db reset` runs.


-- ============================================================
-- SECTION 1: Grant tightening
-- ============================================================

-- Remove all access for anon on backend-only tables.
REVOKE ALL ON TABLE public.documents, public.chunks, public.feedback FROM anon;

-- Remove all access for authenticated on backend-only tables.
-- The backend API (service_role) is the only path to these tables; the frontend
-- JS client never queries documents, chunks, or feedback directly.
REVOKE ALL ON TABLE public.documents, public.chunks, public.feedback FROM authenticated;

-- service_role grants are intentionally left intact; the backend relies on them.

-- Remove the broad GRANT ALL on chat_sessions from anon (not needed).
REVOKE ALL ON TABLE public.chat_sessions FROM anon;

-- Narrow chat_sessions from ALL → DML-only for authenticated.
-- The frontend JS client reads, writes, updates, and deletes its own sessions.
REVOKE ALL ON TABLE public.chat_sessions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_sessions TO authenticated;


-- ============================================================
-- SECTION 2: Constraints on documents
-- ============================================================

-- Enum guard: status must be one of the four machine states.
ALTER TABLE public.documents
    DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE public.documents
    ADD CONSTRAINT documents_status_check
    CHECK (status IN ('pending', 'processing', 'ready', 'failed'));

-- Enum guard: stage must be NULL or a recognised sub-step.
ALTER TABLE public.documents
    DROP CONSTRAINT IF EXISTS documents_stage_check;
ALTER TABLE public.documents
    ADD CONSTRAINT documents_stage_check
    CHECK (stage IS NULL OR stage IN ('downloading', 'extracting', 'chunking', 'embedding', 'storing'));

-- A storage object should only ever map to one document row.
ALTER TABLE public.documents
    DROP CONSTRAINT IF EXISTS documents_storage_path_unique;
ALTER TABLE public.documents
    ADD CONSTRAINT documents_storage_path_unique
    UNIQUE (storage_path);

-- Composite uniqueness on (id, user_id) — required as the target of the
-- composite FK from chunks (Postgres demands the referenced columns form a
-- unique/PK constraint).
ALTER TABLE public.documents
    DROP CONSTRAINT IF EXISTS documents_id_user_unique;
ALTER TABLE public.documents
    ADD CONSTRAINT documents_id_user_unique
    UNIQUE (id, user_id);


-- ============================================================
-- SECTION 3: Constraints on chunks
-- ============================================================

-- The ingest pipeline always embeds every chunk before calling insert_chunks
-- (store.py), so embedding is never NULL at insert time. Make that invariant
-- explicit so a future code regression surfaces at the DB layer immediately.
ALTER TABLE public.chunks ALTER COLUMN embedding SET NOT NULL;

-- Each (document_id, ordinal) pair must be unique within a document.
ALTER TABLE public.chunks
    DROP CONSTRAINT IF EXISTS chunks_document_ordinal_unique;
ALTER TABLE public.chunks
    ADD CONSTRAINT chunks_document_ordinal_unique
    UNIQUE (document_id, ordinal);

-- Replace the single-column document_id FK with a composite FK that also
-- verifies the chunk's user_id matches the parent document's owner. This
-- makes cross-user data smuggling impossible at the DB level.
ALTER TABLE public.chunks
    DROP CONSTRAINT IF EXISTS chunks_document_id_fkey;
ALTER TABLE public.chunks
    ADD CONSTRAINT chunks_document_id_fkey
    FOREIGN KEY (document_id, user_id)
    REFERENCES public.documents(id, user_id)
    ON DELETE CASCADE;


-- ============================================================
-- SECTION 4: Indexes
-- ============================================================

-- Cover the common "list my documents, newest first" query.
CREATE INDEX IF NOT EXISTS documents_user_created_idx
    ON public.documents USING btree (user_id, created_at DESC);

-- Cover vector search + ordinal-ordered chunk fetches scoped to a user+doc.
CREATE INDEX IF NOT EXISTS chunks_user_doc_ordinal_idx
    ON public.chunks USING btree (user_id, document_id, ordinal);
