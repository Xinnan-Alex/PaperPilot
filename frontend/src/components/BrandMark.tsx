import { cn } from "@/lib/utils";

interface BrandMarkProps {
  /** Sizing utilities for the square (e.g. "h-8 w-8"). */
  className?: string;
  /** Override the nib glyph size (defaults to half the square). */
  iconClassName?: string;
  /**
   * Use the marketing `.landing` colour vars instead of app-chrome tokens.
   * The logged-out landing page lives in its own colour layer.
   */
  landing?: boolean;
}

/** Pen nib glyph: nib body (kite) + slit + vent hole. Inline so the logo has
 * no lucide dependency. Matches lucide's 24×24 / stroke-2 grid. Exported so
 * decorative uses (e.g. the landing flight-path mark) share one glyph. */
export function PaperPilotNib({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3 L18.5 13 L12 21 L5.5 13 Z" />
      <path d="M12 13.5 V21" />
      <circle cx="12" cy="10.5" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The single PaperPilot logo mark: a pen nib in a rounded square. Reused
 * everywhere the brand appears (sidebar, chat empty-state, landing header) so
 * the app has one identity instead of a P-square / ✈️ / Sun-Moon mix.
 */
export function BrandMark({ className, iconClassName, landing = false }: BrandMarkProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg",
        landing
          ? "bg-[color:var(--ink)] text-[color:var(--paper)]"
          : "bg-foreground text-background",
        className,
      )}
      aria-hidden
    >
      <PaperPilotNib className={cn("h-1/2 w-1/2", iconClassName)} />
    </div>
  );
}
