// Lookup form of a skill or occupation name (DATABASE.md: trim, lowercase, collapse
// spaces, NFKC). Used by the seed, the API (M2) and later the collector.
export function normalizeCatalogueName(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}
