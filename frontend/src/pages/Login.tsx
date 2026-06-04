import { supabase } from "@/lib/supabase";
import {
  ArrowLeft,
  ArrowRight,
  FileUp,
  Loader2,
  Moon,
  Quote,
  Send,
  Sparkles,
  Sun,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { toast } from "sonner";
import { useTheme } from "next-themes";

const REPO_URL = "https://github.com/Xinnan-Alex/PaperPilot";

const GitHubMark = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

const GoogleMark = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden>
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

function ThemeIcon() {
  const { theme, setTheme } = useTheme();
  const ref = useRef<HTMLButtonElement>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [animating, setAnimating] = useState(false);
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null);
  const [flipping, setFlipping] = useState(false);
  const isDark = theme === "dark";

  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  const handleClick = useCallback(() => {
    if (animating) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTheme(isDark ? "light" : "dark");
      return;
    }

    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    setAnimating(true);
    setFlipping(true);
    setRipple({ x: cx, y: cy });

    timersRef.current.push(setTimeout(() => {
      setTheme(isDark ? "light" : "dark");
    }, 280));

    timersRef.current.push(setTimeout(() => {
      setRipple(null);
      setFlipping(false);
      setAnimating(false);
    }, 850));
  }, [animating, isDark, setTheme]);

  return (
    <>
      <button
        ref={ref}
        onClick={handleClick}
        disabled={animating}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className={`grid h-9 w-9 place-items-center rounded-lg bg-[color:var(--btn)] text-[color:var(--btn-ink)] shadow-sm transition-shadow ${flipping ? (isDark ? "animate-[backflip-reverse_0.5s_cubic-bezier(0.34,1.56,0.64,1)_forwards]" : "animate-[backflip_0.5s_cubic-bezier(0.34,1.56,0.64,1)_forwards]") : ""}`}
        style={flipping ? { backfaceVisibility: "hidden" as const } : undefined}
      >
        <span className={flipping ? "animate-[fade-in_0.15s_ease_0.28s_both]" : ""}>
          {isDark ? <Moon className="h-4.5 w-4.5" /> : <Sun className="h-4.5 w-4.5" />}
        </span>
      </button>

      {ripple && (
        <div
          aria-hidden={true}
          className="pointer-events-none fixed z-50"
          style={{
            inset: 0,
            "--ripple-x": `${ripple.x}px`,
            "--ripple-y": `${ripple.y}px`,
            clipPath: "circle(0% at var(--ripple-x) var(--ripple-y))",
            animation: "ripple-expand 0.6s cubic-bezier(0.2, 0.8, 0.3, 1) forwards",
            background: "var(--paper)",
          } as React.CSSProperties}
        />
      )}
    </>
  );
}

const features = [
  { icon: FileUp, label: "Upload PDF · DOCX · TXT" },
  { icon: Sparkles, label: "Ask in plain English" },
  { icon: Quote, label: "Answers with citations" },
];

export default function Login() {
  const [loading, setLoading] = useState<"github" | "google" | null>(null);
  const [showProviders, setShowProviders] = useState(false);

  const signIn = async (provider: "github" | "google") => {
    setLoading(provider);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (error) toast.error(error.message);
    } catch {
      toast.error("Failed to start sign-in. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="landing flex flex-col font-sans">
      {/* dashed flight path + floating paper plane */}
      <svg
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          className="l-flight"
          d="M -50 120 C 240 40, 360 260, 640 150 S 1100 60, 1500 220"
          fill="none"
          stroke="var(--muted-ink)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.28"
        />
      </svg>
      <div
        className="l-plane pointer-events-none absolute z-0 hidden text-[color:var(--ink)] sm:block"
        style={{ top: "16%", right: "16%" }}
        aria-hidden
      >
        <div className="grid h-16 w-16 -rotate-12 place-items-center rounded-2xl border border-[color:var(--line)] bg-[color:var(--card)] shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
          <Send className="h-7 w-7" />
        </div>
      </div>

      {/* ---------- Header ---------- */}
      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
        <div className="l-rise flex items-center gap-2.5">
          <ThemeIcon />
          <span className="text-lg font-semibold tracking-tight">
            PaperPilot
          </span>
        </div>

        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="l-surface l-rise flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium"
          style={{ "--d": "0.06s" } as CSSProperties}
          aria-label="View source code on GitHub"
        >
          <GitHubMark className="h-4 w-4" />
          <span className="hidden sm:inline">Source</span>
        </a>
      </header>

      {/* ---------- Hero ---------- */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-2xl text-center">
          <div
            className="l-rise l-surface mb-7 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium tracking-wide"
            style={{ "--d": "0.1s" } as CSSProperties}
          >
            <span className="text-[color:var(--muted-ink)]">✦</span>
            RAG document copilot
          </div>

          <h1
            className="l-rise l-display text-[clamp(2.75rem,9vw,5.25rem)]"
            style={{ "--d": "0.16s" } as CSSProperties}
          >
            Ask your documents{" "}
            <span className="l-serif l-mark">anything.</span>
          </h1>

          <p
            className="l-rise l-muted mx-auto mt-6 max-w-xl text-base leading-relaxed sm:text-lg"
            style={{ "--d": "0.24s" } as CSSProperties}
          >
            PaperPilot turns your PDFs, DOCX and notes into a conversation. Get
            streaming, citation-backed answers — every claim traceable straight
            back to its source.
          </p>

          {/* ---------- Sign in / provider morph ---------- */}
          <div
            className="l-rise mx-auto mt-9 flex min-h-[3.25rem] w-full max-w-sm flex-col items-center"
            style={{ "--d": "0.32s" } as CSSProperties}
          >
            {!showProviders ? (
              <>
                <button
                  onClick={() => setShowProviders(true)}
                  className="l-cta group flex h-13 w-full items-center justify-center gap-2 rounded-2xl px-6 text-base font-semibold"
                >
                  Sign in
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </button>
                <p className="l-muted mt-3 text-xs">
                  Free · no card · GitHub or Google
                </p>
              </>
            ) : (
              <div className="w-full space-y-2.5">
                <button
                  onClick={() => signIn("github")}
                  disabled={loading !== null}
                  className="l-surface l-pop flex h-13 w-full items-center justify-center gap-2.5 rounded-2xl px-6 text-base font-semibold"
                >
                  {loading === "github" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <GitHubMark className="h-5 w-5" />
                  )}
                  Continue with GitHub
                </button>
                <button
                  onClick={() => signIn("google")}
                  disabled={loading !== null}
                  className="l-surface l-pop flex h-13 w-full items-center justify-center gap-2.5 rounded-2xl px-6 text-base font-semibold"
                  style={{ "--d": "0.06s" } as CSSProperties}
                >
                  {loading === "google" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <GoogleMark className="h-5 w-5" />
                  )}
                  Continue with Google
                </button>
                <button
                  onClick={() => setShowProviders(false)}
                  disabled={loading !== null}
                  className="l-muted mx-auto mt-1 flex items-center gap-1.5 text-xs font-medium hover:text-[color:var(--ink)] disabled:opacity-50"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  back
                </button>
              </div>
            )}
          </div>

          {/* ---------- Feature chips ---------- */}
          <div
            className="l-rise mt-12 flex flex-wrap items-center justify-center gap-2.5"
            style={{ "--d": "0.4s" } as CSSProperties}
          >
            {features.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="l-surface flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium"
              >
                <Icon className="h-3.5 w-3.5 text-[color:var(--muted-ink)]" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* ---------- Footer ---------- */}
      <footer
        className="l-rise l-muted relative z-10 px-5 py-5 text-center text-xs sm:px-8"
        style={{ "--d": "0.48s" } as CSSProperties}
      >
        Built with FastAPI · React · Supabase ·{" "}
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[color:var(--muted-ink)] decoration-1 underline-offset-2 hover:text-[color:var(--ink)]"
        >
          open source
        </a>
      </footer>
    </div>
  );
}
