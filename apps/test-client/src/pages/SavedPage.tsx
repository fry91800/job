import { useCallback, useEffect, useState } from "react";
import { SAVED_OFFER_STATUSES, type SavedOfferListResponse } from "@job/shared";
import { api, errorText } from "../api";
import { SavedEditor } from "../SavedEditor";
import { formatLocation } from "./SearchPage";

export function SavedPage({ openOffer }: { openOffer: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("saved");
  const [list, setList] = useState<SavedOfferListResponse["results"]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ sort, ...(status && { status }) });
    const result = await api<SavedOfferListResponse>("GET", `/api/saved-offers?${params}`);
    setError(errorText(result));
    if (result.ok) setList(result.data.results);
  }, [status, sort]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <p>
        <label>Status{" "}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">all</option>
            {SAVED_OFFER_STATUSES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>Sort{" "}
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="saved">saved date</option>
            <option value="status_changed">status change</option>
          </select>
        </label>
        {list.length} saved offers
      </p>
      {error && <p className="error">{error}</p>}
      <table>
        <tbody>
          {list.map((item) => (
            <tr key={item.offer.id}>
              <td>
                <a onClick={() => openOffer(item.offer.id)}>{item.offer.title}</a>
                {item.offer.closed && <span className="error"> (closed)</span>}
                <div className="muted">{item.offer.companyName ?? "—"} — {formatLocation(item.offer.location)}</div>
              </td>
              <td>
                {/* key: reset the editor's local state when the data changes */}
                <SavedEditor key={JSON.stringify(item)} offerId={item.offer.id} saved={item} onChange={load} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
