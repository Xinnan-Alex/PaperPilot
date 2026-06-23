# PaperPilot Mobile App — Capacitor Wrapper Design

**Date:** 2026-06-19
**Status:** Approved (design)
**Branch:** `mobile-app-fe`

## Goal

Ship PaperPilot as native iOS + Android apps that reuse the existing React web
frontend **unchanged**, talk to the same backend, and leave the current web
deployment (S3 + CloudFront) untouched. Mobile is delivered via **Capacitor**
(the native runtime from the Ionic team) — not the Ionic Framework UI library.

Explicit non-goal: this does **not** teach the Ionic Framework component
library. It teaches the Capacitor native toolchain. Accepted by the user.

## Approach

Add Capacitor **inside `frontend/`** (the standard Capacitor + Vite layout) and
wrap the existing Vite build in a native shell. No UI rebuild. `frontend/src`
React code is unchanged except small, native-gated auth additions (see Auth).

```
paperpilot/
└─ frontend/                # web app, still deploys to S3/CloudFront
   ├─ src/                  # React — unchanged except native-gated auth branch
   ├─ dist/                 # Vite build output (gitignored)
   ├─ capacitor.config.ts   # NEW
   ├─ ios/                  # NEW — `npx cap add ios`
   ├─ android/              # NEW — `npx cap add android`
   └─ package.json          # + @capacitor/{core,cli,ios,android,app,browser}
```

Capacitor in `frontend/` (not a sibling `mobile/`) because the JS imports
(`Capacitor.isNativePlatform()`, `@capacitor/app`, `@capacitor/browser`) must
resolve at the frontend Vite build, and `npx cap sync` scans the same
`package.json` to copy each plugin's native code. Splitting across folders makes
plugin sync flaky.

`capacitor.config.ts`:
- `appId`: `com.leongxinnan.paperpilot` (reverse-DNS, stable for store identity)
- `appName`: `PaperPilot`
- `webDir`: `dist` — Capacitor packages the exact same React build.

## Build / run flow

```bash
cd frontend

# 1. Build the web app with the mobile API target baked in (Vite env is build-time)
VITE_API_URL=https://api.paperpilot.leongxinnan.com \
  VITE_SUPABASE_URL=... VITE_SUPABASE_PUBLISHABLE_KEY=... pnpm build

# 2. Copy dist + native plugins into the native projects
npx cap sync

# 3. Run
npx cap run ios          # or: npx cap open ios     → Xcode → simulator
npx cap run android      # or: npx cap open android → Android Studio
```

`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are baked the same way at
build time. A convenience approach (a `frontend/.env.mobile` file or a
`pnpm build:mobile` script that sets the three vars) MAY be added to avoid
retyping the env — decided during implementation, not required by this design.

## Auth — native OAuth deep link (REQUIRED for v1)

The web app authenticates with **OAuth only** (GitHub + Google) via
`supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } })`.
There is **no email/password login**. In a Capacitor WebView, `window.location.origin`
is `capacitor://localhost` / `http://localhost`, so the OAuth provider redirect
never returns to the app and login dead-ends. Native OAuth via a **deep link** is
therefore mandatory for v1 — there is no email/password path to fall back to.

Pieces:

1. **Plugins:** `@capacitor/browser` (open the OAuth URL in the system browser)
   and `@capacitor/app` (receive the redirect via the `appUrlOpen` listener).
2. **Custom URL scheme:** `com.leongxinnan.paperpilot://login-callback`,
   registered in iOS `Info.plist` and an Android intent filter (Capacitor wires
   these from config).
3. **Supabase dashboard (manual, done by the user):** add the scheme above to
   Auth → URL Configuration → Redirect URLs; confirm Google + GitHub provider
   config allows it.
4. **Supabase client:** create with `auth: { flowType: 'pkce', detectSessionInUrl: false }`
   for native. On `appUrlOpen`, pass the callback URL to
   `supabase.auth.exchangeCodeForSession(url)` to complete the session.
5. **`Login.tsx` (additive, web behavior unchanged):**
   `redirectTo = Capacitor.isNativePlatform() ? 'com.leongxinnan.paperpilot://login-callback' : window.location.origin`.
   The `appUrlOpen` handler lives in app bootstrap (e.g. `main.tsx`), native-only.

This slightly dents "frontend untouched": a platform conditional on `redirectTo`
and a native-only `appUrlOpen` handler are added to `frontend/`. Both are
additive and gated on `Capacitor.isNativePlatform()`; the web build is identical.

## Required changes (backend + git)

1. **Backend CORS — config only, no code.** CORS origins are already env-driven:
   `config.py` `frontend_origins` (comma-separated, default `http://localhost:5173`),
   parsed in `api.py`. Add the native WebView origins `capacitor://localhost`,
   `http://localhost`, `https://localhost` to the `FRONTEND_ORIGINS` value — the
   SSM param `/paperpilot/FRONTEND_ORIGINS` for prod and `backend/.env` for local.
   No `api.py` edit needed.

2. **`.gitignore` for native artifacts** (`frontend/.gitignore`). Ignore
   `ios/App/Pods`, `ios/App/App/public`, `android/.gradle`, `android/app/build`,
   `android/app/src/main/assets/public`, and Capacitor's copied `public/` dirs.
   Commit the native project scaffolding (`ios/`, `android/`) itself so the app
   is reproducible.

## Verify on simulator (not assumed)

- **SSE streaming** (`/chat`, `/query`) through the WebView fetch — confirm
  tokens stream live on iOS + Android simulators.
- **File upload** (`<input type=file>`) — iOS needs `NSPhotoLibraryUsageDescription`
  / `NSCameraUsageDescription` strings in `Info.plist`; Android needs the
  file/photo picker to resolve. Confirm a PDF upload completes.
- **Auth round-trip** — OAuth deep-link login completes (browser → redirect →
  `exchangeCodeForSession`) and the session persists across app restarts.

## Out of scope (v1)

- **Ionic Framework UI components** — explicitly not used.
- Native push notifications.
- App Store / Play Store submission, signing, provisioning profiles.
- Custom splash screen / app icon polish — Capacitor defaults for v1.
- Extracting mobile into its own package/repo. Capacitor lives in `frontend/`
  for v1; split it out only if the mobile build later needs to diverge from web.

## Success criteria

- `npx cap run ios` and `npx cap run android` launch PaperPilot in their
  respective simulators.
- A user can log in (Google or GitHub OAuth via deep link), upload a PDF, and
  get a streaming answer with citations — same behavior as web.
- Web deployment is unaffected (no change to `frontend/` source or its CI).

## Follow-ups (post-v1, separate specs)

- App icon + splash branding.
- Store submission pipeline.
- Capacitor plugins for native niceties (status bar, haptics, share sheet).
