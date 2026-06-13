-- Stop the client from owning the authz column on chat_sessions.
--
-- The frontend JS client previously sent `user_id` explicitly on every
-- chat_sessions insert. Defaulting the column to auth.uid() lets the database
-- own it, so a forged user_id in the client payload is no longer possible. The
-- existing RLS `with check (auth.uid() = user_id)` policy continues to enforce
-- ownership. The backend never inserts chat_sessions (no server routes for
-- sessions), so auth.uid() is always the authenticated caller here.
ALTER TABLE public.chat_sessions
    ALTER COLUMN user_id SET DEFAULT auth.uid();
