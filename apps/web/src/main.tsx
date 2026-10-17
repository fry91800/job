import "./styles.css";
import "./i18n";
import * as Tooltip from "@radix-ui/react-tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { queryClient } from "./api/queries";
import { Shell } from "./layout/Shell";
import { startAnalytics } from "./lib/analytics";

void startAnalytics();

// Every address is handled by the workspace shell: addresses name tabs (FRONTEND.md §2.4).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
    <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Shell />} />
        </Routes>
      </BrowserRouter>
    </Tooltip.Provider>
    </QueryClientProvider>
  </StrictMode>,
);
