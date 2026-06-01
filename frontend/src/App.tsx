import { Loader2 } from "lucide-react";
import { useSession } from "./hooks/useSession";
import Login from "./pages/Login";
import AppPage from "./pages/AppPage";
import { Toaster } from "./components/ui/sonner";

export default function App() {
  const { user, loading } = useSession();

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <>
      <AppPage />
      <Toaster richColors position="top-right" />
    </>
  );
}
