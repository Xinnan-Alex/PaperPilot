# Markdown Rendering for Assistant Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant reply text as markdown (bold, italic, headings, code blocks, lists) while preserving inline citation marks `[1]`, `[2]` that scroll to source chunks.

**Architecture:** A remark plugin splits `[N]` citation markers out of mdast text nodes into custom `citationMarker` nodes; `react-markdown` converts these to `<citation-marker>` hast elements; a custom component renderer turns them into interactive `CitationMark` buttons. `MarkdownContent` wraps all this; `ChatBox` swaps in the new component.

**Tech Stack:** `react-markdown` v9, `remark-gfm`, `unist-util-visit`, TypeScript, Tailwind v4, existing shadcn/ui

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `frontend/src/lib/remarkCitations.ts` | Remark plugin: split `[N]` text nodes into citation marker nodes |
| Create | `frontend/src/components/MarkdownContent.tsx` | ReactMarkdown wrapper + `CitationMark` sub-component |
| Modify | `frontend/src/components/ChatBox.tsx` | Remove `CitationMark` + `renderContext`; use `<MarkdownContent>` |

---

### Task 1: Install dependencies

**Files:**
- Modify: `frontend/package.json` (via pnpm)

- [ ] **Step 1: Install packages**

Run from `frontend/`:
```bash
pnpm add react-markdown remark-gfm unist-util-visit
```

Expected output: packages added to `dependencies` in `package.json`, lockfile updated.

- [ ] **Step 2: Verify TypeScript finds types**

```bash
pnpm build 2>&1 | head -20
```

Expected: build succeeds or only pre-existing errors (no "Cannot find module 'react-markdown'" errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "chore: add react-markdown, remark-gfm, unist-util-visit"
```

---

### Task 2: Create remarkCitations plugin

**Files:**
- Create: `frontend/src/lib/remarkCitations.ts`

- [ ] **Step 1: Create the plugin**

Create `frontend/src/lib/remarkCitations.ts`:

```typescript
import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Text } from "mdast";

const remarkCitations: Plugin<[], Root> = () => (tree) => {
  visit(tree, "text", (node: Text, index, parent) => {
    if (index == null || !parent) return;

    const parts = node.value.split(/(\[\d+\])/g);
    if (parts.length <= 1) return;

    const newNodes = parts
      .filter((p) => p !== "")
      .map((part) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (match) {
          return {
            type: "citationMarker" as const,
            data: {
              hName: "citation-marker",
              hProperties: { n: String(parseInt(match[1]) - 1) },
            },
          };
        }
        return { type: "text" as const, value: part };
      });

    parent.children.splice(index, 1, ...(newNodes as never[]));
  });
};

export default remarkCitations;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && pnpm build 2>&1 | grep -E "error|warning" | head -20
```

Expected: no new errors from `remarkCitations.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/remarkCitations.ts
git commit -m "feat: add remark plugin to extract citation markers from mdast"
```

---

### Task 3: Create MarkdownContent component

**Files:**
- Create: `frontend/src/components/MarkdownContent.tsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/MarkdownContent.tsx`:

```tsx
import type { ComponentType } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkCitations from "@/lib/remarkCitations";
import type { SSESource } from "@/lib/api";

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

interface MarkdownContentProps {
  text: string;
  sources?: SSESource[];
  onCitationClick: (chunkId: string) => void;
}

export default function MarkdownContent({
  text,
  sources,
  onCitationClick,
}: MarkdownContentProps) {
  return (
    <ReactMarkdown
      className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed"
      remarkPlugins={[remarkGfm, remarkCitations]}
      components={
        {
          "citation-marker": ({ node }: { node?: { properties?: { n?: unknown } } }) => {
            const n = Number(node?.properties?.n);
            if (!sources || !sources[n]) return null;
            return (
              <CitationMark
                index={n}
                onClick={() => onCitationClick(sources[n].chunk_id)}
              />
            );
          },
        } as Record<string, ComponentType<{ node?: { properties?: { n?: unknown } } }>>
      }
    >
      {text}
    </ReactMarkdown>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd frontend && pnpm build 2>&1 | grep -E "error" | head -20
```

Expected: no errors from `MarkdownContent.tsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MarkdownContent.tsx
git commit -m "feat: add MarkdownContent component with inline citation support"
```

---

### Task 4: Wire MarkdownContent into ChatBox

**Files:**
- Modify: `frontend/src/components/ChatBox.tsx`

- [ ] **Step 1: Add import, remove CitationMark and renderContext**

In `frontend/src/components/ChatBox.tsx`:

**Add** this import near the top (after the existing imports):
```tsx
import MarkdownContent from "./MarkdownContent";
```

**Delete** the entire `CitationMark` component (lines 34–50):
```tsx
// DELETE this entire block:
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
```

**Delete** the entire `renderContext` function (~lines 295–315):
```tsx
// DELETE this entire block:
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
```

- [ ] **Step 2: Replace first render site (parts loop)**

Find this block (~line 407):
```tsx
part.type === "text" ? (
  <div
    key={idx}
    className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed"
  >
    {renderContext(part.text, msg.sources)}
  </div>
) : (
```

Replace with:
```tsx
part.type === "text" ? (
  <MarkdownContent
    key={idx}
    text={part.text}
    sources={msg.sources}
    onCitationClick={handleSourceClick}
  />
) : (
```

- [ ] **Step 3: Replace second render site (fallback content)**

Find this block (~line 424):
```tsx
) : msg.content ? (
  <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">
    {renderContext(msg.content, msg.sources)}
  </div>
) : (
```

Replace with:
```tsx
) : msg.content ? (
  <MarkdownContent
    text={msg.content}
    sources={msg.sources}
    onCitationClick={handleSourceClick}
  />
) : (
```

- [ ] **Step 4: Verify build passes**

```bash
cd frontend && pnpm build 2>&1 | grep -E "error" | head -30
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatBox.tsx
git commit -m "feat: render assistant messages as markdown with inline citations"
```

---

### Task 5: Manual verification

**Files:** none (read-only verification)

- [ ] **Step 1: Start dev server**

```bash
cd frontend && pnpm dev
```

Open `http://localhost:5173` in a browser.

- [ ] **Step 2: Test markdown rendering**

Send a message and confirm the assistant response renders:
- `**bold**` → bold text
- `*italic*` → italic text
- `` `code` `` → inline code
- ` ```\ncode block\n``` ` → fenced code block
- `- item` / `1. item` → lists
- `# Heading` → heading

- [ ] **Step 3: Test citation marks**

With a document attached, send a question that returns citations. Confirm:
- `[1]`, `[2]` render as clickable badge buttons inside the markdown text
- Clicking a badge scrolls and highlights the corresponding source card
- Citations inside bold or list items work correctly (e.g., `**answer [1]**`)

- [ ] **Step 4: Test streaming**

Confirm text streams in progressively without flicker; incomplete markdown (e.g., unclosed `**`) renders as plain text and resolves once the closing delimiter arrives.
