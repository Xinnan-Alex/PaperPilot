import { useState } from "react";
import { Loader2, X } from "lucide-react";
import ChatBox from "@/components/ChatBox";
import UploadBox from "@/components/UploadBox";
import Sidebar from "@/components/Sidebar";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { useChatSessions } from "@/hooks/useChatSessions";

export default function AppPage() {
  const [showDocs, setShowDocs] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
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
  } = useChatSessions();

  if (loading) {
    return (
      <div className="flex h-svh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background">
      {/* Mobile sidebar backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

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
        {showDocs && (
          <>
            <div
              className="fixed inset-0 z-30 bg-black/50 md:hidden"
              onClick={() => setShowDocs(false)}
              aria-hidden="true"
            />
            <div className="fixed inset-y-0 right-0 z-40 w-full max-w-sm border-l border-border bg-background overflow-y-auto md:static md:z-auto md:max-w-none md:w-80 md:border-l-0 md:border-r">
              <div className="flex justify-end p-2 md:hidden">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowDocs(false)}
                  aria-label="Close documents"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <UploadBox />
            </div>
          </>
        )}
        <div className="flex-1 overflow-hidden">
          {activeSession && activeChatId && (
            <ErrorBoundary key={activeChatId}>
              <ChatBox
                key={activeChatId}
                chatId={activeChatId}
                messages={activeSession.messages}
                docIds={activeSession.docIds}
                chatTitle={activeSession.title}
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
