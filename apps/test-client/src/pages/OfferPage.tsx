import { useCallback, useEffect, useState } from "react";
import type { OfferDetail } from "@job/shared";
import { api, errorText } from "../api";
import { SavedEditor } from "../SavedEditor";
import { formatLocation, formatSalary } from "./SearchPage";

export function OfferPage({ id, refreshMe }: { id: string; refreshMe: () => void }) {
  const [lang, setLang] = useState("");
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await api<OfferDetail>("GET", `/api/offers/${id}${lang ? `?lang=${lang}` : ""}`);
    setError(errorText(result));
    setOffer(result.ok ? result.data : null);
  }, [id, lang]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    const result = await api("PUT", `/api/saved-offers/${id}`);
    setError(errorText(result));
    refreshMe(); // saving may have created a guest
    load();
  }

  if (!offer) return <p className="error">{error}</p>;

  return (
    <div>
      <h2>{offer.title}</h2>
      {offer.closedAt && <p className="error">No longer available (closed {new Date(offer.closedAt).toLocaleDateString()})</p>}
      {!offer.isPublic && <p className="muted">Private offer{offer.isOwn ? " (added by you)" : ""}</p>}
      <table>
        <tbody>
          <tr><th>Company</th><td>{offer.companyName ?? "—"}</td></tr>
          <tr><th>Location</th><td>{formatLocation(offer.location)}</td></tr>
          <tr><th>Remote / contract</th><td>{offer.remoteType ?? "—"} / {offer.contractType ?? "—"}</td></tr>
          <tr><th>Salary</th><td>{formatSalary(offer.salary)}</td></tr>
          <tr><th>Published</th><td>{offer.publishedAt ? new Date(offer.publishedAt).toLocaleString() : "—"}</td></tr>
          <tr><th>Language</th><td>{offer.language ?? "—"}</td></tr>
          <tr><th>Original</th><td>{offer.url ? <a href={offer.url} target="_blank" rel="noopener noreferrer">{offer.url}</a> : "—"}</td></tr>
          <tr>
            <th>Skills</th>
            <td>
              {offer.skills.map((skill) => `${skill.name} (${skill.id})`).join(", ") || "none"}{" "}
              <select value={lang} onChange={(event) => setLang(event.target.value)}>
                <option value="">default language</option>
                <option value="fr">fr</option>
                <option value="en">en</option>
              </select>
            </td>
          </tr>
          <tr><th>Occupations</th><td>{offer.occupations.map((occupation) => occupation.name).join(", ") || "none"}</td></tr>
          <tr><th>Generated resumes</th><td>{offer.generatedResumes.length}</td></tr>
          <tr>
            <th>Saved</th>
            <td>{offer.saved ? <SavedEditor key={JSON.stringify(offer.saved)} offerId={offer.id} saved={offer.saved} onChange={load} /> : <button onClick={save}>Save</button>}</td>
          </tr>
        </tbody>
      </table>
      {error && <p className="error">{error}</p>}
      <h3>Description (raw Markdown)</h3>
      <pre>{offer.description}</pre>
    </div>
  );
}
