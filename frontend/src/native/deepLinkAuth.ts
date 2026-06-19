import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

const CALLBACK_HOST = "login-callback";

// Exchange the PKCE code from a deep-link callback URL for a Supabase session.
export async function handleAuthCallback(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.host !== CALLBACK_HOST) return;
  const code = parsed.searchParams.get("code");
  if (!code) return;
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("OAuth code exchange failed:", error.message);
    toast.error("Sign-in failed. Please try again.");
  }
  await Browser.close();
}

// Native-only: route the OS deep-link back into Supabase auth.
export function registerDeepLinkAuth(): void {
  if (!Capacitor.isNativePlatform()) return;
  void App.addListener("appUrlOpen", ({ url }) => {
    void handleAuthCallback(url);
  });
}
