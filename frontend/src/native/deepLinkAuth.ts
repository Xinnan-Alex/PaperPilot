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
