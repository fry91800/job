import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { canonicalIds, matchInText, matchLabels, prisma, resetCatalogueMatcher } from "@job/backend";
import { zipSync } from "fflate";
import { importCatalogue, parseRomeEscoMapping } from "./import";

// Small fixture versions of the official files; nothing is downloaded (the cache folder
// already holds them). Test codes Z99… are removed afterwards.

const ESCO_DEV = "http://data.europa.eu/esco/occupation/test-dev";
const ESCO_ADMIN = "http://data.europa.eu/esco/occupation/test-admin";
const ESCO_SKILL = "http://data.europa.eu/esco/skill/test-kotlin-multiplatform";
const TEST_SKILLS = ["test-python-esco", "test-planning", "test-gambling"].map((name) => `http://data.europa.eu/esco/skill/${name}`);

// ROME files are Windows-1252 (accents as single bytes).
const cp1252 = (value: unknown) => Buffer.from(JSON.stringify(value), "latin1");

let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "catalogue-test-"));
  const zip = zipSync({
    "unix_referentiel_code_rome_v999.json": cp1252([
      { code_rome: "Z9901", libelle: "Testeur / Testeuse de catalogues", code_rome_parent: "Z9901" },
      { code_rome: "Z9902", libelle: "Ingénieur / Ingénieure catalogue (IC)", code_rome_parent: "Z9901" },
    ]),
    "unix_referentiel_appellation_v999.json": cp1252([
      { code_ogr: 999001, libelle: "Vérificateur / Vérificatrice de référentiels", code_rome_parent: "Z9901" },
      { code_ogr: 999002, libelle: "Administrateur / Administratrice de nomenclatures", code_rome_parent: "Z9902" },
    ]),
  });
  await writeFile(join(dir, "rome-open-data.zip"), zip);
  await writeFile(
    join(dir, "esco-rome-fr.csv"),
    [
      "Mapping project name,ESCO - ROME",
      "",
      "classification 1 ID,classification 1 prefered label,classification 2 ID,classification 2 prefered label,mapping relation",
      `${ESCO_DEV},testeur de catalogues/testeuse de catalogues,999001,Vérificateur / Vérificatrice de référentiels,skos:exactMatch`,
      `${ESCO_ADMIN},administrateur de nomenclatures,999002,Administrateur / Administratrice de nomenclatures,skos:broadMatch`,
      `${ESCO_ADMIN},administrateur de nomenclatures,123456789,Unknown appellation,skos:closeMatch`,
    ].join("\n"),
  );
  const esco = join(dir, "esco");
  await rm(esco, { recursive: true, force: true });
  await import("node:fs/promises").then((fs) => fs.mkdir(esco));
  const occupations = (label: string, alt: string) => `conceptType,conceptUri,preferredLabel,altLabels\nOccupation,${ESCO_DEV},${label},"${alt}"\n`;
  await writeFile(join(esco, "occupations_fr.csv"), occupations("testeur de catalogues/testeuse de catalogues", "contrôleur de catalogues\nauditeur de catalogues"));
  await writeFile(join(esco, "occupations_en.csv"), occupations("catalogue tester", "catalogue auditor"));
  await writeFile(join(esco, "skills_fr.csv"), `conceptType,conceptUri,preferredLabel,altLabels\nKnowledgeSkillCompetence,${ESCO_SKILL},Kotlin Multiplateforme,KMP\n`);
  await writeFile(join(esco, "skills_en.csv"), `conceptType,conceptUri,preferredLabel,altLabels\nKnowledgeSkillCompetence,${ESCO_SKILL},Kotlin Multiplatform,KMP\n`);
});

after(async () => {
  await prisma.occupation.deleteMany({ where: { OR: [{ source: "rome", externalId: { startsWith: "Z99" } }, { source: "esco", externalId: { in: [ESCO_DEV, ESCO_ADMIN] } }] } });
  await prisma.skill.deleteMany({ where: { source: "esco", externalId: { in: [ESCO_SKILL, ...TEST_SKILLS] } } });
  await rm(dir, { recursive: true, force: true });
  resetCatalogueMatcher();
  await prisma.$disconnect();
});

describe("catalogue import (ROME + ESCO)", () => {
  test("the mapping file is read from its header row", () => {
    const rows = parseRomeEscoMapping("Mapping project name,ESCO - ROME\n\nclassification 1 ID,a,b,c,d\nhttp://x,label,10,app,skos:exactMatch\n");
    assert.deepEqual(rows, [{ escoUri: "http://x", escoLabel: "label", appellation: "10", relation: "skos:exactMatch" }]);
  });

  test("imports ROME with its hierarchy and names, ESCO, and the links between them", async () => {
    const messages: string[] = [];
    await importCatalogue({ cacheDir: dir, escoDir: join(dir, "esco"), log: (message) => messages.push(message) });
    assert.ok(messages.some((message) => /1 mapping rows with an appellation unknown/.test(message)), messages.join("\n"));

    const z9902 = await prisma.occupation.findFirstOrThrow({
      where: { source: "rome", externalId: "Z9902" },
      include: { parent: true, names: true, relations: { include: { relatedOccupation: true } } },
    });
    assert.equal(z9902.parent?.externalId, "Z9901");
    const names = z9902.names.map((name) => name.name);
    for (const name of ["Ingénieur catalogue", "Ingénieure catalogue", "Administrateur de nomenclatures", "Administratrice de nomenclatures"]) {
      assert.ok(names.includes(name), `${name} in ${names.join(" | ")}`);
    }
    assert.equal(z9902.names.filter((name) => name.isCanonical).length, 1, "one canonical name per language");
    assert.deepEqual(z9902.relations.map((relation) => [relation.relationshipType, relation.relatedOccupation.externalId]), [["related", ESCO_ADMIN]]);

    const z9901 = await prisma.occupation.findFirstOrThrow({ where: { source: "rome", externalId: "Z9901" }, include: { relations: true } });
    assert.equal(z9901.relations[0].relationshipType, "equivalent", "exact match");

    const escoDev = await prisma.occupation.findFirstOrThrow({ where: { source: "esco", externalId: ESCO_DEV }, include: { names: true } });
    const escoNames = escoDev.names.map((name) => `${name.language}:${name.name}`);
    for (const name of ["fr:testeuse de catalogues", "fr:auditeur de catalogues", "en:catalogue tester", "en:catalogue auditor"]) assert.ok(escoNames.includes(name), name);

    const skill = await prisma.skill.findFirstOrThrow({ where: { source: "esco", externalId: ESCO_SKILL }, include: { names: true } });
    assert.deepEqual(skill.names.map((name) => `${name.language}:${name.name}`).sort(), ["en:KMP", "en:Kotlin Multiplatform", "fr:KMP", "fr:Kotlin Multiplateforme"]);

    // The matcher sees the new names right away.
    const found = await matchInText("occupation", "Vérificatrice de référentiels (H/F)", "fr");
    assert.ok(found.includes(z9901.id));
  });

  test("acronyms only match in capitals", async () => {
    const skill = await prisma.skill.findFirstOrThrow({ where: { source: "esco", externalId: ESCO_SKILL } });
    assert.ok((await matchInText("skill", "Nous développons en KMP.", "fr")).includes(skill.id));
    assert.ok(!(await matchInText("skill", "Nous développons en kmp.", "fr")).includes(skill.id));
    assert.ok((await matchInText("skill", "Expérience en Kotlin Multiplateforme", "fr")).includes(skill.id), "full names in any case");
  });

  test("running it again changes nothing", async () => {
    const before = await prisma.occupationName.count();
    await importCatalogue({ cacheDir: dir, escoDir: join(dir, "esco"), log: () => {} });
    assert.equal(await prisma.occupationName.count(), before);
  });

  test("skills in free text: no everyday words, English fallback for technical names only, duplicates once", async () => {
    // ESCO-like entries: the same Python as the hand-made seed skill, an everyday English
    // word, and an ambiguous French word.
    const add = async (externalId: string, names: { language: string; name: string; isCanonical: boolean }[]) =>
      (await prisma.skill.create({ data: { source: "esco", externalId, names: { create: names.map((name) => ({ ...name, normalizedName: name.name.toLowerCase() })) } } })).id;
    const escoPython = await add(TEST_SKILLS[0], [{ language: "en", name: "Python (computer programming)", isCanonical: true }, { language: "en", name: "Python", isCanonical: false }]);
    const planning = await add(TEST_SKILLS[1], [{ language: "en", name: "planning", isCanonical: true }]);
    const gambling = await add(TEST_SKILLS[2], [{ language: "en", name: "gambling", isCanonical: true }, { language: "fr", name: "paris", isCanonical: true }]);
    resetCatalogueMatcher();
    const manualPython = (await prisma.skill.findFirstOrThrow({ where: { source: "manual", externalId: "python" } })).id;

    const found = await matchInText("skill", "Développement en Python, planning des livraisons, poste basé à Paris.", "fr");
    assert.ok(found.includes(manualPython), "technical names in any language");
    assert.ok(!found.includes(escoPython), "the ESCO Python is the hand-made one");
    assert.ok(!found.includes(planning), "everyday English words don't match French text");
    assert.ok(!found.includes(gambling), "ambiguous words never match free text");
    assert.ok((await matchInText("skill", "Strong planning skills.", "en")).includes(planning), "in an English text they do");
    assert.ok((await matchLabels("skill", ["paris"], "fr")).includes(gambling), "a source's own label still matches");
    assert.deepEqual(await canonicalIds("skill", [escoPython, manualPython]), [manualPython], "resumes count it once too");

    const recruiting = (await prisma.skill.findFirstOrThrow({ where: { source: "manual", externalId: "recruitment" } })).id;
    assert.ok(!(await matchInText("skill", "Notre processus de recrutement est rapide.", "fr")).includes(recruiting), "generic in a description");
    assert.ok((await matchInText("skill", "Chargé de recrutement", "fr", { title: true })).includes(recruiting), "meaningful in a title");
  });
});
