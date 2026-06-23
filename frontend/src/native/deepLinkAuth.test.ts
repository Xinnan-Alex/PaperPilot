import { describe, expect, it, vi, beforeEach } from "vitest";

const { exchangeCodeForSession, browserClose } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
  browserClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { exchangeCodeForSession } },
}));
vi.mock("@capacitor/browser", () => ({ Browser: { close: browserClose } }));
vi.mock("@capacitor/app", () => ({ App: { addListener: vi.fn() } }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { toast } from "sonner";
import { handleAuthCallback } from "./deepLinkAuth";

describe("handleAuthCallback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockClear();
    browserClose.mockClear();
    vi.mocked(toast.error).mockClear();
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

  it("shows a toast and closes the browser on exchange error", async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "bad code" } });
    await handleAuthCallback("com.leongxinnan.paperpilot://login-callback?code=bad");
    expect(toast.error).toHaveBeenCalledWith("Sign-in failed. Please try again.");
    expect(browserClose).toHaveBeenCalled();
  });
});
