import {
  getDocumentDownloadUrl,
  streamQuery,
  submitFeedback,
  type SSESource,
} from "@/lib/api";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { ExternalLink, Send, StopCircle, ThumbsDown } from "lucide-react";
import { Textarea } from "./ui/textarea";

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
      className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-muted px-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
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
    el?.classList.add("ring-2", "ring-primary");
    setTimeout(() => el?.classList.remove("ring-2", "ring-primary"), 2000);
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
            ></CitationMark>
          );
        }
      }
      return <span key={i}>{part}</span>;
    });
  };

  const lastAssistantMsg = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const showSource =
    lastAssistantMsg?.sources && lastAssistantMsg.sources.length > 0;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Card className="flex flex-1 flex-col overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Chat</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col overflow-hidden px-0">
          <div className="flex-1 overflow-y-auto px-6" ref={scrollRef}>
            {messages.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Upload a document and ask a question to get started.
              </p>
            ) : (
              <div className="space-y-4 pb-4">
                {messages.map((msg) => (
                  <div key={msg.id}>
                    <div
                      className={`rounded-lg px-4 py-3 text-sm
                      ${
                        msg.role === "user"
                          ? "ml-8 bg-primary text-primary-foreground"
                          : "mr-8 bg-muted"
                      }`}
                    >
                      {msg.role === "assistant" ? (
                        <>
                          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                            {renderContext(msg.content, msg.sources)}
                          </div>
                          {typeof msg.confidence === "number" && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Confidence: {Math.round(msg.confidence * 100)}%
                            </p>
                          )}
                        </>
                      ) : (
                        msg.content
                      )}
                    </div>
                    {msg.role === "assistant" && msg.content && !streaming && (
                      <div className="mt-1 flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          disabled={ratingLoading === msg.id}
                          onClick={() => handleFeedback(msg, 1)}
                          aria-label="Thumbs down"
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          {showSource && (
            <div className="border-t px-6 py-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                SOURCES
              </p>
              <div className="flex gap-2 overflow-x-auto">
                {lastAssistantMsg?.sources?.map((src) => (
                  <div
                    key={src.chunk_id}
                    id={`source-${src.chunk_id}`}
                    className="shrink-0 rounded-md border p-2 text-xs transition-all max-w-64"
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
                        <ExternalLink className="h-3 w-3"></ExternalLink>
                      </Button>
                    </div>
                    <p className="text-muted-foreground">
                      Page: {src.page ?? "N/A"}
                    </p>
                    <p className="mt-1 line-clamp-3">{src.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="boder-t p-4">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask a question about your documents..."
                rows={1}
                disabled={streaming}
                className="min-h-0 resize-none"
                aria-label="Ask a question"
              />
              {streaming ? (
                <Button
                  onClick={handleCancel}
                  variant="destructive"
                  size="icon"
                  aria-label="Stop generating"
                >
                  <StopCircle className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  size="icon"
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
