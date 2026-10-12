import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { MeResponse, SavedOfferInfo, SavedOfferListResponse } from "@job/shared";
import { config } from "../config";
import { prisma, seedOfferId, startTestServer } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;

before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const path = (key: string) => `/api/saved-offers/${seedOfferId(key)}`;

describe("saved offers (O3)", () => {
  test("anonymous visitors have an empty list and no guest is created", async () => {
    const client = server.client();
    assert.deepEqual((await client.get("/api/saved-offers")).body, { results: [] });
    assert.equal(client.session, undefined);
  });

  test("saving creates a guest; saving again is idempotent", async () => {
    const client = server.client();
    const first = await client.put<SavedOfferInfo>(path("edge-old"));
    assert.equal(first.status, 201);
    assert.equal(first.body.status, "saved");
    assert.equal((await client.get<MeResponse>("/api/auth/me")).body.user?.isGuest, true);

    const again = await client.put<SavedOfferInfo>(path("edge-old"));
    assert.equal(again.status, 200);
    assert.equal(again.body.savedAt, first.body.savedAt);
  });

  test("only visible offers can be saved", async () => {
    const client = server.client();
    assert.equal((await client.put(path("edge-private-user"))).status, 404);
    assert.equal((await client.put(path("does-not-exist"))).status, 404);
    assert.equal((await client.put("/api/saved-offers/not-a-uuid")).status, 404);
  });

  test("status changes set statusChangedAt and the first appliedAt", async () => {
    const client = server.client();
    const saved = (await client.put<SavedOfferInfo>(path("edge-internship"))).body;

    const applied = await client.patch<SavedOfferInfo>(path("edge-internship"), { status: "applied" });
    assert.equal(applied.status, 200);
    assert.ok(applied.body.appliedAt);
    assert.ok(applied.body.statusChangedAt >= saved.statusChangedAt);

    // Going back and forth keeps the first applied date.
    await client.patch(path("edge-internship"), { status: "interviewing" });
    const reapplied = await client.patch<SavedOfferInfo>(path("edge-internship"), { status: "applied" });
    assert.equal(reapplied.body.appliedAt, applied.body.appliedAt);

    // The applied date is editable.
    const edited = await client.patch<SavedOfferInfo>(path("edge-internship"), { appliedAt: "2026-09-01T10:00:00.000Z" });
    assert.equal(edited.body.appliedAt, "2026-09-01T10:00:00.000Z");
  });

  test("notes are limited to 5 000 characters; empty updates are rejected", async () => {
    const client = server.client();
    await client.put(path("edge-internship"));
    assert.equal((await client.patch(path("edge-internship"), { notes: "x".repeat(5001) })).status, 400);
    assert.equal((await client.patch(path("edge-internship"), {})).status, 400);
    const ok = await client.patch<SavedOfferInfo>(path("edge-internship"), { notes: "Relancer lundi" });
    assert.equal(ok.body.notes, "Relancer lundi");
  });

  test("updating or removing an offer that is not saved returns 404", async () => {
    const client = server.client();
    assert.equal((await client.patch(path("edge-old"), { status: "applied" })).status, 401);
    await client.put(path("edge-internship"));
    assert.equal((await client.patch(path("edge-old"), { status: "applied" })).status, 404);
    assert.equal((await client.delete(path("edge-old"))).status, 404);
  });

  test("unsave removes the entry", async () => {
    const client = server.client();
    await client.put(path("edge-old"));
    assert.equal((await client.delete(path("edge-old"))).status, 204);
    assert.deepEqual((await client.get("/api/saved-offers")).body, { results: [] });
  });

  test("lists with status filter, sort and closed flag (seeded demo user)", async () => {
    const demo = server.client("dev-session-demo");
    const all = (await demo.get<SavedOfferListResponse>("/api/saved-offers")).body.results;
    assert.equal(all.length, 7);
    assert.equal(all.find((item) => item.offer.id === seedOfferId("edge-closed"))?.offer.closed, true);
    const savedAt = all.map((item) => item.savedAt);
    assert.deepEqual(savedAt, [...savedAt].sort().reverse());

    const interviewing = (await demo.get<SavedOfferListResponse>("/api/saved-offers?status=interviewing")).body.results;
    assert.deepEqual(interviewing.map((item) => item.offer.id), [seedOfferId("edge-remote-bordeaux")]);

    const byChange = (await demo.get<SavedOfferListResponse>("/api/saved-offers?sort=status_changed")).body.results;
    const changed = byChange.map((item) => item.statusChangedAt);
    assert.deepEqual(changed, [...changed].sort().reverse());
  });

  test("guests can save at most the configured number of offers", async () => {
    const client = server.client();
    const limit = config.limits.savedOffers.guest;
    const offers = await prisma.offer.findMany({ where: { isPublic: true }, select: { id: true }, take: limit + 1 });
    for (const offer of offers.slice(0, limit)) {
      assert.equal((await client.put(`/api/saved-offers/${offer.id}`)).status, 201);
    }
    const over = await client.put(`/api/saved-offers/${offers[limit].id}`);
    assert.equal(over.status, 429);
    assert.equal(over.body.error.code, "limit_reached");
  });
});
