import type { CollectedRecord, Connector } from "../types";

// PLACEHOLDER — AI as a source (COLLECTOR.md §5.7). Not built: AI models have no live
// job offers and invent plausible ones. If built later, the AI only suggests LEADS
// (companies, career pages, offer URLs); each lead is verified by fetching the real page
// with a real connector (ATS adapter, structured-data crawler) before anything is stored.
// Nothing an AI produces is ever stored directly as an offer.
export const aiSourcePlaceholder: Connector = {
  key: "ai-source",
  kind: "placeholder",
  description: "AI lead suggestions (placeholder, collects nothing)",
  schedule: null,
  async *collect(): AsyncGenerator<CollectedRecord, string | null> {
    return null;
  },
};
