import {
  getDocumentDownloadUrl,
  chatStream,
  submitFeedback,
  listDocuments,
  type SSESource,
  type StreamEvent,
  type ChatTurnMessage,
} from "@/lib/api";
import ModelPicker from "./ModelPicker";
import ToolCallBubble, { type ToolCallState } from "./ToolCallBubble";
import { useModels } from "./ModelProvider";
import type { ChatMessage, MessagePart } from "@/hooks/useChatSessions";
import { useRef, useState, useEffect, useCallback } from "react";
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
  RotateCcw,
} from "lucide-react";
import { useSession } from "@/hooks/useSession";
import MarkdownContent from "./MarkdownContent";
import { BrandMark } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";

interface AvailableDoc {
  id: string;
  filename: string;
  status: string;
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
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false);
  const [availableDocs, setAvailableDocs] = useState<AvailableDoc[]>([]);
  const [docNameById, setDocNameById] = useState<Record<string, string>>({});
  const [loadingDocs, setLoadingDocs] = useState(false);
  // Maps assistantId → failed turn context for inline retry.
  // This is local state only — never persisted to the DB.
  const [failedTurns, setFailedTurns] = useState<
    Map<string, { turn: ChatTurnMessage[]; modelId: string; docIds: string[]; error: string }>
  >(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sourcesRef = useRef<Map<string, SSESource[]>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { user } = useSession();

  const { selectedId, loading: modelsLoading } = useModels();

  const displayName =
    user?.user_metadata?.user_name || user?.email?.split("@")[0] || "there";

  // Stable identity (scrollRef is a ref) so the runStream useCallback below
  // doesn't get a new dependency on every render.
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, []);

  const handleSourceClick = (chunkId: string) => {
    const el = document.getElementById(`source-${chunkId}`);
    el?.classList.add("ring-2", "ring-ring");
    setTimeout(() => el?.classList.remove("ring-2", "ring-ring"), 2000);
  };

  const handleOpenSource = async (src: SSESource) => {
    try {
      const { url } = await getDocumentDownloadUrl(src.source_url ?? "");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Could not open source document");
    }
  };

  // Core streaming helper: drives a single assistant turn. Reused by
  // handleSend (new turn) and the inline Retry button (re-stream failed turn).
  const runStream = useCallback(
    async (
      assistantId: string,
      turn: ChatTurnMessage[],
      modelId: string,
      streamDocIds: string[],
    ) => {
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

      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      scrollToBottom();

      try {
        for await (const event of chatStream(
          turn,
          modelId,
          streamDocIds.length > 0 ? streamDocIds : undefined,
          controller.signal,
        )) {
          handleStreamEvent(event, {
            appendText,
            pushTool,
            updateTool,
            onSources: (sources) => {
              sourcesRef.current.set(assistantId, sources);
              updateAssistant((m) => ({ ...m, sources }));
            },
          });
          scrollToBottom();
        }
        // chatStream swallows AbortError and returns normally — detect via signal
        if (controller.signal.aborted) {
          appendText(" [stopped]");
          setFailedTurns((prev) => {
            const next = new Map(prev);
            next.delete(assistantId);
            return next;
          });
        } else {
          // Clean completion — clear any prior failure for this turn
          setFailedTurns((prev) => {
            const next = new Map(prev);
            next.delete(assistantId);
            return next;
          });
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // Fallback: some paths may still surface AbortError directly
          appendText(" [stopped]");
          setFailedTurns((prev) => {
            const next = new Map(prev);
            next.delete(assistantId);
            return next;
          });
        } else {
          const msg = err instanceof Error ? err.message : "Chat failed";
          // Keep whatever partial text already streamed and record the failure
          // so the inline retry row can appear.
          setFailedTurns((prev) => {
            const next = new Map(prev);
            next.set(assistantId, { turn, modelId, docIds: streamDocIds, error: msg });
            return next;
          });
          toast.error(msg);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [onMessagesChange, scrollToBottom],
  );

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
      ...messages
        .filter((m) => m.role === "user" || (m.content && m.content.trim()))
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: q },
    ];

    await runStream(assistantId, turn, selectedId, docIds);
  };

  const handleRetry = useCallback(
    async (assistantId: string) => {
      const failed = failedTurns.get(assistantId);
      if (!failed || streaming) return;
      // Reset this assistant message's content/parts so it starts fresh
      onMessagesChange((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: "", parts: [], sources: undefined } : m,
        ),
      );
      // Clear failure record before re-streaming (runStream will re-set if it fails again)
      setFailedTurns((prev) => {
        const next = new Map(prev);
        next.delete(assistantId);
        return next;
      });
      await runStream(assistantId, failed.turn, failed.modelId, failed.docIds);
    },
    [failedTurns, streaming, onMessagesChange, runStream],
  );

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleFeedback = async (msg: ChatMessage, rating: 1 | -1) => {
    const sources = msg.sources || sourcesRef.current.get(msg.id) || [];
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

  const mergeDocNames = useCallback((docs: AvailableDoc[]) => {
    setDocNameById((prev) => {
      const next = { ...prev };
      for (const doc of docs) {
        if (doc.status === "ready") next[doc.id] = doc.filename;
      }
      return next;
    });
  }, []);

  // Latest values read inside effects without retriggering them.
  const docNameByIdRef = useRef(docNameById);
  useEffect(() => {
    docNameByIdRef.current = docNameById;
  }, [docNameById]);
  const showDocPickerRef = useRef(showDocPicker);
  useEffect(() => {
    showDocPickerRef.current = showDocPicker;
  }, [showDocPicker]);

  const loadAvailableDocs = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const data = await listDocuments();
      const ready = data.filter((d) => d.status === "ready");
      setAvailableDocs(ready);
      mergeDocNames(ready);
    } catch {
      toast.error("Failed to load documents");
    } finally {
      setLoadingDocs(false);
    }
  }, [mergeDocNames]);

  const lastHydratedKey = useRef("");
  useEffect(() => {
    if (docIds.length === 0) return;
    if (docIds.every((id) => docNameByIdRef.current[id])) return;

    // Guard against refetching the same doc set repeatedly when an id never
    // resolves (e.g. a deleted doc still in scope) — its name stays unset, so
    // the every() check above can't short-circuit on later renders.
    const key = docIds.join(",");
    if (lastHydratedKey.current === key) return;
    lastHydratedKey.current = key;

    let cancelled = false;
    listDocuments()
      .then((data) => {
        if (cancelled) return;
        mergeDocNames(data.filter((d) => d.status === "ready"));
      })
      .catch(() => {
        // Allow a retry for this doc set if the fetch failed.
        lastHydratedKey.current = "";
        // loadAvailableDocs surfaces errors when the picker is open
      });

    return () => {
      cancelled = true;
    };
  }, [docIds, mergeDocNames]);

  useEffect(() => {
    if (docsVersion === undefined || docsVersion === 0) return;

    let cancelled = false;
    listDocuments()
      .then((data) => {
        if (cancelled) return;
        const ready = data.filter((d) => d.status === "ready");
        mergeDocNames(ready);
        if (showDocPickerRef.current) setAvailableDocs(ready);
      })
      .catch(() => {
        if (!cancelled && showDocPickerRef.current) {
          toast.error("Failed to load documents");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [docsVersion, mergeDocNames]);

  const toggleDocPicker = () => {
    if (!showDocPicker) loadAvailableDocs();
    setShowDocPicker((v) => !v);
  };

  const toggleDoc = (id: string) => {
    if (docIds.includes(id)) {
      onDocIdsChange(docIds.filter((d) => d !== id));
    } else {
      const doc = availableDocs.find((d) => d.id === id);
      if (doc) mergeDocNames([doc]);
      onDocIdsChange([...docIds, id]);
    }
  };

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
        {showDocPicker && (
          <div className="border-b px-4 py-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Add documents to this chat
            </p>
            {loadingDocs ? (
              <p className="text-xs text-muted-foreground">Loading...</p>
            ) : availableDocs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No ready documents. Upload via Documents panel.
              </p>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {availableDocs.map((doc) => (
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
        {docIds.length > 0 && !showDocPicker && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {docIds.map((id) => {
              const name = docNameById[id] ?? "Document";
              return (
                <span
                  key={id}
                  className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
                >
                  <FileText className="h-3 w-3 text-muted-foreground" />
                  {name}
                  <button
                    type="button"
                    onClick={() => toggleDoc(id)}
                    className="ml-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
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
        <ThemeToggle />
      </div>

      {!hasMessages ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-3 py-6 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark className="h-10 w-10" />
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
                      {/* Inline error + retry row — shown when this turn failed */}
                      {failedTurns.has(msg.id) && (
                        <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-destructive/10 px-3 py-2 text-sm text-destructive">
                          <span className="flex-1 truncate">
                            {failedTurns.get(msg.id)?.error ?? "Stream failed"}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 gap-1.5"
                            onClick={() => void handleRetry(msg.id)}
                            aria-label="Retry"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Retry
                          </Button>
                        </div>
                      )}
                      {msg.content && !streaming && !failedTurns.has(msg.id) && (
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
