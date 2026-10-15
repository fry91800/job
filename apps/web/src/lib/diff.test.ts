import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { diffWords } from "./diff";

const show = (before: string, after: string) => diffWords(before, after).map((part) => (part.type === "same" ? part.text : part.type === "added" ? `[+${part.text}]` : `[-${part.text}]`)).join("");

describe("word diff", () => {
  test("changed words in the middle; unchanged text kept as is", () => {
    assert.equal(show("Développement de fonctionnalités en React.", "Conception de fonctionnalités en React et Node.js."), "[-Développement ][+Conception ]de fonctionnalités en [-React.][+React et Node.js.]");
    assert.equal(show("Même texte.", "Même texte."), "Même texte.");
  });

  test("only additions or only removals", () => {
    assert.equal(show("", "Nouveau"), "[+Nouveau]");
    assert.equal(show("Texte supprimé", ""), "[-Texte supprimé]");
    assert.equal(show("a c", "a b c"), "a [+b ]c");
  });

  test("both sides are rebuilt from the parts", () => {
    const before = "Développeuse web avec 4 ans d'expérience sur des applications React.";
    const after = "Développeuse full stack avec 4 ans d'expérience en React et Node.js.";
    const parts = diffWords(before, after);
    assert.equal(parts.filter((part) => part.type !== "added").map((part) => part.text).join(""), before);
    assert.equal(parts.filter((part) => part.type !== "removed").map((part) => part.text).join(""), after);
  });
});
