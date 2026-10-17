import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PublicConfigResponse } from "@job/shared";
import { config } from "../config";
import { sentMails } from "../mail/mailer";
import { resetLandingIndex } from "../seo/landing";
import { startTestServer, TEST_PASSWORD, uniqueEmail } from "../test/helpers";

// The feedback form and the settings the web app reads at start (GROWTH.md phase 0).

let server: Awaited<ReturnType<typeof startTestServer>>;

before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const feedbackMails = () => sentMails.filter((mail) => mail.to === config.feedback.to);

describe("feedback (POST /api/feedback)", () => {
  test("a visitor's message is emailed to the operator, answerable with Reply", async () => {
    const before = feedbackMails().length;
    const { status } = await server.client().post("/api/feedback", { message: "La recherche par ville\nne trouve pas Brest.", email: "Visiteur@Example.test ", page: "/offers/123" });
    assert.equal(status, 204);
    const mail = feedbackMails().at(-1)!;
    assert.equal(feedbackMails().length, before + 1);
    assert.equal(mail.subject, "[Avis] La recherche par ville");
    assert.equal(mail.replyTo, "visiteur@example.test");
    assert.match(mail.text, /ne trouve pas Brest\.[\s\S]*visiteur sans session[\s\S]*Page : \/offers\/123/);
  });

  test("an account's message says who sent it; HTML is escaped", async () => {
    const client = server.client();
    const email = uniqueEmail();
    await client.post("/api/auth/signup", { email, password: TEST_PASSWORD });
    assert.equal((await client.post("/api/feedback", { message: "<b>Bravo</b>" })).status, 204);
    const mail = feedbackMails().at(-1)!;
    assert.equal(mail.replyTo, undefined);
    assert.match(mail.text, new RegExp(`compte ${email}`));
    assert.match(mail.html, /&lt;b&gt;Bravo&lt;\/b&gt;/);
  });

  test("an empty message or a wrong address is refused; no guest is created", async () => {
    const client = server.client();
    assert.equal((await client.post("/api/feedback", { message: "   " })).status, 400);
    assert.equal((await client.post("/api/feedback", { message: "ok", email: "pas une adresse" })).status, 400);
    assert.equal(client.session, undefined);
  });
});

describe("public config and audience measurement", () => {
  test("analytics off without a website id, on with one (app and landing pages)", async () => {
    const client = server.client();
    assert.deepEqual((await client.get<PublicConfigResponse>("/api/public-config")).body, { analytics: null });
    config.analytics.umamiWebsiteId = "0b8c2a4e-1111-4222-8333-444455556666";
    try {
      assert.deepEqual((await client.get<PublicConfigResponse>("/api/public-config")).body, { analytics: { websiteId: "0b8c2a4e-1111-4222-8333-444455556666", domain: "localhost" } });
      resetLandingIndex();
      const hub = await (await fetch(new URL("/emplois", server.baseUrl))).text();
      assert.match(hub, /<script defer src="\/u\/script\.js" data-website-id="0b8c2a4e-1111-4222-8333-444455556666" data-domains="localhost" data-exclude-search="true" data-do-not-track="true"><\/script>/);
    } finally {
      config.analytics.umamiWebsiteId = undefined;
    }
  });
});
