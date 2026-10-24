import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { emptyResumeContent, type CoverLetterDetail, type CoverLetterListResponse, type ResumeDetail, type SavedOfferListResponse } from "@job/shared";
import type { AiJsonRequest } from "../ai/provider";
import { config } from "../config";
import { seedOfferId, startTestServer, TEST_PASSWORD, uniqueEmail } from "../test/helpers";

// Cover letters (FEATURE M5), with the fake AI.

let server: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const frenchOffer = seedOfferId("edge-brunoy-fullstack");
const englishOffer = seedOfferId("edge-remote-no-location");

const letter = {
  subject: "Candidature au poste de développeur full stack",
  salutation: "Madame, Monsieur,",
  paragraphs: [
    "Votre offre de développeur full stack à Brunoy a retenu toute mon attention : elle porte sur des API Node.js et des interfaces React.",
    "Développeur full stack, j'ai conçu des services Node.js et des écrans React, les deux technologies au cœur de votre poste.",
  ],
  closing: "Je serais heureux d'en échanger avec vous lors d'un entretien.",
};

async function userWithResume(signup = true) {
  const client = server.client();
  if (signup) await client.post("/api/auth/signup", { email: uniqueEmail(), password: TEST_PASSWORD });
  const base = emptyResumeContent("Camille Martin");
  const content = {
    ...base,
    basics: { ...base.basics, title: "Développeur full stack", email: "camille@example.test", phone: "06 12 34 56 78", location: { city: "Lyon", region: null, country: "France" } },
    skills: [{ name: "Node.js", category: "technical" }, { name: "React", category: "technical" }],
  };
  const resume = (await client.post<ResumeDetail>("/api/resumes", { language: "fr", content })).body;
  return { client, resume };
}

describe("cover letters (M5)", () => {
  test("written from the resume and the offer, in the offer's language; the header filled in by us", async () => {
    const { client, resume } = await userWithResume();
    let request: AiJsonRequest | undefined;
    const { status, body } = await server.ai.with(
      "write-cover-letter",
      (sent) => {
        request = sent;
        return letter;
      },
      () => client.post<CoverLetterDetail>("/api/cover-letters", { offerId: frenchOffer }),
    );
    assert.equal(status, 201);
    assert.equal(body.language, "fr");
    assert.equal(body.resume?.id, resume.id);
    assert.equal(body.subject, letter.subject);
    assert.equal(body.body, [letter.salutation, ...letter.paragraphs, letter.closing].join("\n\n"));
    assert.deepEqual(body.sender, { name: "Camille Martin", title: "Développeur full stack", email: "camille@example.test", phone: "06 12 34 56 78", location: "Lyon, France" });
    const text = JSON.stringify(request);
    assert.doesNotMatch(text, /camille@example\.test|06 12 34 56 78/, "contact details are not sent to the AI");
    assert.match(text, /French cover letter conventions/);

    const saved = (await client.get<SavedOfferListResponse>("/api/saved-offers")).body.results;
    assert.ok(saved.some((item) => item.offer.id === frenchOffer), "the offer is saved");
    const list = (await client.get<CoverLetterListResponse>(`/api/cover-letters?offerId=${frenchOffer}`)).body.results;
    assert.deepEqual(list.map((item) => item.id), [body.id]);
  });

  test("edited by the user; rendered as a page and a PDF; other users can't see it", async () => {
    const { client } = await userWithResume();
    const written = (await server.ai.with("write-cover-letter", () => letter, () => client.post<CoverLetterDetail>("/api/cover-letters", { offerId: frenchOffer }))).body;
    const edited = await client.patch<CoverLetterDetail>(`/api/cover-letters/${written.id}`, { body: "Madame, Monsieur,\n\nMon texte <b>revu</b>.\n\nCordialement." });
    assert.equal(edited.status, 200);
    assert.match(edited.body.body, /Mon texte <b>revu<\/b>/);
    const raw = (path: string) => fetch(new URL(path, server.baseUrl), { headers: { Cookie: `session=${client.session}` } });
    const page = await raw(`/api/cover-letters/${written.id}/html`);
    const html = await page.text();
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.match(html, /Mon texte &lt;b&gt;revu&lt;\/b&gt;/, "escaped in the page");
    assert.ok(!html.includes("<b>revu"));
    assert.match(html, /Objet : Candidature au poste/);
    assert.match(html, /Lyon, le \d/, "the town only in the date line");
    const pdf = await raw(`/api/cover-letters/${written.id}/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.match(pdf.headers.get("content-disposition") ?? "", /Lettre_Camille-Martin_.+_\d{4}-\d{2}-\d{2}\.pdf/);

    const other = (await userWithResume()).client;
    assert.equal((await other.get(`/api/cover-letters/${written.id}`)).status, 404);
    assert.equal((await client.delete(`/api/cover-letters/${written.id}`)).status, 204);
    assert.equal((await client.get(`/api/cover-letters/${written.id}`)).status, 404);
  });

  test("an English offer: an English letter", async () => {
    const { client } = await userWithResume();
    let request: AiJsonRequest | undefined;
    const { body } = await server.ai.with(
      "write-cover-letter",
      (sent) => {
        request = sent;
        return { ...letter, subject: "Application for the position of developer", salutation: "Dear Hiring Manager," };
      },
      () => client.post<CoverLetterDetail>("/api/cover-letters", { offerId: englishOffer }),
    );
    assert.equal(body.language, "en");
    assert.match(JSON.stringify(request), /English cover letter conventions/);
  });

  test("guests: a few letters, then an account; no resume, no letter", async () => {
    const { client } = await userWithResume(false);
    for (let index = 0; index < config.limits.coverLetters.guestTotal; index++) {
      assert.equal((await server.ai.with("write-cover-letter", () => letter, () => client.post("/api/cover-letters", { offerId: frenchOffer }))).status, 201);
    }
    const refused = await server.ai.with("write-cover-letter", () => letter, () => client.post<{ error: { code: string } }>("/api/cover-letters", { offerId: frenchOffer }));
    assert.equal(refused.status, 429);
    assert.equal(refused.body.error.code, "limit_reached");

    const empty = server.client();
    await empty.post("/api/auth/signup", { email: uniqueEmail(), password: TEST_PASSWORD });
    assert.equal((await empty.post<{ error: { code: string } }>("/api/cover-letters", { offerId: frenchOffer })).body.error.code, "no_resume");
  });
});
