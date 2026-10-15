import { isPublicAddress, safeFetch, SafeFetchError, safeLookupFor } from "@job/backend";
import { config } from "../config";
import { HttpError } from "./http-error";

// Fetches a web page from a URL given by a user (O5), with the shared safe fetcher
// (public addresses only, checked redirects, limits — `@job/backend` net/safe-fetch.ts);
// failures become HTTP errors for the API.

export { isPublicAddress };

const allowed = (address: string) => isPublicAddress(address) || config.fetch.allowedPrivateAddresses.includes(address);
export const safeLookup = safeLookupFor(allowed);

const blockedAddress = () => new HttpError(422, "blocked_address", "This address cannot be fetched");
export const pageUnavailable = (reason: string) =>
  new HttpError(422, "page_unavailable", `We couldn't read this page (${reason}). Paste the text of the offer instead.`);

export type FetchedPage = { url: string; contentType: string; text: string };

export async function fetchPage(input: string): Promise<FetchedPage> {
  try {
    const response = await safeFetch(input, {
      ...config.fetch,
      accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
      contentTypes: /text\/html|application\/xhtml\+xml|text\/plain/i,
    });
    // 401/403/429…: login walls and bot protection (e.g. LinkedIn).
    if (response.status < 200 || response.status >= 300) throw pageUnavailable(`HTTP ${response.status}`);
    return { url: response.url, contentType: response.contentType, text: response.text };
  } catch (error) {
    if (!(error instanceof SafeFetchError)) throw error;
    if (error.reason === "invalid_url") throw new HttpError(400, "invalid_url", error.message);
    if (error.reason === "blocked_address") throw blockedAddress();
    throw pageUnavailable(error.message);
  }
}
