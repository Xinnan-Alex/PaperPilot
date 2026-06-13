import { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import ChatBox from "@/components/ChatBox";
import UploadBox from "@/components/UploadBox";
import Sidebar from "@/components/Sidebar";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useChatSessions } from "@/hooks/useChatSessions";

export default function AppPage() {
  const [showDocs, setShowDocs] = useState(false);
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
      <div className="flex h-svh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background">
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

        {/* Mobile docs panel — Radix Dialog drawer (right side).
            UploadBox is mounted twice (once here, once in the desktop column
            above) but only one is ever rendered at a time: the desktop column
            is `hidden md:block` and this Dialog only opens on mobile.
            Two separate mounts was chosen for correctness/a11y over a shared
            mount that would need complex forwarding. */}
        <Dialog
          open={showDocs}
          onOpenChange={(open) => {
            if (!open) setShowDocs(false);
          }}
        >
          <DialogContent
            side="right"
            className="md:hidden w-full max-w-sm p-0 overflow-y-auto"
            title="Documents"
          >
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
