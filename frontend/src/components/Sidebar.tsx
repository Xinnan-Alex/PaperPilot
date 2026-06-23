import {
  Plus,
  FileText,
  PanelLeftClose,
  PanelLeft,
  FileUp,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Dialog, DialogContent } from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./ui/alert-dialog";
import { useSession } from "@/hooks/useSession";
import { ThemeToggle } from "./ThemeToggle";
import { BrandMark } from "./BrandMark";
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

// Stateless — closes over nothing from the component, so it lives at module
// scope (one binding) rather than being recreated on every render.
const handleSignOut = async () => {
  await supabase.auth.signOut();
};

// Collapsible account menu — Sign out today, room for Settings etc. later.
// `trigger` is the clickable element; placement adapts to the sidebar mode.
function AccountMenu({
  trigger,
  side = "top",
  align = "end",
}: {
  trigger: ReactNode;
  side?: "top" | "right";
  align?: "start" | "end";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="w-48">
        <DropdownMenuItem
          onSelect={handleSignOut}
          className="text-muted-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  // ID of the chat session pending delete confirmation (null = none open).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
        <BrandMark className="h-8 w-8" />
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
        <AccountMenu
          side="right"
          align="end"
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Account menu"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                <span className="text-[10px] font-medium">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              </div>
            </Button>
          }
        />
      </div>
    </div>
  );

  const fullSidebarBody = (
    <div className="flex h-full w-full flex-col bg-sidebar-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <BrandMark className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">PaperPilot</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Mobile chat header has its own toggle; only show here on desktop. */}
          <span className="hidden md:inline-flex">
            <ThemeToggle />
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex h-8 w-8"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
          {/* Plain button (not DialogClose): fullSidebarBody also renders on the
              desktop path outside any Dialog, so a DialogClose here would throw.
              onMobileClose drives the Dialog's open state; Radix still returns
              focus on close. */}
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
                    type="button"
                    onClick={() => handleSelectChat(session.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-sidebar-accent",
                      session.id === activeChatId &&
                        "bg-sidebar-accent text-sidebar-accent-foreground",
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate pr-7">
                      {session.title}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 z-10 h-7 w-8 -translate-y-1/2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity active:-translate-y-1/2! active:scale-90 active:bg-destructive/15 active:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(session.id);
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
        <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted">
            <span className="text-xs font-medium">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{displayName}</p>
          </div>
          <AccountMenu
            side="top"
            align="end"
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground"
                aria-label="Account menu"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar — unchanged */}
      <div
        className={cn(
          "hidden md:flex h-svh shrink-0 border-r border-border",
          collapsed ? "w-14" : "w-64",
        )}
      >
        {collapsed ? compactSidebarBody : fullSidebarBody}
      </div>

      {/* Mobile drawer — Radix Dialog for focus trap, Escape-to-close, and aria-modal */}
      <Dialog
        open={mobileOpen}
        onOpenChange={(open) => {
          if (!open) onMobileClose();
        }}
      >
        <DialogContent
          side="left"
          className="w-72 max-w-[85vw] p-0"
          title="Navigation"
        >
          {fullSidebarBody}
        </DialogContent>
      </Dialog>

      {/* Chat delete confirmation — AlertDialog */}
      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this conversation. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeleteId) {
                  onDeleteChat(confirmDeleteId);
                  setConfirmDeleteId(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
