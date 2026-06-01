CREATE TABLE IF NOT EXISTS "public"."chat_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL DEFAULT 'New Chat',
    "messages" "jsonb" NOT NULL DEFAULT '[]',
    "doc_ids" "uuid"[] NOT NULL DEFAULT '{}',
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."chat_sessions" OWNER TO "postgres";

ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

CREATE INDEX "chat_sessions_user_id_idx" ON "public"."chat_sessions" USING "btree" ("user_id", "updated_at" DESC);

ALTER TABLE "public"."chat_sessions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own chats" ON "public"."chat_sessions"
    USING (("auth"."uid"() = "user_id"));

CREATE POLICY "users insert own chats" ON "public"."chat_sessions"
    FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));

CREATE POLICY "users update own chats" ON "public"."chat_sessions"
    FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));

CREATE POLICY "users delete own chats" ON "public"."chat_sessions"
    FOR DELETE USING (("auth"."uid"() = "user_id"));

GRANT ALL ON TABLE "public"."chat_sessions" TO "anon";
GRANT ALL ON TABLE "public"."chat_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_sessions" TO "service_role";
