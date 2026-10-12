import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { emptyResumeContent, type MeResponse, type ResumeDetail, type ResumeListResponse } from "@job/shared";
import { config } from "../config";
import { prisma, startTestServer, TestClient, TEST_PASSWORD, uniqueEmail } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;

before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const PDF = Buffer.from("%PDF-1.4\n% test file\n");

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

describe("resume upload (R2, placeholder parser)", () => {
  test("a PDF creates the placeholder resume and keeps the file", async () => {
    const client = server.client();
    const { status, body } = await upload(client, PDF, "?name=Imported");
    assert.equal(status, 201);
    assert.equal(body.name, "Imported");
    assert.equal(body.content.basics.fullName, "Jean Dupont");
    assert.equal(body.hasSourceFile, true);
    assert.ok(body.skillIds.length > 0);

    const source = await fetch(new URL(`/api/resumes/${body.id}/source`, server.baseUrl), { headers: { Cookie: `session=${client.session}` } });
    assert.equal(source.headers.get("content-type"), "application/pdf");
    assert.deepEqual(Buffer.from(await source.arrayBuffer()), PDF);
  });

  test("DOCX files are accepted, other files are not", async () => {
    const docx = Buffer.concat([Buffer.from("PK\x03\x04", "latin1"), Buffer.from("....word/document.xml....")]);
    assert.equal((await upload(server.client(), docx)).status, 201);
    assert.equal((await upload(server.client(), Buffer.from("PK\x03\x04 a zip without word", "latin1"))).status, 415);
    assert.equal((await upload(server.client(), Buffer.from("hello"))).status, 415);
    assert.equal((await upload(server.client(), Buffer.alloc(0))).status, 400);
  });

  test("files over the size limit are refused", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(config.limits.uploadMaxBytes)]);
    const { status, body } = await upload(server.client(), big);
    assert.equal(status, 413);
    assert.equal(body.error.code, "payload_too_large");
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
