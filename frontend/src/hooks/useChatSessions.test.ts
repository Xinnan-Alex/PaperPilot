import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useChatSessions } from "./useChatSessions";

// ---------------------------------------------------------------------------
// Supabase mock
// The hook uses supabase.from(...).select/insert/update/delete/eq/order/single
// and supabase.auth.getSession. We stub this as a chainable builder where
// the terminal call (.single(), .order()) returns a resolved promise.
// ---------------------------------------------------------------------------

type FakeResult = { data: unknown; error: unknown };

// Shared state to let tests control resolved values.
const mockResults: {
  select: FakeResult;
  insert: FakeResult;
  update: FakeResult;
  delete: FakeResult;
  session: FakeResult;
} = {
  select: { data: null, error: null },
  insert: { data: null, error: null },
  update: { data: null, error: null },
  delete: { data: null, error: null },
  session: { data: { session: { user: { id: "user-1" }, access_token: "tok" } }, error: null },
};

// Minimal chainable builder — each method returns `this` except terminal ones.
function makeBuilder(resultKey: keyof typeof mockResults) {
  const builder: Record<string, unknown> = {};
  const noop = () => builder;
  const terminal = () => Promise.resolve(mockResults[resultKey]);

  builder.select = noop;
  builder.insert = () => makeBuilder("insert");
  builder.update = () => makeBuilder("update");
  builder.delete = () => makeBuilder("delete");
  builder.eq = noop;
  builder.order = terminal;  // used by the initial load query
  builder.single = terminal; // used by insert().select().single()

  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "chat_sessions") {
        return makeBuilder("select");
      }
      return makeBuilder("select");
    },
    auth: {
      getSession: () => Promise.resolve(mockResults.session),
    },
  },
}));

// ---------------------------------------------------------------------------
// Helper to build a fake DB row with sensible defaults.
// ---------------------------------------------------------------------------
function makeRow(overrides: Partial<{
  id: string;
  title: string;
  messages: unknown[];
  doc_ids: string[];
  created_at: string;
  updated_at: string;
}> = {}) {
  return {
    id: overrides.id ?? "sess-1",
    title: overrides.title ?? "New Chat",
    messages: overrides.messages ?? [],
    doc_ids: overrides.doc_ids ?? [],
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset to defaults before each test
  mockResults.select = { data: null, error: null };
  mockResults.insert = { data: null, error: null };
  mockResults.update = { data: null, error: null };
  mockResults.delete = { data: null, error: null };
  mockResults.session = {
    data: { session: { user: { id: "user-1" }, access_token: "tok" } },
    error: null,
  };
});

describe("useChatSessions — initial load", () => {
  it("creates a fresh session when no sessions exist in the DB", async () => {
    const newRow = makeRow({ id: "fresh-1", title: "New Chat" });
    // select returns empty, insert returns a new row
    mockResults.select = { data: [], error: null };
    mockResults.insert = { data: newRow, error: null };

    const { result } = renderHook(() => useChatSessions());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].id).toBe("fresh-1");
    expect(result.current.activeChatId).toBe("fresh-1");
  });

  it("loads existing sessions and sets the first as active", async () => {
    const rows = [
      makeRow({ id: "s1", title: "Chat A", updated_at: "2024-01-02T00:00:00Z" }),
      makeRow({ id: "s2", title: "Chat B", updated_at: "2024-01-01T00:00:00Z" }),
    ];
    mockResults.select = { data: rows, error: null };

    const { result } = renderHook(() => useChatSessions());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.sessions).toHaveLength(2);
    expect(result.current.activeChatId).toBe("s1");
  });
});

describe("useChatSessions — createChat", () => {
  it("prepends a new session and sets it as active", async () => {
    const existing = makeRow({ id: "s-existing", title: "Old Chat" });
    const newRow = makeRow({ id: "s-new", title: "New Chat" });
    mockResults.select = { data: [existing], error: null };
    mockResults.insert = { data: newRow, error: null };

    const { result } = renderHook(() => useChatSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createChat();
    });

    expect(result.current.sessions[0].id).toBe("s-new");
    expect(result.current.activeChatId).toBe("s-new");
    expect(result.current.sessions).toHaveLength(2);
  });
});

describe("useChatSessions — deleteChat", () => {
  it("removes the session from the list", async () => {
    const rows = [
      makeRow({ id: "s1", title: "First" }),
      makeRow({ id: "s2", title: "Second" }),
    ];
    mockResults.select = { data: rows, error: null };

    const { result } = renderHook(() => useChatSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteChat("s2");
    });

    expect(result.current.sessions.map((s) => s.id)).toEqual(["s1"]);
  });

  it("creates a fresh session when deleting the last one", async () => {
    const only = makeRow({ id: "only-1", title: "Solo" });
    const newRow = makeRow({ id: "fresh-after-delete", title: "New Chat" });
    mockResults.select = { data: [only], error: null };
    mockResults.insert = { data: newRow, error: null };

    const { result } = renderHook(() => useChatSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteChat("only-1");
    });

    // After deletion a fresh session is created asynchronously
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.sessions[0].id).toBe("fresh-after-delete");
  });
});

describe("useChatSessions — updateMessages", () => {
  it("derives title from first message when title is 'New Chat'", async () => {
    const row = makeRow({ id: "sess-title", title: "New Chat" });
    mockResults.select = { data: [row], error: null };

    const { result } = renderHook(() => useChatSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.updateMessages("sess-title", () => [
        { id: "m1", role: "user", content: "What is RAG?" },
      ]);
    });

    const session = result.current.sessions.find((s) => s.id === "sess-title");
    expect(session?.title).toBe("What is RAG?");
  });

  it("does not override an existing custom title", async () => {
    const row = makeRow({ id: "sess-custom", title: "My Custom Title" });
    mockResults.select = { data: [row], error: null };

    const { result } = renderHook(() => useChatSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.updateMessages("sess-custom", () => [
        { id: "m1", role: "user", content: "New question" },
      ]);
    });

    const session = result.current.sessions.find((s) => s.id === "sess-custom");
    expect(session?.title).toBe("My Custom Title");
  });

  it("truncates the derived title to 50 chars", async () => {
    const row = makeRow({ id: "sess-long", title: "New Chat" });
    mockResults.select = { data: [row], error: null };

    const { result } = renderHook(() => useChatSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const longContent = "A".repeat(100);
    act(() => {
      result.current.updateMessages("sess-long", () => [
        { id: "m1", role: "user", content: longContent },
      ]);
    });

    const session = result.current.sessions.find((s) => s.id === "sess-long");
    expect(session?.title).toHaveLength(50);
  });
});

describe("useChatSessions — selectChat", () => {
  it("changes the active chat id", async () => {
    const rows = [
      makeRow({ id: "s1" }),
      makeRow({ id: "s2" }),
    ];
    mockResults.select = { data: rows, error: null };

    const { result } = renderHook(() => useChatSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.activeChatId).toBe("s1");

    act(() => {
      result.current.selectChat("s2");
    });

    expect(result.current.activeChatId).toBe("s2");
  });
});
