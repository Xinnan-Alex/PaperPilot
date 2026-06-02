# Markdown Rendering for Assistant Messages

**Date:** 2026-06-02
**Status:** Approved

## Overview

Add markdown rendering to assistant reply bubbles in `ChatBox`. Currently text renders as plain `whitespace-pre-wrap`. Goal: render headings, bold/italic, code blocks, lists, and tables while preserving inline citation marks `[1]`, `[2]` that link to source chunks.

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/lib/remarkCitations.ts` | New — remark plugin (~25 lines) |
| `frontend/src/components/MarkdownContent.tsx` | New — ReactMarkdown wrapper with citation support |
| `frontend/src/components/ChatBox.tsx` | Replace `renderContext(...)` divs with `<MarkdownContent>` |

**Dependencies to install:** `react-markdown`, `remark-gfm`, `unist-util-visit`

## Architecture

### remarkCitations plugin (`src/lib/remarkCitations.ts`)

Remark plugin that walks the mdast. For every `text` node containing `[N]` patterns:

1. Split node value on `/(\[\d+\])/g`
2. Replace the single text node with a sequence of plain `text` nodes and custom `citationMarker` nodes
3. `citationMarker` nodes use `data.hName = 'citation-marker'` and `data.hProperties = { n: String(index) }` — the remark-rehype bridge that avoids needing `rehype-raw`

No raw HTML injection. No XSS surface.

### MarkdownContent component (`src/components/MarkdownContent.tsx`)

Props:
```typescript
interface MarkdownContentProps {
  text: string;
  sources?: SSESource[];
  onCitationClick: (chunkId: string) => void;
}
```

Renders `<ReactMarkdown>` with:
- `remarkPlugins={[remarkGfm, remarkCitations]}`
- `prose prose-sm dark:prose-invert max-w-none` classes
- Custom `components` prop with `'citation-marker'` entry that reads `node.properties.n`, looks up `sources[n]`, and renders `<CitationMark index={n} onClick={() => onCitationClick(sources[n].chunk_id)} />`
- Missing citation index (out-of-range or no sources) renders nothing silently

Works during streaming — react-markdown handles incomplete markdown gracefully (unclosed bold/code renders as plain text until closing delimiter arrives).

### ChatBox changes (`src/components/ChatBox.tsx`)

- Delete `renderContext` function
- Replace both assistant text render sites (parts loop at ~line 411, fallback at ~line 425) with `<MarkdownContent text={...} sources={msg.sources} onCitationClick={handleSourceClick} />`
- Remove `whitespace-pre-wrap` class from those divs (markdown renderer handles line breaks)

## Data Flow

```
LLM token stream
  → appendText() builds msg.parts[].text
  → MarkdownContent receives text + sources
  → ReactMarkdown parses markdown AST
  → remarkCitations splits [N] text nodes into citationMarker nodes
  → remark-rehype converts to hast (citation-marker element)
  → citation-marker component renders CitationMark
  → CitationMark onClick → handleSourceClick(chunkId) → scroll highlight
```

## Error Handling

- `citation-marker` component: if `sources` is undefined or index is out of range, render `null` silently
- react-markdown: incomplete markdown during streaming renders gracefully as plain text

## Out of Scope

- User message bubbles (plain text only, no markdown)
- Syntax highlighting for code blocks (can be added later with `rehype-highlight`)
