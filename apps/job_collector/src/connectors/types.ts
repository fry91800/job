import type { CollectedOffer } from "@job/shared";

// A connector collects offers from one kind of source (COLLECTOR.md §3).

export type ConnectorKind = "api" | "ats" | "crawler" | "aggregator" | "ingest" | "placeholder";

export type CollectedRecord = {
  raw: unknown; // as received from the source (stored in raw_offers)
  offer: CollectedOffer; // mapped to the ingestion contract
};

export type RunContext = {
  cursor: string | null; // from the last successful run (incremental collection)
  signal: AbortSignal;
  log: (message: string) => void;
};

export interface Connector {
  key: string; // = offer_sources.source
  kind: ConnectorKind;
  description: string;
  schedule: string | null; // cron; null = not scheduled (placeholders, manual runs)
  // Yields records; returns the cursor of the next incremental run.
  collect(context: RunContext): AsyncGenerator<CollectedRecord, string | null>;
  // Optional: is this offer still open at its source? (closing expired offers)
  isStillOpen?(externalId: string, context: RunContext): Promise<boolean>;
}

// Which source wins when several describe the same offer (COLLECTOR.md §7): higher first.
export const KIND_PRIORITY: Record<ConnectorKind | "user", number> = {
  ats: 5, // the employer's own system
  api: 4,
  crawler: 3,
  aggregator: 2,
  ingest: 1,
  placeholder: 0,
  user: 0, // user-added offers (O5)
};
