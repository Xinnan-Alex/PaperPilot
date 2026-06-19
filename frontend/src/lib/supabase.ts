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
