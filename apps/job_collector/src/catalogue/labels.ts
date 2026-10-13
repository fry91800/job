// Searchable forms of an occupation label (masculine / feminine forms, without the
// parenthesis), so that offer titles match: "Développeur / Développeuse informatique (H/F)"
// → "Développeur informatique", "Développeuse informatique".

function splitGenderForms(label: string): string[] {
  // ROME style: "Masculin / Féminin rest of the label".
  let match = /^(.+?)\s+\/\s+(.+)$/.exec(label);
  // ESCO style: "développeur web/développeuse web", only between forms of the same word
  // (so "Designer UX/UI" stays whole).
  if (!match) {
    const compact = /^(.+?)\/(.+)$/.exec(label);
    const firstLeft = compact?.[1].trim().split(/\s+/)[0].toLowerCase() ?? "";
    const firstRight = compact?.[2].trim().split(/\s+/)[0].toLowerCase() ?? "";
    if (compact && firstLeft.length >= 3 && firstLeft.slice(0, 3) === firstRight.slice(0, 3)) match = compact;
  }
  if (!match) return [label];
  const left = match[1].trim();
  const right = match[2].trim();
  const leftWords = left.split(/\s+/).length;
  const rightWords = right.split(/\s+/);
  const masculine = rightWords.length > leftWords ? `${left} ${rightWords.slice(leftWords).join(" ")}` : left;
  return [masculine, right];
}

export function labelVariants(label: string): string[] {
  const clean = label.replace(/\s+/g, " ").trim();
  const withoutParenthesis = clean.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const variants = new Set<string>([clean]);
  for (const text of [clean, withoutParenthesis]) for (const form of splitGenderForms(text)) variants.add(form);
  return [...variants].filter((variant) => variant.length >= 2);
}
