import { normalizeCatalogueName } from "@job/shared";
import { prisma } from "../prisma";

// Dictionary matching of skill and occupation names in free text (FEATURE M2), for
// offers. The text is cut into tokens that keep technical names whole ("node.js", "c#",
// "c++", ".net"; hyphens separate words, so "full-stack" = "full stack"), and every group
// of 1 to N consecutive tokens is looked up in an index of all catalogue names: the cost
// depends on the text, not on the size of the catalogue (ROME + ESCO ≈ 200 000 names).
//
// Measured on collected offers (2026-10-16), most wrong skills came from everyday words:
// French words that are also skill names ("paris" = betting, "politique", "vue" = Vue.js),
// and English words matched in French offers through the English fallback ("plan",
// "transport", "design"). Hence, for skills in free text:
// * names in another language than the document's only when they look technical (a
//   capital letter, a digit or a symbol: "Python", "AWS", "Node.js", "C#");
// * AMBIGUOUS_IN_TEXT words never; TITLE_ONLY words only in titles ("Chargé de
//   recrutement" asks for recruiting, "notre processus de recrutement" doesn't).
// Skills given as such by a source (matchLabels) are always looked up.
// The same skill in two catalogues (a hand-made skill and its ESCO concept, or two ESCO
// concepts with the same main name) gets one id: matching and match % count it once.

const TOKEN = /\.?[\p{L}\p{N}](?:[\p{L}\p{N}#+_.'’/]*[\p{L}\p{N}#+])?/gu;

// Too ambiguous to be found in free text ("go" the language vs "go" the verb, "paris" the
// city vs betting). They are still found when a source gives them as a skill label.
const AMBIGUOUS_IN_TEXT = new Set([
  "go", "c", "r", "d", "less", "make", "swift", "rust", "dart", "chef", "spring",
  "paris", "politique", "plan", "vue", "lead", "source", "transport", "transformer", "lecture", "passerelles", "physique", "communiquer",
]);

// Generic in a description, meaningful in a title.
const TITLE_ONLY = new Set(["recrutement", "recruitment", "recruiting", "communication", "informatique"]);

export function tokenize(text: string): string[] {
  return normalizeCatalogueName(text).match(TOKEN) ?? [];
}

// Same tokens, case kept (normalization only lowercases, so both lists align).
function tokenizeKeepingCase(text: string): string[] {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").match(TOKEN) ?? [];
}

// Short all-capital names are acronyms ("AVEC", "PAP", "MDM"): once lowercased they
// collide with ordinary words ("avec"), so in free text they only match when written in
// capitals there too.
const isAcronym = (name: string) => /^[A-Z0-9]{2,5}$/.test(name.trim());
// Tools, languages, products: "Python", "AWS", "Node.js", "C#", "R&D".
const looksTechnical = (name: string) => /[A-Z0-9+#./&]/.test(name);

type Kind = "skill" | "occupation";
type Index = {
  byKey: Map<string, Set<number>>;
  acronymKeys: Set<string>;
  technicalKeys: Set<string>; // keys with at least one technical-looking name
  maxTokens: number;
  canonical: Map<number, number>; // id → the id that stands for the same thing
};
type Indexes = { at: number; skill: Index; occupation: Index };
type NameRow = { id: number; language: string; name: string; normalizedName: string; isCanonical: boolean; manual: boolean };

const REFRESH_MS = 10 * 60 * 1000;
let loaded: Indexes | null = null;
let loading: Promise<Indexes> | null = null;

// Groups of ids that are the same thing: a hand-made skill and any catalogue entry sharing
// one of its names, and entries with the same main name. Alternative names alone never
// join two catalogue entries (they would chain unrelated concepts). The hand-made entry,
// else the oldest, stands for the group.
function sameThingGroups(rows: NameRow[]): Map<number, number> {
  const parent = new Map<number, number>();
  const manual = new Set(rows.filter((row) => row.manual).map((row) => row.id));
  const find = (id: number): number => {
    let root = id;
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: number, b: number) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra === rb) return;
    // The hand-made one, else the smaller id, is the root.
    const keep = manual.has(ra) !== manual.has(rb) ? (manual.has(ra) ? ra : rb) : Math.min(ra, rb);
    parent.set(keep === ra ? rb : ra, keep);
  };
  const byName = new Map<string, NameRow[]>();
  for (const row of rows) {
    const key = `${row.language}|${row.normalizedName}`;
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const hand = group.filter((row) => row.manual);
    const main = group.filter((row) => row.isCanonical && !row.manual);
    for (const row of group) if (hand.length && row.id !== hand[0].id) union(hand[0].id, row.id);
    for (const row of main.slice(1)) union(main[0].id, row.id);
  }
  const result = new Map<number, number>();
  for (const row of rows) result.set(row.id, find(row.id));
  return result;
}

function buildIndex(rows: NameRow[]): Index {
  const canonical = sameThingGroups(rows);
  const byKey = new Map<string, Set<number>>();
  const plainKeys = new Set<string>();
  const acronymOnly = new Set<string>();
  const technicalKeys = new Set<string>();
  let maxTokens = 1;
  for (const row of rows) {
    const tokens = row.normalizedName.match(TOKEN) ?? [];
    if (tokens.length === 0) continue;
    maxTokens = Math.max(maxTokens, tokens.length);
    const key = `${row.language}|${tokens.join(" ")}`;
    let ids = byKey.get(key);
    if (!ids) byKey.set(key, (ids = new Set()));
    ids.add(canonical.get(row.id) ?? row.id);
    if (isAcronym(row.name)) acronymOnly.add(key);
    else plainKeys.add(key);
    if (looksTechnical(row.name)) technicalKeys.add(key);
  }
  // A key stays case-sensitive only if every name behind it is an acronym ("Git" and
  // "GIT" are both fine in any case).
  const acronymKeys = new Set([...acronymOnly].filter((key) => !plainKeys.has(key)));
  return { byKey, acronymKeys, technicalKeys, maxTokens: Math.min(maxTokens, 12), canonical };
}

async function load(): Promise<Indexes> {
  const [skills, occupations] = await Promise.all([
    prisma.skillName.findMany({ select: { skillId: true, language: true, name: true, normalizedName: true, isCanonical: true, skill: { select: { source: true } } } }),
    prisma.occupationName.findMany({ select: { occupationId: true, language: true, name: true, normalizedName: true, isCanonical: true } }),
  ]);
  return {
    at: Date.now(),
    skill: buildIndex(skills.map((row) => ({ id: row.skillId, language: row.language, name: row.name, normalizedName: row.normalizedName, isCanonical: row.isCanonical, manual: row.skill.source === "manual" }))),
    // Occupations: ROME and ESCO are linked by their correspondence table instead.
    occupation: buildIndex(occupations.map((row) => ({ id: row.occupationId, language: row.language, name: row.name, normalizedName: row.normalizedName, isCanonical: false, manual: false }))),
  };
}

async function indexes(): Promise<Indexes> {
  if (loaded && Date.now() - loaded.at < REFRESH_MS) return loaded;
  loading ??= load().finally(() => {
    loading = null;
  });
  const result = await loading;
  loaded = result;
  return result;
}

// After a catalogue import or in tests: the next match reloads the names.
export function resetCatalogueMatcher(): void {
  loaded = null;
}

const languagesFor = (language: string | null | undefined) => (language && language !== "en" ? [language, "en"] : language === "en" ? ["en"] : ["fr", "en"]);

// Ids of the names found in the text, as whole token groups. `title`: the text is an
// offer's title (TITLE_ONLY words count there).
export async function matchInText(kind: Kind, text: string, language?: string | null, options: { title?: boolean } = {}): Promise<number[]> {
  const index = (await indexes())[kind];
  const tokens = tokenize(text);
  const original = tokenizeKeepingCase(text);
  const found = new Set<number>();
  const own = languagesFor(language)[0];
  for (const lang of languagesFor(language)) {
    for (let start = 0; start < tokens.length; start++) {
      for (let length = 1; length <= index.maxTokens && start + length <= tokens.length; length++) {
        const phrase = tokens.slice(start, start + length).join(" ");
        if (length === 1 && (phrase.length < 2 || (kind === "skill" && AMBIGUOUS_IN_TEXT.has(phrase)))) continue;
        if (length === 1 && kind === "skill" && !options.title && TITLE_ONLY.has(phrase)) continue;
        const key = `${lang}|${phrase}`;
        const ids = index.byKey.get(key);
        if (!ids) continue;
        if (index.acronymKeys.has(key) && !isAcronym(original.slice(start, start + length).join(" "))) continue;
        if (kind === "skill" && lang !== own && !index.technicalKeys.has(key)) continue;
        ids.forEach((id) => found.add(id));
      }
    }
  }
  return [...found];
}

// Ids of labels given as such by a source ("React", "Gestion de projet"): exact names.
export async function matchLabels(kind: Kind, labels: string[], language?: string | null): Promise<number[]> {
  const index = (await indexes())[kind];
  const found = new Set<number>();
  for (const label of labels) {
    const key = tokenize(label).join(" ");
    for (const lang of languagesFor(language)) index.byKey.get(`${lang}|${key}`)?.forEach((id) => found.add(id));
  }
  return [...found];
}

// The ids that stand for these ones (the same skill in two catalogues counts once), for
// links found otherwise (resumes).
export async function canonicalIds(kind: Kind, ids: number[]): Promise<number[]> {
  const { canonical } = (await indexes())[kind];
  return [...new Set(ids.map((id) => canonical.get(id) ?? id))];
}
