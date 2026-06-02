import { useState } from "react";
import { Loader2 } from "lucide-react";
import ChatBox from "@/components/ChatBox";
import UploadBox from "@/components/UploadBox";
import Sidebar from "@/components/Sidebar";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useChatSessions } from "@/hooks/useChatSessions";

export default function AppPage() {
  const [showDocs, setShowDocs] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
      />

      <main className="flex flex-1 overflow-hidden">
        {showDocs && (
          <div className="w-80 border-r border-border bg-background overflow-y-auto">
            <UploadBox />
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          {activeSession && activeChatId && (
            <ErrorBoundary key={activeChatId}>
              <ChatBox
                key={activeChatId}
                chatId={activeChatId}
                messages={activeSession.messages}
                docIds={activeSession.docIds}
                onMessagesChange={(updater) =>
                  updateMessages(activeChatId, updater)
                }
                onDocIdsChange={(ids) => updateDocIds(activeChatId, ids)}
              />
            </ErrorBoundary>
          )}
        </div>
      </main>
    </div>
  );
}
