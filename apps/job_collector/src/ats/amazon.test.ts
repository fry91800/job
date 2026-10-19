import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { amazonDate, amazonOffer } from "./adapters/amazon";

describe("Amazon offers", () => {
  test("French dates; texts with the qualifications; the internship flag", () => {
    assert.equal(amazonDate("octobre 19, 2026"), "2026-10-19T00:00:00.000Z");
    assert.equal(amazonDate("février 7, 2026"), "2026-02-07T00:00:00.000Z");
    assert.equal(amazonDate("October 19, 2026"), "2026-10-19T00:00:00.000Z");
    assert.equal(amazonDate("il y a 2 jours"), null);
    const offer = amazonOffer("www.amazon.jobs", "Amazon", {
      id_icims: "3182750",
      title: "Responsable des Opérations (H/F)",
      city: "Beauvais",
      normalized_location: "Beauvais, Hauts-de-France, FRA",
      country_code: "FRA",
      description: "Devenez Responsable des Opérations chez Amazon.",
      basic_qualifications: "- Diplôme d'ingénieur<br/>- Management",
      posted_date: "février 17, 2026",
      job_path: "/fr/jobs/3182750/responsable-des-operations-h-f",
      is_intern: true,
    });
    assert.equal(offer.externalId, "www.amazon.jobs:3182750");
    assert.equal(offer.url, "https://www.amazon.jobs/fr/jobs/3182750/responsable-des-operations-h-f");
    assert.equal(offer.contractType, "internship");
    assert.equal(offer.location?.city, "Beauvais");
    assert.match(offer.description.content, /^<p>Devenez.*<h3>Qualifications requises<\/h3><p>- Diplôme/);
  });
});
