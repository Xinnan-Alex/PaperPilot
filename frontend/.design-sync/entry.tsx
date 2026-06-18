// design-sync entry — scoped re-export of the renderable design-system surface.
// Hand-written (not the synth auto-entry) so the IIFE bundle excludes app
// components whose transitive imports (lib/supabase.ts → createClient at module
// load) would otherwise run at bundle eval and blank every preview.
// Committed sync input — required by re-sync (passed via --entry).
export * from "@/components/ui/button";
export * from "@/components/ui/badge";
export * from "@/components/ui/skeleton";
export * from "@/components/ui/dialog";
export * from "@/components/ui/dropdown-menu";
export * from "@/components/ui/alert-dialog";
export * from "@/components/ui/sonner";
// Re-export sonner's imperative `toast` from the SAME bundled instance the
// Toaster subscribes to, so previews (and design-tool code) fire toasts that
// actually reach the rendered host.
export { toast } from "sonner";
export * from "@/components/BrandMark";
export * from "@/components/ThemeToggle";
