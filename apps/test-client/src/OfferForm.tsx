import { useState } from "react";
import { CONTRACT_TYPES, REMOTE_TYPES, SALARY_PERIODS, type LocationSummary, type OfferDraft } from "@job/shared";
import { LocationPicker } from "./pages/SearchPage";

// Review / edit form for a user-added offer (O5). Plain inputs, one per field.
export function OfferForm({ initial, initialLocation, submitLabel, onSubmit }: {
  initial: OfferDraft;
  initialLocation?: LocationSummary | null;
  submitLabel: string;
  onSubmit: (draft: OfferDraft) => void;
}) {
  const [draft, setDraft] = useState<OfferDraft>(initial);
  const [location, setLocation] = useState<LocationSummary | null>(initialLocation ?? null);
  const set = <K extends keyof OfferDraft>(key: K, value: OfferDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const text = (key: "title" | "companyName" | "url" | "salaryCurrency", size = 40) => (
    <input size={size} value={draft[key] ?? ""} onChange={(event) => set(key, event.target.value || null)} />
  );
  const number = (key: "salaryMin" | "salaryMax") => (
    <input size={8} value={draft[key] ?? ""} onChange={(event) => set(key, event.target.value === "" ? null : Number(event.target.value))} />
  );
  const choice = <K extends "remoteType" | "contractType" | "salaryPeriod" | "language">(key: K, values: readonly string[]) => (
    <select value={draft[key] ?? ""} onChange={(event) => set(key, (event.target.value || null) as OfferDraft[K])}>
      <option value="">—</option>
      {values.map((value) => <option key={value}>{value}</option>)}
    </select>
  );

  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit({ ...draft, locationId: location?.id ?? null }); }}>
      <table>
        <tbody>
          <tr><th>Title</th><td>{text("title", 60)}</td></tr>
          <tr><th>Company</th><td>{text("companyName")}</td></tr>
          <tr><th>URL</th><td>{text("url", 60)}</td></tr>
          <tr><th>Location</th><td><LocationPicker value={location} onChange={setLocation} /></td></tr>
          <tr><th>Language</th><td>{choice("language", ["fr", "en"])}</td></tr>
          <tr><th>Remote / contract</th><td>{choice("remoteType", REMOTE_TYPES)} {choice("contractType", CONTRACT_TYPES)}</td></tr>
          <tr><th>Salary</th><td>{number("salaryMin")} – {number("salaryMax")} {text("salaryCurrency", 4)} {choice("salaryPeriod", SALARY_PERIODS)}</td></tr>
          <tr>
            <th>Description</th>
            <td><textarea rows={12} style={{ width: "100%" }} value={draft.description} onChange={(event) => set("description", event.target.value)} /></td>
          </tr>
        </tbody>
      </table>
      <button type="submit">{submitLabel}</button>
    </form>
  );
}
