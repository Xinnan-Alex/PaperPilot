import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrandMarkProps {
  /** Sizing utilities for the square (e.g. "h-8 w-8"). */
  className?: string;
  /** Override the plane icon size (defaults to half the square). */
  iconClassName?: string;
  /**
   * Use the marketing `.landing` colour vars instead of app-chrome tokens.
   * The logged-out landing page lives in its own colour layer.
   */
  landing?: boolean;
}

/**
 * The single PaperPilot logo mark: a paper plane in a rounded square. Reused
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
      <Send className={cn("h-1/2 w-1/2", iconClassName)} />
    </div>
  );
}
