import { Loader2, Check, X, Wrench } from "lucide-react";

export interface ToolCallState {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  state: "running" | "done" | "error";
}

const TOOL_LABEL: Record<string, string> = {
  search_documents: "Searching documents",
  list_documents: "Listing documents",
  get_document_summary: "Summarizing document",
  web_search: "Searching the web",
};

function shortArg(args: Record<string, unknown>): string {
  if (typeof args.query === "string") return `"${args.query}"`;
  if (typeof args.document_id === "string") return args.document_id.slice(0, 8);
  return "";
}

export default function ToolCallBubble({ tool }: { tool: ToolCallState }) {
  const label = TOOL_LABEL[tool.name] ?? tool.name;
  const detail = shortArg(tool.args);

  return (
    <output
      className="my-2 inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs"
      aria-live="polite"
    >
      {tool.state === "running" ? (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      ) : tool.state === "error" ? (
        <X className="h-3 w-3 text-destructive" />
      ) : tool.state === "done" ? (
        <Check className="h-3 w-3 text-muted-foreground" />
      ) : (
        <Wrench className="h-3 w-3 text-muted-foreground" />
      )}
      <span className="text-muted-foreground">{label}</span>
      {detail && (
        <span className="max-w-[12rem] truncate text-foreground/80">
          {detail}
        </span>
      )}
    </output>
  );
}
