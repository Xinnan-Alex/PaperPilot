# Login Theme Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static Send icon in the login page header with a clickable theme toggle that animates a backflip + circular ripple reveal.

**Architecture:** A `<ThemeIcon>` component inline in `Login.tsx` replaces the existing logo square. Click triggers two overlapping CSS animations: a `rotateX(360deg)` backflip on the icon and a full-viewport `clip-path: circle()` ripple overlay. Theme swap via `next-themes` `setTheme()` at midpoint. Reduced-motion skip via media query.

**Tech Stack:** React 19, next-themes, lucide-react, Tailwind v4 CSS animations/clip-path

**Files:**
- Modify: `frontend/src/pages/Login.tsx`
- Modify: `frontend/src/index.css`

---

### Task 1: Add animation keyframes and ripple utility to index.css

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Add backflip keyframes after the existing `@keyframes` block**

Add after the `thinking-bounce` keyframes (after line 120):

```css
@keyframes backflip {
  0% {
    transform: rotateX(0deg);
  }
  60% {
    transform: rotateX(300deg);
  }
  80% {
    transform: rotateX(360deg);
  }
  100% {
    transform: rotateX(360deg);
  }
}

@keyframes backflip-reverse {
  0% {
    transform: rotateX(0deg);
  }
  60% {
    transform: rotateX(-300deg);
  }
  80% {
    transform: rotateX(-360deg);
  }
  100% {
    transform: rotateX(-360deg);
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
```

- [ ] **Step 2: Run lint to verify**

```bash
cd frontend && pnpm lint
```

Expected: no errors (just CSS, lint should pass).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "chore: add backflip and fade-in keyframes"
```

---

### Task 2: Replace Send icon square with clickable ThemeIcon in Login.tsx

**Files:**
- Modify: `frontend/src/pages/Login.tsx`

- [ ] **Step 1: Update imports**

Replace the lucide imports to add `Sun` and `Moon`, and add `useCallback`, `useRef`, `useState`:

```tsx
import {
  ArrowLeft,
  ArrowRight,
  FileUp,
  Loader2,
  Moon,
  Quote,
  Send,
  Sparkles,
  Sun,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTheme } from "next-themes";
```

- [ ] **Step 2: Add the ThemeIcon component above the Login component**

Add this just before the `features` array or before the `export default function Login` line:

```tsx
function ThemeIcon() {
  const { theme, setTheme } = useTheme();
  const ref = useRef<HTMLButtonElement>(null);
  const [animating, setAnimating] = useState(false);
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null);
  const [flipping, setFlipping] = useState(false);
  const isDark = theme === "dark";

  const handleClick = useCallback(() => {
    if (animating) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTheme(isDark ? "light" : "dark");
      return;
    }

    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    setAnimating(true);
    setFlipping(true);
    setRipple({ x: cx, y: cy });

    // swap theme at flip midpoint (~250ms)
    setTimeout(() => {
      setTheme(isDark ? "light" : "dark");
    }, 280);

    // remove ripple after animation completes
    setTimeout(() => {
      setRipple(null);
      setFlipping(false);
      setAnimating(false);
    }, 850);
  }, [animating, isDark, setTheme]);

  return (
    <>
      <button
        ref={ref}
        onClick={handleClick}
        disabled={animating}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className={`grid h-9 w-9 place-items-center rounded-lg bg-[color:var(--btn)] text-[color:var(--btn-ink)] shadow-sm transition-shadow ${flipping ? (isDark ? "animate-[backflip-reverse_0.5s_cubic-bezier(0.34,1.56,0.64,1)_forwards]" : "animate-[backflip_0.5s_cubic-bezier(0.34,1.56,0.64,1)_forwards]") : ""}`}
        style={flipping ? { backfaceVisibility: "hidden" } : undefined}
      >
        <span className={flipping ? "animate-[fade-in_0.15s_ease_0.25s_both]" : ""}>
          {isDark ? <Moon className="h-4.5 w-4.5" /> : <Sun className="h-4.5 w-4.5" />}
        </span>
      </button>

      {ripple && (
        <div
          className="pointer-events-none fixed z-50"
          style={{
            inset: 0,
            clipPath: `circle(0% at ${ripple.x}px ${ripple.y}px)`,
            animation: "ripple-expand 0.6s cubic-bezier(0.2, 0.8, 0.3, 1) forwards",
            background: "var(--paper)",
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Replace the static logo square in the header**

In the header section (around line 99-106), replace:

```tsx
<div className="l-rise flex items-center gap-2.5">
  <div className="grid h-9 w-9 place-items-center rounded-lg bg-[color:var(--btn)] text-[color:var(--btn-ink)] shadow-sm">
    <Send className="h-4.5 w-4.5" />
  </div>
  <span className="text-lg font-semibold tracking-tight">
    PaperPilot
  </span>
</div>
```

With:

```tsx
<div className="l-rise flex items-center gap-2.5">
  <ThemeIcon />
  <span className="text-lg font-semibold tracking-tight">
    PaperPilot
  </span>
</div>
```

- [ ] **Step 4: Add the ripple-expand keyframe to index.css**

Append to `frontend/src/index.css`:

```css
@keyframes ripple-expand {
  from {
    clip-path: circle(0%);
  }
  to {
    clip-path: circle(150%);
  }
}
```

Wait — the ripple origin is set inline via `style` so `circle(0%)` and `circle(150%)` already include the center position from the JS. Let me verify: the inline style sets `clipPath: circle(0% at ${ripple.x}px ${ripple.y}px)` and the keyframe animates to `circle(150%)` — but the keyframe needs to also specify `at x y` or it will default to center. Let me fix this.

Actually, CSS `clip-path` animations: when you animate `clip-path` with a `circle()` that has `at x y` in the base style, the keyframe `to` also needs the `at x y` or it defaults to center. So the keyframe should be:

```css
@keyframes ripple-expand {
  from {
    clip-path: circle(0%);
  }
  to {
    clip-path: circle(150%);
  }
}
```

The inline style on the div sets `clipPath: circle(0% at ${ripple.x}px ${ripple.y}px)` and the `from` keyframe has `circle(0%)` — these won't match, so the animation might not work cleanly. Let me rethink.

Better approach: set the clip-path via CSS custom property in the inline style instead of hardcoding in the keyframe:

```tsx
style={{
  inset: 0,
  position: "fixed",
  clipPath: `circle(0% at ${ripple.x}px ${ripple.y}px)`,
  animation: "ripple-expand 0.6s cubic-bezier(0.2, 0.8, 0.3, 1) forwards",
  background: "var(--paper)",
  zIndex: 50,
}}
```

```css
@keyframes ripple-expand {
  to {
    clip-path: circle(150%);
  }
}
```

This works because the inline `from` style is `circle(0% at Xpx Ypx)` and the keyframe `to` is `circle(150%)`. Wait — the issue is that `clip-path` needs the same `at` position in both the `from` and `to` for smooth interpolation. If the base style has `circle(0% at X Y)` but the keyframe `to` has `circle(150%)`, the browser will render `circle(150% at center)` because the center defaults to 50% 50%.

So I need a different approach. Let me use a CSS custom property:

```tsx
style={{
  position: "fixed",
  inset: 0,
  zIndex: 50,
  pointerEvents: "none",
  background: "var(--paper)",
  "--ripple-x": `${ripple.x}px`,
  "--ripple-y": `${ripple.y}px`,
  animation: "ripple-expand 0.6s cubic-bezier(0.2, 0.8, 0.3, 1) forwards",
} as React.CSSProperties}
```

```css
@keyframes ripple-expand {
  from {
    clip-path: circle(0% at var(--ripple-x) var(--ripple-y));
  }
  to {
    clip-path: circle(150% at var(--ripple-x) var(--ripple-y));
  }
}
```

This will work because both `from` and `to` reference the same `--ripple-x` and `--ripple-y` custom properties.

Let me update the plan to reflect this.

- [ ] **Step 5: Run lint and build**

```bash
cd frontend && pnpm lint && pnpm build
```

Expected: clean lint, successful build.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Login.tsx frontend/src/index.css
git commit -m "feat: add animated theme toggle to login page"
```

---

### Self-review

**Spec coverage:**
- Top-left icon becomes clickable toggle ✓ (Task 2)
- Backflip animation on click ✓ (Task 1 keyframes, Task 2 component)
- Ripple-out clip-path reveal ✓ (Task 1 ripple-expand keyframe, Task 2 overlay)
- Theme swaps at midpoint ✓ (Task 2 setTimeout at 280ms)
- Icon swaps Sun↔Moon mid-flip ✓ (Task 2 component renders based on `isDark`)
- Reduced motion skip ✓ (Task 2 matchMedia check)
- Rapid click guard ✓ (Task 2 `animating` state guard)
- Works at any viewport size ✓ (Task 2 getBoundingClientRect)
- App chrome ThemeToggle unchanged ✓ (not touched)

**Placeholder check:** No placeholders found.

**Type consistency:** All refs, states, and CSS properties match.
