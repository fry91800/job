import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeOfferUrl } from "./user-offers";

describe("normalizeOfferUrl", () => {
  test("lowercases scheme and host, drops fragment, default port and tracking parameters, sorts the rest", () => {
    assert.equal(
      normalizeOfferUrl(" HTTPS://Jobs.Example.COM:443/Offers/42?utm_source=x&b=2&gclid=y&a=1#apply "),
      "https://jobs.example.com/Offers/42?a=1&b=2",
    );
  });

  test("the path keeps its case; no query = no question mark", () => {
    assert.equal(normalizeOfferUrl("https://example.com/Job?utm_medium=mail"), "https://example.com/Job");
  });

  test("same page, same URL", () => {
    assert.equal(normalizeOfferUrl("https://example.com/job?id=1&fbclid=abc"), normalizeOfferUrl("https://EXAMPLE.com/job?id=1"));
  });

  test("rejects non-http URLs and URLs with credentials", () => {
    assert.equal(normalizeOfferUrl("javascript:alert(1)"), null);
    assert.equal(normalizeOfferUrl("ftp://example.com/x"), null);
    assert.equal(normalizeOfferUrl("https://user:pass@example.com/"), null);
    assert.equal(normalizeOfferUrl("not a url"), null);
  });
});
