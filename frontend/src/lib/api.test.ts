import { describe, it, expect } from "vitest";
import { parseSSEStream } from "./api";
import type { StreamEvent } from "./api";

// Helpers to build a fake Response whose body is a readable stream of chunks.

function makeReader(chunks: Uint8Array[]): ReadableStreamDefaultReader<Uint8Array> {
  let idx = 0;
  return {
    async read() {
      if (idx >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[idx++] };
    },
    releaseLock() {},
    cancel() { return Promise.resolve(); },
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

function makeResponse(chunks: Uint8Array[]): Response {
  return {
    body: {
      getReader: () => makeReader(chunks),
    },
  } as unknown as Response;
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

async function collect(res: Response): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const ev of parseSSEStream(res)) {
    events.push(ev);
  }
  return events;
}

describe("parseSSEStream", () => {
  it("yields a token event from a JSON-string payload", async () => {
    const raw = `event: token\ndata: "hello"\n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "token", data: "hello" }]);
  });

  it("yields multiple token events", async () => {
    const raw = `event: token\ndata: "foo"\n\nevent: token\ndata: "bar"\n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([
      { type: "token", data: "foo" },
      { type: "token", data: "bar" },
    ]);
  });

  it("flushes a trailing data line that has no final newline", async () => {
    // Stream closes mid-line without a terminating \n — the last event must
    // still be emitted, not dropped.
    const raw = `event: token\ndata: "tail"`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "token", data: "tail" }]);
  });

  it("yields a sources event as a parsed array", async () => {
    const sources = [
      {
        chunk_id: "c1",
        document_id: "d1",
        ordinal: 0,
        page: 1,
        text: "hello",
      },
    ];
    const raw = `event: sources\ndata: ${JSON.stringify(sources)}\n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "sources", data: sources }]);
  });

  it("yields a tool_call event", async () => {
    const payload = { id: "tc1", name: "search_documents", args: { query: "foo" } };
    const raw = `event: tool_call\ndata: ${JSON.stringify(payload)}\n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "tool_call", data: payload }]);
  });

  it("yields a tool_result event", async () => {
    const payload = { id: "tc1", result: { hits: [] } };
    const raw = `event: tool_result\ndata: ${JSON.stringify(payload)}\n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "tool_result", data: payload }]);
  });

  it("yields a done event", async () => {
    const raw = `event: done\ndata: \n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "done" }]);
  });

  it("handles an event split across two reader chunks", async () => {
    // "hello" is split: first chunk ends mid-JSON string
    const chunk1 = enc(`event: token\ndata: "hel`);
    const chunk2 = enc(`lo"\n\n`);
    const events = await collect(makeResponse([chunk1, chunk2]));
    expect(events).toEqual([{ type: "token", data: "hello" }]);
  });

  it("handles \\r\\n line endings", async () => {
    const raw = `event: token\r\ndata: "world"\r\n\r\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "token", data: "world" }]);
  });

  it("handles \\r line endings", async () => {
    const raw = `event: token\rdata: "cr"\r\r`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "token", data: "cr" }]);
  });

  it("handles event: with NO space after colon", async () => {
    const raw = `event:token\ndata:"nospace"\n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    // data: also has no space — should still parse
    expect(events).toEqual([{ type: "token", data: "nospace" }]);
  });

  it("ignores comment lines (starting with :)", async () => {
    const raw = `: this is a comment\nevent: token\ndata: "ok"\n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "token", data: "ok" }]);
  });

  it("ignores blank lines without crashing", async () => {
    const raw = `\n\nevent: token\ndata: "after blanks"\n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "token", data: "after blanks" }]);
  });

  it("skips a malformed sources payload and does NOT throw", async () => {
    const raw =
      `event: sources\ndata: NOT_JSON\n\n` +
      `event: token\ndata: "after bad"\n\n`;
    // Should not throw, and the token after the bad line should still yield.
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "token", data: "after bad" }]);
  });

  it("skips a malformed tool_call payload and does NOT throw", async () => {
    const raw =
      `event: tool_call\ndata: {bad json\n\n` +
      `event: token\ndata: "still here"\n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "token", data: "still here" }]);
  });

  it("skips a malformed tool_result payload and does NOT throw", async () => {
    const raw =
      `event: tool_result\ndata: <<<\n\n` +
      `event: done\ndata: \n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "done" }]);
  });

  it("falls back to raw string for a malformed token payload", async () => {
    // token events already had a try/catch that falls back to the raw string
    const raw = `event: token\ndata: {unterminated\n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toEqual([{ type: "token", data: "{unterminated" }]);
  });

  it("handles multiple events in a single chunk across types", async () => {
    const sources = [{ chunk_id: "c2", document_id: "d2", ordinal: 0, page: null, text: "x" }];
    const raw =
      `event: token\ndata: "first"\n\n` +
      `event: sources\ndata: ${JSON.stringify(sources)}\n\n` +
      `event: done\ndata: \n\n`;
    const events = await collect(makeResponse([enc(raw)]));
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "token", data: "first" });
    expect(events[1]).toEqual({ type: "sources", data: sources });
    expect(events[2]).toEqual({ type: "done" });
  });

  it("throws when response has no body", async () => {
    const noBody = { body: null } as unknown as Response;
    await expect(collect(noBody)).rejects.toThrow("No response body");
  });
});
