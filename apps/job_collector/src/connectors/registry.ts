import { aiSourcePlaceholder } from "./placeholders/ai-source";
import { loggedInBotPlaceholder } from "./placeholders/logged-in-bot";
import { siteCrawlerPlaceholder } from "./placeholders/site-crawler";
import { KIND_PRIORITY, type Connector, type ConnectorKind } from "./types";

// Every connector of the collector. Phase 2 adds France Travail, phase 3 the ATS adapters.
export const connectors: Connector[] = [siteCrawlerPlaceholder, aiSourcePlaceholder, loggedInBotPlaceholder];

const extra: Connector[] = [];

// For tests: connectors added at runtime.
export function registerConnector(connector: Connector): void {
  extra.push(connector);
}

export function findConnector(key: string): Connector | undefined {
  return [...connectors, ...extra].find((connector) => connector.key === key);
}

// Priority of a source key: its connector's kind; "user" for user-added offers; sources
// of the ingestion endpoint (unknown keys) count as "ingest".
export function sourcePriority(source: string): number {
  if (source === "user" || source === "seed") return KIND_PRIORITY.user;
  const kind: ConnectorKind = findConnector(source)?.kind ?? "ingest";
  return KIND_PRIORITY[kind];
}
