# design-sync notes — PaperPilot

PaperPilot is an **app**, not a published component library. There is no `dist/`
component entry and no `.d.ts` tree, so this sync runs the converter in
**synth-entry mode** off `src/`, with a hand-written scoped entry.

## Setup quirks (must hold on every sync / fresh clone)

- **Run everything from `frontend/`** (the package root). All design-sync artifacts
  live under `frontend/` (`.design-sync/`, `.ds-sync/`, `ds-bundle/`).
- **Scoped entry, not the synth auto-entry.** `.design-sync/entry.tsx` re-exports only
  the 9 renderable design-system components and `toast`. Pass it via `--entry`.
  Reason: `src/lib/supabase.ts` calls `createClient(import.meta.env…)` at module load;
  the synth auto-entry `export *`s every src file, which would run that side effect at
  bundle eval and blank every preview. App components (ChatBox/Sidebar/UploadBox/…) are
  deliberately excluded for the same reason.
- **Tailwind v4 must be compiled first.** `cssEntry` points at `.design-sync/compiled.css`,
  produced by `cfg.buildCmd` (`@tailwindcss/cli -i src/index.css -o …`). The raw
  `src/index.css` is uncompiled (`@import "tailwindcss"`) and renders unstyled in a browser.
  The driver runs `buildCmd` before the converter; for a bare build, run it manually first.
- **`.ds-sync` dep install must include the Tailwind CLI:** on a fresh clone run
  `(cd .ds-sync && npm i esbuild ts-morph @types/react @tailwindcss/cli@4.3.0 tailwindcss@4.3.0 playwright@1.60.0 playwright-core@1.60.0)`.
  esbuild's postinstall is gated — `npm approve-scripts esbuild` (or `npm rebuild esbuild`).
- **Playwright:** the machine's chromium cache is at `~/Library/Caches/ms-playwright`
  (chromium build **1223** → **playwright 1.60.0**). Do NOT set `PLAYWRIGHT_BROWSERS_PATH`
  (the default path is correct); pinning a non-matching playwright re-downloads ~200MB.
- **`toast` instance:** `entry.tsx` re-exports `toast` from `sonner` so previews fire
  toasts on the SAME instance the bundled `Toaster` subscribes to. Importing `toast`
  straight from `"sonner"` in a preview gives a second instance and toasts never paint.

## Known render warns (triaged benign — not new on re-sync)

- `[RENDER_THIN]` on **Toaster** — the toast is fixed-positioned (0 measured height) but
  paints correctly (confirmed in the screenshot). Its preview neutralizes only sonner's
  entrance animation (`opacity:0`→mounted) via an inline `<style>`; the toast itself is the
  real component.

## dtsPropsFor (synth mode can't extract these)

Synth mode emits `[key: string]: unknown` props. Hand-written prop bodies for
`Button`, `Badge`, `BrandMark`, `Skeleton` live in `cfg.dtsPropsFor`. Compound Radix
wrappers (Dialog/AlertDialog/DropdownMenu) keep passthrough props — their usage is
carried by the authored previews + conventions header.

## Re-sync risks (what can silently go stale)

- **Variant unions in `dtsPropsFor`** are hand-mirrored from `button-variants.ts` /
  `badge-variants.ts`. If those CVA configs gain/drop a variant or size, update
  `dtsPropsFor` — nothing checks it automatically.
- **`extraFonts`** points at `node_modules/@fontsource-variable/geist/index.css`; a Geist
  fontsource major bump could move those files.
- **`runtimeFontPrefixes: ["Fraunces"]`** suppresses a `[FONT_MISSING]` for the marketing
  serif (loaded at runtime via index.html Google Fonts, unused by the 9 components). If a
  synced component ever uses Fraunces, ship it instead of suppressing.
- **Token list noise:** the compiled Tailwind CSS dumps `--tw-*` internal vars into the
  README token list. The conventions header tells the agent to ignore them; the real
  tokens are `--color-*` / `--radius-*` / `--font-sans`.
- Scope is intentionally 9 components. To add app components later they'd need their
  data/auth dependencies stubbed via `cfg.provider` or excluded imports.
