import { normalizeCatalogueName } from "@job/shared";
import { prisma } from "../prisma";

// Dictionary matching of skill and occupation names in free text (FEATURE M2), for
// offers. The text is cut into tokens that keep technical names whole ("node.js", "c#",
// "c++", ".net", "front-end"), and every group of 1 to N consecutive tokens is looked up
// in an index of all catalogue names: the cost depends on the text, not on the size of
// the catalogue (ESCO + ROME = hundreds of thousands of names).

const TOKEN = /\.?[\p{L}\p{N}](?:[\p{L}\p{N}#+_.'’/-]*[\p{L}\p{N}#+])?/gu;

// Too ambiguous to be found in free text ("go" the language vs "go" the verb). They are
// still found when a source gives them as a skill label (matchLabels).
const AMBIGUOUS_IN_TEXT = new Set(["go", "c", "r", "d", "less", "make", "swift", "rust", "dart", "chef", "spring"]);

export function tokenize(text: string): string[] {
  return normalizeCatalogueName(text).match(TOKEN) ?? [];
}

type Index = { byKey: Map<string, Set<number>>; maxTokens: number };
type Kind = "skill" | "occupation";

type Indexes = { at: number; skill: Index; occupation: Index };

const REFRESH_MS = 10 * 60 * 1000;
let loaded: Indexes | null = null;
let loading: Promise<Indexes> | null = null;

function buildIndex(rows: { id: number; language: string; normalizedName: string }[]): Index {
  const byKey = new Map<string, Set<number>>();
  let maxTokens = 1;
  for (const row of rows) {
    const tokens = row.normalizedName.match(TOKEN) ?? [];
    if (tokens.length === 0) continue;
    maxTokens = Math.max(maxTokens, tokens.length);
    const key = `${row.language}|${tokens.join(" ")}`;
    let ids = byKey.get(key);
    if (!ids) byKey.set(key, (ids = new Set()));
    ids.add(row.id);
  }
  return { byKey, maxTokens: Math.min(maxTokens, 12) };
}

async function load(): Promise<Indexes> {
  const [skills, occupations] = await Promise.all([
    prisma.skillName.findMany({ select: { skillId: true, language: true, normalizedName: true } }),
    prisma.occupationName.findMany({ select: { occupationId: true, language: true, normalizedName: true } }),
  ]);
  return {
    at: Date.now(),
    skill: buildIndex(skills.map((row) => ({ id: row.skillId, language: row.language, normalizedName: row.normalizedName }))),
    occupation: buildIndex(occupations.map((row) => ({ id: row.occupationId, language: row.language, normalizedName: row.normalizedName }))),
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

// Ids of the names found in the text, as whole token groups.
export async function matchInText(kind: Kind, text: string, language?: string | null): Promise<number[]> {
  const index = (await indexes())[kind];
  const tokens = tokenize(text);
  const found = new Set<number>();
  for (const lang of languagesFor(language)) {
    for (let start = 0; start < tokens.length; start++) {
      for (let length = 1; length <= index.maxTokens && start + length <= tokens.length; length++) {
        const phrase = tokens.slice(start, start + length).join(" ");
        if (length === 1 && (phrase.length < 2 || AMBIGUOUS_IN_TEXT.has(phrase))) continue;
        index.byKey.get(`${lang}|${phrase}`)?.forEach((id) => found.add(id));
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
