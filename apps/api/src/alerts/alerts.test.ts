import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { JobAlert } from "@job/shared";
import { config } from "../config";
import { sentMails } from "../mail/mailer";
import { prisma, startTestServer, TEST_PASSWORD, uniqueEmail } from "../test/helpers";
import { lastSendTime, runAlerts } from "./send";

// Job alerts (GROWTH.md phase 2): saved searches, their emails, the unsubscribe link.

let server: Awaited<ReturnType<typeof startTestServer>>;
const offerIds: string[] = [];

before(async () => {
  server = await startTestServer();
});
after(async () => {
  await prisma.savedOffer.deleteMany({ where: { offerId: { in: offerIds } } });
  await prisma.offer.deleteMany({ where: { id: { in: offerIds } } });
  await server.close();
});

async function account(verified = true) {
  const client = server.client();
  const email = uniqueEmail();
  await client.post("/api/auth/signup", { email, password: TEST_PASSWORD, uiLanguage: "fr" });
  if (verified) await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  return { client, email };
}

const KEYWORD = "Zorblaxe";

async function newOffer(title: string) {
  const offer = await prisma.offer.create({ data: { source: "test-alerts", title, description: "Une offre pour les alertes.", companyName: "Alertes SAS", contractType: "permanent", publishedAt: new Date() } });
  offerIds.push(offer.id);
  return offer;
}

describe("job alerts API", () => {
  test("an account saves a search once; sort, page and date are not part of it", async () => {
    const { client } = await account();
    const first = await client.post<JobAlert>("/api/alerts", { query: `q=${KEYWORD}&sort=recent&page=2&publishedWithin=7d`, label: KEYWORD });
    assert.equal(first.status, 201);
    assert.equal(first.body.query, `q=${KEYWORD}`);
    assert.equal(first.body.frequency, "daily");
    const again = await client.post<JobAlert>("/api/alerts", { query: `q=${KEYWORD}`, label: "autre nom" });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, first.body.id);
    assert.equal((await client.get<{ results: JobAlert[] }>("/api/alerts")).body.results.length, 1);
  });

  test("refused: guests, searches without criteria, more than the limit", async () => {
    const guest = server.client();
    await guest.put(`/api/saved-offers/${(await newOffer("Pour créer un invité")).id}`);
    assert.equal((await guest.post("/api/alerts", { query: "q=test", label: "test" })).status, 403);

    const { client } = await account();
    const broad = await client.post("/api/alerts", { query: "sort=recent", label: "tout" });
    assert.equal(broad.status, 400);
    assert.equal(broad.body.error.code, "alert_too_broad");
    for (let i = 0; i < 10; i++) assert.equal((await client.post("/api/alerts", { query: `q=test${i}`, label: `test${i}` })).status, 201);
    const over = await client.post("/api/alerts", { query: "q=encore", label: "encore" });
    assert.equal(over.status, 409);
    assert.equal(over.body.error.code, "alert_limit");
  });

  test("frequency, pause and deletion; other accounts' alerts are not found", async () => {
    const { client } = await account();
    const { body: alert } = await client.post<JobAlert>("/api/alerts", { query: "q=python", label: "python" });
    assert.equal((await client.patch<JobAlert>(`/api/alerts/${alert.id}`, { frequency: "weekly", paused: true })).body.paused, true);
    const other = await account();
    assert.equal((await other.client.patch(`/api/alerts/${alert.id}`, { paused: false })).status, 404);
    assert.equal((await other.client.delete(`/api/alerts/${alert.id}`)).status, 404);
    assert.equal((await client.delete(`/api/alerts/${alert.id}`)).status, 204);
    assert.equal((await client.get<{ results: JobAlert[] }>("/api/alerts")).body.results.length, 0);
  });
});

describe("sending", () => {
  test("send times: 8:00 Paris, summer and winter; weekly on Mondays", () => {
    assert.equal(lastSendTime(new Date("2026-10-17T05:00:00Z"), false).toISOString(), "2026-10-16T06:00:00.000Z", "07:00 in Paris: yesterday's");
    assert.equal(lastSendTime(new Date("2026-10-17T06:30:00Z"), false).toISOString(), "2026-10-17T06:00:00.000Z");
    assert.equal(lastSendTime(new Date("2026-12-10T07:30:00Z"), false).toISOString(), "2026-12-10T07:00:00.000Z", "winter time");
    assert.equal(lastSendTime(new Date("2026-10-17T10:00:00Z"), true).toISOString(), "2026-10-12T06:00:00.000Z", "a Saturday: last Monday's");
  });

  test("new offers are emailed once, to confirmed addresses, with a one-click unsubscribe", async () => {
    const verified = await account(true);
    const unverified = await account(false);
    for (const { client } of [verified, unverified]) await client.post("/api/alerts", { query: `q=${KEYWORD}`, label: KEYWORD });
    await prisma.jobAlert.updateMany({ where: { query: `q=${KEYWORD}` }, data: { lastRunAt: new Date(Date.now() - 2 * 24 * 3600_000) } });
    await newOffer(`Développeur ${KEYWORD} H/F`);

    const now = new Date();
    await runAlerts(now);
    const mails = sentMails.filter((mail) => mail.subject.includes(KEYWORD));
    assert.equal(mails.filter((mail) => mail.to === unverified.email).length, 0, "not to unconfirmed addresses");
    const mail = mails.find((mail) => mail.to === verified.email)!;
    assert.equal(mail.subject, `Nouvelle offre : ${KEYWORD}`);
    assert.match(mail.text, new RegExp(`Développeur ${KEYWORD} H/F\\n  Alertes SAS · CDI\\n  ${config.webBaseUrl}/offers/[0-9a-f-]{36}\\?alert=${config.alerts.sendHour}\\n`));
    assert.match(mail.text, new RegExp(`${config.webBaseUrl}/\\?q=${KEYWORD}&sort=recent&alert=${config.alerts.sendHour}\\n`), "links say they come from an alert, and its send hour");
    const unsubscribe = /<(.+)>/.exec(mail.headers!["List-Unsubscribe"])![1];
    assert.equal(mail.headers!["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");

    const count = sentMails.length;
    await runAlerts(now);
    assert.equal(sentMails.length, count, "nothing new: no second email");

    // The link: GET asks (mail scanners open links), POST turns the alert off.
    const page = await fetch(unsubscribe.replace(config.webBaseUrl, server.baseUrl));
    assert.match(await page.text(), /<form method="post"><button type="submit">Désactiver l'alerte/);
    assert.equal((await verified.client.get<{ results: JobAlert[] }>("/api/alerts")).body.results[0].paused, false);
    const done = await fetch(unsubscribe.replace(config.webBaseUrl, server.baseUrl), { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    assert.equal(done.status, 200);
    assert.match(await done.text(), /est désactivée/);
    assert.equal((await verified.client.get<{ results: JobAlert[] }>("/api/alerts")).body.results[0].paused, true);
    assert.equal((await fetch(`${server.baseUrl}/api/alerts/unsubscribe/unknown`)).status, 404);
  });
});
