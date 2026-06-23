# PaperPilot Mobile (Capacitor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PaperPilot as native iOS + Android apps that wrap the existing React web build via Capacitor, reusing 100% of the UI and the same backend.

**Architecture:** Capacitor is added *inside* `frontend/` (standard Capacitor + Vite layout). `webDir: dist` packages the exact Vite build into native iOS/Android shells. The only `frontend/src` changes are native-gated auth additions so OAuth completes via a deep link instead of a web redirect (which dead-ends in a WebView). Backend needs only a CORS env change.

**Tech Stack:** Capacitor 6 (`@capacitor/core`, `cli`, `ios`, `android`, `app`, `browser`) · React 19 + Vite 8 · Supabase JS (OAuth PKCE) · pnpm 11.7.0 · Xcode + Android Studio.

## Global Constraints

- App identity: `appId = com.leongxinnan.paperpilot`, `appName = PaperPilot`. Stable — do not change after store submission.
- Deep-link redirect scheme: `com.leongxinnan.paperpilot://login-callback`.
- Capacitor config + native folders live in `frontend/` (NOT a sibling `mobile/`). `webDir: dist`.
- Dev/prod API target baked at build time: `VITE_API_URL=https://api.paperpilot.leongxinnan.com` (localhost does not resolve on a device).
- **Web build behavior must stay byte-for-byte identical.** Every native code path is gated on `Capacitor.isNativePlatform()`, which returns `false` on web.
- Package manager: pnpm `11.7.0`. `frontend/pnpm-workspace.yaml` enforces `minimumReleaseAge: 10080` (7 days) — only install Capacitor releases older than 7 days (all current stable releases qualify).
- TypeScript `verbatimModuleSyntax: true` → use `import type` for type-only imports. `@/` aliases `./src/`.
- All `cd` paths are relative to repo root `/Users/alexleong/.supacode/repos/paperpilot/mobile-app-fe`.

**Note on test style:** Tasks 1, 2, 4, 5 are CLI/native-config glue with no unit-testable logic — they are verified by exact command output and on-simulator observation (stated per task), not unit tests (YAGNI). Task 3 contains the only real logic (the auth callback handler) and carries a Vitest unit test.

---

### Task 1: Scaffold Capacitor inside `frontend/`

**Files:**
- Create: `frontend/capacitor.config.ts`
- Create: `frontend/ios/` (generated), `frontend/android/` (generated)
- Modify: `frontend/package.json` (deps + scripts, by CLI)
- Modify: `frontend/.gitignore`

**Interfaces:**
- Produces: a synced Capacitor project. Later tasks run `npx cap sync` / `npx cap run` from `frontend/`.

- [ ] **Step 1: Install Capacitor packages**

```bash
cd frontend
pnpm add @capacitor/core@^6 @capacitor/app@^6 @capacitor/browser@^6
pnpm add -D @capacitor/cli@^6 @capacitor/ios@^6 @capacitor/android@^6
```

- [ ] **Step 2: Initialize Capacitor config**

```bash
cd frontend
npx cap init "PaperPilot" "com.leongxinnan.paperpilot" --web-dir dist
```

Then replace the generated `frontend/capacitor.config.ts` with:

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.leongxinnan.paperpilot",
  appName: "PaperPilot",
  webDir: "dist",
};

export default config;
```

- [ ] **Step 3: Produce a build so `cap add` has a webDir**

```bash
cd frontend
pnpm build
```
Expected: `dist/` is created with `index.html` + assets.

- [ ] **Step 4: Add native platforms**

```bash
cd frontend
npx cap add ios
npx cap add android
```
Expected: `ios/` and `android/` directories created; output ends with `[success] ios added!` and `[success] android added!`.

- [ ] **Step 5: Ignore native build artifacts**

Append to `frontend/.gitignore`:

```gitignore
# Capacitor native build artifacts
ios/App/Pods
ios/App/App/public
ios/App/Podfile.lock
android/.gradle
android/app/build
android/app/src/main/assets/public
android/capacitor-cordova-android-plugins
.env.mobile
.env.mobile.local
```

- [ ] **Step 6: Verify the project is wired up**

```bash
cd frontend
npx cap doctor
```
Expected: lists `@capacitor/ios` and `@capacitor/android` as installed, `capacitor.config.ts` found, no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/capacitor.config.ts frontend/package.json frontend/pnpm-lock.yaml frontend/.gitignore frontend/ios frontend/android
git commit -m "feat(mobile): scaffold Capacitor iOS + Android in frontend"
```

---

### Task 2: Mobile build config + simulator smoke test

**Files:**
- Create: `frontend/.env.mobile.example`
- Create: `frontend/.env.mobile` (gitignored — real values)
- Modify: `frontend/package.json` (add `build:mobile` script)

**Interfaces:**
- Consumes: scaffolded project from Task 1.
- Produces: `pnpm build:mobile` — a Vite build with prod API + Supabase env baked in, consumed by `npx cap sync` in every later task.

- [ ] **Step 1: Add the mobile env template**

Create `frontend/.env.mobile.example`:

```bash
# Built into the mobile bundle by `pnpm build:mobile` (vite --mode mobile).
# All three are public (shipped in the JS bundle) — publishable key only.
VITE_API_URL=https://api.paperpilot.leongxinnan.com
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```

Then copy it and fill real values (get them from `frontend/.env.local`):

```bash
cd frontend
cp .env.mobile.example .env.mobile
# edit .env.mobile: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to the hosted project values
```

- [ ] **Step 2: Add the `build:mobile` script**

In `frontend/package.json` `scripts`, add (Vite `--mode mobile` auto-loads `.env.mobile`):

```json
"build:mobile": "tsc -b && vite build --mode mobile",
```

- [ ] **Step 3: Build for mobile and sync**

```bash
cd frontend
pnpm build:mobile
npx cap sync
```
Expected: `cap sync` ends with `[success] Sync finished`.

- [ ] **Step 4: Run on the iOS simulator**

```bash
cd frontend
npx cap run ios
```
Expected: an iOS simulator boots, the app launches and renders the PaperPilot **login screen** (paper-plane landing with Google/GitHub buttons). Web assets, fonts, and styling render correctly.

- [ ] **Step 5: Run on the Android emulator**

```bash
cd frontend
npx cap run android
```
Expected: an Android emulator boots and renders the same login screen.

> Note: OAuth login does NOT work yet — Task 3–5 fix that. This step only proves the web bundle renders natively.

- [ ] **Step 6: Commit**

```bash
git add frontend/.env.mobile.example frontend/package.json
git commit -m "feat(mobile): mobile build mode + simulator smoke test"
```

---

### Task 3: Native OAuth deep-link auth (code + unit test)

**Files:**
- Create: `frontend/src/native/deepLinkAuth.ts`
- Test: `frontend/src/native/deepLinkAuth.test.ts`
- Modify: `frontend/src/lib/supabase.ts`
- Modify: `frontend/src/pages/Login.tsx` (signIn, ~lines 113–127)
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Produces:
  - `handleAuthCallback(url: string): Promise<void>` — extracts `?code=` from a deep-link URL and exchanges it for a Supabase session.
  - `registerDeepLinkAuth(): void` — native-only; wires `App` `appUrlOpen` → `handleAuthCallback`.
- Consumes: `supabase` client (Task is also where the client gains native auth options).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/native/deepLinkAuth.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
const browserClose = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { exchangeCodeForSession } },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { close: browserClose } }));

import { handleAuthCallback } from "./deepLinkAuth";

describe("handleAuthCallback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockClear();
    browserClose.mockClear();
  });

  it("exchanges the code from a deep-link URL", async () => {
    await handleAuthCallback("com.leongxinnan.paperpilot://login-callback?code=abc123");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(browserClose).toHaveBeenCalled();
  });

  it("ignores a URL with no code", async () => {
    await handleAuthCallback("com.leongxinnan.paperpilot://login-callback");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd frontend
pnpm test src/native/deepLinkAuth.test.ts
```
Expected: FAIL — `Failed to resolve import "./deepLinkAuth"` / `handleAuthCallback is not a function`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/native/deepLinkAuth.ts`:

```ts
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/lib/supabase";

const CALLBACK_HOST = "login-callback";

// Exchange the PKCE code from a deep-link callback URL for a Supabase session.
export async function handleAuthCallback(url: string): Promise<void> {
  if (!url.includes(CALLBACK_HOST)) return;
  const code = new URL(url).searchParams.get("code");
  if (!code) return;
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) console.error("OAuth code exchange failed:", error.message);
  await Browser.close();
}

// Native-only: route the OS deep-link back into Supabase auth.
export function registerDeepLinkAuth(): void {
  if (!Capacitor.isNativePlatform()) return;
  void App.addListener("appUrlOpen", ({ url }) => {
    void handleAuthCallback(url);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd frontend
pnpm test src/native/deepLinkAuth.test.ts
```
Expected: PASS (2 passed).

- [ ] **Step 5: Give the Supabase client native PKCE options**

Replace `frontend/src/lib/supabase.ts` with:

```ts
import { Capacitor } from "@capacitor/core";
import { createClient } from "@supabase/supabase-js";

// Native: PKCE flow + manual code exchange (no URL auto-detection in a WebView).
// Web: unchanged defaults (detectSessionInUrl handles the redirect).
const native = Capacitor.isNativePlatform();

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  native
    ? {
        auth: {
          flowType: "pkce",
          detectSessionInUrl: false,
          persistSession: true,
          autoRefreshToken: true,
        },
      }
    : undefined,
);
```

- [ ] **Step 6: Branch the OAuth redirect in `Login.tsx`**

In `frontend/src/pages/Login.tsx`, add imports near the top:

```ts
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
```

Replace the `signIn` body (currently ~lines 113–127) with:

```ts
  const signIn = async (provider: "github" | "google") => {
    setLoading(provider);
    try {
      const native = Capacitor.isNativePlatform();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: native
            ? "com.leongxinnan.paperpilot://login-callback"
            : window.location.origin,
          skipBrowserRedirect: native,
        },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      // Native: open the provider in the system browser; the deep-link
      // callback (registerDeepLinkAuth) completes the session.
      if (native && data?.url) await Browser.open({ url: data.url });
    } catch {
      toast.error("Failed to start sign-in. Please try again.");
    } finally {
      setLoading(null);
    }
  };
```

- [ ] **Step 7: Register the deep-link listener at startup**

In `frontend/src/main.tsx`, add after the imports and before `createRoot(...)`:

```ts
import { registerDeepLinkAuth } from "./native/deepLinkAuth";

registerDeepLinkAuth();
```

- [ ] **Step 8: Verify web build is unaffected**

```bash
cd frontend
pnpm test
pnpm build
```
Expected: all tests pass; web `pnpm build` succeeds. (On web, `Capacitor.isNativePlatform()` is `false`, so `signIn` and the client options take the original web path.)

- [ ] **Step 9: Commit**

```bash
git add frontend/src/native frontend/src/lib/supabase.ts frontend/src/pages/Login.tsx frontend/src/main.tsx
git commit -m "feat(mobile): native OAuth via deep link (PKCE code exchange)"
```

---

### Task 4: Register the deep-link scheme + upload permissions in the native projects

**Files:**
- Modify: `frontend/ios/App/App/Info.plist`
- Modify: `frontend/android/app/src/main/AndroidManifest.xml`

**Interfaces:**
- Consumes: scheme `com.leongxinnan.paperpilot://login-callback` (from Task 3).
- Produces: the OS routes that scheme back to the app, enabling the `appUrlOpen` listener to fire.

- [ ] **Step 1: iOS — register the URL scheme and file/camera usage strings**

In `frontend/ios/App/App/Info.plist`, add these keys inside the top-level `<dict>`:

```xml
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>com.leongxinnan.paperpilot</string>
			</array>
		</dict>
	</array>
	<key>NSPhotoLibraryUsageDescription</key>
	<string>PaperPilot needs photo access to attach documents.</string>
	<key>NSCameraUsageDescription</key>
	<string>PaperPilot needs camera access to capture documents.</string>
```

- [ ] **Step 2: Android — add the deep-link intent filter**

In `frontend/android/app/src/main/AndroidManifest.xml`, inside the existing
`<activity android:name=".MainActivity" ...>` element (alongside the launcher
intent-filter Capacitor generated), add:

```xml
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data
                    android:scheme="com.leongxinnan.paperpilot"
                    android:host="login-callback" />
            </intent-filter>
```

- [ ] **Step 3: Sync native projects**

```bash
cd frontend
npx cap sync
```
Expected: `[success] Sync finished`.

- [ ] **Step 4: Verify the scheme opens the app (iOS simulator)**

With the app installed on the booted simulator (from Task 2), run:

```bash
xcrun simctl openurl booted "com.leongxinnan.paperpilot://login-callback?code=test"
```
Expected: the simulator foregrounds the PaperPilot app (the code is invalid, so no session — that is fine; the point is the scheme routes to the app).

- [ ] **Step 5: Commit**

```bash
git add frontend/ios/App/App/Info.plist frontend/android/app/src/main/AndroidManifest.xml
git commit -m "feat(mobile): register login-callback deep link + upload permissions"
```

---

### Task 5: Supabase redirect allowlist + backend CORS + full end-to-end verify

**Files:**
- Modify: `backend/.env` (local `FRONTEND_ORIGINS`)
- Manual: Supabase dashboard redirect URL; prod SSM param `/paperpilot/FRONTEND_ORIGINS`.

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: a working OAuth round-trip and RAG query on both simulators.

- [ ] **Step 1: Allow the deep-link redirect in Supabase (manual)**

In the Supabase dashboard → **Authentication → URL Configuration → Redirect URLs**, add:

```
com.leongxinnan.paperpilot://login-callback
```
Save. (Google/GitHub providers stay as-is; this only allowlists the native return URL.)

- [ ] **Step 2: Add native origins to backend CORS (local)**

CORS is env-driven (`config.py` `frontend_origins`, parsed in `api.py`) — no code
change. In `backend/.env`, set (or extend) `FRONTEND_ORIGINS`:

```bash
FRONTEND_ORIGINS=http://localhost:5173,capacitor://localhost,http://localhost,https://localhost
```

- [ ] **Step 3: Add native origins to prod CORS (manual, SSM)**

Append the three native origins to the **existing** prod value (keep the current
web origin). Read the current value first:

```bash
aws ssm get-parameter --name /paperpilot/FRONTEND_ORIGINS --region ap-southeast-5 --query Parameter.Value --output text
```
Then overwrite with the existing value + native origins appended:

```bash
aws ssm put-parameter --name /paperpilot/FRONTEND_ORIGINS --type String --overwrite \
  --region ap-southeast-5 \
  --value "<EXISTING_VALUE>,capacitor://localhost,http://localhost,https://localhost"
```
Restart the backend container so it re-reads the param (per CLAUDE.md, the container fetches SSM params at start — trigger the SSM Run Command restart used by deploy, or reboot the instance).

- [ ] **Step 4: Rebuild, sync, run — verify OAuth login end to end (iOS)**

```bash
cd frontend
pnpm build:mobile && npx cap sync && npx cap run ios
```
On the simulator: tap **Continue with Google** → system browser opens → complete
Google sign-in → browser redirects to `com.leongxinnan.paperpilot://login-callback`
→ app foregrounds → lands on the authed app (sidebar + chat). 
Expected: you are logged in; killing and reopening the app keeps the session.

- [ ] **Step 5: Verify a full RAG round-trip (iOS)**

In the authed app on the simulator: upload a PDF (file/photo picker appears,
permission prompt shows the Info.plist string), wait for it to reach `ready`,
ask a question.
Expected: the answer **streams token-by-token** (SSE through the WebView works)
and renders inline `[N]` citations. This confirms CORS + streaming + upload.

- [ ] **Step 6: Repeat verification on Android**

```bash
cd frontend
npx cap run android
```
Expected: same OAuth login + upload + streaming-answer behavior on the Android
emulator.

- [ ] **Step 7: Commit**

```bash
git add backend/.env.example
git commit -m "feat(mobile): document native CORS origins for FRONTEND_ORIGINS"
```

> Note: `backend/.env` itself is gitignored — commit the change to `backend/.env.example` (add the native origins as a comment/example there). The Supabase dashboard and SSM changes are infra config, not code.

---

## Self-Review

**Spec coverage:**
- Capacitor in `frontend/`, `webDir: dist`, appId/appName → Task 1. ✓
- Build flow with baked `VITE_API_URL` → Task 2 (`build:mobile` + `.env.mobile`). ✓
- Native OAuth deep link (plugins, scheme, PKCE, `exchangeCodeForSession`, `Login.tsx` branch, `appUrlOpen`) → Tasks 3 + 4. ✓
- Supabase redirect allowlist (manual) → Task 5 Step 1. ✓
- Backend CORS via env, no code → Task 5 Steps 2–3. ✓
- `.gitignore` native artifacts → Task 1 Step 5. ✓
- Verify SSE streaming, file upload (Info.plist usage strings), session persistence → Task 5 Steps 4–6; usage strings added in Task 4 Step 1. ✓
- Web build unchanged → Task 3 Step 8 (gated on `isNativePlatform()`). ✓
- Out of scope (Ionic UI, push, store submission, splash/icon) → not in any task. ✓

**Placeholder scan:** No TBD/TODO; every code/config step shows full content. `<EXISTING_VALUE>` in Task 5 Step 3 is a read-from-SSM value, with the read command given — not a placeholder for the author to invent.

**Type consistency:** `handleAuthCallback(url: string)` and `registerDeepLinkAuth()` names match across the test, implementation, and `main.tsx` import. `supabase` import path `@/lib/supabase` consistent. Scheme string `com.leongxinnan.paperpilot://login-callback` identical in `Login.tsx`, `deepLinkAuth.ts` (`login-callback` host), Info.plist, and AndroidManifest.
