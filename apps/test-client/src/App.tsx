import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "@job/shared";
import { api, onApiCall, type LogEntry } from "./api";
import { AuthPage } from "./pages/AuthPage";
import { GeneratedPage, GeneratedResumePage } from "./pages/GeneratedPages";
import { OfferPage } from "./pages/OfferPage";
import { PhotosPage } from "./pages/PhotosPage";
import { ResumePage, ResumesPage } from "./pages/ResumePages";
import { SavedPage } from "./pages/SavedPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";

type Tab = "search" | "saved" | "resumes" | "photos" | "generated" | "settings" | "auth";
export type Page = { name: Tab } | { name: "offer" | "resume" | "generatedResume"; id: string };
export type Navigate = (page: Page) => void;

// Minimal client for trying the API by hand (see ARCHITECTURE.md "Test client").
export function App() {
  const [page, setPage] = useState<Page>({ name: "search" });
  const [me, setMe] = useState<MeResponse["user"]>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  useEffect(() => onApiCall((entry) => setLog((entries) => [entry, ...entries].slice(0, 50))), []);

  const refreshMe = useCallback(async () => {
    const result = await api<MeResponse>("GET", "/api/auth/me");
    if (result.ok) setMe(result.data.user);
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const openOffer = (id: string) => setPage({ name: "offer", id });
  const tab = (name: Tab, label: string) => (
    <button aria-current={page.name === name ? "page" : undefined} onClick={() => setPage({ name })}>
      {label}
    </button>
  );

  return (
    <div className="layout">
      <main>
        <nav>
          {tab("search", "Search")} {tab("saved", "Saved offers")} {tab("resumes", "Resumes")} {tab("photos", "Photos")} {tab("generated", "Generated")}{" "}
          {tab("settings", "Settings")} {tab("auth", "Account")}{" "}
          <span className="muted">
            {me ? `${me.isGuest ? "Guest" : me.email} (${me.id.slice(0, 8)})` : "Anonymous"}
          </span>
        </nav>
        {page.name === "search" && <SearchPage me={me} openOffer={openOffer} refreshMe={refreshMe} />}
        {page.name === "offer" && <OfferPage key={page.id} id={page.id} me={me} refreshMe={refreshMe} navigate={setPage} />}
        {page.name === "resumes" && <ResumesPage navigate={setPage} refreshMe={refreshMe} />}
        {page.name === "resume" && <ResumePage key={page.id} id={page.id} refreshMe={refreshMe} />}
        {page.name === "photos" && <PhotosPage />}
        {page.name === "generated" && <GeneratedPage navigate={setPage} />}
        {page.name === "generatedResume" && <GeneratedResumePage key={page.id} id={page.id} navigate={setPage} />}
        {page.name === "settings" && <SettingsPage refreshMe={refreshMe} />}
        {page.name === "saved" && <SavedPage openOffer={openOffer} />}
        {page.name === "auth" && <AuthPage me={me} refreshMe={refreshMe} />}
      </main>
      <aside>
        <strong>Requests</strong> <button onClick={() => setLog([])}>Clear</button>
        {log.map((entry) => (
          <details key={entry.id}>
            <summary className={entry.status >= 400 ? "error" : undefined}>
              {entry.status} {entry.method} {entry.path}
            </summary>
            {entry.body !== undefined && <pre>{JSON.stringify(entry.body, null, 2)}</pre>}
            <pre>{JSON.stringify(entry.response, null, 2)}</pre>
          </details>
        ))}
      </aside>
    </div>
  );
}
