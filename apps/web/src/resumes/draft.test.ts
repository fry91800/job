import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { resumeContentSchema } from "@job/shared";
import { draftToContent, freshDraft } from "./draft";

describe("a resume from scratch (R7)", () => {
  test("complete entries only, lines as responsibilities, current studies, soft skills apart; a valid resume", () => {
    const draft = {
      ...freshDraft(),
      name: " Léa Martin ",
      title: "Vendeuse en alternance",
      city: "Rennes",
      email: "lea@example.test",
      experiences: [
        { id: "x1", jobTitle: "Équipière", company: "Burger Shop", city: "", start: "2025-06", end: "2025-08", current: false, lines: "- Accueil des clients\n\n• Préparation des commandes  " },
        { id: "x2", jobTitle: "Bénévole", company: "", city: "", start: "", end: "", current: false, lines: "sans employeur : ignorée" },
      ],
      studies: [{ id: "s1", degree: "BTS MCO", institution: "Lycée Bréquigny", city: "Rennes", start: "2025-09", end: "2027-06", current: true }],
      skills: ["Encaissement", "Travail en équipe"],
    };
    const content = draftToContent(draft);
    assert.equal(content.basics.fullName, "Léa Martin");
    assert.deepEqual(content.basics.location, { city: "Rennes", region: null, country: null });
    assert.equal(content.workExperience.length, 1, "an experience needs its employer");
    assert.deepEqual(content.workExperience[0].responsibilities.map((item) => item.text), ["Accueil des clients", "Préparation des commandes"]);
    assert.deepEqual([content.education[0].endDate, content.education[0].description], [null, "En cours"]);
    assert.deepEqual(content.skills.map((skill) => skill.category), ["technical", "soft"]);
    assert.deepEqual(content.languages, [{ id: draft.languages[0].id, language: "Français", level: "Langue maternelle" }]);
    assert.ok(resumeContentSchema.safeParse(content).success, "accepted by the API");
  });
});
