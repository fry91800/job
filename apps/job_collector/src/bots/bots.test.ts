import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma, useFakeAi, type FakeProvider } from "@job/backend";
import type { BotPage } from "@job/shared";
import { collectorConfig } from "../config";
import { checkBotSources } from "./health";
import { processBotPage } from "./pages";
import { applySnapshot } from "./snapshot";

// Pages and snapshots of a test bot (source "test-bots"), through the collector's side:
// extraction (JobPosting, else the fake AI), the hash cache, the AI budget, closing.

const SOURCE = "test-bots";
const LONG = "Vous développerez les services de paiement en TypeScript au sein d'une équipe produit. ".repeat(3);
const jsonLd = (fields: object = {}) =>
  `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Développeur TypeScript (H/F)",
    description: `<p>${LONG}</p>`,
    datePosted: "2026-10-10",
    hiringOrganization: { "@type": "Organization", name: "Bots Test SAS" },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Nantes", postalCode: "44000", addressCountry: "FR" } },
    ...fields,
  })}</script>`;
const page = (id: string, html: string): BotPage => ({ externalId: `site:${id}`, url: `https://jobs.example.fr/offres/${id}`, html, fetchedAt: new Date().toISOString() });
const AI_ANSWER = {
  isJobOffer: true,
  title: "Chargé de recrutement (H/F)",
  companyName: "Bots Test SAS",
  description: `## Missions\n\n${LONG}`,
  location: { city: "Lyon", postcode: "69003", region: "Auvergne-Rhône-Alpes", countryCode: "FR" },
  remoteType: "hybrid",
  contractType: "permanent",
  salary: { min: 38000, max: 42000, currency: "EUR", period: "year" },
  publishedAt: "2026-10-12",
  expiresAt: null,
};

let ai: FakeProvider;
const sourceOf = (id: string) => prisma.offerSource.findUnique({ where: { source_externalId: { source: SOURCE, externalId: `site:${id}` } }, include: { offer: true } });

before(() => {
  ai = useFakeAi();
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  const sources = await prisma.offerSource.findMany({ where: { source: SOURCE }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: SOURCE } });
  await prisma.collectorToken.deleteMany({ where: { source: SOURCE } });
  await prisma.company.deleteMany({ where: { normalizedName: "bots test" } });
  await prisma.$disconnect();
});

describe("bot pages", () => {
  test("JobPosting markup: the offer without AI; the same page again is only seen", async () => {
    ai.requests = [];
    const first = await processBotPage(SOURCE, page("1", `<html><head>${jsonLd()}</head><body>Offre</body></html>`));
    assert.equal(first.result, "created");
    assert.equal(ai.requests.length, 0);
    const saved = (await sourceOf("1"))!;
    assert.deepEqual([saved.offer.title, saved.offer.source], ["Développeur TypeScript (H/F)", SOURCE]);

    assert.equal((await processBotPage(SOURCE, page("1", `<html><head>${jsonLd()}</head><body>Offre</body></html>`))).result, "seen");
    assert.equal((await processBotPage(SOURCE, page("1", `<html><head>${jsonLd({ title: "Développeur TypeScript senior (H/F)" })}</head><body>Offre</body></html>`))).result, "updated");
  });

  test("JobPosting abroad: set aside, remembered", async () => {
    const html = `<html><head>${jsonLd({ jobLocation: { address: { addressLocality: "London", addressCountry: "GB" } } })}</head></html>`;
    assert.deepEqual(await processBotPage(SOURCE, page("2", html)), { result: "skipped", reason: "not in France" });
    assert.equal((await processBotPage(SOURCE, page("2", html))).result, "seen");
  });

  test("no markup: the AI extracts the offer, once per page content", async () => {
    const html = `<html><body><h1>Chargé de recrutement</h1><p>${LONG}</p><p>Lyon, CDI, 38 000 à 42 000 €.</p></body></html>`;
    ai.requests = [];
    const outcome = await ai.with("extract-bot-page", () => AI_ANSWER, () => processBotPage(SOURCE, page("3", html)));
    assert.equal(outcome.result, "created");
    assert.equal(ai.requests.length, 1);
    const saved = (await sourceOf("3"))!;
    assert.deepEqual([saved.offer.title, saved.offer.contractType, saved.offer.salaryMin, saved.offer.remoteType], ["Chargé de recrutement (H/F)", "permanent", 38000, "hybrid"]);
    const raw = await prisma.rawOffer.findFirstOrThrow({ where: { source: SOURCE, externalId: "site:3" } });
    assert.equal((raw.payload as { extraction: string }).extraction, "ai");

    // Not an offer: set aside and not paid for again.
    const listing = `<html><body><h1>Nos offres</h1><p>${LONG}</p></body></html>`;
    ai.requests = [];
    assert.deepEqual(await ai.with("extract-bot-page", () => ({ ...AI_ANSWER, isJobOffer: false }), () => processBotPage(SOURCE, page("4", listing))), { result: "skipped", reason: "not an offer" });
    assert.equal((await processBotPage(SOURCE, page("4", listing))).result, "seen");
    assert.equal(ai.requests.length, 1);
  });

  test("the daily AI budget per source", async () => {
    const budget = collectorConfig.bots.aiPagesPerDay;
    collectorConfig.bots.aiPagesPerDay = 2; // 2 already used today (pages 3 and 4)
    try {
      ai.requests = [];
      const html = `<html><body><h1>Comptable</h1><p>${LONG}</p></body></html>`;
      assert.equal((await processBotPage(SOURCE, page("5", html))).result, "over-budget");
      assert.equal(ai.requests.length, 0);
    } finally {
      collectorConfig.bots.aiPagesPerDay = budget;
    }
  });
});

describe("bot snapshots and health", () => {
  test("a complete snapshot closes the scope's missing offers; too many missing: held", async () => {
    // Offers site:1 and site:3 are open (created above).
    const partial = await applySnapshot(SOURCE, { scope: "site", externalIds: ["site:1"], complete: false });
    assert.deepEqual(partial, { seen: 1, closed: 0, held: 0 });

    const share = collectorConfig.bots.closingAlwaysAllowed;
    collectorConfig.bots.closingAlwaysAllowed = 0;
    try {
      const held = await applySnapshot(SOURCE, { scope: "site", externalIds: [], complete: true });
      assert.deepEqual(held, { seen: 0, closed: 0, held: 2 }, "every open offer missing: nothing closed");
    } finally {
      collectorConfig.bots.closingAlwaysAllowed = share;
    }
    const closing = await applySnapshot(SOURCE, { scope: "site", externalIds: ["site:1"], complete: true });
    assert.deepEqual(closing, { seen: 1, closed: 1, held: 0 });
    assert.ok((await sourceOf("3"))!.closedAt);
    assert.equal((await sourceOf("1"))!.closedAt, null);
  });

  test("offers not seen for too long are closed; a quiet source is reported", async () => {
    const now = new Date();
    await prisma.collectorToken.create({
      data: { source: SOURCE, name: "[test] bots", tokenHash: createHash("sha256").update(randomBytes(16)).digest("hex"), lastUsedAt: new Date(now.getTime() - 72 * 3600 * 1000) },
    });
    await prisma.offerSource.update({ where: { source_externalId: { source: SOURCE, externalId: "site:1" } }, data: { lastSeenAt: new Date(now.getTime() - 10 * 24 * 3600 * 1000) } });
    const result = await checkBotSources(now);
    assert.ok(result.quietSources.includes(SOURCE));
    assert.ok(result.closedNotSeen >= 1);
    assert.ok((await sourceOf("1"))!.closedAt);
  });
});
