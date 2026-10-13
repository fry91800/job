// Small text helpers of the pipeline (pure functions).

export const stripAccents = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "");

const LEGAL_FORMS = /\b(sas|sasu|sa|sarl|eurl|sci|snc|scop|sca|gie|selarl|gmbh|ltd|limited|inc|llc|plc|bv|nv|spa|srl|ag)\b/g;

// "Cloudine SAS", "CLOUDINE", "Cloudine S.A.S." → "cloudine"
export function normalizeCompanyName(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, "$1") // S.A.S. → SAS
    .replace(/\./g, "")
    .replace(LEGAL_FORMS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// "Développeur Full-Stack (H/F)" → "developpeur full stack"
export function normalizeTitle(title: string): string {
  return stripAccents(title)
    .toLowerCase()
    .replace(/\(?\b(h|f)\s*\/\s*(h|f)(\s*\/\s*x)?\b\)?/g, " ")
    .replace(/[^a-z0-9#+]+/g, " ")
    .trim();
}

// Company + title + département: the same job published by several sources.
export function offerFingerprint(companyKey: string | null, title: string, countyCode: string | null): string | null {
  if (!companyKey) return null;
  return `${companyKey}|${normalizeTitle(title)}|${countyCode ?? ""}`;
}

// Similarity of two descriptions: Jaccard index of their 3-word shingles (0..1).
export function textSimilarity(a: string, b: string): number {
  const shingles = (text: string) => {
    const words = stripAccents(text).toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 600) ?? [];
    const set = new Set<string>();
    for (let i = 0; i + 2 < words.length; i++) set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    return set;
  };
  const left = shingles(a);
  const right = shingles(b);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const item of left) if (right.has(item)) common++;
  return common / (left.size + right.size - common);
}

// Personal data in descriptions (GDPR, COLLECTOR.md §4): email addresses and phone
// numbers are removed. Recruiter names can't be found reliably without AI: later.
export function removePersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[…]")
    .replace(/(?<![\w])(\+33\s?|0033\s?|0)[1-9](?:[\s.-]?\d{2}){4}(?![\w])/g, "[…]")
    .replace(/(?<![\w])\+\d{1,3}(?:[\s.-]?\d){8,12}(?![\w])/g, "[…]");
}

const FRENCH = new Set(["le", "la", "les", "des", "du", "et", "vous", "nous", "pour", "avec", "une", "dans", "sur", "est", "au", "aux", "en", "votre", "nos"]);
const ENGLISH = new Set(["the", "and", "you", "we", "for", "with", "our", "your", "to", "of", "in", "is", "are", "will", "on", "as"]);

// "fr", "en" or null (too short / unclear).
export function detectLanguage(text: string): "fr" | "en" | null {
  let fr = 0;
  let en = 0;
  for (const word of text.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ']+/g)?.slice(0, 400) ?? []) {
    if (FRENCH.has(word)) fr++;
    if (ENGLISH.has(word)) en++;
  }
  if (fr + en < 5) return null;
  return fr >= en ? "fr" : "en";
}

// Quality score (COLLECTOR.md §6): completeness of the useful fields, 0–100.
export function qualityScore(offer: {
  hasSalary: boolean;
  hasLocation: boolean;
  hasContract: boolean;
  hasRemote: boolean;
  hasCompany: boolean;
  skillCount: number;
  descriptionLength: number;
  hasPublishedAt: boolean;
}): number {
  return (
    (offer.hasSalary ? 20 : 0) +
    (offer.hasLocation ? 20 : 0) +
    (offer.hasContract ? 15 : 0) +
    (offer.hasRemote ? 5 : 0) +
    (offer.hasCompany ? 10 : 0) +
    (offer.skillCount >= 3 ? 15 : offer.skillCount * 5) +
    (offer.descriptionLength >= 500 ? 10 : 0) +
    (offer.hasPublishedAt ? 5 : 0)
  );
}
