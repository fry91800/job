import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { emptyResumeContent, type ResumeDetail, type ResumeListResponse } from "@job/shared";
import type { AiJsonRequest } from "../ai/provider";
import { config } from "../config";
import { startTestServer, TestClient, TEST_PASSWORD, uniqueEmail } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;

before(async () => {
  server = await startTestServer();
  server.ai.handlers["translate-resume"] = fakeTranslation;
  server.ai.handlers["translate-field"] = () => ({ text: "Re-translated text" });
});
after(() => server.close());

// "Translates" every text it receives by prefixing [EN], keeping the ids.
function fakeTranslation(request: AiJsonRequest) {
  const text = (request.parts[0] as { text: string }).text;
  const fields = JSON.parse(text.slice(text.indexOf("<resume-fields>") + 15, text.indexOf("</resume-fields>")));
  const tr = (value: unknown): unknown =>
    typeof value === "string" ? `[EN] ${value}` : Array.isArray(value) ? value.map(tr) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, key === "id" ? inner : tr(inner)]))
      : value;
  return tr(fields);
}

const sourceContent = {
  ...emptyResumeContent("Camille Martin"),
  basics: { ...emptyResumeContent("Camille Martin").basics, title: "Développeuse", email: "camille@example.com" },
  summary: "Développeuse web.",
  skills: [
    { name: "React", category: "technical" },
    { name: "Travail en équipe", category: "soft" },
  ],
  workExperience: [
    {
      jobTitle: "Développeuse", company: "Atelier Numérique", location: "Paris", startDate: "2021-01", endDate: null, isCurrent: true,
      responsibilities: [{ text: "Développement d'applications." }], technologies: ["React", "Node.js"],
    },
  ],
  education: [{ degree: "Master informatique", institution: "Université de Lyon", location: null, startDate: "2018", endDate: "2020", description: null }],
  languages: [{ language: "Anglais", level: "C1" }],
  interests: ["Escalade"],
};

async function userWithResume(guest = false) {
  const client = server.client();
  if (!guest) await client.post("/api/auth/signup", { email: uniqueEmail(), password: TEST_PASSWORD });
  const resume = (await client.post<ResumeDetail>("/api/resumes", { name: "Mon CV", language: "fr", content: sourceContent })).body;
  return { client, resume };
}

const translate = (client: TestClient, id: string, body: object) => client.post(`/api/resumes/${id}/translations`, body);

describe("resume translation (T1)", () => {
  test("creates a linked resume; only translatable fields change", async () => {
    const { client, resume } = await userWithResume();
    const { status, body } = await translate(client, resume.id, { language: "en" });
    assert.equal(status, 201);
    const translated = body as ResumeDetail;
    assert.equal(translated.name, "Mon CV (EN)");
    assert.equal(translated.language, "en");
    assert.equal(translated.translatedFrom?.id, resume.id);
    assert.equal(translated.isSelected, false, "never selected automatically");

    const content = translated.content;
    assert.equal(content.summary, "[EN] Développeuse web.");
    assert.equal(content.basics.title, "[EN] Développeuse");
    assert.equal(content.workExperience[0].jobTitle, "[EN] Développeuse");
    assert.equal(content.workExperience[0].responsibilities[0].text, "[EN] Développement d'applications.");
    assert.equal(content.education[0].degree, "[EN] Master informatique");
    assert.equal(content.education[0].description, null, "empty fields stay empty");
    assert.deepEqual(content.interests, ["[EN] Escalade"]);
    assert.equal(content.skills.find((skill) => skill.category === "soft")!.name, "[EN] Travail en équipe");

    // Never translated or changed.
    assert.equal(content.skills.find((skill) => skill.category === "technical")!.name, "React");
    assert.equal(content.basics.fullName, "Camille Martin");
    assert.equal(content.basics.email, "camille@example.com");
    assert.equal(content.workExperience[0].company, "Atelier Numérique");
    assert.deepEqual(content.workExperience[0].technologies, ["React", "Node.js"]);
    assert.equal(content.education[0].institution, "Université de Lyon");
    assert.deepEqual(
      [content.workExperience[0].startDate, content.workExperience[0].isCurrent],
      [resume.content.workExperience[0].startDate, true],
    );
    assert.deepEqual(content.skills.map((skill) => skill.id), resume.content.skills.map((skill) => skill.id), "same ids, same order");

    // The AI never saw the protected fields.
    const sent = (server.ai.requests.at(-1)!.parts[0] as { text: string }).text;
    assert.doesNotMatch(sent, /Camille Martin|camille@example.com|Atelier Numérique|Université de Lyon|"React"/);
  });

  test("an answer with missing or added items is retried, then fails", async () => {
    const { client, resume } = await userWithResume();
    const missing = (request: AiJsonRequest) => ({ ...(fakeTranslation(request) as object), interests: [] });
    await server.ai.with("translate-resume", missing, async () => {
      const { status, body } = await translate(client, resume.id, { language: "en" });
      assert.equal(status, 502);
      assert.equal(body.error.code, "ai_invalid_output");
    });
    let calls = 0;
    await server.ai.with("translate-resume", (request) => (++calls === 1 ? missing(request) : fakeTranslation(request)), async () => {
      assert.equal((await translate(client, resume.id, { language: "en" })).status, 201);
    });
  });

  test("same language refused; an existing translation is proposed unless forced", async () => {
    const { client, resume } = await userWithResume();
    assert.equal((await translate(client, resume.id, { language: "fr" })).body.error.code, "same_language");
    const first = (await translate(client, resume.id, { language: "en" })).body as ResumeDetail;
    const again = await translate(client, resume.id, { language: "en" });
    assert.equal(again.status, 409);
    assert.deepEqual(again.body.error.details, { existingResumeId: first.id });
    assert.equal((await translate(client, resume.id, { language: "en", force: true })).status, 201);
  });

  test("flags translations whose source changed afterwards", async () => {
    const { client, resume } = await userWithResume();
    const translated = (await translate(client, resume.id, { language: "en" })).body as ResumeDetail;
    assert.equal(translated.translatedFrom?.changedSinceTranslation, false);
    await client.put(`/api/resumes/${resume.id}`, { name: "Mon CV", language: "fr", content: { ...sourceContent, summary: "Modifié." } });
    const list = (await client.get<ResumeListResponse>("/api/resumes")).body.results;
    assert.equal(list.find((item) => item.id === translated.id)?.translatedFrom?.changedSinceTranslation, true);
  });

  test("guests can translate a limited number of times", async () => {
    const { client, resume } = await userWithResume(true);
    const limits = { ...config.limits.resumes };
    config.limits.resumes.guest = 10; // the resume limit must not be what stops it
    try {
      for (let i = 0; i < config.limits.translations.guestTotal; i++) {
        assert.equal((await translate(client, resume.id, { language: "en", force: true })).status, 201);
      }
      const over = await translate(client, resume.id, { language: "en", force: true });
      assert.equal(over.status, 429);
    } finally {
      config.limits.resumes.guest = limits.guest;
    }
  });

  test("re-translate one field of a translation", async () => {
    const { client, resume } = await userWithResume();
    const translated = (await translate(client, resume.id, { language: "en" })).body as ResumeDetail;
    const responsibility = translated.content.workExperience[0].responsibilities[0];
    const path = `workExperience[id=${translated.content.workExperience[0].id}].responsibilities[id=${responsibility.id}].text`;

    const { status, body } = await client.post(`/api/resumes/${translated.id}/translate-field`, { path });
    assert.equal(status, 200);
    assert.deepEqual(body, { path, text: "Re-translated text" });
    assert.match((server.ai.requests.at(-1)!.parts[0] as { text: string }).text, /Développement d'applications\./, "from the source text");

    const technical = `skills[id=${translated.content.skills.find((skill) => skill.category === "technical")!.id}].name`;
    for (const forbidden of ["basics.fullName", technical, "workExperience[id=x].company"]) {
      assert.equal((await client.post(`/api/resumes/${translated.id}/translate-field`, { path: forbidden })).body.error.code, "not_translatable", forbidden);
    }
    assert.equal((await client.post(`/api/resumes/${resume.id}/translate-field`, { path: "summary" })).body.error.code, "not_a_translation");

    await client.delete(`/api/resumes/${resume.id}`);
    assert.equal((await client.post(`/api/resumes/${translated.id}/translate-field`, { path: "summary" })).body.error.code, "source_deleted");
  });
});
