import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { PolishLinesResponse, SuggestedSkillsResponse, WriteSummaryResponse } from "@job/shared";
import type { AiJsonRequest } from "../ai/provider";
import { prisma, startTestServer } from "../test/helpers";
import { resetSuggestedSkills } from "./resume-help";

// Help for writing a resume from scratch (FEATURE R7), with the fake AI.

let server: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  server = await startTestServer();
  resetSuggestedSkills();
});
after(() => server.close());

describe("resume help (R7)", () => {
  test("skills employers ask for a job: from the offers with that job, languages left out", async () => {
    // A job title of the seed offers.
    const offer = await prisma.offer.findFirstOrThrow({ where: { isPublic: true, closedAt: null, skills: { some: {} } }, select: { title: true } });
    const word = offer.title.split(/\s+/)[0];
    const { status, body } = await server.client().get<SuggestedSkillsResponse>(`/api/resume-help/skills?title=${encodeURIComponent(word)}`);
    assert.equal(status, 200);
    assert.ok(body.skills.length > 0, `skills for "${word}"`);
    assert.ok(body.skills.every((skill) => skill.charAt(0) === skill.charAt(0).toUpperCase()));
    assert.ok(!body.skills.some((skill) => /^(français|anglais)$/i.test(skill)), "languages are entered apart");
    assert.equal((await server.client().get("/api/resume-help/skills")).status, 400, "a title is needed");
  });

  test("an experience's lines reworded, from what the person wrote only", async () => {
    let request: AiJsonRequest | undefined;
    const { status, body } = await server.ai.with(
      "write-resume-text",
      (sent) => {
        request = sent;
        return { lines: ["Accueil et conseil des clients", "Encaissement et tenue de la caisse"] };
      },
      () => server.client().post<PolishLinesResponse>("/api/resume-help/polish", { language: "fr", jobTitle: "Vendeur", company: "Décathlon", lines: ["j'accueillais les clients et je les conseillais", "je faisais la caisse"] }),
    );
    assert.equal(status, 200);
    assert.deepEqual(body.lines, ["Accueil et conseil des clients", "Encaissement et tenue de la caisse"]);
    assert.match(JSON.stringify(request), /strictly truthful/);
    assert.match(JSON.stringify(request), /je faisais la caisse/);
    const tooMany = await server.ai.with("write-resume-text", () => ({ lines: ["a b", "c d", "e f"] }), () =>
      server.client().post<{ error: { code: string } }>("/api/resume-help/polish", { language: "fr", jobTitle: "Vendeur", lines: ["une ligne seulement"] }),
    );
    assert.notEqual(tooMany.status, 200, "never more lines than written");
  });

  test("the profile summary, from the entered data", async () => {
    const { status, body } = await server.ai.with("write-resume-text", () => ({ summary: "Étudiant en BTS MCO, expérience de la vente en magasin de sport, à la recherche d'une alternance de vendeur." }), () =>
      server.client().post<WriteSummaryResponse>("/api/resume-help/summary", {
        language: "fr",
        targetTitle: "Vendeur en alternance",
        experiences: [{ jobTitle: "Vendeur", company: "Décathlon", lines: ["Accueil des clients"] }],
        education: [{ degree: "BTS MCO", institution: "Lycée Jean Moulin", current: true }],
        skills: ["Vente", "Encaissement"],
      }),
    );
    assert.equal(status, 200);
    assert.match(body.summary, /BTS MCO/);
  });
});
