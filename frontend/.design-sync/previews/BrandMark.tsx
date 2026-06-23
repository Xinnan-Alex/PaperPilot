import { BrandMark } from "paperpilot";

// The mark at the sizes it appears across the app.
export function Sizes() {
  return (
    <div className="flex items-end gap-4">
      <BrandMark className="h-8 w-8" />
      <BrandMark className="h-10 w-10" />
      <BrandMark className="h-14 w-14" />
    </div>
  );
}

// How the mark pairs with the wordmark in the sidebar header.
export function WithWordmark() {
  return (
    <div className="flex items-center gap-2">
      <BrandMark className="h-8 w-8" />
      <span className="text-lg font-semibold tracking-tight">PaperPilot</span>
    </div>
  );
}
