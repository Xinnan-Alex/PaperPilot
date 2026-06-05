import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Loads the Geist Variable @font-face used by --font-sans in index.css.
import "@fontsource-variable/geist";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider } from "./components/ThemeProvider";
import { ModelProvider } from "./components/ModelProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <ModelProvider>
        <App />
      </ModelProvider>
    </ThemeProvider>
  </StrictMode>,
);
