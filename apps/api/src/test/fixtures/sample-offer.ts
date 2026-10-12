import type { ExtractedOffer } from "../../offers/offer-extractor";

// Answer of the fake AI for offer extraction in tests.
export const sampleExtractedOffer: ExtractedOffer = {
  isJobOffer: true,
  title: "[test] Développeur React H/F",
  companyName: "Exemple SA",
  description: "## Missions\n\n- Développer en React et Node.js",
  language: "fr",
  location: { city: "Brunoy", region: "Île-de-France", countryCode: "FR" },
  remoteType: "hybrid",
  contractType: "permanent",
  salary: { min: 45000, max: 55000, currency: "eur", period: "year" },
};
