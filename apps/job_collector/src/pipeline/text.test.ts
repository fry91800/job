import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { tokenize } from "@job/backend";
import { labelVariants } from "../catalogue/labels";
import { parseCsv } from "../catalogue/csv";
import { detectLanguage, normalizeCompanyName, normalizeTitle, offerFingerprint, qualityScore, removePersonalData, textSimilarity } from "./text";

describe("pipeline text helpers", () => {
  test("company names: legal forms, case, accents and punctuation removed", () => {
    for (const name of ["Cloudine SAS", "CLOUDINE", "Cloudine S.A.S.", "cloudine sarl"]) assert.equal(normalizeCompanyName(name), "cloudine");
    assert.equal(normalizeCompanyName("Pixel & Plume"), "pixel et plume");
    assert.equal(normalizeCompanyName("Société Générale SA"), "societe generale");
  });

  test("titles: gender markers removed for fingerprints", () => {
    assert.equal(normalizeTitle("Développeur Full-Stack (H/F)"), "developpeur full stack");
    assert.equal(normalizeTitle("Développeur Full Stack F/H"), "developpeur full stack");
    assert.equal(normalizeTitle("Développeur C++ h/f/x"), "developpeur c++");
    assert.equal(offerFingerprint("cloudine", "Dev React (H/F)", "44"), "cloudine|dev react|44");
    assert.equal(offerFingerprint(null, "Dev React", "44"), null, "no company, no fingerprint");
  });

  test("personal data: emails and phone numbers removed", () => {
    const text = "Contact : jeanne.dupont@cloudine.fr ou 06 12 34 56 78, +33 1 23 45 67 89. Salaire 45000 €, réf. 2026-10.";
    assert.equal(removePersonalData(text), "Contact : […] ou […], […]. Salaire 45000 €, réf. 2026-10.");
  });

  test("language detection", () => {
    assert.equal(detectLanguage("Nous recherchons un développeur pour notre équipe et vous aurez des missions variées dans la data."), "fr");
    assert.equal(detectLanguage("We are looking for a developer to join our team and you will work on the platform with us."), "en");
    assert.equal(detectLanguage("React Node.js"), null);
  });

  test("description similarity", () => {
    const a = "Cloudine recrute un développeur React pour son équipe produit à Nantes. Missions : développer de nouvelles fonctionnalités.";
    assert.equal(textSimilarity(a, a), 1);
    assert.ok(textSimilarity(a, `${a} Télétravail possible.`) > 0.7);
    assert.ok(textSimilarity(a, "Offre de comptable en cabinet à Lyon, tenue de la comptabilité générale.") < 0.1);
  });

  test("quality score", () => {
    const full = { hasSalary: true, hasLocation: true, hasContract: true, hasRemote: true, hasCompany: true, skillCount: 5, descriptionLength: 800, hasPublishedAt: true };
    assert.equal(qualityScore(full), 100);
    assert.equal(qualityScore({ ...full, hasSalary: false, skillCount: 1 }), 70);
  });
});

describe("catalogue helpers", () => {
  test("occupation label variants: gender forms and parenthesis", () => {
    assert.deepEqual(labelVariants("Développeur / Développeuse informatique"), ["Développeur / Développeuse informatique", "Développeur informatique", "Développeuse informatique"]);
    assert.deepEqual(labelVariants("Administrateur / Administratrice de systèmes d'information (SI)").slice(1), [
      "Administrateur de systèmes d'information (SI)",
      "Administratrice de systèmes d'information (SI)",
      "Administrateur de systèmes d'information",
      "Administratrice de systèmes d'information",
    ]);
    assert.deepEqual(labelVariants("développeur web/développeuse web"), ["développeur web/développeuse web", "développeur web", "développeuse web"]);
    assert.deepEqual(labelVariants("Designer UX/UI"), ["Designer UX/UI"], "not gender forms");
    assert.deepEqual(labelVariants("danseur/danseuse"), ["danseur/danseuse", "danseur", "danseuse"]);
  });

  test("CSV: quotes, doubled quotes, line breaks inside fields", () => {
    assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi""\nagain"\r\n1,2'), [["a", "b"], ["x, y", 'say "hi"\nagain'], ["1", "2"]]);
  });

  test("tokens keep technical names whole", () => {
    assert.deepEqual(tokenize("Node.js, C#, C++ et .NET ; front-end. PostgreSQL."), ["node.js", "c#", "c++", "et", ".net", "front-end", "postgresql"]);
  });
});
