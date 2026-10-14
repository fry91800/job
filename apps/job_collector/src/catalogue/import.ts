import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prisma, resetCatalogueMatcher } from "@job/backend";
import { normalizeCatalogueName } from "@job/shared";
import { unzipSync } from "fflate";
import { skills as manualSkills } from "../../../../prisma/seed/catalogue";
import { csvRecords, parseCsv } from "./csv";
import { labelVariants } from "./labels";

// Catalogue import (COLLECTOR.md §8.1): ROME occupations (France Travail open data),
// the official ROME ↔ ESCO correspondence, ESCO occupations and skills (CSV files from
// the ESCO portal), and the hand-written technical skills. Re-runnable: rows are matched
// by their official code (source + external_id) and their names are rewritten.

export const CATALOGUE_SOURCES = {
  // ROME 4.0, all data (zip of JSON files), Licence Ouverte 2.0.
  rome: "https://api.francetravail.fr/api-nomenclatureemploi/v1/open-data/json",
  // ESCO ↔ ROME mapping published by France Travail on the ESCO portal (EURES).
  romeEsco: "https://esco.ec.europa.eu/system/files/2024-10/EURESmapping_occs_FR_v1.1.csv",
};

type Name = { language: string; name: string };
type Entry = { externalId: string; names: Name[]; parentExternalId?: string | null };
type Log = (message: string) => void;

const BATCH = 5000;

async function cached(cacheDir: string, file: string, url: string, refresh: boolean, log: Log): Promise<Buffer> {
  const path = join(cacheDir, file);
  if (!refresh && existsSync(path)) return readFile(path);
  log(`downloading ${url}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path, data);
  return data;
}

// ROME files are Windows-1252; a few values are UTF-8 read as Windows-1252 ("Ã©").
function decodeRome(bytes: Uint8Array): string {
  return new TextDecoder("windows-1252").decode(bytes);
}
function repairMojibake(text: string): string {
  if (!/[ÃÂ]/.test(text)) return text;
  const repaired = Buffer.from(text, "latin1").toString("utf8");
  return repaired.includes("�") ? text : repaired;
}

// Upserts catalogue rows by (source, external_id) and rewrites their names.
async function writeEntries(kind: "occupation" | "skill", source: string, entries: Entry[], options: { replaceNames: boolean }) {
  const model = kind === "occupation" ? prisma.occupation : prisma.skill;
  const existing = new Map(
    (await (model as typeof prisma.occupation).findMany({ where: { source }, select: { id: true, externalId: true } })).map((row) => [row.externalId!, row.id]),
  );
  const missing = entries.filter((entry) => !existing.has(entry.externalId));
  for (let i = 0; i < missing.length; i += BATCH) {
    await (model as typeof prisma.occupation).createMany({ data: missing.slice(i, i + BATCH).map((entry) => ({ source, externalId: entry.externalId })) });
  }
  const ids = new Map(
    (await (model as typeof prisma.occupation).findMany({ where: { source }, select: { id: true, externalId: true } })).map((row) => [row.externalId!, row.id]),
  );

  // Names: one canonical per language (the first), synonyms after; normalized for lookup.
  const targets = options.replaceNames ? entries : missing;
  const rows: { ownerId: number; language: string; name: string; normalizedName: string; isCanonical: boolean }[] = [];
  for (const entry of targets) {
    const ownerId = ids.get(entry.externalId)!;
    const seen = new Set<string>();
    const canonicalDone = new Set<string>();
    for (const { language, name } of entry.names) {
      const normalizedName = normalizeCatalogueName(name);
      if (!normalizedName || seen.has(`${language}|${normalizedName}`)) continue;
      seen.add(`${language}|${normalizedName}`);
      rows.push({ ownerId, language, name: name.slice(0, 500), normalizedName, isCanonical: !canonicalDone.has(language) });
      canonicalDone.add(language);
    }
  }
  const ownerIds = targets.map((entry) => ids.get(entry.externalId)!);
  if (kind === "occupation") {
    await prisma.occupationName.deleteMany({ where: { occupationId: { in: ownerIds } } });
    for (let i = 0; i < rows.length; i += BATCH) {
      await prisma.occupationName.createMany({ data: rows.slice(i, i + BATCH).map(({ ownerId, ...row }) => ({ ...row, occupationId: ownerId })) });
    }
  } else {
    await prisma.skillName.deleteMany({ where: { skillId: { in: ownerIds } } });
    for (let i = 0; i < rows.length; i += BATCH) {
      await prisma.skillName.createMany({ data: rows.slice(i, i + BATCH).map(({ ownerId, ...row }) => ({ ...row, skillId: ownerId })) });
    }
  }
  return { ids, created: missing.length, names: rows.length };
}

// ── ROME ─────────────────────────────────────────────────────────────────────

type RomeData = { entries: Entry[]; appellationToCode: Map<string, string> };

export function parseRome(zip: Uint8Array): RomeData {
  const files = unzipSync(zip);
  const find = (prefix: string) => {
    const name = Object.keys(files).find((file) => file.split("/").pop()!.startsWith(prefix));
    if (!name) throw new Error(`ROME archive: missing ${prefix}*`);
    return JSON.parse(decodeRome(files[name])) as Record<string, unknown>[];
  };
  const codes = find("unix_referentiel_code_rome_") as { code_rome: string; libelle: string; code_rome_parent: string | null }[];
  const appellations = find("unix_referentiel_appellation_") as { code_ogr: number; libelle: string; code_rome_parent: string }[];

  const byCode = new Map<string, Entry>();
  for (const code of codes) {
    byCode.set(code.code_rome, {
      externalId: code.code_rome,
      parentExternalId: code.code_rome_parent && code.code_rome_parent !== code.code_rome ? code.code_rome_parent : null,
      names: labelVariants(repairMojibake(code.libelle)).map((name) => ({ language: "fr", name })),
    });
  }
  const appellationToCode = new Map<string, string>();
  for (const appellation of appellations) {
    appellationToCode.set(String(appellation.code_ogr), appellation.code_rome_parent);
    const entry = byCode.get(appellation.code_rome_parent);
    if (entry) for (const name of labelVariants(repairMojibake(appellation.libelle))) entry.names.push({ language: "fr", name });
  }
  return { entries: [...byCode.values()], appellationToCode };
}

async function importRome(rome: RomeData, log: Log) {
  const { ids, created, names } = await writeEntries("occupation", "rome", rome.entries, { replaceNames: true });
  // Hierarchy (M1811 → M1802).
  for (const entry of rome.entries) {
    const parentId = entry.parentExternalId ? ids.get(entry.parentExternalId) ?? null : null;
    await prisma.occupation.update({ where: { id: ids.get(entry.externalId)! }, data: { parentId } });
  }
  log(`ROME: ${rome.entries.length} occupations (${created} new), ${names} names`);
  return ids;
}

// ── ROME ↔ ESCO ──────────────────────────────────────────────────────────────

export function parseRomeEscoMapping(csv: string) {
  const rows = parseCsv(csv);
  const start = rows.findIndex((row) => row[0] === "classification 1 ID");
  if (start === -1) throw new Error("ROME–ESCO mapping: header row not found");
  return rows
    .slice(start + 1)
    .filter((row) => row.length >= 5 && row[0].startsWith("http"))
    .map((row) => ({ escoUri: row[0], escoLabel: row[1], appellation: row[2].trim(), relation: row[4].trim() }));
}

async function importRomeEsco(mapping: ReturnType<typeof parseRomeEscoMapping>, rome: RomeData, romeIds: Map<string, number>, log: Log) {
  // ESCO occupations missing from the table are created from the mapping's French label.
  const escoEntries = new Map<string, Entry>();
  for (const row of mapping) {
    if (!escoEntries.has(row.escoUri)) {
      escoEntries.set(row.escoUri, { externalId: row.escoUri, names: labelVariants(row.escoLabel).map((name) => ({ language: "fr", name })) });
    }
  }
  const { ids: escoIds } = await writeEntries("occupation", "esco", [...escoEntries.values()], { replaceNames: false });

  // One link per (ROME occupation, ESCO occupation): equivalent if any appellation is an
  // exact match, related otherwise.
  const pairs = new Map<string, { romeId: number; escoId: number; exact: boolean }>();
  let unknown = 0;
  for (const row of mapping) {
    const code = rome.appellationToCode.get(row.appellation);
    const romeId = code ? romeIds.get(code) : undefined;
    if (!romeId) {
      unknown++;
      continue;
    }
    const escoId = escoIds.get(row.escoUri)!;
    const key = `${romeId}|${escoId}`;
    const pair = pairs.get(key) ?? { romeId, escoId, exact: false };
    pair.exact ||= row.relation === "skos:exactMatch";
    pairs.set(key, pair);
  }

  const romeOccupationIds = [...romeIds.values()];
  await prisma.occupationRelationship.deleteMany({ where: { occupationId: { in: romeOccupationIds }, relatedOccupationId: { in: [...escoIds.values()] } } });
  const data = [...pairs.values()].map((pair) => ({
    occupationId: pair.romeId,
    relatedOccupationId: pair.escoId,
    relationshipType: pair.exact ? ("equivalent" as const) : ("related" as const),
  }));
  for (let i = 0; i < data.length; i += BATCH) await prisma.occupationRelationship.createMany({ data: data.slice(i, i + BATCH), skipDuplicates: true });
  log(`ROME ↔ ESCO: ${data.length} links (${data.filter((row) => row.relationshipType === "equivalent").length} equivalent), ${unknown} mapping rows with an appellation unknown to this ROME version`);
}

// ── ESCO (CSV package downloaded from the ESCO portal) ───────────────────────

async function importEsco(dir: string, log: Log) {
  const files = await readdir(dir);
  const pick = (kind: "occupations" | "skills") =>
    files
      .map((file) => ({ file, language: new RegExp(`^${kind}_([a-z]{2})\\.csv$`).exec(file)?.[1] }))
      .filter((item): item is { file: string; language: string } => item.language !== undefined);

  const read = async (kind: "occupations" | "skills") => {
    const entries = new Map<string, Entry>();
    for (const { file, language } of pick(kind)) {
      for (const record of csvRecords(await readFile(join(dir, file), "utf8"))) {
        const uri = record.conceptUri;
        if (!uri || !record.preferredLabel) continue;
        const entry = entries.get(uri) ?? { externalId: uri, names: [] };
        const labels = [record.preferredLabel, ...(record.altLabels ?? "").split(/\r?\n/)].map((label) => label.trim()).filter(Boolean);
        for (const label of labels) {
          for (const name of kind === "occupations" ? labelVariants(label) : [label]) entry.names.push({ language, name });
        }
        entries.set(uri, entry);
      }
    }
    return [...entries.values()];
  };

  const occupations = await read("occupations");
  const skills = await read("skills");
  if (occupations.length === 0 && skills.length === 0) throw new Error(`No occupations_xx.csv or skills_xx.csv in ${dir}`);
  const occupationResult = await writeEntries("occupation", "esco", occupations, { replaceNames: true });
  const skillResult = await writeEntries("skill", "esco", skills, { replaceNames: true });
  log(`ESCO: ${occupations.length} occupations (${occupationResult.names} names), ${skills.length} skills (${skillResult.names} names)`);
}

// ── Hand-written technical skills (React, Node.js… missing from ESCO) ─────────
// Only the skills ESCO doesn't have: a manual skill is skipped when one of its names is
// already an ESCO name in the same language (no duplicate skills).

async function importManualSkills(log: Log) {
  const escoNames = new Set(
    (await prisma.skillName.findMany({ where: { skill: { source: "esco" } }, select: { language: true, normalizedName: true } })).map(
      (row) => `${row.language}|${row.normalizedName}`,
    ),
  );
  const entries: Entry[] = [];
  const covered: string[] = [];
  for (const skill of manualSkills) {
    const names = [...skill.fr.map((name) => ({ language: "fr", name })), ...skill.en.map((name) => ({ language: "en", name }))];
    if (names.some(({ language, name }) => escoNames.has(`${language}|${normalizeCatalogueName(name)}`))) covered.push(skill.key);
    else entries.push({ externalId: skill.key, names });
  }
  const { names } = await writeEntries("skill", "manual", entries, { replaceNames: true });
  log(`manual skills: ${entries.length} added or updated (${names} names), ${covered.length} already in ESCO`);
}

export async function importCatalogue(options: { cacheDir?: string; escoDir?: string; refresh?: boolean; log?: Log } = {}) {
  const log = options.log ?? ((message: string) => console.log(`[catalogue] ${message}`));
  const cacheDir = resolve(options.cacheDir ?? "data/catalogue");

  const rome = parseRome(await cached(cacheDir, "rome-open-data.zip", CATALOGUE_SOURCES.rome, options.refresh ?? false, log));
  const romeIds = await importRome(rome, log);
  const mapping = parseRomeEscoMapping((await cached(cacheDir, "esco-rome-fr.csv", CATALOGUE_SOURCES.romeEsco, options.refresh ?? false, log)).toString("utf8"));
  if (options.escoDir) await importEsco(resolve(options.escoDir), log);
  else log("ESCO: skipped (no --esco folder); ESCO occupations come from the ROME correspondence only, without skills");
  await importRomeEsco(mapping, rome, romeIds, log);
  await importManualSkills(log);
  resetCatalogueMatcher();
}
