import { Moon, Sun } from "lucide-react";
import { useThemeTransition } from "@/hooks/useThemeTransition";
import { Button } from "./ui/button";

export function ThemeToggle() {
  const { isDark, animating, toggleFromElement } = useThemeTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={(e) => toggleFromElement(e.currentTarget)}
      disabled={animating}
      className="h-8 w-8"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );
}
