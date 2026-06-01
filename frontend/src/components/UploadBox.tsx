import { ingestDocument, listDocuments, uploadDocument } from "@/lib/api";
import { CheckCircle2, FileText, Loader2, Upload, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";

interface Doc {
  id: string;
  filename: string;
  status: string;
}

const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/html",
];

const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".html", ".htm"];

function validateFile(file: File): string | null {
  if (ALLOWED_TYPES.includes(file.type)) return null;
  const ext = "." + file.name.split(".").pop()?.toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext)) return null;
  return `Unsupported file type. Allowed: PDF, DOCX, TXT, MD, HTML.`;
}

export default function UploadBox() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const fetchDocs = useCallback(async () => {
    try {
      const data = await listDocuments();
      setDocs(data);
    } catch (err) {
      console.error("Failed to fetch documents:", err);
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  useEffect(() => {
    const hasActiveIngest = docs.some(
      (d) => d.status === "pending" || d.status == "processing",
    );
    if (hasActiveIngest) {
      pollRef.current = setInterval(fetchDocs, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [docs, fetchDocs]);

  const handleFile = async (file: File) => {
    const error = validateFile(file);
    if (error) {
      toast.error(error);
      return;
    }
    setUploading(true);
    try {
      const { doc_id } = await uploadDocument(file);
      await ingestDocument(doc_id);
      toast.success(`Uploaded: ${file.name}`);
      await fetchDocs();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-4 flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Documents</h2>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition-colors mb-4 ${
          dragOver
            ? "border-foreground bg-muted"
            : "border-muted-foreground/20 hover:border-muted-foreground/40"
        }`}
        role="button"
        tabIndex={0}
        aria-label="Upload a document"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Uploading...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Drop a file here, or click to browse
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              PDF, DOCX, TXT, MD
            </span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.html,.htm"
          className="hidden"
          aria-label="File upload"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : docs.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-4">
            No documents yet. Upload one to get started.
          </p>
        ) : (
          <ul className="space-y-1" role="list">
            {docs.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
              >
                <span className="truncate pr-2">{doc.filename}</span>
                <Badge
                  variant={
                    doc.status === "ready"
                      ? "default"
                      : doc.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                  className="text-[10px] shrink-0"
                >
                  {doc.status === "ready" ? (
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                  ) : doc.status === "failed" ? (
                    <XCircle className="mr-1 h-3 w-3" />
                  ) : (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  )}
                  {doc.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
