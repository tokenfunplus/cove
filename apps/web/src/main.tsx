import { App } from "@/App";
import { initializeSkin } from "@/theme/skin";
import { QueryClientProvider } from "@tanstack/react-query";
import { createLocalServiceQueryClient } from "@/api/queryClient";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

initializeSkin();

const queryClient = createLocalServiceQueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
