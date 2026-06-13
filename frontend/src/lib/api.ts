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

export interface DocumentSummary {
  id: string;
  filename: string;
  status: string;
  stage?: string | null;
  error_detail?: string | null;
  retry_count?: number;
  created_at: string;
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  return apiFetch("/documents");
}

export async function deleteDocument(docId: string): Promise<void> {
  const token = await getToken();
  if (!token) throw new Error("No access token");

  const res = await fetch(`${BASE}/documents/${docId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    signOut("Session expired. Please sign in again.");
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Delete failed: ${res.status}`);
  }
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
  span_start?: number | null;
  span_end?: number | null;
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

// Exported for unit testing. Parses an SSE Response body into typed StreamEvents.
// Handles \r\n, \r, and \n line endings; SSE fields with or without a space
// after the colon; comment lines (":..."); and blank lines (dispatch boundary).
// Every JSON.parse is guarded — a malformed event is skipped, not fatal.
export async function* parseSSEStream(
  res: Response,
): AsyncGenerator<StreamEvent> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  // Normalise any line ending to \n so split("\n") covers all cases.
  function normalizeLineEndings(s: string): string {
    return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  // SSE field value: strip the single leading space per spec (if present).
  function fieldValue(raw: string): string {
    return raw.startsWith(" ") ? raw.slice(1) : raw;
  }

  // Process one SSE line, yielding an event for each complete `data:` line.
  // Closes over `currentEvent` so the preceding `event:` line scopes it.
  function* processLine(line: string): Generator<StreamEvent> {
    // Ignore comment lines and blank lines (blank = dispatch boundary).
    if (line === "" || line.startsWith(":")) return;

    // event field — accept "event:" or "event: "
    if (line.startsWith("event:")) {
      currentEvent = fieldValue(line.slice(6)).trim();
      return;
    }

    // data field — accept "data:" or "data: "
    if (line.startsWith("data:")) {
      const payload = fieldValue(line.slice(5));
      if (currentEvent === "token") {
        try {
          yield { type: "token", data: JSON.parse(payload) as string };
        } catch {
          yield { type: "token", data: payload };
        }
      } else if (currentEvent === "sources") {
        try {
          yield { type: "sources", data: JSON.parse(payload) as SSESource[] };
        } catch {
          // skip malformed sources event
        }
      } else if (currentEvent === "tool_call") {
        try {
          yield { type: "tool_call", data: JSON.parse(payload) };
        } catch {
          // skip malformed tool_call event
        }
      } else if (currentEvent === "tool_result") {
        try {
          yield { type: "tool_result", data: JSON.parse(payload) };
        } catch {
          // skip malformed tool_result event
        }
      } else if (currentEvent === "done") {
        yield { type: "done" };
      }
      currentEvent = "";
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += normalizeLineEndings(decoder.decode(value, { stream: true }));
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) yield* processLine(line);
    }

    // EOF: flush any bytes the decoder still holds and process the trailing
    // line(s) — a stream that closes without a final newline would otherwise
    // drop its last `data:` event.
    buffer += normalizeLineEndings(decoder.decode());
    for (const line of buffer.split("\n")) yield* processLine(line);
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
