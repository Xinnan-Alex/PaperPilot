import ChatBox from "@/components/ChatBox";
import UploadBox from "@/components/UploadBox";
import { useSession } from "@/hooks/useSession";

export default function AppPage() {
  const { user } = useSession();

  return (
    <main className="mx-auto flex h-svh max-w-4xl flex-col gap-0 p-4">
      <header className="flex items-center justify-between border-b pb-3">
        <h1 className="text-lg font-semibold">PaperPilot</h1>
        <p className="text-sm text-muted-foreground">
          {user?.email ?? user?.user_metadata?.user_name ?? "Signed in"}
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-hidden pt-4">
        <UploadBox />
        <ChatBox />
      </div>
    </main>
  );
}
