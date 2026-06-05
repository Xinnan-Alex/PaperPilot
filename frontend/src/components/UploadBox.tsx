import { deleteDocument, ingestDocument, listDocuments, uploadDocument } from "@/lib/api";
import { CheckCircle2, FileText, Loader2, Trash2, Upload, XCircle } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

interface Doc {
  id: string;
  filename: string;
  status: string;
  stage?: string | null;
  error_detail?: string | null;
}

// Fine-grained ingest sub-step → friendly label shown while processing.
const STAGE_LABELS: Record<string, string> = {
  downloading: "Downloading",
  extracting: "Extracting text",
  chunking: "Chunking",
  embedding: "Embedding",
  storing: "Saving",
};

function statusLabel(doc: Doc): string {
  if (doc.status === "ready") return "ready";
  if (doc.status === "failed") return "failed";
  if (doc.stage && STAGE_LABELS[doc.stage]) return STAGE_LABELS[doc.stage];
  return doc.status;
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

interface UploadBoxProps {
  onDocDeleted?: (docId: string) => void;
  onDocsChanged?: () => void;
}

// Everything about the document list and the operations that mutate it
// (initial load, upload, delete, delete-confirmation) is one cohesive slice.
// dragOver is unrelated presentational state and stays its own useState.
interface DocState {
  docs: Doc[];
  loading: boolean;
  uploading: boolean;
  confirmDeleteId: string | null;
  deleting: string | null;
}

type DocAction =
  | { type: "docsLoaded"; docs: Doc[] }
  | { type: "loadFailed" }
  | { type: "uploadStart" }
  | { type: "uploadEnd" }
  | { type: "deleteStart"; id: string }
  | { type: "deleteEnd" }
  | { type: "toggleConfirm"; id: string }
  | { type: "clearConfirm" };

const initialDocState: DocState = {
  docs: [],
  loading: true,
  uploading: false,
  confirmDeleteId: null,
  deleting: null,
};

function docReducer(state: DocState, action: DocAction): DocState {
  switch (action.type) {
    case "docsLoaded":
      return { ...state, docs: action.docs, loading: false };
    case "loadFailed":
      return { ...state, loading: false };
    case "uploadStart":
      return { ...state, uploading: true };
    case "uploadEnd":
      return { ...state, uploading: false };
    case "deleteStart":
      return { ...state, deleting: action.id, confirmDeleteId: null };
    case "deleteEnd":
      return { ...state, deleting: null };
    case "toggleConfirm":
      return {
        ...state,
        confirmDeleteId:
          state.confirmDeleteId === action.id ? null : action.id,
      };
    case "clearConfirm":
      return { ...state, confirmDeleteId: null };
  }
}

export default function UploadBox({ onDocDeleted, onDocsChanged }: UploadBoxProps) {
  const [{ docs, loading, uploading, confirmDeleteId, deleting }, dispatch] =
    useReducer(docReducer, initialDocState);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const fetchDocs = useCallback(async () => {
    try {
      const data = await listDocuments();
      dispatch({ type: "docsLoaded", docs: data });
      onDocsChanged?.();
    } catch (err) {
      console.error("Failed to fetch documents:", err);
      toast.error("Failed to load documents");
      dispatch({ type: "loadFailed" });
    }
  }, [onDocsChanged]);

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

  const handleDelete = async (docId: string) => {
    dispatch({ type: "deleteStart", id: docId });
    try {
      await deleteDocument(docId);
      toast.success("Document permanently deleted");
      onDocDeleted?.(docId);
      await fetchDocs();
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    } finally {
      dispatch({ type: "deleteEnd" });
    }
  };

  const handleFile = async (file: File) => {
    const error = validateFile(file);
    if (error) {
      toast.error(error);
      return;
    }
    dispatch({ type: "uploadStart" });
    try {
      const { doc_id } = await uploadDocument(file);
      await ingestDocument(doc_id);
      toast.success(`Uploaded: ${file.name}`);
      await fetchDocs();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      dispatch({ type: "uploadEnd" });
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
          <>
            <ul className="space-y-1">
              {docs.map((doc) => (
                <li
                  key={doc.id}
                  className="rounded-lg border px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate flex-1">{doc.filename}</span>
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
                      {statusLabel(doc)}
                    </Badge>
                    {deleting === doc.id ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label="Delete document"
                        onClick={() =>
                          dispatch({ type: "toggleConfirm", id: doc.id })
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {doc.status === "failed" && doc.error_detail && (
                    <p className="mt-1.5 text-[10px] leading-tight text-destructive/90">
                      {doc.error_detail}
                    </p>
                  )}
                  {confirmDeleteId === doc.id && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-2 py-1.5">
                      <span className="text-[10px] text-destructive leading-tight">
                        Permanently delete? All data removed, no recovery.
                      </span>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-5 px-2 text-[10px]"
                          onClick={() => handleDelete(doc.id)}
                        >
                          Delete
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 px-2 text-[10px]"
                          onClick={() => dispatch({ type: "clearConfirm" })}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[10px] text-muted-foreground/60 text-center leading-tight px-1">
              Deleted documents are permanently removed — no file, text, or embeddings are retained.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
