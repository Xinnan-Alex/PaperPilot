import { toast } from "sonner";
import { supabase } from "./supabase";

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function getToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  if (!token) {
    signOut("Authentication required. Please sign in again.");
    throw new Error("No access token");
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    signOut("Session expired. Please sign in again.");
    throw new Error("Unauthorized");
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After") || "3600";
    toast.error(
      `Rate limited. Try again in ${Math.ceil(Number(retryAfter) / 60)} minutes.`,
    );
    throw new Error(`Rate limited`);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Request failed: ${res.status}`);
  }

  return res.json();
}

function signOut(message: string) {
  toast.error(message);
  supabase.auth.signOut().catch(() => {});
}

export async function uploadDocument(
  file: File,
): Promise<{ doc_id: string; filename: string }> {
  const token = await getToken();
  if (!token) throw new Error("No access token");

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  if (res.status === 401) {
    signOut("Session expired.");
    throw new Error("Unauthorized");
  }

  if (res.status === 429) {
    toast.error("Upload limit reached.");
    throw new Error("Rate limited");
  }

  if (!res.ok) {
    const b = await res.text();
    throw new Error(b);
  }

  return res.json();
}

export async function ingestDocument(
  docId: string,
): Promise<{ doc_id: string; status: string; chunks: number }> {
  return apiFetch("/ingest", {
    method: "POST",
    body: JSON.stringify({ doc_id: docId }),
  });
}

export async function listDocuments(): Promise<
  Array<{ id: string; filename: string; status: string; created_at: string }>
> {
  return apiFetch("/documents");
}

export async function submitFeedback(
  query: string,
  answer: string,
  rating: 1 | -1,
  retrievedChunkIds: string[],
): Promise<void> {
  await apiFetch("/feedback", {
    method: "POST",
    body: JSON.stringify({
      query,
      answer,
      rating,
      retrieved_chunk_ids: retrievedChunkIds,
    }),
  });
}

export interface SSESource {
  chunk_id: string;
  document_id: string;
  ordinal: number;
  page: number | null;
  text: string;
  document_filename?: string;
  filename?: string;
  source_url?: string;
}

export interface ModelInfo {
  id: string;
  display_name: string;
  provider: string;
  supports_tools: boolean;
  context_window: number;
  default: boolean;
}

export interface ProviderBadge {
  label: string;
  color: string;
}

export interface ProviderInfo {
  id: string;
  display_name: string;
  badge: ProviderBadge;
}

export interface ModelsPayload {
  default_model_id: string | null;
  providers: ProviderInfo[];
  models: ModelInfo[];
}

export interface ToolCallEvent {
  type: "tool_call";
  data: { id: string; name: string; args: Record<string, unknown> };
}

export interface ToolResultEvent {
  type: "tool_result";
  data: { id: string; result: Record<string, unknown> };
}

export type StreamEvent =
  | { type: "token"; data: string }
  | { type: "sources"; data: SSESource[] }
  | ToolCallEvent
  | ToolResultEvent
  | { type: "done" };

export interface ChatTurnMessage {
  role: "user" | "assistant";
  content: string;
}

export async function getModels(): Promise<ModelsPayload> {
  return apiFetch("/models");
}

async function* parseSSEStream(
  res: Response,
): AsyncGenerator<StreamEvent> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (currentEvent === "token") {
            try {
              yield { type: "token", data: JSON.parse(payload) as string };
            } catch {
              yield { type: "token", data: payload };
            }
          } else if (currentEvent === "sources") {
            yield { type: "sources", data: JSON.parse(payload) as SSESource[] };
          } else if (currentEvent === "tool_call") {
            yield { type: "tool_call", data: JSON.parse(payload) };
          } else if (currentEvent === "tool_result") {
            yield { type: "tool_result", data: JSON.parse(payload) };
          } else if (currentEvent === "done") {
            yield { type: "done" };
          }
          currentEvent = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* chatStream(
  messages: ChatTurnMessage[],
  modelId: string,
  docIds?: string[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const token = await getToken();
  if (!token) throw new Error("No access token");

  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages,
      model_id: modelId,
      doc_ids: docIds,
    }),
    signal,
  });

  if (res.status === 401) {
    signOut("Session expired.");
    throw new Error("Unauthorized");
  }
  if (res.status === 429) {
    toast.error("Chat limit reached. Try again later.");
    throw new Error("Rate limited");
  }
  if (!res.ok) throw new Error(`Chat failed: ${res.status}`);

  try {
    for await (const ev of parseSSEStream(res)) yield ev;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    throw err;
  }
}

export async function getDocumentDownloadUrl(
  path: string,
): Promise<{ url: string }> {
  return apiFetch(path);
}

export async function* streamQuery(
  query: string,
  topK: number = 5,
  docIds?: string[],
  signal?: AbortSignal,
): AsyncGenerator<
  | { type: "token"; data: string }
  | { type: "sources"; data: SSESource[] }
  | { type: "confidence"; data: number }
  | { type: "done" }
> {
  const token = await getToken();
  if (!token) throw new Error("No access token");

  const res = await fetch(`${BASE}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, top_k: topK, doc_ids: docIds }),
    signal,
  });

  if (res.status === 401) {
    signOut("Session expired.");
    throw new Error("Unauthorized");
  }
  if (res.status === 429) {
    toast.error("Query limit reached. Try again later.");
    throw new Error("Rate limited");
  }
  if (!res.ok) {
    throw new Error(`Query failed: ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, {
        stream: true,
      });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (currentEvent === "token") {
            try {
              yield {
                type: "token",
                data: JSON.parse(payload),
              };
            } catch {
              yield {
                type: "token",
                data: payload,
              };
            }
          } else if (currentEvent === "sources") {
            yield {
              type: "sources",
              data: JSON.parse(payload) as SSESource[],
            };
          } else if (currentEvent === "confidence") {
            yield {
              type: "confidence",
              data: Number(payload),
            };
          } else if (currentEvent === "done") {
            yield {
              type: "done",
            };
          }
          currentEvent = "";
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    throw err;
  } finally {
    reader.releaseLock();
  }
}
