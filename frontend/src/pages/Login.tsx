import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function Login() {
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) {
        toast.error(error.message);
      }
    } catch {
      toast.error("Failed to start sign-in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">PaperPilot</CardTitle>
          <CardDescription>
            Ask questions about your documents with AI
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={signIn} disabled={loading} className="w-full">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Sign in with Github
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
