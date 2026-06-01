import { Plus, FileText, PanelLeftClose, PanelLeft, FileUp, LogOut } from "lucide-react";
import { Button } from "./ui/button";
import { useSession } from "@/hooks/useSession";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

interface SidebarProps {
  onNewChat: () => void;
  onToggleDocs: () => void;
  showDocs: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({
  onNewChat,
  onToggleDocs,
  showDocs,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const { user } = useSession();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const displayName =
    user?.user_metadata?.user_name ||
    user?.email?.split("@")[0] ||
    "User";

  if (collapsed) {
    return (
      <div className="flex h-svh w-14 flex-col items-center border-r border-border bg-sidebar-background py-4">
        <div className="mb-6 flex items-center justify-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background font-bold text-sm">
            P
          </div>
        </div>
        <nav className="flex flex-1 flex-col items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onNewChat}
            aria-label="New Chat"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", showDocs && "bg-sidebar-accent")}
            onClick={onToggleDocs}
            aria-label="Documents"
          >
            <FileUp className="h-4 w-4" />
          </Button>
        </nav>
        <div className="flex flex-col items-center gap-2">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={handleSignOut}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-svh w-64 flex-col border-r border-border bg-sidebar-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background font-bold text-sm">
            P
          </div>
          <span className="text-base font-semibold">PaperPilot</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex flex-col gap-0.5 px-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-sm font-normal"
          onClick={onNewChat}
        >
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-2 text-sm font-normal",
            showDocs && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
          onClick={onToggleDocs}
        >
          <FileText className="h-4 w-4" />
          Documents
        </Button>
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Footer */}
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 rounded-lg px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
            <span className="text-xs font-medium">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{displayName}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          className="mt-1 w-full justify-start gap-2 text-sm font-normal text-muted-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
