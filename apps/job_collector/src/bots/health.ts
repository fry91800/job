import { logEvent, prisma, sendAlert } from "@job/backend";
import { collectorConfig } from "../config";
import { closeSource } from "../pipeline/close";

// Daily, in the maintenance (COLLECTOR.md §17.3). Bot sources are the sources with a token.
// * Offers a bot hasn't seen for `bots.notSeenDays` (per source, else the default) are
//   closed: it stopped listing them, or stopped running (then the quiet alert says so).
// * A source whose token hasn't been used for `bots.quietAfterHours` is alerted.

async function botSources(): Promise<{ source: string; lastUsedAt: Date | null }[]> {
  const tokens = await prisma.collectorToken.findMany({ where: { revokedAt: null }, select: { source: true, lastUsedAt: true } });
  const latest = new Map<string, Date | null>();
  for (const token of tokens) {
    const previous = latest.get(token.source);
    if (!latest.has(token.source) || (token.lastUsedAt && (!previous || token.lastUsedAt > previous))) latest.set(token.source, token.lastUsedAt);
  }
  return [...latest].map(([source, lastUsedAt]) => ({ source, lastUsedAt }));
}

export async function checkBotSources(now = new Date()): Promise<{ closedNotSeen: number; quietSources: string[] }> {
  const day = 24 * 3600 * 1000;
  let closedNotSeen = 0;
  const quietSources: string[] = [];
  for (const { source, lastUsedAt } of await botSources()) {
    const days = collectorConfig.bots.notSeenDays[source] ?? collectorConfig.bots.notSeenDays.default;
    const stale = await prisma.offerSource.findMany({
      where: { source, closedAt: null, lastSeenAt: { lt: new Date(now.getTime() - days * day) } },
      select: { externalId: true },
    });
    for (const row of stale) await closeSource(source, row.externalId, now);
    closedNotSeen += stale.length;

    if (lastUsedAt && now.getTime() - lastUsedAt.getTime() > collectorConfig.bots.quietAfterHours * 3600 * 1000) {
      quietSources.push(source);
      logEvent("warn", "bot_source_quiet", { source, lastUsedAt: lastUsedAt.toISOString() });
      await sendAlert(`bot-quiet:${source}`, `Bot source "${source}" has sent nothing since ${lastUsedAt.toISOString()}.`);
    }
  }
  return { closedNotSeen, quietSources };
}
