# Login Page Theme Toggle — Design Spec

## Summary

Replace the static Send icon in the login page's top-left logo square with a clickable theme toggle that animates a backflip + full-viewport circular ripple reveal when switching between light and dark mode.

## Motivation

The login page currently has no way to preview or toggle the app's dark/light theme. Users logging in at night see a bright white page with no way to switch. Adding a playful, branded toggle here also gives first-time visitors a taste of the app's attention to detail.

## Design

### Placement

The existing header structure stays the same — `<header>` with flexbox `justify-between`. The left logo group:

```
[ Send icon square ]  PaperPilot
```

The Send icon square becomes `<ThemeIcon>` — a `<button>` (for accessibility) that retains the same visual styling (`rounded-lg bg-[color:var(--btn)] text-[color:var(--btn-ink)] shadow-sm` grid h-9 w-9 place-items-center). The "PaperPilot" text beside it is unchanged.

### States

| State | Icon | Behavior |
|-------|------|----------|
| Light mode | Sun (`lucide-react` `Sun`) | Click → animate to dark |
| Dark mode | Moon (`lucide-react` `Moon`) | Click → animate to light |

The icon swaps mid-flip (at 180° rotation) so the user sees the new icon as it rights itself.

### Click animation sequence

1. **Trigger:** User clicks the square.
2. **Backflip:** The icon element animates `rotateX(360deg)` over ~500ms with a cubic-bezier easing (fast start, overshoot slightly, settle). At 180° (250ms) the icon component swaps from Sun→Moon or Moon→Sun.
3. **Ripple start:** At ~150ms (icon is mid-air), a full-viewport overlay `<div>` is injected as a child of `body`, positioned absolutely. It starts with:
   - `clip-path: circle(0% at <iconXpx> <iconYpx>)`
   - `background: var(--paper)` to match the landing page background
   - `transition: clip-path 600ms cubic-bezier(0.2, 0.8, 0.3, 1)`
4. **Theme swap:** At ~350ms (~40% of the ripple's visual progress), the component calls `setTheme()` from `next-themes`. The `.dark` class toggles on `<html>`, all CSS custom properties swap. The ripple overlay now "reveals" the new theme underneath.
5. **Ripple end:** The overlay expands to `circle(150% at <iconXpx> <iconYpx>)` (well past the viewport corners). After transition ends, the overlay is removed from the DOM.

### Visual details

- **Backflip:** Rotation is around the X axis (a gymnastic backflip, not a spinner). The icon is given `backface-visibility: hidden` for clean rendering.
- **Ripple:** The overlay uses the landing page's `--paper` var so it matches the page background. In the dark theme, `--paper` is `#191919`; in light, `#ffffff`. The ripple across the dark/light boundary is seamless because the overlay color matches the *source* theme, and as it expands, the *destination* theme is revealed outside it.
- **Easing:** Backflip uses `cubic-bezier(0.34, 1.56, 0.64, 1)` (spring-like overshoot). Ripple uses `cubic-bezier(0.2, 0.8, 0.3, 1)` (smooth, natural).
- **Duration:** Total animation ~650ms. Backflip ~500ms, ripple ~600ms (overlapping).

### Edge cases

- **Rapid clicks:** While the animation runs, clicks are ignored (a `disabled` or `animating` ref state). After animation completes, the toggle is re-enabled.
- **Reduced motion:** If the user prefers `prefers-reduced-motion`, skip all animation and toggle immediately (respect `window.matchMedia("(prefers-reduced-motion: reduce)")`).
- **Icon square on mobile:** Same behavior; the ripple origin tracks the icon's `getBoundingClientRect()` so it works at any viewport size.

## Implementation

### Files touched

- `frontend/src/pages/Login.tsx` — Replace the static logo square with `<ThemeIcon>` component; import `useTheme` from `next-themes`; add ripple overlay logic.
- `frontend/src/index.css` — Add `@keyframes` for the backflip rotation and any new utility classes for the ripple.
- `frontend/src/components/ThemeToggle.tsx` — No changes (it's the app-chrome toggle, stays as-is).

### New code

A small `<ThemeIcon>` component (approx 40 lines) inside `Login.tsx` containing:
- The `useTheme()` hook
- `useRef` for the icon element (to get position for ripple origin)
- `useState` for `animating` flag
- Click handler: computes `getBoundingClientRect()`, starts flip + ripple, calls `setTheme()` at the midpoint
- Render: a `<button>` with the `backflip` CSS class driving the animation

The ripple overlay is a separate `<div>` rendered as a portal child of `document.body` during animation, tracking the icon's coordinates.

### No external dependencies

Everything uses `next-themes` (already installed), `lucide-react` (already installed) `Sun` and `Moon` icons, and CSS animations/clip-path.

## Open questions

None.

## Future considerations

- If the sidebar `ThemeToggle` in `AppPage.tsx` is later updated to use the same flip+ripple animation, the `<ThemeIcon>` component can be extracted to `src/components/`.
- Could be extended with `localStorage` persistence for the "never animate again" preference.
