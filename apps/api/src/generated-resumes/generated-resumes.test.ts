import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  computeMatch,
  emptyResumeContent,
  type GeneratedResumeDetail,
  type GeneratedResumeListResponse,
  type ResumeChange,
  type OfferDetail,
  type ResumeDetail,
  type SavedOfferListResponse,
  type Settings,
  type TemplateListResponse,
} from "@job/shared";
import type { AiJsonRequest } from "../ai/provider";
import { config } from "../config";
import { prisma, seedOfferId, startTestServer, TestClient, TEST_PASSWORD, uniqueEmail } from "../test/helpers";

let server: Awaited<ReturnType<typeof startTestServer>>;

before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const frenchOffer = seedOfferId("edge-brunoy-fullstack");
const englishOffer = seedOfferId("edge-remote-no-location");

async function userWithResume(language: "fr" | "en" = "fr", summary: string | null = null) {
  const client = server.client();
  await client.post("/api/auth/signup", { email: uniqueEmail(), password: TEST_PASSWORD });
  const content = {
    ...emptyResumeContent("Camille Martin"),
    basics: { ...emptyResumeContent("Camille Martin").basics, title: "Développeur full stack" },
    summary,
    skills: [
      { name: "Node.js", category: "technical" },
      { name: "React", category: "technical" },
    ],
  };
  const resume = (await client.post<ResumeDetail>("/api/resumes", { language, content })).body;
  return { client, resume };
}

// `any` body: success responses are GeneratedResumeDetail, errors are { error }.
const generate = (client: TestClient, body: object) => client.post("/api/generated-resumes", body);

describe("generate a resume (M1, modifier off)", () => {
  test("copies the resume, stores the match score and saves the offer", async () => {
    const { client, resume } = await userWithResume();
    const { status, body } = await generate(client, { offerId: frenchOffer });
    assert.equal(status, 201);
    assert.equal(body.resume?.id, resume.id);
    assert.equal(body.modified, false);
    assert.deepEqual(body.generatedContent, resume.content);
    assert.deepEqual(body.changes, []);
    assert.equal(body.template.id, 1);

    const offer = (await client.get<OfferDetail>(`/api/offers/${frenchOffer}`)).body;
    const expected = computeMatch(
      { skillIds: offer.skills.map((skill) => skill.id), occupationIds: offer.occupations.map((item) => item.id) },
      { skillIds: resume.skillIds, occupationIds: resume.occupationIds },
    );
    assert.equal(body.matchScore, expected.score);
    assert.ok(body.matchScore! > 0);

    assert.deepEqual(offer.generatedResumes.map((item) => item.id), [body.id]);
    const saved = (await client.get<SavedOfferListResponse>("/api/saved-offers")).body.results;
    assert.deepEqual(saved.map((item) => item.offer.id), [frenchOffer]);
  });

  test("later edits of the source resume don't change the generated one", async () => {
    const { client, resume } = await userWithResume();
    const generated = (await generate(client, { offerId: frenchOffer })).body;
    await client.put(`/api/resumes/${resume.id}`, { name: "x", language: "fr", content: emptyResumeContent("Someone Else") });
    const again = (await client.get<GeneratedResumeDetail>(`/api/generated-resumes/${generated.id}`)).body;
    assert.equal(again.generatedContent.basics.fullName, "Camille Martin");
  });

  test("needs a resume", async () => {
    const client = server.client();
    await client.post("/api/auth/signup", { email: uniqueEmail(), password: TEST_PASSWORD });
    const { status, body } = await generate(client, { offerId: frenchOffer });
    assert.equal(status, 400);
    assert.equal(body.error.code, "no_resume");
  });

  test("language check: proposes a resume in the offer's language, or generates anyway", async () => {
    const { client } = await userWithResume("fr");
    const mismatch = await generate(client, { offerId: englishOffer });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.error.code, "language_mismatch");
    assert.deepEqual(mismatch.body.error.details, { offerLanguage: "en", resumeLanguage: "fr", alternativeResumeId: null });

    const english = (await client.post<ResumeDetail>("/api/resumes", { language: "en", content: emptyResumeContent("Camille") })).body;
    const proposed = await generate(client, { offerId: englishOffer });
    assert.equal(proposed.body.error.details.alternativeResumeId, english.id);

    const anyway = await generate(client, { offerId: englishOffer, ignoreLanguageMismatch: true });
    assert.equal(anyway.status, 201);
    assert.equal(anyway.body.language, "fr", "the output stays in the resume language");
  });

  test("offers the user cannot see return 404", async () => {
    const { client } = await userWithResume();
    assert.equal((await generate(client, { offerId: seedOfferId("edge-private-user") })).status, 404);
  });
});

describe("view, edit, download (M3)", () => {
  test("HTML preview escapes the content and forbids scripts", async () => {
    const { client } = await userWithResume("fr", "<script>alert(1)</script> & co");
    const generated = (await generate(client, { offerId: frenchOffer })).body;
    const response = await fetch(new URL(`/api/generated-resumes/${generated.id}/html`, server.baseUrl), {
      headers: { Cookie: `session=${client.session}` },
    });
    const html = await response.text();
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co"));
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("Profil"), "headings in the resume language");
  });

  test("PDF download with the file name rule", async () => {
    const { client } = await userWithResume();
    const generated = (await generate(client, { offerId: frenchOffer })).body;
    const response = await fetch(new URL(`/api/generated-resumes/${generated.id}/pdf`, server.baseUrl), {
      headers: { Cookie: `session=${client.session}` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(response.headers.get("content-disposition") ?? "", /Camille-Martin_Brunoy-Digital_\d{4}-\d{2}-\d{2}\.pdf/);
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  });

  test("change template, edit content, history list, delete", async () => {
    const { client } = await userWithResume();
    const generated = (await generate(client, { offerId: frenchOffer })).body;

    const templates = (await client.get<TemplateListResponse>("/api/templates")).body.results;
    const modern = templates.find((template) => template.rendererKey === "modern")!;
    const changed = await client.patch<GeneratedResumeDetail>(`/api/generated-resumes/${generated.id}`, { templateId: modern.id });
    assert.equal(changed.body.template.id, modern.id);

    const content = { ...generated.generatedContent, summary: "Edited by hand" };
    const edited = await client.patch<GeneratedResumeDetail>(`/api/generated-resumes/${generated.id}`, { generatedContent: content });
    assert.equal(edited.body.generatedContent.summary, "Edited by hand");
    assert.equal(edited.body.originalContent.summary, null, "the original snapshot is kept");

    const list = (await client.get<GeneratedResumeListResponse>(`/api/generated-resumes?offerId=${frenchOffer}`)).body.results;
    assert.deepEqual(list.map((item) => item.id), [generated.id]);

    assert.equal((await client.delete(`/api/generated-resumes/${generated.id}`)).status, 204);
    assert.equal((await client.get(`/api/generated-resumes/${generated.id}`)).status, 404);
    assert.ok(await prisma.generatedResume.findUnique({ where: { id: generated.id } }), "soft deleted");
  });

  test("other users' generated resumes return 404", async () => {
    const { client } = await userWithResume();
    const generated = (await generate(client, { offerId: frenchOffer })).body;
    const other = (await userWithResume()).client;
    assert.equal((await other.get(`/api/generated-resumes/${generated.id}`)).status, 404);
    assert.equal((await other.get(`/api/generated-resumes/${generated.id}/pdf`)).status, 404);
  });
});

describe("settings and templates (S1, S2)", () => {
  test("templates are public and ordered", async () => {
    const { body } = await server.client().get<TemplateListResponse>("/api/templates");
    assert.deepEqual(body.results.map((template) => template.rendererKey), ["classic", "modern"]);
  });

  test("update settings; unknown templates and config keys are rejected", async () => {
    const client = server.client();
    const updated = await client.patch<Settings>("/api/settings", {
      modifierEnabled: true,
      modifierStrength: "hard",
      modifierConfig: { summary: true, projects: true },
      templateId: 2,
    });
    assert.equal(updated.status, 200, "creates a guest");
    assert.equal(updated.body.modifierStrength, "hard");
    assert.deepEqual(updated.body.modifierConfig, { summary: true, projects: true });
    assert.equal((await client.get<Settings>("/api/settings")).body.templateId, 2);

    assert.equal((await client.patch("/api/settings", { templateId: 999 })).status, 400);
    assert.equal((await client.patch("/api/settings", { modifierConfig: { education: true } })).status, 400);
    assert.equal((await client.patch("/api/settings", {})).status, 400);
  });

  test("a retired template falls back to the first available one", async () => {
    const client = server.client();
    await client.patch("/api/settings", { templateId: 2 });
    await prisma.template.update({ where: { id: 2 }, data: { deletedAt: new Date() } });
    try {
      assert.equal((await client.get<Settings>("/api/settings")).body.templateId, 1);
    } finally {
      await prisma.template.update({ where: { id: 2 }, data: { deletedAt: null } });
    }
  });
});

// The resume the AI received, to build a proposal with its real item ids.
function resumeSent(request: AiJsonRequest) {
  const text = (request.parts[0] as { text: string }).text;
  return JSON.parse(text.slice(text.indexOf("<resume>") + 8, text.indexOf("</resume>")));
}

// Rewrites the summary, reverses the skills and adds "TypeScript".
function proposal(request: AiJsonRequest) {
  const resume = resumeSent(request);
  return {
    summary: "Développeuse full stack orientée React et Node.js.",
    skills: [...resume.skills].reverse().concat([{ name: "TypeScript", category: "technical" }]),
  };
}

const modifier = { modifierEnabled: true, modifierStrength: "hard", modifierConfig: { summary: true, skills: true } };

describe("generation with the modifier (M1) and change review (M4)", () => {
  test("the AI proposal becomes a reviewable change set, applied by default", async () => {
    const { client, resume } = await userWithResume("fr", "Développeuse web.");
    const { status, body } = await server.ai.with("generate-resume", proposal, () => generate(client, { offerId: frenchOffer, ...modifier }));
    assert.equal(status, 201);
    const detail = body as GeneratedResumeDetail;
    assert.equal(detail.modified, true);
    assert.equal(detail.modifierStrength, "hard");
    assert.deepEqual(detail.modifierConfig, { summary: true, skills: true });
    assert.equal(detail.aiModel, "fake:fake-model");
    assert.deepEqual(detail.changes.map((change) => change.op).sort(), ["add", "reorder", "replace"]);
    assert.equal(detail.changes.find((change) => change.op === "add")!.flag, "added_skill");
    assert.equal(detail.pendingChanges, 3);
    assert.equal(detail.generatedContent.summary, "Développeuse full stack orientée React et Node.js.");
    assert.deepEqual(detail.generatedContent.skills.map((skill) => skill.name), ["React", "Node.js", "TypeScript"]);
    assert.deepEqual(detail.originalContent, resume.content);

    const row = await prisma.generatedResume.findUniqueOrThrow({ where: { id: detail.id } });
    assert.ok(row.promptVersion);

    // The AI was asked for the allowed sections only, with the strength rules.
    const request = server.ai.requests.at(-1)!;
    assert.deepEqual(Object.keys((request.jsonSchema as any).properties).sort(), ["skills", "summary"]);
    assert.match(request.system, /Strength HARD/);
    assert.match(request.system, /Never invent or change employers/);
  });

  test("accept and reject changes; rejected ones are undone in the content", async () => {
    const { client } = await userWithResume("fr", "Développeuse web.");
    const generated = (await server.ai.with("generate-resume", proposal, () => generate(client, { offerId: frenchOffer, ...modifier }))).body as GeneratedResumeDetail;
    const changeId = (op: string) => generated.changes.find((change) => change.op === op)!.id;
    const decide = (decisions: object[]) => client.patch<GeneratedResumeDetail>(`/api/generated-resumes/${generated.id}/changes`, { decisions });

    let result = await decide([{ id: changeId("add"), status: "rejected" }, { id: changeId("reorder"), status: "rejected" }]);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.generatedContent.skills.map((skill) => skill.name), ["Node.js", "React"]);
    assert.equal(result.body.pendingChanges, 1);

    result = await decide([{ id: changeId("replace"), status: "rejected" }, { id: changeId("add"), status: "accepted" }]);
    assert.equal(result.body.generatedContent.summary, "Développeuse web.");
    assert.deepEqual(result.body.generatedContent.skills.map((skill) => skill.name), ["Node.js", "React", "TypeScript"]);
    assert.equal(result.body.pendingChanges, 0);

    assert.equal((await decide([{ id: "c99", status: "accepted" }])).status, 404);
    assert.equal((await decide([{ id: changeId("add"), status: "maybe" }])).status, 400);
  });

  test("a manual edit of a changed field makes the change edited", async () => {
    const { client } = await userWithResume("fr", "Développeuse web.");
    const generated = (await server.ai.with("generate-resume", proposal, () => generate(client, { offerId: frenchOffer, ...modifier }))).body as GeneratedResumeDetail;
    const content = { ...generated.generatedContent, summary: "Écrit à la main." };
    const edited = await client.patch<GeneratedResumeDetail>(`/api/generated-resumes/${generated.id}`, { generatedContent: content });
    const replace = edited.body.changes.find((change: ResumeChange) => change.op === "replace")!;
    assert.equal(replace.status, "edited");
    assert.equal(edited.body.generatedContent.summary, "Écrit à la main.");

    const decision = await client.patch(`/api/generated-resumes/${generated.id}/changes`, { decisions: [{ id: replace.id, status: "rejected" }] });
    assert.equal(decision.status, 409);
    assert.equal(decision.body.error.code, "change_edited");
  });

  test("modifications outside the allowed sections are dropped", async () => {
    const { client } = await userWithResume("fr", "Développeuse web.");
    const sneaky = (request: AiJsonRequest) => ({ summary: "Résumé réécrit.", skills: resumeSent(request).skills.slice(1), basics: { fullName: "Someone Else" } });
    const { body } = await server.ai.with("generate-resume", sneaky, () =>
      generate(client, { offerId: frenchOffer, modifierEnabled: true, modifierStrength: "soft", modifierConfig: { summary: true } }),
    );
    assert.deepEqual(body.changes.map((change: ResumeChange) => change.path), ["summary"]);
    assert.equal(body.generatedContent.basics.fullName, "Camille Martin");
    assert.equal(body.generatedContent.skills.length, 2);
  });

  test("an empty proposal is saved with no changes", async () => {
    const { client } = await userWithResume("fr", "Développeuse web.");
    const { status, body } = await server.ai.with("generate-resume", () => ({ summary: "Développeuse web." }), () =>
      generate(client, { offerId: frenchOffer, modifierEnabled: true, modifierStrength: "soft", modifierConfig: { summary: true } }),
    );
    assert.equal(status, 201);
    assert.equal(body.modified, true);
    assert.deepEqual(body.changes, []);
  });

  test("needs at least one section; `remember` saves the overrides as defaults", async () => {
    const { client } = await userWithResume("fr", "Développeuse web.");
    const none = await generate(client, { offerId: frenchOffer, modifierEnabled: true, modifierConfig: {} });
    assert.equal(none.body.error.code, "no_section_selected");

    await server.ai.with("generate-resume", proposal, () => generate(client, { offerId: frenchOffer, ...modifier, remember: true }));
    const settings = (await client.get<Settings>("/api/settings")).body;
    assert.deepEqual([settings.modifierEnabled, settings.modifierStrength, settings.modifierConfig], [true, "hard", { summary: true, skills: true }]);
  });

  test("AI failures save nothing and use no quota", async () => {
    const { client } = await userWithResume("fr", "Développeuse web.");
    const failed = await server.ai.with("generate-resume", () => "not json", () => generate(client, { offerId: frenchOffer, ...modifier }));
    assert.equal(failed.status, 502);
    assert.deepEqual((await client.get<GeneratedResumeListResponse>("/api/generated-resumes")).body.results, []);
  });

  test("guests can generate with the AI a limited number of times; modifier off stays free", async () => {
    const client = server.client();
    await client.post("/api/resumes", { language: "fr", content: { ...emptyResumeContent("Camille"), summary: "Développeuse web." } });
    await server.ai.with("generate-resume", proposal, async () => {
      for (let i = 0; i < config.limits.aiGenerations.guestTotal; i++) {
        assert.equal((await generate(client, { offerId: frenchOffer, ...modifier })).status, 201);
      }
      const over = await generate(client, { offerId: frenchOffer, ...modifier });
      assert.equal(over.status, 429);
    });
    assert.equal((await generate(client, { offerId: frenchOffer, modifierEnabled: false })).status, 201);
  });
});
