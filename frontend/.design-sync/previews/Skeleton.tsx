import { Skeleton } from "paperpilot";

// Loading placeholder for the document list while it fetches.
export function DocumentList() {
  return (
    <div className="w-72 space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Shapes() {
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="h-12 w-12 rounded-full" />
      <Skeleton className="h-12 w-40 rounded-lg" />
      <Skeleton className="h-12 w-24 rounded-lg" />
    </div>
  );
}
