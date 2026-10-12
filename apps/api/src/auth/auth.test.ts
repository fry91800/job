import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { MeResponse, SavedOfferListResponse } from "@job/shared";
import { hashToken } from "./session";
import { prisma, seedOfferId, startTestServer, TEST_PASSWORD, uniqueEmail } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;

before(async () => {
  server = await startTestServer();
});
after(() => server.close());

async function signup(email = uniqueEmail()) {
  const client = server.client();
  const response = await client.post<MeResponse>("/api/auth/signup", { email, password: TEST_PASSWORD });
  assert.equal(response.status, 201);
  return { client, email, user: response.body.user! };
}

describe("sign up (A1)", () => {
  test("anonymous visitors have no user", async () => {
    const { body } = await server.client().get<MeResponse>("/api/auth/me");
    assert.deepEqual(body, { user: null });
  });

  test("creates an account and logs it in", async () => {
    const { client, email, user } = await signup();
    assert.equal(user.isGuest, false);
    assert.equal(user.email, email);
    assert.ok(client.session);
    const me = await client.get<MeResponse>("/api/auth/me");
    assert.equal(me.body.user?.id, user.id);
  });

  test("normalizes the email and rejects duplicates", async () => {
    const email = uniqueEmail();
    await signup(email);
    const duplicate = await server.client().post("/api/auth/signup", { email: `  ${email.toUpperCase()} `, password: TEST_PASSWORD });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, "email_taken");
  });

  test("validates the password length", async () => {
    const response = await server.client().post("/api/auth/signup", { email: uniqueEmail(), password: "short" });
    assert.equal(response.status, 400);
  });

  test("a guest keeps its id and data when signing up (G2)", async () => {
    const client = server.client();
    assert.equal((await client.put(`/api/saved-offers/${seedOfferId("edge-old")}`)).status, 201);
    const guest = (await client.get<MeResponse>("/api/auth/me")).body.user!;
    assert.equal(guest.isGuest, true);
    const guestSession = client.session;

    const signed = await client.post<MeResponse>("/api/auth/signup", { email: uniqueEmail(), password: TEST_PASSWORD });
    assert.equal(signed.body.user?.id, guest.id);
    assert.equal(signed.body.user?.isGuest, false);
    assert.equal(client.session, guestSession, "the same session continues");
    const saved = await client.get<SavedOfferListResponse>("/api/saved-offers");
    assert.equal(saved.body.results.length, 1);
  });
});

describe("log in (A2)", () => {
  test("logs in with the right password only, with a generic error", async () => {
    const { email } = await signup();
    const wrong = await server.client().post("/api/auth/login", { email, password: "wrong-password" });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, "invalid_credentials");
    const unknown = await server.client().post("/api/auth/login", { email: uniqueEmail(), password: "wrong-password" });
    assert.equal(unknown.body.error.code, "invalid_credentials");

    const client = server.client();
    const ok = await client.post<MeResponse>("/api/auth/login", { email: email.toUpperCase(), password: TEST_PASSWORD });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user?.email, email);
  });

  test("seeded users can log in and get their selected resume ids", async () => {
    const client = server.client();
    const { body } = await client.post<MeResponse>("/api/auth/login", { email: "demo@example.com", password: "demo-password" });
    assert.ok(body.user?.selectedResume);
    assert.ok(body.user.selectedResume.skillIds.length > 0);
    // Don't leave a test session on the demo user.
    await client.post("/api/auth/logout");
  });

  test("blocks an email after 5 failed attempts", async () => {
    const { email } = await signup();
    for (let i = 0; i < 5; i++) await server.client().post("/api/auth/login", { email, password: "wrong-password" });
    const blocked = await server.client().post("/api/auth/login", { email, password: TEST_PASSWORD });
    assert.equal(blocked.status, 429);
  });

  test("merges a guest's data into the account", async () => {
    const shared = seedOfferId("edge-remote-bordeaux");
    const guestOnly = seedOfferId("edge-internship");

    const account = await signup();
    await account.client.put(`/api/saved-offers/${shared}`);
    await account.client.patch(`/api/saved-offers/${shared}`, { notes: "Account notes" });
    await account.client.post("/api/auth/logout");

    const visitor = server.client();
    await visitor.put(`/api/saved-offers/${shared}`);
    await visitor.patch(`/api/saved-offers/${shared}`, { notes: "Guest notes", status: "applied" });
    await visitor.put(`/api/saved-offers/${guestOnly}`);
    const guestId = (await visitor.get<MeResponse>("/api/auth/me")).body.user!.id;

    const login = await visitor.post<MeResponse>("/api/auth/login", { email: account.email, password: TEST_PASSWORD });
    assert.equal(login.body.user?.id, account.user.id);

    const saved = (await visitor.get<SavedOfferListResponse>("/api/saved-offers")).body.results;
    const byOffer = new Map(saved.map((item) => [item.offer.id, item]));
    assert.equal(saved.length, 2);
    assert.equal(byOffer.get(shared)?.notes, "Account notes\n\nGuest notes");
    assert.equal(byOffer.get(shared)?.status, "saved", "the account's row wins");
    assert.ok(byOffer.has(guestOnly));
    assert.equal(await prisma.user.count({ where: { id: guestId } }), 0, "the guest is deleted");
  });
});

describe("sessions and log out (A3)", () => {
  test("logout ends the session", async () => {
    const { client } = await signup();
    const token = client.session!;
    assert.equal((await client.post("/api/auth/logout")).status, 204);
    assert.equal(client.session, undefined);
    const reused = await server.client(token).get<MeResponse>("/api/auth/me");
    assert.equal(reused.body.user, null);
  });

  test("guests cannot log out", async () => {
    const client = server.client();
    await client.put(`/api/saved-offers/${seedOfferId("edge-old")}`);
    assert.equal((await client.post("/api/auth/logout")).status, 403);
  });

  test("logout-all ends every session of the user", async () => {
    const { client, email } = await signup();
    const other = server.client();
    await other.post("/api/auth/login", { email, password: TEST_PASSWORD });
    assert.equal((await client.post("/api/auth/logout-all")).status, 204);
    assert.equal((await other.get<MeResponse>("/api/auth/me")).body.user, null);
  });

  test("sessions are extended once a day (sliding expiry)", async () => {
    const { client, user } = await signup();
    const where = { tokenHash: hashToken(client.session!) };
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    await prisma.session.update({ where, data: { lastUsedAt: twoDaysAgo, expiresAt: new Date(Date.now() + 3600 * 1000) } });

    await client.get("/api/auth/me");
    const session = await prisma.session.findUniqueOrThrow({ where });
    assert.ok(session.expiresAt.getTime() > Date.now() + 29 * 24 * 3600 * 1000);
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(dbUser.lastActiveAt.getTime() > Date.now() - 60 * 1000);
  });

  test("expired sessions are ignored", async () => {
    const { client } = await signup();
    await prisma.session.update({ where: { tokenHash: hashToken(client.session!) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await client.get<MeResponse>("/api/auth/me")).body.user, null);
  });

  test("state-changing requests from other origins are refused (CSRF)", async () => {
    const client = server.client();
    const body = { email: uniqueEmail(), password: TEST_PASSWORD };
    const evil = await client.request("POST", "/api/auth/signup", body, { Origin: "https://evil.example" });
    assert.equal(evil.status, 403);
    const ours = await client.request("POST", "/api/auth/signup", body, { Origin: "http://localhost:5173" });
    assert.equal(ours.status, 201);
  });
});

describe("password change (A7) and account deletion (A5)", () => {
  test("changing the password logs out the other devices only", async () => {
    const { client, email } = await signup();
    const other = server.client();
    await other.post("/api/auth/login", { email, password: TEST_PASSWORD });

    const wrong = await client.post("/api/auth/password", { currentPassword: "wrong-password", newPassword: "new-password-123" });
    assert.equal(wrong.status, 401);
    assert.equal((await client.post("/api/auth/password", { currentPassword: TEST_PASSWORD, newPassword: "new-password-123" })).status, 204);

    assert.ok((await client.get<MeResponse>("/api/auth/me")).body.user);
    assert.equal((await other.get<MeResponse>("/api/auth/me")).body.user, null);
    assert.equal((await server.client().post("/api/auth/login", { email, password: "new-password-123" })).status, 200);
  });

  test("deleting the account erases the email and frees it", async () => {
    const { client, email, user } = await signup();
    assert.equal((await client.delete("/api/auth/account", { password: "wrong-password" })).status, 401);
    assert.equal((await client.delete("/api/auth/account", { password: TEST_PASSWORD })).status, 204);

    const deleted = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.email, null);
    assert.equal((await server.client().post("/api/auth/login", { email, password: TEST_PASSWORD })).status, 401);
    assert.equal((await server.client().post("/api/auth/signup", { email, password: TEST_PASSWORD })).status, 201);
  });
});
