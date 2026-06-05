import { Streamdown } from "streamdown";
import remarkCitations from "@/lib/remarkCitations";
import type { SSESource } from "@/lib/api";

function normalizeMarkdown(text: string): string {
  return (
    text
      // newline before list-item dash directly following sentence text
      // e.g. "system- CNN" → "system\n- CNN", "uses:- Item" → "uses:\n- Item"
      .replace(/([a-z.)0-9:])- ([A-Z*])/g, "$1\n- $2")
      // blank line before ordered-list numbers directly following sentence text
      // e.g. "streets).2. Many" → "streets).\n\n2. Many"
      .replace(/([a-z.)0-9])(\d+\. )/g, "$1\n\n$2")
      // blank line between **Bold label** and word/digit content directly following
      .replace(/(\*\*[^*\n]+\*\*)\n?([A-Z][a-z]|\d)/g, "$1\n\n$2")
      // join "- **\nWord" → "- **Word" (LLM-emitted line break inside list-item bold opener)
      .replace(/(^|\n)- \*\*\n(?=[A-Z])/g, "$1- **")
  );
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
      type="button"
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
    <div className="text-sm leading-relaxed">
      <Streamdown
        parseIncompleteMarkdown
        remarkPlugins={[remarkCitations]}
        allowedTags={{ "citation-marker": ["n"] }}
        components={
          {
            "citation-marker": ({ n }: { n?: string }) => {
              const index = Number(n);
              if (isNaN(index) || !sources || !sources[index]) return null;
              const src = sources[index];
              return (
                <CitationMark
                  index={index}
                  onClick={() => onCitationClick(src.chunk_id)}
                />
              );
            },
          } as Record<string, React.ComponentType<{ n?: string }>>
        }
      >
        {normalizeMarkdown(text)}
      </Streamdown>
    </div>
  );
}
