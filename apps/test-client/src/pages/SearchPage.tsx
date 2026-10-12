import { useEffect, useState } from "react";
import {
  CONTRACT_TYPES,
  PUBLISHED_WITHIN,
  REMOTE_TYPES,
  SALARY_PERIODS,
  SEARCH_RADIUS_CHOICES,
  type LocationAutocompleteResponse,
  type LocationSummary,
  type OfferSearchResponse,
  type OfferSearchResult,
} from "@job/shared";
import { api, errorText } from "../api";

type Form = {
  q: string;
  company: string;
  radius: string;
  includeRemote: boolean;
  skills: string;
  remoteType: string[];
  contractType: string[];
  publishedWithin: string;
  salaryMin: string;
  salaryCurrency: string;
  salaryPeriod: string;
  salaryShownOnly: boolean;
  sort: string;
};

const emptyForm: Form = {
  q: "", company: "", radius: "25", includeRemote: true, skills: "", remoteType: [], contractType: [],
  publishedWithin: "", salaryMin: "", salaryCurrency: "EUR", salaryPeriod: "year", salaryShownOnly: false, sort: "recent",
};

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function formatLocation(location: LocationSummary | null): string {
  if (!location) return "—";
  return `${location.name} (${location.type}${location.countyName && location.type === "city" ? `, ${location.countyName}` : ""})`;
}

export function formatSalary(salary: OfferSearchResult["salary"]): string {
  if (!salary) return "—";
  return `${salary.min ?? "?"}${salary.max !== null && salary.max !== salary.min ? `–${salary.max}` : ""} ${salary.currency}/${salary.period}`;
}

function LocationPicker({ value, onChange }: { value: LocationSummary | null; onChange: (location: LocationSummary | null) => void }) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSummary[]>([]);

  useEffect(() => {
    if (text.trim().length < 2) return setSuggestions([]);
    const timer = setTimeout(async () => {
      const result = await api<LocationAutocompleteResponse>("GET", `/api/locations?q=${encodeURIComponent(text)}`);
      if (result.ok) setSuggestions(result.data.results);
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);

  if (value) {
    return (
      <span>
        {formatLocation(value)} <button type="button" onClick={() => onChange(null)}>×</button>
      </span>
    );
  }
  return (
    <span>
      <input placeholder="City, department, region…" value={text} onChange={(event) => setText(event.target.value)} />
      {suggestions.map((location) => (
        <button type="button" key={location.id} onClick={() => { onChange(location); setText(""); }}>
          {formatLocation(location)}
        </button>
      ))}
    </span>
  );
}

export function SearchPage({ openOffer, refreshMe }: { openOffer: (id: string) => void; refreshMe: () => void }) {
  const [form, setForm] = useState<Form>(emptyForm);
  const [location, setLocation] = useState<LocationSummary | null>(null);
  const [page, setPage] = useState(1);
  const [response, setResponse] = useState<OfferSearchResponse | null>(null);
  const [error, setError] = useState("");

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  async function search(targetPage: number) {
    const params = new URLSearchParams();
    const add = (key: string, value: string) => value && params.set(key, value);
    add("q", form.q);
    add("company", form.company);
    if (location) {
      params.set("locationId", String(location.id));
      if (location.type === "city") params.set("radius", form.radius);
      params.set("includeRemote", String(form.includeRemote));
    }
    add("skills", form.skills.replace(/\s/g, ""));
    add("remoteType", form.remoteType.join(","));
    add("contractType", form.contractType.join(","));
    add("publishedWithin", form.publishedWithin);
    if (form.salaryMin) {
      params.set("salaryMin", form.salaryMin);
      params.set("salaryCurrency", form.salaryCurrency);
      params.set("salaryPeriod", form.salaryPeriod);
    }
    if (form.salaryShownOnly) params.set("salaryShownOnly", "true");
    params.set("sort", form.sort);
    params.set("page", String(targetPage));

    const result = await api<OfferSearchResponse>("GET", `/api/offers?${params}`);
    setError(errorText(result));
    if (result.ok) {
      setResponse(result.data);
      setPage(targetPage);
    }
  }

  async function toggleSave(offer: OfferSearchResult) {
    const result = await api(offer.saved ? "DELETE" : "PUT", `/api/saved-offers/${offer.id}`);
    setError(errorText(result));
    refreshMe(); // saving may have created a guest
    search(page);
  }

  return (
    <div>
      <form onSubmit={(event) => { event.preventDefault(); search(1); }}>
        <fieldset>
          <label>Keywords <input value={form.q} onChange={(event) => set("q", event.target.value)} /></label>
          <label>Company <input value={form.company} onChange={(event) => set("company", event.target.value)} /></label>
          <label>Skill ids <input placeholder="3,12" size={8} value={form.skills} onChange={(event) => set("skills", event.target.value)} /></label>
        </fieldset>
        <fieldset>
          <label>Location</label> <LocationPicker value={location} onChange={setLocation} />
          {location?.type === "city" && (
            <label> Radius{" "}
              <select value={form.radius} onChange={(event) => set("radius", event.target.value)}>
                {SEARCH_RADIUS_CHOICES.map((radius) => <option key={radius} value={radius}>{radius} km</option>)}
              </select>
            </label>
          )}
          {location && (
            <label><input type="checkbox" checked={form.includeRemote} onChange={(event) => set("includeRemote", event.target.checked)} /> Include remote offers</label>
          )}
        </fieldset>
        <fieldset>
          Remote:{" "}
          {REMOTE_TYPES.map((type) => (
            <label key={type}><input type="checkbox" checked={form.remoteType.includes(type)} onChange={() => set("remoteType", toggle(form.remoteType, type))} />{type}</label>
          ))}
          <br />
          Contract:{" "}
          {CONTRACT_TYPES.map((type) => (
            <label key={type}><input type="checkbox" checked={form.contractType.includes(type)} onChange={() => set("contractType", toggle(form.contractType, type))} />{type}</label>
          ))}
        </fieldset>
        <fieldset>
          <label>Published within{" "}
            <select value={form.publishedWithin} onChange={(event) => set("publishedWithin", event.target.value)}>
              <option value="">any time</option>
              {PUBLISHED_WITHIN.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>Min salary <input size={7} value={form.salaryMin} onChange={(event) => set("salaryMin", event.target.value)} /></label>
          <input size={3} value={form.salaryCurrency} onChange={(event) => set("salaryCurrency", event.target.value)} />
          <select value={form.salaryPeriod} onChange={(event) => set("salaryPeriod", event.target.value)}>
            {SALARY_PERIODS.map((period) => <option key={period}>{period}</option>)}
          </select>{" "}
          <label><input type="checkbox" checked={form.salaryShownOnly} onChange={(event) => set("salaryShownOnly", event.target.checked)} /> Salary shown only</label>
          <label>Sort{" "}
            <select value={form.sort} onChange={(event) => set("sort", event.target.value)}>
              <option value="recent">recent</option>
              <option value="relevance">relevance</option>
            </select>
          </label>
        </fieldset>
        <button type="submit">Search</button>{" "}
        <button type="button" onClick={() => { setForm(emptyForm); setLocation(null); }}>Reset</button>
      </form>

      {error && <p className="error">{error}</p>}

      {response && (
        <>
          <p>
            {response.total} offers — page {response.page}/{Math.max(response.totalPages, 1)}{" "}
            <button disabled={page <= 1} onClick={() => search(page - 1)}>Previous</button>{" "}
            <button disabled={page >= response.totalPages} onClick={() => search(page + 1)}>Next</button>
          </p>
          <table>
            <thead>
              <tr><th>Title</th><th>Company</th><th>Location</th><th>Remote / contract</th><th>Salary</th><th>Published</th><th>Skills</th><th>Saved</th></tr>
            </thead>
            <tbody>
              {response.results.map((offer) => (
                <tr key={offer.id}>
                  <td><a onClick={() => openOffer(offer.id)}>{offer.title}</a></td>
                  <td>{offer.companyName ?? "—"}</td>
                  <td>
                    {formatLocation(offer.location)}
                    {offer.locationMatch && <div className="muted">{offer.locationMatch}{offer.distanceKm !== null && `, ${offer.distanceKm} km`}</div>}
                  </td>
                  <td>{offer.remoteType ?? "—"} / {offer.contractType ?? "—"}</td>
                  <td>{formatSalary(offer.salary)}</td>
                  <td>{offer.publishedAt ? new Date(offer.publishedAt).toLocaleDateString() : "—"}</td>
                  <td className="muted">{offer.skillIds.join(", ")}</td>
                  <td>
                    {offer.saved?.status ?? ""}{" "}
                    <button onClick={() => toggleSave(offer)}>{offer.saved ? "Unsave" : "Save"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
