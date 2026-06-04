---
name: frontend-design-system
description: Use when creating or editing ANY frontend component, page, or UI in PaperPilot's React/Vite frontend (anything under frontend/src/). Enforces the monochrome, Notion-style note-app design system — semantic tokens, fonts, shadcn primitives, shadows, motion — so every new component and page stays visually consistent. Trigger on new components, new pages, restyling, or layout work.
---

# PaperPilot Frontend Design System

One aesthetic, no exceptions: **monochrome, Notion-style note app.** Calm, refined, lots of whitespace. Black / white / gray only. New UI must look like it already shipped.

## The one rule

**No chromatic accent colors.** No coral, blue, purple, gradients-on-white "AI slop." Hierarchy comes from weight, size, spacing, and gray steps — not hue.

Documented exceptions (only these):
- Third-party **brand marks** keep their brand color (e.g. Google's multicolor `G` on the OAuth button). GitHub mark stays mono.
- `--color-destructive` (red) for genuine destructive/error states only.

If you think a feature needs a color to pop, you're wrong for this app — use contrast and space instead.

## Two surface layers

| Layer | Where | Styling source |
|-------|-------|----------------|
| **App chrome** | `pages/AppPage.tsx`, `Sidebar`, `ChatBox`, dialogs, everything inside the authed app | shadcn semantic tokens from the `@theme` block in `src/index.css` |
| **Marketing / auth** | `pages/Login.tsx` (logged-out landing) and any future marketing page | the `.landing` scope + `l-*` helper classes in `src/index.css` |

Pick the layer that matches what you're building. Don't mix `l-*` helpers into app chrome, and don't hardcode landing colors into shadcn components.

### App chrome — use semantic tokens, never raw hex

Style with the token utilities, so light/dark and future retheming Just Work:

- Surfaces: `bg-background`, `bg-card`, `bg-popover`, `bg-muted`, `bg-secondary`, `bg-sidebar-background`
- Text: `text-foreground`, `text-muted-foreground`, `text-primary-foreground`
- Primary action: `bg-primary text-primary-foreground`
- Lines: `border-border`, `border-input`, focus `ring-ring`
- Note: the `accent` token is a **neutral gray**, not a color — `bg-accent`/`text-accent-foreground` are fine.

Never write `bg-[#fff]`, `text-black`, `bg-white`, or a hardcoded gray. If a token doesn't exist for what you need, that's a signal to add one to `@theme`, not to inline a hex.

### Marketing / auth — the `.landing` scope

Wrap the page in `<div className="landing ...">`. Inside it these vars + helpers are available (all defined in `src/index.css`):

| Helper | Purpose |
|--------|---------|
| `l-display` | Fraunces serif headline (marketing only) |
| `l-serif` | Fraunces italic, for an emphasized word |
| `l-mark` | flat light-gray highlight block behind a word (Notion text-highlight look) |
| `l-muted` | muted text color |
| `l-cta` | primary near-black button, soft shadow + lift on hover |
| `l-surface` | secondary card/pill/button: hairline border, subtle gray hover |
| `l-rise` | staggered entrance (set `--d` delay inline) |
| `l-pop` | smaller pop-in for revealed elements |
| `l-plane` / `l-flight` | the paper-plane + dashed flight-path decoration |

Vars inside `.landing`: `--ink`, `--paper`, `--paper-2`, `--muted-ink`, `--line`, `--card`, `--btn`, `--btn-ink`, `--mark`. Reference via arbitrary values, e.g. `text-[color:var(--muted-ink)]`, `bg-[color:var(--btn)]`.

## Typography

- **Body / UI:** Geist (`font-sans`). The default — don't override.
- **Display (marketing only):** Fraunces serif via `l-display`. Loaded in `index.html`.
- That's the whole type system. **Never** introduce Inter, Roboto, Arial, system-ui-as-display, or another Google Font.

## Components

1. **shadcn first.** Reuse what's in `src/components/ui/` (`button`, `card`, `dialog`, `input`, `textarea`, `badge`, `label`, `scroll-area`, `skeleton`, `sonner`). Don't hand-roll a button/input/dialog.
2. **Compose with `cn()`** from `@/lib/utils` for conditional classes.
3. **Variants via `cva`** — follow the pattern in `ui/button.tsx` (variant + size, `data-slot`/`data-*` attrs).
4. Need a new primitive? Add it via the shadcn CLI or mirror the existing primitive's structure (cva, tokens, `cn`, forwardable props) — never a bespoke one-off.

## Shape, elevation, motion

- **Radius:** `rounded-lg` is the default (`--radius-lg`). Pills use `rounded-full`. Stay on the radius scale.
- **Shadows:** soft and subtle only — `shadow-sm`, or `shadow-[0_8px_22px_rgba(0,0,0,0.12)]` for a lifted hover. **No brutalist hard-offset shadows** (`6px 6px 0 0`) in app chrome — that was removed.
- **Hover:** quiet. `translateY(-1px)` + a touch more shadow, or a `bg-muted`/`--paper-2` background shift. No bounce, no scale-up on app controls.
- **Motion:** restrained. Staggered entrance (`l-rise`) is fine on marketing/hero. Inside the app, prefer no entrance animation; use the existing keyframes (`blink`, `thinking-bounce`) for streaming/loading states.

## Tailwind v4 hard rules

- Config is the `@theme` block in `src/index.css`. **There is no `tailwind.config.ts` — never create one.**
- New global colors/tokens → add a CSS var in `@theme` (and its `.dark` override), then use the generated utility.
- Arbitrary values are allowed for var references: `[color:var(--x)]`, `shadow-[...]`. Decimal spacing (`h-13`, `h-4.5`) works (v4 dynamic spacing).
- Dark mode is the `.dark` class (next-themes); the app pins `defaultTheme="light"`. Always provide the `.dark` counterpart for any new token.

## TypeScript / imports

- `import type { ... }` for type-only imports (`verbatimModuleSyntax: true`).
- `@/` → `./src/`.

## Before you finish — checklist

- [ ] No hardcoded hex / `text-black` / `bg-white` — semantic tokens (app) or `.landing` vars (marketing) only.
- [ ] No chromatic accent (color only for brand marks / destructive).
- [ ] Reused shadcn primitives where one fits; new primitives follow the `cva` + token pattern.
- [ ] Soft shadows + quiet hover; radius on-scale; correct font (Geist body / Fraunces display).
- [ ] Dark-mode token counterparts exist; looks right in both themes.
- [ ] `pnpm build` (tsc + vite) and `pnpm lint` clean for the files you touched.
