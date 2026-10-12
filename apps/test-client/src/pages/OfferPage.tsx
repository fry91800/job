import { useCallback, useEffect, useState } from "react";
import { computeMatch, type GeneratedResumeDetail, type LanguageMismatchDetails, type MeResponse, type OfferDetail } from "@job/shared";
import { api, errorText } from "../api";
import type { Navigate } from "../App";
import { GenerateOptions, type GenerateRequestOptions } from "../GenerateOptions";
import { OfferForm } from "../OfferForm";
import { GeneratedList } from "./GeneratedPages";
import { SavedEditor } from "../SavedEditor";
import { formatLocation, formatSalary } from "./SearchPage";

export function OfferPage({ id, me, refreshMe, navigate }: { id: string; me: MeResponse["user"]; refreshMe: () => void; navigate: Navigate }) {
  const [lang, setLang] = useState("");
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

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

  // M1 with the modifier off (AI not available yet). A language mismatch asks what to do.
  async function generate(options: Partial<GenerateRequestOptions> & { resumeId?: string; ignoreLanguageMismatch?: boolean }) {
    setError("Generating…");
    const result = await api<GeneratedResumeDetail>("POST", "/api/generated-resumes", { offerId: id, ...options });
    if (result.ok) {
      refreshMe();
      return navigate({ name: "generatedResume", id: result.data.id });
    }
    if (result.error.code === "language_mismatch") {
      const details = result.error.details as LanguageMismatchDetails;
      if (details.alternativeResumeId && confirm(`The offer is in ${details.offerLanguage}. Use your ${details.offerLanguage} resume instead?`)) {
        return generate({ ...options, resumeId: details.alternativeResumeId });
      }
      if (confirm(`The offer is in ${details.offerLanguage}, your resume in ${details.resumeLanguage}. Generate in ${details.resumeLanguage} anyway?`)) {
        return generate({ ...options, ignoreLanguageMismatch: true });
      }
      return setError("");
    }
    setError(errorText(result));
  }

  if (!offer) return <p className="error">{error}</p>;

  // The creator edits a private user-added offer (O5).
  if (editing) {
    const draft = {
      title: offer.title, companyName: offer.companyName, description: offer.description, language: offer.language as "fr" | "en" | null,
      url: offer.url, locationId: offer.location?.id ?? null, remoteType: offer.remoteType, contractType: offer.contractType,
      salaryMin: offer.salary?.min ?? null, salaryMax: offer.salary?.max ?? null, salaryCurrency: offer.salary?.currency ?? null, salaryPeriod: offer.salary?.period ?? null,
    };
    return (
      <div>
        <h2>Edit offer</h2> <button onClick={() => setEditing(false)}>Cancel</button>
        {error && <p className="error">{error}</p>}
        <OfferForm
          initial={draft}
          initialLocation={offer.location}
          submitLabel="Save"
          onSubmit={async (reviewed) => {
            const result = await api<OfferDetail>("PUT", `/api/user-offers/${offer.id}`, reviewed);
            setError(errorText(result));
            if (result.ok) {
              setEditing(false);
              load();
            }
          }}
        />
      </div>
    );
  }

  const resume = me?.selectedResume;
  const match = resume && computeMatch({ skillIds: offer.skills.map((skill) => skill.id), occupationIds: offer.occupations.map((item) => item.id) }, resume);
  const skillName = (skillId: number) => offer.skills.find((skill) => skill.id === skillId)?.name ?? skillId;

  return (
    <div>
      <h2>{offer.title}</h2>
      {offer.closedAt && <p className="error">No longer available (closed {new Date(offer.closedAt).toLocaleDateString()})</p>}
      {!offer.isPublic && (
        <p className="muted">
          Private offer{offer.isOwn ? " (added by you)" : ""} {offer.isOwn && <button onClick={() => setEditing(true)}>Edit</button>}
        </p>
      )}
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
          <tr>
            <th>Match (O4)</th>
            <td>
              {!match ? "Select a resume to see the match" : match.score === null ? "Not enough data" : `${match.score} %`}
              {match && (
                <div className="muted">
                  matched: {match.matchedSkillIds.map(skillName).join(", ") || "none"} · missing: {match.missingSkillIds.map(skillName).join(", ") || "none"} ·
                  occupation {match.sharesOccupation ? "shared" : "not shared"}
                </div>
              )}
            </td>
          </tr>
          <tr>
            <th>Generated resumes</th>
            <td>
              <GenerateOptions onGenerate={(options) => generate(options)} />
              <GeneratedList key={offer.generatedResumes.length} offerId={offer.id} navigate={navigate} />
            </td>
          </tr>
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
