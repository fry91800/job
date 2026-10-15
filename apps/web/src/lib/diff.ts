// Word-level diff of two texts (FEATURE M4: removed words in red, added in green). Longest
// common subsequence over words, spaces kept with the word before them.

export type DiffPart = { type: "same" | "added" | "removed"; text: string };

const words = (text: string) => text.match(/\S+\s*|\s+/g) ?? [];

export function diffWords(before: string, after: string): DiffPart[] {
  const a = words(before);
  const b = words(after);
  // Common prefix and suffix first: most rewrites change a few words in the middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  // lcs[i][j]: common length of midA[i..] and midB[j..] (compared without trailing spaces).
  const key = (word: string) => word.trimEnd();
  const lcs = Array.from({ length: midA.length + 1 }, () => new Uint16Array(midB.length + 1));
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lcs[i][j] = key(midA[i]) === key(midB[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts.at(-1);
    if (last?.type === type) last.text += text;
    else parts.push({ type, text });
  };
  if (start) push("same", a.slice(0, start).join(""));
  let i = 0;
  let j = 0;
  while (i < midA.length || j < midB.length) {
    if (i < midA.length && j < midB.length && key(midA[i]) === key(midB[j])) {
      push("same", midB[j]);
      i++;
      j++;
    } else if (i < midA.length && (j === midB.length || lcs[i + 1][j] >= lcs[i][j + 1])) push("removed", midA[i++]);
    else push("added", midB[j++]);
  }
  if (endA < a.length) push("same", a.slice(endA).join(""));
  return parts;
}
