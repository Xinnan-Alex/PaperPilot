import { useState } from "react";
import ChatBox from "@/components/ChatBox";
import UploadBox from "@/components/UploadBox";
import Sidebar from "@/components/Sidebar";

export default function AppPage() {
  const [showDocs, setShowDocs] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [chatKey, setChatKey] = useState(0);

  const handleNewChat = () => {
    setChatKey((k) => k + 1);
  };

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background">
      <Sidebar
        onNewChat={handleNewChat}
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
          <ChatBox key={chatKey} />
        </div>
      </main>
    </div>
  );
}
