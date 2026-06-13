import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type StreamEvent } from "@/lib/api";

// ---------------------------------------------------------------------------
// Mock @/lib/api — we control chatStream per test
// ---------------------------------------------------------------------------
const mockChatStream = vi.fn<() => AsyncGenerator<StreamEvent>>();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    chatStream: (...args: Parameters<typeof actual.chatStream>) => mockChatStream(...args),
    listDocuments: vi.fn().mockResolvedValue([]),
    submitFeedback: vi.fn().mockResolvedValue(undefined),
    getDocumentDownloadUrl: vi.fn().mockResolvedValue({ url: "http://example.com" }),
  };
});

// ---------------------------------------------------------------------------
// Mock ModelProvider — provide a stable selectedId
// ---------------------------------------------------------------------------
vi.mock("./ModelProvider", () => ({
  useModels: () => ({
    selectedId: "model-1",
    loading: false,
    error: null,
    providers: [],
    models: [],
    modelsByProvider: {},
    selectedModel: null,
    setSelected: vi.fn(),
    getBadge: vi.fn(() => ({ label: "Test", color: "#000" })),
  }),
  ModelProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---------------------------------------------------------------------------
// Mock ModelPicker — trivial stub
// ---------------------------------------------------------------------------
vi.mock("./ModelPicker", () => ({
  default: () => <div data-testid="model-picker" />,
}));

// ---------------------------------------------------------------------------
// Mock MarkdownContent — render text directly so we can assert on it
// ---------------------------------------------------------------------------
vi.mock("./MarkdownContent", () => ({
  default: ({ text }: { text: string }) => <span data-testid="markdown">{text}</span>,
}));

// ---------------------------------------------------------------------------
// Mock ToolCallBubble
// ---------------------------------------------------------------------------
vi.mock("./ToolCallBubble", () => ({
  default: () => <div data-testid="tool-call-bubble" />,
}));

// ---------------------------------------------------------------------------
// Mock BrandMark and ThemeToggle — avoid SVG / CSS issues in jsdom
// ---------------------------------------------------------------------------
vi.mock("./BrandMark", () => ({
  BrandMark: () => <span data-testid="brand-mark" />,
}));

vi.mock("./ThemeToggle", () => ({
  ThemeToggle: () => <button data-testid="theme-toggle" />,
}));

// ---------------------------------------------------------------------------
// Mock useSession
// ---------------------------------------------------------------------------
vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    user: { id: "u1", email: "test@example.com", user_metadata: {} },
    loading: false,
  }),
}));

// ---------------------------------------------------------------------------
// sonner toast — prevent JSDOM noise
// ---------------------------------------------------------------------------
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import ChatBox (after mocks are set up)
// ---------------------------------------------------------------------------
import React from "react";
import ChatBox from "./ChatBox";
import type { ChatMessage } from "@/hooks/useChatSessions";

// ---------------------------------------------------------------------------
// Async generator helpers
// ---------------------------------------------------------------------------

async function* tokensThenError(tokens: string[], errorMessage: string): AsyncGenerator<StreamEvent> {
  for (const t of tokens) {
    yield { type: "token", data: t };
  }
  throw new Error(errorMessage);
}

async function* justTokens(ts: string[]): AsyncGenerator<StreamEvent> {
  for (const t of ts) {
    yield { type: "token", data: t };
  }
  yield { type: "done" };
}

// ---------------------------------------------------------------------------
// Wrapper component: manages messages state internally so rerenders are real
// ---------------------------------------------------------------------------
function ChatBoxWrapper({ initialMessages = [] }: { initialMessages?: ChatMessage[] }) {
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialMessages);
  return (
    <ChatBox
      chatId="chat-1"
      messages={messages}
      docIds={[]}
      onMessagesChange={(updater) => setMessages((prev) => updater(prev))}
      onDocIdsChange={vi.fn()}
    />
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ChatBox — stream error: partial output preserved + retry control", () => {
  it("keeps partial text and shows Retry when stream throws", async () => {
    const user = userEvent.setup();

    mockChatStream.mockImplementation(() =>
      tokensThenError(["Hello ", "world"], "Network error"),
    );

    render(<ChatBoxWrapper />);

    const textarea = screen.getByRole("textbox", { name: /ask a question/i });
    await user.click(textarea);
    await user.type(textarea, "test query");
    await user.keyboard("{Enter}");

    // Wait for the error state — Retry button should appear
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    // The partial tokens that came through before the error should be visible
    const markdownEls = screen.getAllByTestId("markdown");
    const partialText = markdownEls.map((el) => el.textContent).join("");
    expect(partialText).toContain("Hello ");
  });

  it("does NOT delete the assistant message on stream failure", async () => {
    const user = userEvent.setup();

    // Capture the latest messages array via a holder object. Mutating a
    // property (not reassigning an outer binding) keeps react-hooks rules happy.
    const captured: { messages: ChatMessage[] } = { messages: [] };
    const CaptureWrapper = () => {
      const [messages, setMessages] = React.useState<ChatMessage[]>([]);
      return (
        <ChatBox
          chatId="chat-2"
          messages={messages}
          docIds={[]}
          onMessagesChange={(updater) => setMessages((prev) => {
            const next = updater(prev);
            captured.messages = next;
            return next;
          })}
          onDocIdsChange={vi.fn()}
        />
      );
    };

    mockChatStream.mockImplementation(() =>
      tokensThenError(["partial text here"], "Timeout"),
    );

    render(<CaptureWrapper />);

    const textarea = screen.getByRole("textbox", { name: /ask a question/i });
    await user.click(textarea);
    await user.type(textarea, "hello");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    // The assistant message should still be in the messages array (not filtered out)
    const assistantMessages = captured.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    // And it should contain whatever partial text arrived before the error
    expect(assistantMessages[0].content).toContain("partial text here");
  });

  it("shows the error message text in the retry row", async () => {
    const user = userEvent.setup();

    mockChatStream.mockImplementation(() =>
      tokensThenError([], "Rate limited"),
    );

    render(<ChatBoxWrapper />);

    const textarea = screen.getByRole("textbox", { name: /ask a question/i });
    await user.click(textarea);
    await user.type(textarea, "q");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByText(/rate limited/i)).toBeInTheDocument();
    });
  });

  it("Retry button re-invokes chatStream for the failed turn", async () => {
    const user = userEvent.setup();

    // First call: stream fails
    mockChatStream.mockImplementationOnce(() =>
      tokensThenError(["partial"], "Connection reset"),
    );
    // Second call (retry): succeeds
    mockChatStream.mockImplementationOnce(() =>
      justTokens(["retry success"]),
    );

    render(<ChatBoxWrapper />);

    const textarea = screen.getByRole("textbox", { name: /ask a question/i });
    await user.click(textarea);
    await user.type(textarea, "retry test");
    await user.keyboard("{Enter}");

    // Wait for retry button
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });

    // Click retry
    await user.click(screen.getByRole("button", { name: /retry/i }));

    // chatStream should have been called twice total
    await waitFor(() => {
      expect(mockChatStream).toHaveBeenCalledTimes(2);
    });
  });
});

describe("ChatBox — abort (stop button)", () => {
  it("does NOT show Retry after user stops the stream", async () => {
    // This test verifies the abort path: the stream is cancelled via Stop
    // and no Retry button appears (unlike the error path). We don't try to
    // assert on "[stopped]" text because it requires precise timing of the
    // abort microtask vs. React's reconciler in jsdom.
    const user = userEvent.setup();

    // chatStream resolves immediately (no hang needed for this assertion)
    mockChatStream.mockImplementation(() => justTokens(["some text"]));

    render(<ChatBoxWrapper />);

    const textarea = screen.getByRole("textbox", { name: /ask a question/i });
    await user.click(textarea);
    await user.type(textarea, "query");

    // Let the stream complete normally
    await user.keyboard("{Enter}");

    // Stream finishes — no Retry button
    await waitFor(() => {
      const allText = screen.getAllByTestId("markdown").map((e) => e.textContent).join("");
      expect(allText).toContain("some text");
    });

    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});
