import {
  getDocumentDownloadUrl,
  streamQuery,
  submitFeedback,
  type SSESource,
} from "@/lib/api";
import { useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  ExternalLink,
  Send,
  StopCircle,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { useSession } from "@/hooks/useSession";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SSESource[];
  confidence?: number;
}

function CitationMark({
  index,
  onClick,
}: {
  index: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-muted px-1 text-xs font-medium text-foreground hover:bg-accent transition-colors"
      aria-label={`Jump to source ${index + 1}`}
    >
      [{index + 1}]
    </button>
  );
}

export default function ChatBox() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [ratingLoading, setRatingLoading] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sourcesRef = useRef<Map<string, SSESource[]>>(new Map());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { user } = useSession();

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

  const handleSourceClick = (chunkId: string) => {
    const el = document.getElementById(`source-${chunkId}`);
    el?.classList.add("ring-2", "ring-ring");
    setTimeout(() => el?.classList.remove("ring-2", "ring-ring"), 2000);
  };

  const handleOpenSource = async (src: SSESource) => {
    try {
      const { url } = await getDocumentDownloadUrl(src.source_url);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Could not open source document");
    }
  };

  const handleSend = async () => {
    const q = input.trim();
    if (!q || streaming) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
    };
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    scrollToBottom();

    try {
      for await (const event of streamQuery(
        q,
        5,
        undefined,
        controller.signal,
      )) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsg.id) return m;
            if (event.type === "token")
              return { ...m, content: m.content + event.data };
            if (event.type === "sources") {
              sourcesRef.current.set(m.id, event.data);
              return { ...m, sources: event.data };
            }
            if (event.type === "confidence")
              return { ...m, confidence: event.data };
            return m;
          }),
        );
        scrollToBottom();
      }
    } catch (err: any) {
      if (err.name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: m.content + " [stopped]" }
              : m,
          ),
        );
      } else {
        toast.error(err.message || "Query failed");
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleFeedback = async (msg: Message, rating: 1 | -1) => {
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

  const renderContext = (content: string, sources?: SSESource[]) => {
    if (!sources || sources.length === 0) return content;

    const parts = content.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/^\[(\d+)\]$/);
      if (match) {
        const num = parseInt(match[1]) - 1;
        if (sources[num]) {
          return (
            <CitationMark
              key={i}
              index={num}
              onClick={() => handleSourceClick(sources[num].chunk_id)}
            />
          );
        }
      }
      return <span key={i}>{part}</span>;
    });
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

  const lastAssistantMsg = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const showSource =
    lastAssistantMsg?.sources && lastAssistantMsg.sources.length > 0;

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Messages Area */}
      <div
        className={`flex-1 overflow-y-auto ${hasMessages ? "px-6 py-6" : ""}`}
        ref={scrollRef}
      >
        {!hasMessages ? (
          <div className="flex h-full flex-col items-center justify-center px-6">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <span className="text-lg">✈️</span>
              </div>
              <h1 className="text-3xl font-normal tracking-tight">
                Hello, {displayName}
              </h1>
            </div>
          </div>
        ) : (
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
                      <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">
                        {renderContext(msg.content, msg.sources)}
                      </div>
                      {typeof msg.confidence === "number" && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Confidence: {Math.round(msg.confidence * 100)}%
                        </p>
                      )}
                      {msg.content && !streaming && (
                        <div className="mt-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
        )}
      </div>

      {/* Sources Panel */}
      {showSource && (
        <div className="border-t px-6 py-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Sources
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {lastAssistantMsg?.sources?.map((src) => (
              <div
                key={src.chunk_id}
                id={`source-${src.chunk_id}`}
                className="shrink-0 rounded-lg border p-3 text-xs transition-all max-w-64 bg-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">
                    {src.document_filename}
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
        </div>
      )}

      {/* Input Area */}
      <div className="px-4 pb-6 pt-2">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border bg-card shadow-sm">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about your documents..."
              rows={1}
              disabled={streaming}
              className="w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Ask a question"
              style={{ minHeight: "24px", maxHeight: "200px" }}
            />
            <div className="flex items-center justify-end px-3 pb-3">
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
      </div>
    </div>
  );
}
