import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";

type ThemeName = "light" | "dark";

type ViewTransitionHandle = {
  ready: Promise<void>;
  finished: Promise<void>;
};
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionHandle;
};

/**
 * Shared theme toggle behaviour for both the marketing (Login) and app-chrome
 * (Sidebar) theme switches. Wraps next-themes with a circular clip-path reveal
 * via the View Transitions API, falling back to an animated overlay when the
 * browser lacks `startViewTransition`. Honours `prefers-reduced-motion`.
 *
 * Low-level pieces (`isDark`, `revealTheme`, `applyTheme`) are exposed so the
 * landing flourish (1s pre-delay + wiggle) can compose them; most callers want
 * the high-level `toggleFromElement`.
 */
export function useThemeTransition() {
  const { resolvedTheme, setTheme } = useTheme();
  const animationsRef = useRef<Animation[]>([]);
  const [animating, setAnimating] = useState(false);
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    return () => {
      animationsRef.current.forEach((animation) => animation.cancel());
      animationsRef.current = [];
    };
  }, []);

  const applyTheme = useCallback(
    (nextTheme: ThemeName) => {
      document.documentElement.classList.toggle("dark", nextTheme === "dark");
      document.documentElement.style.colorScheme = nextTheme;
      setTheme(nextTheme);
    },
    [setTheme],
  );

  const revealTheme = useCallback(
    async (x: number, y: number, nextTheme: ThemeName) => {
      const maxX = Math.max(x, window.innerWidth - x);
      const maxY = Math.max(y, window.innerHeight - y);
      const radius = Math.hypot(maxX, maxY);
      const clipPath = [
        `circle(0px at ${x}px ${y}px)`,
        `circle(${radius}px at ${x}px ${y}px)`,
      ];
      const documentWithTransition = document as ViewTransitionDocument;

      if (documentWithTransition.startViewTransition) {
        const transition = documentWithTransition.startViewTransition(() =>
          applyTheme(nextTheme),
        );
        await transition.ready.catch(() => undefined);
        const animation = document.documentElement.animate(
          { clipPath },
          {
            duration: 720,
            easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
            pseudoElement: "::view-transition-new(root)",
          } as KeyframeAnimationOptions,
        );
        animationsRef.current.push(animation);
        await animation.finished.catch(() => undefined);
        await transition.finished.catch(() => undefined);
        return;
      }

      const overlay = document.createElement("div");
      overlay.setAttribute("aria-hidden", "true");
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "50",
        pointerEvents: "none",
        background: nextTheme === "dark" ? "#191919" : "#ffffff",
        clipPath: clipPath[0],
      });
      document.body.appendChild(overlay);
      const animation = overlay.animate(
        { clipPath },
        {
          duration: 720,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          fill: "forwards",
        },
      );
      animationsRef.current.push(animation);
      await animation.finished.catch(() => undefined);
      applyTheme(nextTheme);
      overlay.remove();
    },
    [applyTheme],
  );

  /** Toggle the theme, expanding the reveal from the centre of `el`. */
  const toggleFromElement = useCallback(
    (el: HTMLElement | null) => {
      if (animating) return;
      const nextTheme: ThemeName = isDark ? "light" : "dark";

      if (
        !el ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        applyTheme(nextTheme);
        return;
      }

      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      setAnimating(true);
      void revealTheme(cx, cy, nextTheme).finally(() => setAnimating(false));
    },
    [animating, applyTheme, isDark, revealTheme],
  );

  return { isDark, animating, setAnimating, applyTheme, revealTheme, toggleFromElement };
}
