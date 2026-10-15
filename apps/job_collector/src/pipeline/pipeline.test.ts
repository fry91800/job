import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import type { CollectedOffer } from "@job/shared";
import { registerConnector } from "../connectors/registry";
import type { CollectedRecord, Connector } from "../connectors/types";
import { runConnector } from "../runs/run-connector";
import { closeSource, runMaintenance } from "./close";
import { processRecord } from "./process";

// Runs against the seeded test database (`npm test`).

const SOURCES = ["test-ats", "test-api", "test-aggregator"] as const;
const DESCRIPTION =
  "Cloudine, éditeur SaaS, recrute un développeur pour son équipe produit. Missions : développer de nouvelles fonctionnalités en React et Node.js, " +
  "concevoir des API avec PostgreSQL et participer aux revues de code. Profil : trois ans d'expérience. Contact : rh@cloudine.example ou 06 12 34 56 78.";

let counter = 0;
const uid = () => `${Date.now()}-${++counter}`;

function offer(fields: Partial<CollectedOffer> = {}): CollectedOffer {
  return {
    contractVersion: 1,
    source: "test-api",
    externalId: uid(),
    url: `https://jobs.test.example/${uid()}`,
    title: "Développeur full stack (H/F)",
    company: { name: `Cloudine Test ${counter} SAS` },
    location: { city: "Brunoy", postcode: "91800", countryCode: "FR" },
    remote: "hybrid",
    contractType: "permanent",
    salary: { min: 45000, max: 55000, currency: "eur", period: "year" },
    description: { format: "text", content: DESCRIPTION },
    publishedAt: new Date().toISOString(),
    collectedAt: new Date().toISOString(),
    ...fields,
  };
}
const record = (value: CollectedOffer): CollectedRecord => ({ raw: { ...value, rawOnly: true }, offer: value });

before(() => {
  backendConfig.geoapify.apiKey = undefined; // never call Geoapify from tests
  const kinds = { "test-ats": "ats", "test-api": "api", "test-aggregator": "aggregator" } as const;
  for (const source of SOURCES) {
    registerConnector({ key: source, kind: kinds[source], description: "test", schedule: null, async *collect() { return null; } });
  }
});

after(async () => {
  const offers = await prisma.offerSource.findMany({ where: { source: { in: [...SOURCES] } }, select: { offerId: true } });
  const ids = [...new Set(offers.map((row) => row.offerId))];
  await prisma.savedOffer.deleteMany({ where: { offerId: { in: ids } } });
  await prisma.offer.deleteMany({ where: { id: { in: ids } } });
  await prisma.offer.deleteMany({ where: { source: "user", title: "[test] private" } });
  await prisma.company.deleteMany({ where: { normalizedName: { startsWith: "cloudine test" } } });
  await prisma.rawOffer.deleteMany({ where: { source: { in: [...SOURCES] } } });
  await prisma.collectorRun.deleteMany({ where: { connector: { in: ["test-run"] } } });
  await prisma.$disconnect();
});

const load = (id: string) =>
  prisma.offer.findUniqueOrThrow({
    where: { id },
    include: { sources: true, company: true, location: true, skills: { include: { skill: { include: { names: true } } } }, occupations: true },
  });

describe("pipeline", () => {
  test("creates a public offer: normalized, enriched, personal data removed", async () => {
    const value = offer({ description: { format: "html", content: `<h2>Le poste</h2><p>${DESCRIPTION}</p><script>alert(1)</script>` } });
    const outcome = await processRecord(record(value));
    assert.equal(outcome.result, "created");
    const saved = await load((outcome as { offerId: string }).offerId);

    assert.equal(saved.isPublic, true);
    assert.equal(saved.source, "test-api");
    assert.match(saved.description, /^## Le poste\n\nCloudine/);
    assert.doesNotMatch(saved.description, /alert|rh@cloudine|06 12 34 56 78/);
    assert.equal(saved.location?.name, "Brunoy");
    assert.equal(saved.company?.normalizedName, `cloudine test ${counter}`);
    assert.deepEqual([saved.salaryMin, saved.salaryMax, saved.salaryCurrency], [45000, 55000, "EUR"]);
    assert.equal(saved.language, "fr");
    const skillNames = saved.skills.flatMap((link) => link.skill.names.map((name) => name.name));
    for (const skill of ["React", "Node.js", "PostgreSQL"]) assert.ok(skillNames.includes(skill), skill);
    assert.ok(saved.occupations.length > 0, "occupation found in the title");
    assert.equal(saved.qualityScore, 90, "everything but a long description (under 500 characters)");
    assert.match(saved.fingerprint!, /^cloudine test \d+\|developpeur full stack\|91$/);
    assert.deepEqual(saved.sources.map((source) => [source.source, source.externalId]), [["test-api", value.externalId]]);
    assert.equal(await prisma.rawOffer.count({ where: { source: "test-api", externalId: value.externalId } }), 1);
  });

  test("the same record again is unchanged; a changed record updates the offer", async () => {
    const value = offer();
    const first = await processRecord(record(value));
    assert.equal((await processRecord(record(value))).result, "unchanged");

    const changed = await processRecord(record({ ...value, title: "Développeur full stack senior", salary: null }));
    assert.equal(changed.result, "updated");
    const saved = await load((first as { offerId: string }).offerId);
    assert.equal(saved.title, "Développeur full stack senior");
    assert.equal(saved.salaryMin, null, "the main source removed its salary");
    assert.equal(await prisma.rawOffer.count({ where: { source: "test-api", externalId: value.externalId } }), 2, "both versions kept");
  });

  test("the same page from another source is merged; a higher-priority source takes over", async () => {
    const fromApi = offer({ salary: null, remote: null });
    const created = (await processRecord(record(fromApi))) as { offerId: string };

    // Lower priority (aggregator): only fills empty fields.
    const fromAggregator = offer({ source: "test-aggregator", url: fromApi.url, title: "Dev full stack", remote: "remote", salary: { min: 40000, max: null, currency: "EUR", period: "year" } });
    assert.equal((await processRecord(record(fromAggregator))).result, "merged");
    let saved = await load(created.offerId);
    assert.equal(saved.title, "Développeur full stack (H/F)", "kept from the higher-priority source");
    assert.equal(saved.remoteType, "remote", "empty field filled");
    assert.deepEqual([saved.salaryMin, saved.salaryMax], [40000, null]);

    // Higher priority (the employer's ATS): its values win.
    const fromAts = offer({ source: "test-ats", url: null, applyUrl: fromApi.url, title: "Développeur Full Stack React", salary: { min: 50000, max: 60000, currency: "EUR", period: "year" } });
    assert.equal((await processRecord(record(fromAts))).result, "merged");
    saved = await load(created.offerId);
    assert.equal(saved.title, "Développeur Full Stack React");
    assert.equal(saved.source, "test-ats");
    assert.deepEqual([saved.salaryMin, saved.salaryMax], [50000, 60000], "salary taken as a whole group");
    assert.deepEqual(saved.sources.map((source) => source.source).sort(), ["test-aggregator", "test-api", "test-ats"]);
  });

  test("same company, title and département with a similar description is merged; a different description is not", async () => {
    const company = { name: `Cloudine Test ${uid()}` };
    const first = (await processRecord(record(offer({ company })))) as { offerId: string };
    const similar = await processRecord(record(offer({ source: "test-aggregator", company: { name: `${company.name} S.A.S.` }, description: { format: "text", content: `${DESCRIPTION} Télétravail possible.` } })));
    assert.equal(similar.result, "merged");
    assert.equal((similar as { offerId: string }).offerId, first.offerId);

    const different = await processRecord(
      record(offer({ source: "test-aggregator", company, description: { format: "text", content: "Une tout autre offre de la même entreprise : comptable en cabinet, tenue de la comptabilité générale et clôtures mensuelles." } })),
    );
    assert.equal(different.result, "created");

    const sameSource = await processRecord(record(offer({ company, location: { city: "Yerres", postcode: "91330", countryCode: "FR" } })));
    assert.equal(sameSource.result, "created", "another posting of the same source (another town) is another offer");
  });

  test("a private user-added offer with the same URL becomes public", async () => {
    const url = `https://jobs.test.example/private-${uid()}`;
    const user = await prisma.user.findFirstOrThrow({ where: { email: "demo@example.com" } });
    const privateOffer = await prisma.offer.create({ data: { title: "[test] private", description: "Texte collé.", url, isPublic: false, source: "user", createdByUserId: user.id } });
    const outcome = await processRecord(record(offer({ url })));
    assert.equal(outcome.result, "merged");
    const saved = await load(privateOffer.id);
    assert.equal(saved.isPublic, true);
    assert.equal(saved.createdByUserId, user.id, "the user keeps it");
  });

  test("invalid records are rejected", async () => {
    assert.equal((await processRecord(record({ ...offer(), title: "" }))).result, "rejected");
    assert.equal((await processRecord(record(offer({ description: { format: "text", content: "Trop court pour une offre." } })))).result, "rejected");
    assert.equal((await processRecord({ raw: {}, offer: { ...offer(), extra: true } as unknown as CollectedOffer })).result, "rejected");
  });

  test("an offer closes when all its sources dropped it, and reopens when one publishes it again", async () => {
    const value = offer();
    const { offerId } = (await processRecord(record(value))) as { offerId: string };
    await processRecord(record({ ...value, source: "test-aggregator", externalId: `agg-${value.externalId}` }));

    assert.equal(await closeSource("test-api", value.externalId), false, "another source still has it");
    assert.equal((await load(offerId)).closedAt, null);
    assert.equal(await closeSource("test-aggregator", `agg-${value.externalId}`), true);
    assert.ok((await load(offerId)).closedAt);

    assert.equal((await processRecord(record(value))).result, "unchanged");
    assert.equal((await load(offerId)).closedAt, null, "reopened");
  });

  test("maintenance closes sources past their expiry date", async () => {
    const value = offer({ expiresAt: new Date(Date.now() - 3600 * 1000).toISOString() });
    const { offerId } = (await processRecord(record(value))) as { offerId: string };
    const result = await runMaintenance();
    assert.ok(result.expiredSources >= 1 && result.closedOffers >= 1);
    assert.ok((await load(offerId)).closedAt);
  });
});

describe("connector runs", () => {
  test("a run is recorded with its counts, and the next run starts from its cursor", async () => {
    const cursors: (string | null)[] = [];
    const values = [offer(), offer(), { ...offer(), title: "" }];
    const connector: Connector = {
      key: "test-run",
      kind: "api",
      description: "test",
      schedule: null,
      async *collect(context) {
        cursors.push(context.cursor);
        for (const value of values) yield record({ ...value, source: "test-api" });
        return "cursor-2";
      },
    };
    const first = await runConnector(connector, { log: () => {} });
    assert.deepEqual(first.counts, { received: 3, created: 2, updated: 0, merged: 0, unchanged: 0, rejected: 1, failed: 0 });
    const run = await prisma.collectorRun.findUniqueOrThrow({ where: { id: first.runId } });
    assert.deepEqual([run.status, run.cursor], ["succeeded", "cursor-2"]);

    const second = await runConnector(connector, { log: () => {} });
    assert.deepEqual(cursors, [null, "cursor-2"]);
    assert.equal(second.counts.unchanged, 2);
  });

  test("a connector that fails marks its run failed", async () => {
    const connector: Connector = {
      key: "test-run",
      kind: "api",
      description: "test",
      schedule: null,
      async *collect() {
        throw new Error("source down");
      },
    };
    await assert.rejects(runConnector(connector, { log: () => {} }), /source down/);
    const run = await prisma.collectorRun.findFirstOrThrow({ where: { connector: "test-run" }, orderBy: { startedAt: "desc" } });
    assert.deepEqual([run.status, run.error], ["failed", "source down"]);
  });
});
