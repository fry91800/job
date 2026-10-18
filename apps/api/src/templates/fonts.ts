import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Fonts embedded in the resume HTML (data URLs), so a PDF looks the same on every machine:
// the server's own fonts vary (development, Docker image) and templates may not load
// anything from the network (pdf.ts). Variable fonts from the @fontsource-variable packages
// (SIL Open Font License), Latin and Latin Extended only (French, English and other Latin-
// script names).

export type FontKey = "inter" | "source-serif-4" | "manrope";

// The CSS family names templates use.
export const FONT_FAMILY: Record<FontKey, string> = {
  inter: "'Inter'",
  "source-serif-4": "'Source Serif 4'",
  manrope: "'Manrope'",
};

const FILES: Record<FontKey, string[]> = {
  inter: ["wght.css", "wght-italic.css"],
  "source-serif-4": ["wght.css", "wght-italic.css"],
  manrope: ["wght.css"],
};

const SUBSETS = /-(latin|latin-ext)-wght-(normal|italic)\.woff2$/;
const require = createRequire(__filename);
const cache = new Map<FontKey, string>();

function packageDir(key: FontKey): string {
  return dirname(require.resolve(`@fontsource-variable/${key}/package.json`));
}

// The package's @font-face rules for the Latin subsets, with the files inlined.
function fontFaces(key: FontKey): string {
  const cached = cache.get(key);
  if (cached) return cached;
  const dir = packageDir(key);
  const rules: string[] = [];
  for (const file of FILES[key]) {
    const css = readFileSync(join(dir, file), "utf8");
    for (const rule of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
      const url = /url\(\.\/(files\/[^)]+)\)/.exec(rule)?.[1];
      if (!url || !SUBSETS.test(url)) continue;
      const data = readFileSync(join(dir, url)).toString("base64");
      rules.push(
        rule
          .replace(/font-family:\s*'[^']+'/, `font-family: ${FONT_FAMILY[key]}`)
          .replace(/font-display:[^;]+;/, "")
          .replace(/url\([^)]+\)/, `url(data:font/woff2;base64,${data})`),
      );
    }
  }
  const result = rules.join("\n");
  cache.set(key, result);
  return result;
}

export function fontCss(keys: FontKey[]): string {
  return keys.map(fontFaces).join("\n");
}
