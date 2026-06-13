import { useEffect, useState } from "react";

/**
 * Tracks whether the viewport is below Tailwind's `md` breakpoint (768px).
 * Used to mount mobile-only Radix dialogs *only* on mobile — an always-open
 * dialog would otherwise activate its overlay, focus trap, and scroll lock on
 * desktop even when its content is `md:hidden`.
 */
export function useIsMobile(query = "(max-width: 767px)"): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return isMobile;
}
