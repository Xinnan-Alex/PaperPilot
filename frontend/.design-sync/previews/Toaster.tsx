import { useEffect } from "react";
import { Toaster, toast } from "paperpilot";

// Toasts are imperative (sonner's `toast()`), so this story fires one on mount
// and renders the <Toaster /> host that paints it. In a real app you mount
// <Toaster /> once near the root and call `toast.success(...)`, `toast.error(...)`,
// `toast.info(...)` from anywhere.
//
// The inline <style> only neutralizes sonner's entrance animation (toasts start
// at opacity:0 until JS flips data-mounted, which a static screenshot captures
// too early) — the toast itself is the real sonner component and its own
// injected styles.
export function Notification() {
  useEffect(() => {
    toast.success("Document ready", {
      id: "design-sync-preview-toast",
      description: "annual-report.pdf was embedded and is now searchable.",
      duration: Infinity,
    });
  }, []);

  return (
    <>
      <style>{`[data-sonner-toast]{opacity:1!important;transform:translateY(0)!important}[data-sonner-toast]>*{opacity:1!important}`}</style>
      <Toaster position="top-center" />
    </>
  );
}
