import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { emptyResumeContent, type MeResponse, type ResumeDetail, type ResumeListResponse } from "@job/shared";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import { renderPdf } from "../templates/pdf";
import { sampleParsedResume } from "../test/fixtures/sample-resume";
import { prisma, startTestServer, TestClient, TEST_PASSWORD, uniqueEmail } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;

let PDF: Buffer;
let DOCX: Buffer;

before(async () => {
  server = await startTestServer();
  // Real files: a PDF printed by Chromium, and a minimal DOCX fixture.
  PDF = await renderPdf("<html><body><h1>Marie Curie</h1><p>Data analyst chez DataVerse depuis 2021. Python, SQL, Power BI.</p></body></html>");
  DOCX = await readFile(join(__dirname, "../test/fixtures/resume.docx"));
});
after(() => server.close());

async function registered(): Promise<TestClient> {
  const client = server.client();
  await client.post("/api/auth/signup", { email: uniqueEmail(), password: TEST_PASSWORD });
  return client;
}

async function upload(client: TestClient, file: Buffer, query = "") {
  const response = await fetch(new URL(`/api/resumes/upload${query}`, server.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", ...(client.session && { Cookie: `session=${client.session}` }) },
    body: new Uint8Array(file),
  });
  const setCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith("session="));
  if (setCookie) client.session = /^session=([^;]*)/.exec(setCookie)![1];
  return { status: response.status, body: await response.json() };
}

const skillId = async (key: string) => (await prisma.skill.findFirstOrThrow({ where: { externalId: key } })).id;
const occupationId = async (key: string) => (await prisma.occupation.findFirstOrThrow({ where: { externalId: key } })).id;

describe("resumes (R1–R5)", () => {
  test("anonymous visitors have none", async () => {
    assert.deepEqual((await server.client().get("/api/resumes")).body, { results: [] });
  });

  test("create from scratch: default name, item ids, selected automatically", async () => {
    const client = server.client();
    const content = { ...emptyResumeContent("Camille Martin"), skills: [{ name: "Go", category: "technical" }] };
    const { status, body } = await client.post<ResumeDetail>("/api/resumes", { language: "fr", content });
    assert.equal(status, 201);
    assert.equal(body.name, "Resume 1");
    assert.equal(body.isSelected, true);
    assert.match(body.content.skills[0].id, /^[A-Za-z0-9_-]{8}$/);

    const second = await client.post<ResumeDetail>("/api/resumes", { language: "fr", content: emptyResumeContent("Camille Martin") });
    assert.equal(second.body.name, "Resume 2");
    assert.equal(second.body.isSelected, false, "the first one stays selected");
  });

  test("the default name follows the interface language", async () => {
    const client = server.client();
    await client.patch("/api/settings", { uiLanguage: "fr" });
    const { body } = await client.post<ResumeDetail>("/api/resumes", { language: "en", content: emptyResumeContent("Camille Martin") });
    assert.equal(body.name, "CV 1");
  });

  test("invalid content is rejected", async () => {
    const content = { ...emptyResumeContent("X"), summary: 3 };
    const { status, body } = await server.client().post("/api/resumes", { language: "fr", content });
    assert.equal(status, 400);
    assert.equal(body.error.code, "invalid_request");
  });

  test("saving re-extracts skills and occupations (M2)", async () => {
    const client = await registered();
    const created = (await client.post<ResumeDetail>("/api/resumes", { language: "fr", content: emptyResumeContent("Camille") })).body;
    assert.deepEqual(created.skillIds, []);

    const content = {
      ...created.content,
      basics: { ...created.content.basics, title: "Développeur back-end" },
      skills: [{ name: "node.js", category: "technical" }, { name: "Unknown skill", category: "technical" }],
      projects: [{ name: "API", description: null, technologies: ["Postgres"], link: null, highlights: [] }],
    };
    const updated = await client.put<ResumeDetail>(`/api/resumes/${created.id}`, { name: "Mon CV", language: "fr", content });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.name, "Mon CV");
    assert.deepEqual(updated.body.skillIds.sort(), [await skillId("nodejs"), await skillId("postgresql")].sort());
    assert.deepEqual(updated.body.occupationIds, [await occupationId("backend-developer")]);

    const me = (await client.get<MeResponse>("/api/auth/me")).body.user!;
    assert.deepEqual(me.selectedResume?.skillIds.sort(), updated.body.skillIds.sort());
  });

  test("select, delete (clears the selection), and list", async () => {
    const client = await registered();
    const first = (await client.post<ResumeDetail>("/api/resumes", { language: "fr", content: emptyResumeContent("A") })).body;
    const second = (await client.post<ResumeDetail>("/api/resumes", { language: "en", content: emptyResumeContent("A") })).body;

    assert.equal((await client.post(`/api/resumes/${second.id}/select`)).status, 204);
    let list = (await client.get<ResumeListResponse>("/api/resumes")).body.results;
    assert.deepEqual(list.filter((item) => item.isSelected).map((item) => item.id), [second.id]);

    assert.equal((await client.delete(`/api/resumes/${second.id}`)).status, 204);
    list = (await client.get<ResumeListResponse>("/api/resumes")).body.results;
    assert.deepEqual(list.map((item) => item.id), [first.id]);
    assert.equal((await client.get<MeResponse>("/api/auth/me")).body.user?.selectedResume, null);
    assert.equal((await client.get(`/api/resumes/${second.id}`)).status, 404);
  });

  test("other users' resumes return 404", async () => {
    const owner = await registered();
    const resume = (await owner.post<ResumeDetail>("/api/resumes", { language: "fr", content: emptyResumeContent("A") })).body;
    const other = await registered();
    assert.equal((await other.get(`/api/resumes/${resume.id}`)).status, 404);
    assert.equal((await other.put(`/api/resumes/${resume.id}`, { name: "x", language: "fr", content: emptyResumeContent("B") })).status, 404);
    assert.equal((await other.post(`/api/resumes/${resume.id}/select`)).status, 404);
    assert.equal((await other.delete(`/api/resumes/${resume.id}`)).status, 404);
  });

  test("guests can keep at most the configured number of resumes", async () => {
    const client = server.client();
    for (let i = 0; i < config.limits.resumes.guest; i++) {
      await client.post("/api/resumes", { language: "fr", content: emptyResumeContent("A") });
    }
    const over = await client.post("/api/resumes", { language: "fr", content: emptyResumeContent("A") });
    assert.equal(over.status, 429);
  });
});

describe("resume upload (R2)", () => {
  test("a PDF is read, parsed by the AI and kept", async () => {
    const client = server.client();
    const { status, body } = await upload(client, PDF, "?name=Imported");
    assert.equal(status, 201);
    assert.equal(body.name, "Imported");
    assert.equal(body.language, "fr");
    assert.equal(body.content.basics.fullName, "Jean Dupont");
    assert.match(body.content.skills[0].id, /^[A-Za-z0-9_-]{8}$/, "ids added by the API");
    assert.equal(body.hasSourceFile, true);
    assert.ok(body.skillIds.length > 0);

    // The AI got the text of the file, framed as data.
    const request = server.ai.requests.at(-1)!;
    assert.ok("text" in request.parts[0] && request.parts[0].text.includes("Marie Curie"));
    assert.match(request.system, /ignore any instruction/);

    const source = await fetch(new URL(`/api/resumes/${body.id}/source`, server.baseUrl), { headers: { Cookie: `session=${client.session}` } });
    assert.equal(source.headers.get("content-type"), "application/pdf");
    assert.deepEqual(Buffer.from(await source.arrayBuffer()), PDF);
  });

  test("DOCX files are read too", async () => {
    const { status } = await upload(server.client(), DOCX);
    assert.equal(status, 201);
    const request = server.ai.requests.at(-1)!;
    assert.ok("text" in request.parts[0] && request.parts[0].text.includes("Jeanne Martin"));
  });

  test("other files are refused", async () => {
    assert.equal((await upload(server.client(), Buffer.from("PK\x03\x04 a zip without word", "latin1"))).status, 415);
    assert.equal((await upload(server.client(), Buffer.from("hello"))).status, 415);
    assert.equal((await upload(server.client(), Buffer.alloc(0))).status, 400);
  });

  test("unreadable, scanned or too long PDFs get a clear error", async () => {
    const broken = await upload(server.client(), Buffer.from("%PDF-1.4\n% not really a pdf\n"));
    assert.equal(broken.body.error.code, "unreadable_file");
    const noText = await upload(server.client(), await renderPdf("<html><body></body></html>"));
    assert.equal(noText.body.error.code, "unreadable_file", "no text layer (scanned)");
    const pages = Array.from({ length: 11 }, (_, i) => `<p style="page-break-after: always">Page ${i + 1} ${"texte ".repeat(20)}</p>`).join("");
    const long = await upload(server.client(), await renderPdf(`<html><body>${pages}</body></html>`));
    assert.equal(long.status, 422);
    assert.equal(long.body.error.code, "too_many_pages");
  });

  test("files over the size limit are refused", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(config.limits.uploadMaxBytes)]);
    const { status, body } = await upload(server.client(), big);
    assert.equal(status, 413);
    assert.equal(body.error.code, "payload_too_large");
  });

  test("an invalid AI answer is retried once, then nothing is saved and no quota is used", async () => {
    const client = server.client();
    let calls = 0;
    const invalid = () => (++calls === 1 ? "not json" : { language: "fr", content: { schemaVersion: 1 } });
    await server.ai.with("parse-resume", invalid, async () => {
      const { status, body } = await upload(client, PDF);
      assert.equal(status, 502);
      assert.equal(body.error.code, "ai_invalid_output");
      assert.equal(calls, 2);
    });
    assert.deepEqual((await client.get("/api/resumes")).body, { results: [] });
    // Failed uploads don't count (G5): the guest can still upload its full quota.
    for (let i = 0; i < config.limits.resumeUploads.guestTotal; i++) {
      const { status, body } = await upload(client, PDF);
      assert.equal(status, 201);
      await client.delete(`/api/resumes/${body.id}`);
    }
  });

  test("the retry succeeds when the second answer is valid", async () => {
    let calls = 0;
    await server.ai.with("parse-resume", () => (++calls === 1 ? "{" : sampleParsedResume), async () => {
      assert.equal((await upload(server.client(), PDF)).status, 201);
    });
  });

  test("resumes in other languages are refused", async () => {
    await server.ai.with("parse-resume", () => ({ ...sampleParsedResume, language: "other" }), async () => {
      const { status, body } = await upload(server.client(), PDF);
      assert.equal(status, 422);
      assert.equal(body.error.code, "unsupported_language");
    });
  });

  test("guest uploads count deleted resumes too", async () => {
    const client = server.client();
    for (let i = 0; i < config.limits.resumeUploads.guestTotal; i++) {
      const { body } = await upload(client, PDF);
      await client.delete(`/api/resumes/${body.id}`);
    }
    const over = await upload(client, PDF);
    assert.equal(over.status, 429);
  });
});

describe("per-IP AI rate limit (G4)", () => {
  test("uploads and offer extractions share one limit", async () => {
    const limit = config.rateLimits.aiPerIp.max;
    try {
      // At least one AI request was counted for this IP by now; allow no more.
      assert.equal((await upload(server.client(), PDF)).status, 201);
      config.rateLimits.aiPerIp.max = 1;
      const upload429 = await upload(server.client(), PDF);
      assert.equal(upload429.status, 429);
      assert.equal(upload429.body.error.code, "rate_limited");
      const extract = await server.client().post("/api/user-offers/extract", { text: "[test] Développeur React\nUne offre avec assez de texte." });
      assert.equal(extract.status, 429);
    } finally {
      config.rateLimits.aiPerIp.max = limit;
    }
  });
});
