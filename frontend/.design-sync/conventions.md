## PaperPilot design system — how to build with it

PaperPilot is a **monochrome, Notion-style** app UI: black / white / gray only.
The single chromatic exception is `destructive` (red) for delete/error states; never
introduce other accent colors. Type is **Geist** (`font-sans`). Quiet shadows,
`rounded-lg` by default.

### Setup

`styles.css` defines every design token as a CSS custom property and ships the
Geist `@font-face`s — link it once (see Loading above) and all components are styled.
No provider is required for most components; they read token-backed Tailwind utilities.

Two pieces use React context:
- **Dark mode** is driven by a `.dark` class on a parent element (the app uses
  `next-themes`). Toggle `.dark` on a wrapping node and every token flips to its dark
  value automatically. `ThemeToggle` flips it; without a theme provider it defaults to light.
- **`Toaster`** is mounted **once** near the root; fire notifications imperatively with
  `toast.success(...)` / `toast.error(...)` / `toast.info(...)` (sonner). `toast` is exported
  on `window.PaperPilot.toast` from the same instance the `Toaster` host renders.

### Styling idiom — Tailwind v4 semantic utilities

Style with Tailwind utility classes whose colors map to **semantic tokens**, never raw
hex. Use the token-backed families so light/dark both work:

| Surface / role | Utilities (verified in `styles.css`) |
|---|---|
| Page surface | `bg-background`, `text-foreground` |
| Primary action | `bg-primary`, `text-primary-foreground` |
| Secondary / muted fills | `bg-secondary`, `bg-muted`, `text-muted-foreground` |
| Borders / inputs | `border-border`, `border-input` |
| Sidebar / chrome layer | `bg-sidebar-background`, `bg-sidebar-accent`, `text-sidebar-foreground` |
| Destructive (only accent) | `text-destructive`, `bg-destructive/10` |
| Radius / type | `rounded-lg`, `rounded-md`, `font-sans` |

Component variants are props, not classes — e.g. `Button` takes
`variant="default|secondary|outline|ghost|destructive|link"` and
`size="default|xs|sm|lg|icon|icon-sm|…"`; `Badge` takes the same `variant` set.
See each component's `.d.ts`/`.prompt.md` for the exact prop union.

### Where the truth lives

- `styles.css` — the token source. The real design tokens are `--color-*` (e.g.
  `--color-primary`, `--color-muted-foreground`, `--color-sidebar-accent`),
  `--radius-lg/md/sm`, and `--font-sans`. **Ignore the `--tw-*` entries** in the token
  list — those are Tailwind's internal runtime variables, not design tokens.
- `components/general/<Name>/<Name>.prompt.md` + `.d.ts` — per-component API and usage.

### Idiomatic snippet

```jsx
const { Button, Badge } = window.PaperPilot;

<div className="rounded-lg border border-border bg-background p-4">
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium text-foreground">annual-report.pdf</span>
    <Badge variant="secondary">ready</Badge>
  </div>
  <p className="mt-1 text-xs text-muted-foreground">Embedded · 42 chunks</p>
  <div className="mt-3 flex justify-end gap-2">
    <Button variant="outline" size="sm">Remove</Button>
    <Button size="sm">Ask about this</Button>
  </div>
</div>
```
