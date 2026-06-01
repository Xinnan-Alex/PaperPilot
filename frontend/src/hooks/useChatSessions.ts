import { useCallback, useEffect, useRef, useState } from "react";
import type { SSESource } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SSESource[];
  confidence?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  docIds: string[];
  createdAt: number;
  updatedAt: number;
}

interface DbRow {
  id: string;
  title: string;
  messages: ChatMessage[];
  doc_ids: string[];
  created_at: string;
  updated_at: string;
}

function rowToSession(row: DbRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    messages: row.messages ?? [],
    docIds: row.doc_ids ?? [],
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Debounce timer per chat id for message persistence
  const persistTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const schedulePersist = useCallback(
    (session: ChatSession) => {
      const existing = persistTimers.current.get(session.id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(async () => {
        persistTimers.current.delete(session.id);
        await supabase.from("chat_sessions").update({
          title: session.title,
          messages: session.messages,
          doc_ids: session.docIds,
          updated_at: new Date().toISOString(),
        }).eq("id", session.id);
      }, 1500);
      persistTimers.current.set(session.id, timer);
    },
    [],
  );

  // Load sessions on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("chat_sessions")
        .select("id, title, messages, doc_ids, created_at, updated_at")
        .order("updated_at", { ascending: false });

      if (cancelled) return;

      if (!error && data && data.length > 0) {
        const loaded = (data as DbRow[]).map(rowToSession);
        setSessions(loaded);
        setActiveChatId(loaded[0].id);
      } else {
        // No chats yet — create a fresh one
        const userId = await getUserId();
        if (!userId || cancelled) return;

        const { data: newRow, error: insertErr } = await supabase
          .from("chat_sessions")
          .insert({ user_id: userId, title: "New Chat", messages: [], doc_ids: [] })
          .select()
          .single();

        if (!insertErr && newRow && !cancelled) {
          const session = rowToSession(newRow as DbRow);
          setSessions([session]);
          setActiveChatId(session.id);
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const activeSession = sessions.find((s) => s.id === activeChatId) ?? null;

  const createChat = useCallback(async () => {
    const userId = await getUserId();
    if (!userId) return;

    const { data, error } = await supabase
      .from("chat_sessions")
      .insert({ user_id: userId, title: "New Chat", messages: [], doc_ids: [] })
      .select()
      .single();

    if (!error && data) {
      const session = rowToSession(data as DbRow);
      setSessions((prev) => [session, ...prev]);
      setActiveChatId(session.id);
    }
  }, []);

  const selectChat = useCallback((id: string) => {
    setActiveChatId(id);
  }, []);

  const deleteChat = useCallback(
    async (id: string) => {
      await supabase.from("chat_sessions").delete().eq("id", id);
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (id === activeChatId) {
          setActiveChatId(next.length > 0 ? next[0].id : null);
          if (next.length === 0) {
            // Create a fresh session after state settles
            (async () => {
              const userId = await getUserId();
              if (!userId) return;
              const { data } = await supabase
                .from("chat_sessions")
                .insert({ user_id: userId, title: "New Chat", messages: [], doc_ids: [] })
                .select()
                .single();
              if (data) {
                const session = rowToSession(data as DbRow);
                setSessions([session]);
                setActiveChatId(session.id);
              }
            })();
          }
        }
        return next;
      });
    },
    [activeChatId],
  );

  const updateMessages = useCallback(
    (chatId: string, updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
      setSessions((prev) => {
        const next = prev.map((s) => {
          if (s.id !== chatId) return s;
          const messages = updater(s.messages);
          const title =
            s.title === "New Chat" && messages.length > 0
              ? messages[0].content.slice(0, 50)
              : s.title;
          return { ...s, messages, title, updatedAt: Date.now() };
        });
        const updated = next.find((s) => s.id === chatId);
        if (updated) schedulePersist(updated);
        return next;
      });
    },
    [schedulePersist],
  );

  const updateDocIds = useCallback(
    async (chatId: string, docIds: string[]) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === chatId ? { ...s, docIds, updatedAt: Date.now() } : s,
        ),
      );
      await supabase
        .from("chat_sessions")
        .update({ doc_ids: docIds, updated_at: new Date().toISOString() })
        .eq("id", chatId);
    },
    [],
  );

  return {
    sessions,
    activeChatId,
    activeSession,
    loading,
    createChat,
    selectChat,
    deleteChat,
    updateMessages,
    updateDocIds,
  };
}
