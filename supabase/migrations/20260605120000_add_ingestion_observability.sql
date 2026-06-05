-- Item 9: make ingestion reliable and observable.
-- Adds fine-grained stage tracking, persisted error details, retry accounting,
-- and a last-touched timestamp to the documents table. `status` stays the
-- coarse state machine (pending / processing / ready / failed); `stage` records
-- the sub-step within `processing` (downloading / extracting / chunking /
-- embedding / storing) for live progress and post-mortem debugging.

ALTER TABLE "public"."documents"
    ADD COLUMN IF NOT EXISTS "stage" "text",
    ADD COLUMN IF NOT EXISTS "error_detail" "text",
    ADD COLUMN IF NOT EXISTS "retry_count" integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;

-- Surface stalled ingests: rows stuck in `processing` whose updated_at is old.
CREATE INDEX IF NOT EXISTS "documents_status_updated_idx"
    ON "public"."documents" USING "btree" ("status", "updated_at");
