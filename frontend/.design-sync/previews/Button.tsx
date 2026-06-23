import { Button } from "paperpilot";
import { Plus, Send, Trash2, Loader2 } from "lucide-react";

// All button variants, labelled with real app actions.
export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="default">New Chat</Button>
      <Button variant="secondary">Documents</Button>
      <Button variant="outline">Cancel</Button>
      <Button variant="ghost">Sign out</Button>
      <Button variant="destructive">Delete</Button>
      <Button variant="link">Learn more</Button>
    </div>
  );
}

// The four button sizes, smallest to largest.
export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </div>
  );
}

// Buttons with leading icons, icon-only buttons, and a disabled loading state.
export function WithIcons() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button>
        <Plus /> New Chat
      </Button>
      <Button size="icon" aria-label="Send">
        <Send />
      </Button>
      <Button variant="destructive" size="icon" aria-label="Delete">
        <Trash2 />
      </Button>
      <Button variant="outline" disabled>
        <Loader2 className="animate-spin" /> Uploading
      </Button>
    </div>
  );
}
