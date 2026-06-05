import {
  getDocumentDownloadUrl,
  chatStream,
  submitFeedback,
  listDocuments,
  type SSESource,
  type StreamEvent,
} from "@/lib/api";
import ModelPicker from "./ModelPicker";
import ToolCallBubble, { type ToolCallState } from "./ToolCallBubble";
import { useModels } from "./ModelProvider";
import type { ChatMessage, MessagePart } from "@/hooks/useChatSessions";
import { useRef, useState, useEffect, useCallback, useReducer } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  ExternalLink,
  Send,
  StopCircle,
  ThumbsUp,
  ThumbsDown,
  FileText,
  Plus,
  X,
  ChevronDown,
  Menu,
} from "lucide-react";
import { useSession } from "@/hooks/useSession";
import MarkdownContent from "./MarkdownContent";

interface AvailableDoc {
  id: string;
  filename: string;
  status: string;
}

// The doc-picker popover is one cohesive state slice: its open flag, the docs
// it fetched, and that fetch's loading state always move together.
interface DocPickerState {
  open: boolean;
  docs: AvailableDoc[];
  loading: boolean;
}

type DocPickerAction =
  | { type: "toggle" }
  | { type: "loadStart" }
  | { type: "loaded"; docs: AvailableDoc[] }
  | { type: "loadFailed" };

const initialDocPicker: DocPickerState = {
  open: false,
  docs: [],
  loading: false,
};

function docPickerReducer(
  state: DocPickerState,
  action: DocPickerAction,
): DocPickerState {
  switch (action.type) {
    case "toggle":
      return { ...state, open: !state.open };
    case "loadStart":
      return { ...state, loading: true };
    case "loaded":
      return { ...state, docs: action.docs, loading: false };
    case "loadFailed":
      return { ...state, loading: false };
  }
}

function ThinkingBubble() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-muted-foreground"
          style={{
            animation: "thinking-bounce 1.4s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}

type EventHandlers = {
  appendText: (text: string) => void;
  pushTool: (tool: ToolCallState) => void;
  updateTool: (id: string, mut: (t: ToolCallState) => ToolCallState) => void;
  onSources: (sources: SSESource[]) => void;
};

function handleStreamEvent(event: StreamEvent, h: EventHandlers): void {
  if (event.type === "token") {
    h.appendText(event.data);
  } else if (event.type === "tool_call") {
    h.pushTool({
      id: event.data.id,
      name: event.data.name,
      args: event.data.args,
      state: "running",
    });
  } else if (event.type === "tool_result") {
    h.updateTool(event.data.id, (t) => ({
      ...t,
      result: event.data.result,
      state: "error" in event.data.result ? "error" : "done",
    }));
  } else if (event.type === "sources") {
    h.onSources(event.data);
  }
}

// Stateless handlers — they close over nothing from the component, so they live
// at module scope (one binding) instead of being rebuilt on every render.
function handleSourceClick(chunkId: string): void {
  const el = document.getElementById(`source-${chunkId}`);
  el?.classList.add("ring-2", "ring-ring");
  setTimeout(() => el?.classList.remove("ring-2", "ring-ring"), 2000);
}

async function handleOpenSource(src: SSESource): Promise<void> {
  try {
    const { url } = await getDocumentDownloadUrl(src.source_url ?? "");
    window.open(url, "_blank", "noopener,noreferrer");
  } catch {
    toast.error("Could not open source document");
  }
}

interface ChatBoxProps {
  chatId: string;
  messages: ChatMessage[];
  docIds: string[];
  chatTitle?: string;
  docsVersion?: number;
  onMessagesChange: (updater: (msgs: ChatMessage[]) => ChatMessage[]) => void;
  onDocIdsChange: (ids: string[]) => void;
  onOpenSidebar?: () => void;
}

export default function ChatBox({
  messages,
  docIds,
  chatTitle,
  docsVersion,
  onMessagesChange,
  onDocIdsChange,
  onOpenSidebar,
}: ChatBoxProps) {
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [ratingLoading, setRatingLoading] = useState<string | null>(null);
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false);
  // Doc-picker slice grouped into a reducer (see docPickerReducer). The four
  // values above are independent and stay as their own useState.
  const [docPicker, dispatchDocPicker] = useReducer(
    docPickerReducer,
    initialDocPicker,
  );
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Lazily initialised so the Map is built once, not re-allocated and discarded
  // on every render (ChatBox re-renders on each streamed token).
  const sourcesRef = useRef<Map<string, SSESource[]> | null>(null);
  if (sourcesRef.current === null) sourcesRef.current = new Map();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { user } = useSession();

  const { selectedId, loading: modelsLoading } = useModels();

  const displayName =
    user?.user_metadata?.user_name || user?.email?.split("@")[0] || "there";

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  };

  const handleSend = async () => {
    const q = input.trim();
    if (!q || streaming) return;
    if (!selectedId) {
      toast.error("Pick a model first");
      return;
    }

    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      parts: [],
      model: selectedId,
    };
    onMessagesChange((prev) => [...prev, userMsg, assistantMsg]);

    const turn = [
      ...messages.flatMap((m) =>
        m.role === "user" || (m.content && m.content.trim())
          ? [{ role: m.role, content: m.content }]
          : [],
      ),
      { role: "user" as const, content: q },
    ];

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    scrollToBottom();

    const updateAssistant = (mut: (m: ChatMessage) => ChatMessage) => {
      onMessagesChange((prev) =>
        prev.map((m) => (m.id === assistantId ? mut(m) : m)),
      );
    };

    const appendText = (text: string) => {
      updateAssistant((m) => {
        const parts: MessagePart[] = m.parts ? [...m.parts] : [];
        const last = parts[parts.length - 1];
        if (last && last.type === "text") {
          parts[parts.length - 1] = {
            type: "text",
            text: last.text + text,
          };
        } else {
          parts.push({ type: "text", text });
        }
        const content = parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");
        return { ...m, parts, content };
      });
    };

    const pushTool = (tool: ToolCallState) => {
      updateAssistant((m) => {
        const parts: MessagePart[] = m.parts ? [...m.parts] : [];
        parts.push({ type: "tool", tool });
        return { ...m, parts };
      });
    };

    const updateTool = (id: string, mut: (t: ToolCallState) => ToolCallState) => {
      updateAssistant((m) => {
        const parts = (m.parts ?? []).map((p) =>
          p.type === "tool" && p.tool.id === id
            ? { type: "tool" as const, tool: mut(p.tool) }
            : p,
        );
        return { ...m, parts };
      });
    };

    try {
      for await (const event of chatStream(
        turn,
        selectedId,
        docIds.length > 0 ? docIds : undefined,
        controller.signal,
      )) {
        handleStreamEvent(event, {
          appendText,
          pushTool,
          updateTool,
          onSources: (sources) => {
            sourcesRef.current?.set(assistantId, sources);
            updateAssistant((m) => ({ ...m, sources }));
          },
        });
        scrollToBottom();
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        appendText(" [stopped]");
      } else {
        const msg = err instanceof Error ? err.message : "Chat failed";
        toast.error(msg);
        onMessagesChange((prev) => prev.filter((m) => m.id !== assistantId));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleFeedback = async (msg: ChatMessage, rating: 1 | -1) => {
    const sources = msg.sources || sourcesRef.current?.get(msg.id) || [];
    const chunksIds = sources.map((s) => s.chunk_id);
    setRatingLoading(msg.id);
    try {
      await submitFeedback(
        messages.find(
          (m) =>
            m.role === "user" && messages.indexOf(m) < messages.indexOf(msg),
        )?.content || "",
        msg.content,
        rating,
        chunksIds,
      );
      toast.success(
        rating === 1
          ? "Thanks for the feedback!"
          : "Feedback noted. We'll improve",
      );
    } catch {
      toast.error("Failed to record feedback");
    } finally {
      setRatingLoading(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  const loadAvailableDocs = useCallback(async () => {
    dispatchDocPicker({ type: "loadStart" });
    try {
      const data = await listDocuments();
      dispatchDocPicker({
        type: "loaded",
        docs: data.filter((d) => d.status === "ready"),
      });
    } catch {
      toast.error("Failed to load documents");
      dispatchDocPicker({ type: "loadFailed" });
    }
  }, []);

  // Fetch the document list whenever the picker is open — on first open and
  // again if documents change elsewhere (docsVersion) while it's open. There's
  // no stale cache to clear: a closed picker shows nothing, and opening always
  // refetches. This replaces an effect that reset state on a prop change.
  useEffect(() => {
    if (!docPicker.open) return;
    loadAvailableDocs();
  }, [docPicker.open, docsVersion, loadAvailableDocs]);

  const toggleDocPicker = () => dispatchDocPicker({ type: "toggle" });

  const toggleDoc = (id: string) => {
    if (docIds.includes(id)) {
      onDocIdsChange(docIds.filter((d) => d !== id));
    } else {
      onDocIdsChange([...docIds, id]);
    }
  };

  const attachedDocNames = docPicker.docs.flatMap((d) =>
    docIds.includes(d.id) ? [d.filename] : [],
  );

  const lastAssistantMsg = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const showSource =
    lastAssistantMsg?.sources && lastAssistantMsg.sources.length > 0;

  const hasMessages = messages.length > 0;

  const sourcesPanel = showSource && (
    <div className="px-3 py-3 sm:px-6">
      <div className="mx-auto max-w-3xl border-t pt-3">
        <button
          type="button"
          onClick={() => setSourcesCollapsed((v) => !v)}
          className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={`h-3 w-3 transition-transform duration-150 ${sourcesCollapsed ? "-rotate-90" : ""}`}
          />
          Sources ({lastAssistantMsg?.sources?.length ?? 0})
        </button>
        {!sourcesCollapsed && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {lastAssistantMsg?.sources?.map((src) => (
              <div
                key={src.chunk_id}
                id={`source-${src.chunk_id}`}
                className="shrink-0 rounded-lg border p-3 text-xs transition-all max-w-64 bg-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">
                    {src.document_filename ?? src.filename ?? "unknown"}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleOpenSource(src)}
                    aria-label="Open source document"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-muted-foreground">
                  Page: {src.page ?? "N/A"}
                </p>
                <p className="mt-1 line-clamp-3 text-muted-foreground">
                  {src.text}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const inputArea = (
    <div className="mx-auto w-full max-w-3xl">
      <div className="rounded-2xl border bg-card shadow-sm">
        {/* Doc Picker Dropdown */}
        {docPicker.open && (
          <div className="border-b px-4 py-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Add documents to this chat
            </p>
            {docPicker.loading ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : docPicker.docs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No ready documents. Upload via Documents panel.
              </p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {docPicker.docs.map((doc) => (
                  <li key={doc.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={docIds.includes(doc.id)}
                        onChange={() => toggleDoc(doc.id)}
                        className="accent-foreground"
                      />
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{doc.filename}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Attached doc chips */}
        {docIds.length > 0 && !docPicker.open && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {attachedDocNames.map((name, i) => (
              <span
                key={docIds[i]}
                className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
              >
                <FileText className="h-3 w-3 text-muted-foreground" />
                {name}
                <button
                  type="button"
                  onClick={() => toggleDoc(docIds[i])}
                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about your documents..."
          rows={1}
          disabled={streaming}
          className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
          aria-label="Ask a question"
          style={{ minHeight: "24px", maxHeight: "200px" }}
        />
        <div className="flex items-center justify-between px-3 pb-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={toggleDocPicker}
              aria-label="Attach documents"
            >
              <Plus className="h-3.5 w-3.5" />
              {docIds.length > 0
                ? `${docIds.length} doc${docIds.length > 1 ? "s" : ""}`
                : "Add docs"}
            </Button>
            <ModelPicker disabled={streaming || modelsLoading} />
          </div>
          {streaming ? (
            <Button
              onClick={handleCancel}
              variant="destructive"
              size="icon"
              className="h-8 w-8 rounded-full"
              aria-label="Stop generating"
            >
              <StopCircle className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              disabled={!input.trim()}
              size="icon"
              className="h-8 w-8 rounded-full"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Mobile header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onOpenSidebar}
          aria-label="Open menu"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <h1 className="flex-1 truncate text-sm font-medium">
          {chatTitle ?? "PaperPilot"}
        </h1>
      </div>

      {!hasMessages ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-3 py-6 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <span className="text-lg">✈️</span>
            </div>
            <h1 className="text-3xl font-normal tracking-tight">
              Hello, {displayName}
            </h1>
          </div>
          <div className="w-full">{inputArea}</div>
        </div>
      ) : (
        <>
          {/* Messages Area */}
          <div
            className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6"
            ref={scrollRef}
          >
            <div className="mx-auto max-w-3xl space-y-6">
              {messages.map((msg) => (
              <div key={msg.id} className="group">
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl bg-foreground px-5 py-3 text-sm text-background">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs">
                      ✈️
                    </div>
                    <div className="flex-1 min-w-0">
                      {msg.parts && msg.parts.length > 0 ? (
                        <div className="space-y-1">
                          {msg.parts.map((part, idx) =>
                            part.type === "text" ? (
                              <MarkdownContent
                                key={idx}
                                text={part.text}
                                sources={msg.sources}
                                onCitationClick={handleSourceClick}
                              />
                            ) : (
                              <ToolCallBubble key={part.tool.id} tool={part.tool} />
                            ),
                          )}
                          {streaming &&
                            msg.id === messages[messages.length - 1]?.id &&
                            (msg.parts.length === 0 ||
                              msg.parts[msg.parts.length - 1].type !== "text" ||
                              (msg.parts[msg.parts.length - 1] as { type: "text"; text: string })
                                .text === "") && <ThinkingBubble />}
                        </div>
                      ) : msg.content ? (
                        <MarkdownContent
                          text={msg.content}
                          sources={msg.sources}
                          onCitationClick={handleSourceClick}
                        />
                      ) : (
                        streaming && <ThinkingBubble />
                      )}
                      {msg.content && !streaming && (
                        <div className="mt-2 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={ratingLoading === msg.id}
                            onClick={() => handleFeedback(msg, 1)}
                            aria-label="Thumbs up"
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={ratingLoading === msg.id}
                            onClick={() => handleFeedback(msg, -1)}
                            aria-label="Thumbs down"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            </div>
          </div>
          {sourcesPanel}
          <div className="px-3 pb-4 pt-2 sm:px-4 sm:pb-6">{inputArea}</div>
        </>
      )}
    </div>
  );
}
