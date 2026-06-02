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
    <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
      <ReactMarkdown
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
    </div>
  );
}
