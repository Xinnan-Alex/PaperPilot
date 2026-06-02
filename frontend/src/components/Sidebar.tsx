import {
  Plus,
  FileText,
  PanelLeftClose,
  PanelLeft,
  FileUp,
  LogOut,
  MessageSquare,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { useSession } from "@/hooks/useSession";
import { ThemeToggle } from "./ThemeToggle";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { ChatSession } from "@/hooks/useChatSessions";

interface SidebarProps {
  sessions: ChatSession[];
  activeChatId: string;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onToggleDocs: () => void;
  showDocs: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar({
  sessions,
  activeChatId,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onToggleDocs,
  showDocs,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileClose,
}: SidebarProps) {
  const { user } = useSession();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const displayName =
    user?.user_metadata?.user_name ||
    user?.email?.split("@")[0] ||
    "User";

  const handleSelectChat = (id: string) => {
    onSelectChat(id);
    onMobileClose();
  };

  const handleNewChat = () => {
    onNewChat();
    onMobileClose();
  };

  const handleToggleDocs = () => {
    onToggleDocs();
    onMobileClose();
  };

  const compactSidebarBody = (
    <div className="flex h-full w-full flex-col items-center bg-sidebar-background py-4">
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

  const fullSidebarBody = (
    <div className="flex h-full w-full flex-col bg-sidebar-background">
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
            className="hidden md:inline-flex h-8 w-8"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden h-8 w-8"
            onClick={onMobileClose}
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Nav Items */}
      <nav className="flex flex-col gap-0.5 px-3">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-sm font-normal"
          onClick={handleNewChat}
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
          onClick={handleToggleDocs}
        >
          <FileText className="h-4 w-4" />
          Documents
        </Button>
      </nav>

      {/* Chat History */}
      <div className="mt-3 flex-1 overflow-y-auto px-3">
        {sessions.length > 0 && (
          <>
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Chats
            </p>
            <ul className="space-y-0.5">
              {sessions.map((session) => (
                <li key={session.id} className="group relative">
                  <button
                    onClick={() => handleSelectChat(session.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-sidebar-accent",
                      session.id === activeChatId &&
                        "bg-sidebar-accent text-sidebar-accent-foreground",
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate pr-5">
                      {session.title}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat(session.id);
                    }}
                    aria-label="Delete chat"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

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

  return (
    <>
      {/* Desktop sidebar */}
      <div
        className={cn(
          "hidden md:flex h-svh shrink-0 border-r border-border",
          collapsed ? "w-14" : "w-64",
        )}
      >
        {collapsed ? compactSidebarBody : fullSidebarBody}
      </div>

      {/* Mobile drawer */}
      <div
        className={cn(
          "md:hidden fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] border-r border-border transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {fullSidebarBody}
      </div>
    </>
  );
}
