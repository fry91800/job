import "./styles.css";
import "./i18n";
import * as Tooltip from "@radix-ui/react-tooltip";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { Shell } from "./layout/Shell";

// Every address is handled by the workspace shell: addresses name tabs (FRONTEND.md §2.4).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Tooltip.Provider delayDuration={400} skipDelayDuration={200}>
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<Shell />} />
        </Routes>
      </BrowserRouter>
    </Tooltip.Provider>
  </StrictMode>,
);
