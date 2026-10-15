import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { parseMarkdown } from "./markdown-parse";

describe("offer description Markdown", () => {
  test("headings, paragraphs with line breaks, bullet and numbered lists", () => {
    assert.deepEqual(parseMarkdown("## Le poste\n\nPremière ligne\nsuite\n\n- un\n- deux\n\n1. a\n2) b"), [
      { type: "heading", text: "Le poste" },
      { type: "paragraph", lines: ["Première ligne", "suite"] },
      { type: "list", ordered: false, items: ["un", "deux"] },
      { type: "list", ordered: true, items: ["a", "b"] },
    ]);
  });

  test("a dash alone on its line takes the next line as its item (older descriptions)", () => {
    assert.deepEqual(parseMarkdown("Solutions :\n\n-\nSecurity Rating : notation\n\n-\nAD Rating"), [
      { type: "paragraph", lines: ["Solutions :"] },
      { type: "list", ordered: false, items: ["Security Rating : notation", "AD Rating"] },
    ]);
  });

  test("HTML stays text", () => {
    assert.deepEqual(parseMarkdown("<script>alert(1)</script>"), [{ type: "paragraph", lines: ["<script>alert(1)</script>"] }]);
  });
});
