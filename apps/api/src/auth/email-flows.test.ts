import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { MeResponse } from "@job/shared";
import { sentMails } from "../mail/mailer";
import { prisma, startTestServer, TestClient, TEST_PASSWORD, uniqueEmail } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;

before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const lastMailTo = (email: string) => [...sentMails].reverse().find((mail) => mail.to === email);
const tokenIn = (text: string) => /token=([\w-]+)/.exec(text)?.[1] ?? "";

async function signup(uiLanguage: "fr" | "en" = "fr") {
  const client = server.client();
  const email = uniqueEmail();
  await client.post("/api/auth/signup", { email, password: TEST_PASSWORD, uiLanguage });
  return { client, email };
}

// Emails are sent in the background: wait until the expected one arrives.
async function waitForMail(email: string, count = 1) {
  for (let i = 0; i < 50; i++) {
    if (sentMails.filter((mail) => mail.to === email).length >= count) return lastMailTo(email)!;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no email to ${email}`);
}

describe("email verification (A6)", () => {
  test("sent at sign-up in the user's language; the link confirms the address", async () => {
    const { client, email } = await signup("fr");
    const mail = await waitForMail(email);
    assert.equal(mail.subject, "Confirmez votre adresse e-mail");
    assert.match(mail.text, /http:\/\/localhost:5173\/verify-email\?token=/);
    assert.equal((await client.get<MeResponse>("/api/auth/me")).body.user?.emailVerified, false, "usable before confirmation");

    // Confirmed from anywhere, even without a session.
    assert.equal((await server.client().post("/api/auth/email-verification/confirm", { token: tokenIn(mail.text) })).status, 204);
    assert.equal((await client.get<MeResponse>("/api/auth/me")).body.user?.emailVerified, true);
    assert.equal((await server.client().post("/api/auth/email-verification/confirm", { token: tokenIn(mail.text) })).body.error.code, "invalid_token", "single use");
  });

  test("resend invalidates the previous link; refused once confirmed", async () => {
    const { client, email } = await signup("en");
    const first = await waitForMail(email);
    assert.equal(first.subject, "Confirm your email address");
    assert.equal((await client.post("/api/auth/email-verification/resend")).status, 202);
    const second = await waitForMail(email, 2);
    assert.notEqual(tokenIn(second.text), tokenIn(first.text));

    assert.equal((await server.client().post("/api/auth/email-verification/confirm", { token: tokenIn(first.text) })).body.error.code, "invalid_token");
    assert.equal((await server.client().post("/api/auth/email-verification/confirm", { token: tokenIn(second.text) })).status, 204);
    assert.equal((await client.post("/api/auth/email-verification/resend")).body.error.code, "already_verified");
  });

  test("guests cannot ask for a confirmation email", async () => {
    const client = server.client();
    await client.put("/api/saved-offers/00000000-0000-0000-0000-000000000000");
    assert.equal((await client.post("/api/auth/email-verification/resend")).status, 403);
  });
});

describe("password reset (A4)", () => {
  test("same answer for known and unknown addresses; email only for accounts", async () => {
    const { email } = await signup();
    const before = sentMails.length;
    const unknown = await server.client().post("/api/auth/password-reset/request", { email: uniqueEmail() });
    const known = await server.client().post("/api/auth/password-reset/request", { email: email.toUpperCase() });
    assert.equal(unknown.status, 202);
    assert.deepEqual(unknown.body, known.body);
    const mail = await waitForMail(email, 2);
    assert.equal(mail.subject, "Réinitialisation de votre mot de passe");
    assert.match(mail.text, /\/reset-password\?token=/);
    assert.equal(sentMails.length, before + 1, "nothing sent for the unknown address");
  });

  test("the link sets a new password, logs out every device and logs in", async () => {
    const { client: otherDevice, email } = await signup();
    await server.client().post("/api/auth/password-reset/request", { email });
    const mail = await waitForMail(email, 2);

    const browser = server.client();
    const result = await browser.post<MeResponse>("/api/auth/password-reset/confirm", { token: tokenIn(mail.text), password: "brand-new-password" });
    assert.equal(result.status, 200);
    assert.equal(result.body.user?.email, email);
    assert.ok(browser.session, "logged in with a new session");
    assert.equal((await otherDevice.get<MeResponse>("/api/auth/me")).body.user, null, "other sessions logged out");
    assert.equal((await server.client().post("/api/auth/login", { email, password: TEST_PASSWORD })).status, 401);
    assert.equal((await server.client().post("/api/auth/login", { email, password: "brand-new-password" })).status, 200);

    const reused = await server.client().post("/api/auth/password-reset/confirm", { token: tokenIn(mail.text), password: "another-password" });
    assert.equal(reused.body.error.code, "invalid_token");
  });

  test("expired links and weak passwords are refused", async () => {
    const { email } = await signup();
    await server.client().post("/api/auth/password-reset/request", { email });
    const token = tokenIn((await waitForMail(email, 2)).text);
    assert.equal((await server.client().post("/api/auth/password-reset/confirm", { token, password: "short" })).status, 400);

    await prisma.userToken.updateMany({ where: { user: { email }, type: "password_reset" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await server.client().post("/api/auth/password-reset/confirm", { token, password: "brand-new-password" })).body.error.code, "invalid_token");
  });

  test("a guest who resets its account's password gets its data merged", async () => {
    const { email } = await signup();
    await server.client().post("/api/auth/password-reset/request", { email });
    const token = tokenIn((await waitForMail(email, 2)).text);

    const guest: TestClient = server.client();
    await guest.put(`/api/saved-offers/${(await prisma.offer.findFirstOrThrow({ where: { isPublic: true } })).id}`);
    const result = await guest.post<MeResponse>("/api/auth/password-reset/confirm", { token, password: "brand-new-password" });
    assert.equal(result.body.user?.email, email);
    assert.equal(((await guest.get("/api/saved-offers")).body.results as unknown[]).length, 1);
  });

  test("at most 3 requests per address per hour", async () => {
    const email = uniqueEmail();
    for (let i = 0; i < 3; i++) assert.equal((await server.client().post("/api/auth/password-reset/request", { email })).status, 202);
    assert.equal((await server.client().post("/api/auth/password-reset/request", { email })).status, 429);
  });
});
