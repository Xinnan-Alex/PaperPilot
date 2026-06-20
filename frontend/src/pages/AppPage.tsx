import { useCallback, useState } from "react";
import { Loader2, X } from "lucide-react";
import ChatBox from "@/components/ChatBox";
import UploadBox from "@/components/UploadBox";
import Sidebar from "@/components/Sidebar";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { useChatSessions } from "@/hooks/useChatSessions";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function AppPage() {
  const [showDocs, setShowDocs] = useState(false);
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [docsVersion, setDocsVersion] = useState(0);
  const {
    sessions,
    activeChatId,
    activeSession,
    loading,
    createChat,
    selectChat,
    deleteChat,
    updateMessages,
    updateDocIds,
    removeDocFromAllSessions,
  } = useChatSessions();

  const handleDocDeleted = useCallback(
    (docId: string) => {
      removeDocFromAllSessions(docId);
      setDocsVersion((v) => v + 1);
    },
    [removeDocFromAllSessions],
  );

  const handleDocsChanged = useCallback(() => {
    setDocsVersion((v) => v + 1);
  }, []);

  if (loading) {
    return (
      <div className="app-shell flex h-svh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="app-shell flex h-svh w-full overflow-hidden bg-background">
      {/* Sidebar: desktop renders inline; mobile uses Radix Dialog inside Sidebar */}
      <Sidebar
        sessions={sessions}
        activeChatId={activeChatId ?? ""}
        onNewChat={createChat}
        onSelectChat={selectChat}
        onDeleteChat={deleteChat}
        onToggleDocs={() => setShowDocs(!showDocs)}
        showDocs={showDocs}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <main className="flex flex-1 overflow-hidden">
        {/* Desktop docs panel — static column, unchanged */}
        {showDocs && (
          <div className="hidden md:block w-80 border-r border-border overflow-y-auto shrink-0">
            <UploadBox
              onDocDeleted={handleDocDeleted}
              onDocsChanged={handleDocsChanged}
            />
          </div>
        )}

        {/* Mobile docs panel — Radix Dialog drawer (right side). Gated on
            `isMobile` so it never opens on desktop: `showDocs` also drives the
            static desktop column above, and an open Dialog would otherwise
            activate its overlay/focus-trap/scroll-lock on desktop. UploadBox is
            mounted in both panels but only one is ever in the DOM at a time. */}
        <Dialog
          open={showDocs && isMobile}
          onOpenChange={(open) => {
            if (!open) setShowDocs(false);
          }}
        >
          <DialogContent
            side="right"
            className="w-full max-w-sm p-0 overflow-y-auto"
            title="Documents"
          >
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-[calc(env(safe-area-inset-top)_+_0.5rem)] z-10 h-8 w-8"
                aria-label="Close documents"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
            <UploadBox
              onDocDeleted={handleDocDeleted}
              onDocsChanged={handleDocsChanged}
            />
          </DialogContent>
        </Dialog>

        <div className="flex-1 overflow-hidden">
          {activeSession && activeChatId && (
            <ErrorBoundary key={activeChatId}>
              <ChatBox
                key={activeChatId}
                chatId={activeChatId}
                messages={activeSession.messages}
                docIds={activeSession.docIds}
                chatTitle={activeSession.title}
                docsVersion={docsVersion}
                onMessagesChange={(updater) =>
                  updateMessages(activeChatId, updater)
                }
                onDocIdsChange={(ids) => updateDocIds(activeChatId, ids)}
                onOpenSidebar={() => setMobileSidebarOpen(true)}
              />
            </ErrorBoundary>
          )}
        </div>
      </main>
    </div>
  );
}
