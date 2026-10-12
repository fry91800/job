import { useState } from "react";
import type { OfferDetail, OfferDraft, OfferExtractResponse } from "@job/shared";
import { api, errorText } from "../api";
import type { Navigate } from "../App";
import { OfferForm } from "../OfferForm";

// User-added offer (O5): URL or pasted text → review the draft → create.
export function AddOfferPage({ navigate, refreshMe }: { navigate: Navigate; refreshMe: () => void }) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<OfferDraft | null>(null);
  const [message, setMessage] = useState("");

  async function extract(body: { url: string } | { text: string }) {
    const result = await api<OfferExtractResponse>("POST", "/api/user-offers/extract", body);
    refreshMe(); // may have created a guest
    if (!result.ok) {
      const existing = (result.error.details as { existingOfferId?: string } | undefined)?.existingOfferId;
      return setMessage(errorText(result) + (existing ? ` (existing offer ${existing})` : ""));
    }
    setMessage("");
    if ("existingOfferId" in result.data) return navigate({ name: "offer", id: result.data.existingOfferId });
    setDraft(result.data.draft);
  }

  async function create(reviewed: OfferDraft) {
    const result = await api<OfferDetail>("POST", "/api/user-offers", reviewed);
    if (result.ok) return navigate({ name: "offer", id: result.data.id });
    const existing = (result.error.details as { existingOfferId?: string } | undefined)?.existingOfferId;
    if (existing && confirm("An offer with this URL already exists. Open it?")) return navigate({ name: "offer", id: existing });
    setMessage(errorText(result));
  }

  return (
    <div>
      <p className="muted">The page (or the pasted text) is read by the AI; check every field before creating the offer. Sites with a login wall (e.g. LinkedIn) can't be read: paste the text instead.</p>
      <fieldset>
        <legend>From a URL</legend>
        <input size={70} value={url} onChange={(event) => setUrl(event.target.value)} /> <button onClick={() => extract({ url })}>Extract</button>
      </fieldset>
      <fieldset>
        <legend>From pasted text</legend>
        <textarea rows={6} style={{ width: "100%" }} value={text} onChange={(event) => setText(event.target.value)} />
        <button onClick={() => extract({ text })}>Extract</button>
      </fieldset>
      {message && <p className="error">{message}</p>}
      {draft && (
        <>
          <h3>Review</h3>
          <OfferForm key={JSON.stringify(draft)} initial={draft} submitLabel="Create offer" onSubmit={create} />
        </>
      )}
    </div>
  );
}
