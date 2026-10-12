import { useState } from "react";
import { SAVED_OFFER_STATUSES, type SavedOfferInfo } from "@job/shared";
import { api, errorText } from "./api";

// Edits one saved offer: status, notes, applied date, unsave.
export function SavedEditor({ offerId, saved, onChange }: { offerId: string; saved: SavedOfferInfo; onChange: () => void }) {
  const [notes, setNotes] = useState(saved.notes ?? "");
  const [appliedAt, setAppliedAt] = useState(saved.appliedAt?.slice(0, 10) ?? "");
  const [error, setError] = useState("");
  const path = `/api/saved-offers/${offerId}`;

  async function patch(body: object) {
    const result = await api("PATCH", path, body);
    setError(errorText(result));
    if (result.ok) onChange();
  }

  async function unsave() {
    if ((saved.status !== "saved" || saved.notes) && !confirm("Unsave this offer? Its status and notes will be lost.")) return;
    const result = await api("DELETE", path);
    setError(errorText(result));
    if (result.ok) onChange();
  }

  return (
    <div>
      <select value={saved.status} onChange={(event) => patch({ status: event.target.value })}>
        {SAVED_OFFER_STATUSES.map((status) => <option key={status}>{status}</option>)}
      </select>{" "}
      <span className="muted">
        saved {new Date(saved.savedAt).toLocaleString()}, status changed {new Date(saved.statusChangedAt).toLocaleString()}
      </span>
      <div>
        <textarea rows={2} cols={50} value={notes} onChange={(event) => setNotes(event.target.value)} />{" "}
        <button onClick={() => patch({ notes: notes || null })}>Save notes</button>
      </div>
      <div>
        Applied on <input type="date" value={appliedAt} onChange={(event) => setAppliedAt(event.target.value)} />{" "}
        <button onClick={() => patch({ appliedAt: appliedAt ? new Date(appliedAt).toISOString() : null })}>Set date</button>{" "}
        <button onClick={unsave}>Unsave</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
