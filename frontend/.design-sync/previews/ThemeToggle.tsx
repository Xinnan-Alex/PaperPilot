import { ThemeToggle, BrandMark } from "paperpilot";

// The toggle as it sits in the app-chrome header — a quiet ghost icon button
// that swaps the sun/moon glyph with the active theme.
export function InHeader() {
  return (
    <div className="flex w-80 items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
      <div className="flex items-center gap-2">
        <BrandMark className="h-7 w-7" />
        <span className="text-sm font-semibold tracking-tight">PaperPilot</span>
      </div>
      <ThemeToggle />
    </div>
  );
}
