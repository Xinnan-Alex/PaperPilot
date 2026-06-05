// @fontsource-variable/* packages ship only CSS and font files (no type
// declarations), so a bare side-effect import (e.g. in main.tsx) needs an
// ambient module declaration to satisfy tsc. Vite still resolves and bundles
// the actual CSS at build time — this only affects type-checking.
declare module "@fontsource-variable/*";
