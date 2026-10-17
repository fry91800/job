import { logEvent, prisma, sendAlert } from "@job/backend";
import type { BotSnapshot } from "@job/shared";
import { collectorConfig } from "../config";
import { closeSource, markSeen } from "../pipeline/close";

// Snapshots sent by bots after a run (COLLECTOR.md §17.3): every offer id they see in a
// scope. Listed offers are seen now. In a complete snapshot, the scope's open offers missing
// from it are closed, unless too many would close at once (more than
// `bots.maxClosingShare` of them, past a few): a broken bot or a changed site looks like
// that, so nothing is closed and an alert is sent.

export async function applySnapshot(source: string, snapshot: BotSnapshot): Promise<{ seen: number; closed: number; held: number }> {
  const listed = new Set(snapshot.externalIds);
  await markSeen(source, [...listed]);
  if (!snapshot.complete) return { seen: listed.size, closed: 0, held: 0 };

  const open = await prisma.offerSource.findMany({
    where: { source, externalId: { startsWith: `${snapshot.scope}:` }, closedAt: null },
    select: { externalId: true },
  });
  const missing = open.filter((row) => !listed.has(row.externalId));
  const { maxClosingShare, closingAlwaysAllowed } = collectorConfig.bots;
  if (missing.length > closingAlwaysAllowed && missing.length > open.length * maxClosingShare) {
    logEvent("warn", "bot_snapshot_held", { source, scope: snapshot.scope, open: open.length, missing: missing.length });
    await sendAlert(
      `bot-snapshot:${source}:${snapshot.scope}`,
      `Bot "${source}" (${snapshot.scope}): ${missing.length} of ${open.length} open offers missing from its snapshot. Nothing was closed: check the bot.`,
    );
    return { seen: listed.size, closed: 0, held: missing.length };
  }
  for (const row of missing) await closeSource(source, row.externalId);
  return { seen: listed.size, closed: missing.length, held: 0 };
}
