import { Badge } from "paperpilot";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

// All badge variants side by side.
export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="ghost">Ghost</Badge>
      <Badge variant="destructive">Destructive</Badge>
    </div>
  );
}

// Document ingest status chips, as shown in the upload panel.
export function DocumentStatus() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">
        <Loader2 className="animate-spin" /> Embedding
      </Badge>
      <Badge variant="outline">
        <CheckCircle2 /> ready
      </Badge>
      <Badge variant="destructive">
        <XCircle /> failed
      </Badge>
    </div>
  );
}
