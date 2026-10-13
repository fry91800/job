import type { CollectedRecord, Connector } from "../types";

// PLACEHOLDER — automated bots on sites that require an account, e.g. LinkedIn
// (COLLECTOR.md §5.7). Not built: those sites' terms forbid automated access, accounts get
// banned, and the EU database right and GDPR apply. Such a bot would not run here: it
// would post CollectedOffer batches to POST /api/collector/ingest with its own token.
// The user-triggered browser extension (§5.6) covers the legitimate part of the idea.
export const loggedInBotPlaceholder: Connector = {
  key: "logged-in-bot",
  kind: "placeholder",
  description: "Automated logged-in bot (placeholder, collects nothing)",
  schedule: null,
  async *collect(): AsyncGenerator<CollectedRecord, string | null> {
    return null;
  },
};
