import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { prisma } from "../test/helpers";
import { closeBrowser, renderPdf } from "./pdf";
import { PHOTO_TEMPLATES, renderers, renderResumeHtml } from "./render";
import { SAMPLE_PHOTO, SAMPLE_RESUME } from "./sample";

// Every resume template: renders the sample, escapes what users type, embeds its fonts,
// matches its database row, has its preview picture.

after(async () => {
  await closeBrowser();
});

const hostile = {
  ...SAMPLE_RESUME,
  basics: { ...SAMPLE_RESUME.basics, fullName: `Camille <script>alert(1)</script> "Laurent"`, links: [{ id: "l1", label: "piège", url: "javascript:alert(1)" }] },
};

describe("resume templates", () => {
  for (const key of Object.keys(renderers)) {
    test(`${key}: every section, escaped values, embedded fonts, no unsafe links`, () => {
      const html = renderResumeHtml(key, { content: hostile, language: "fr", photoDataUrl: PHOTO_TEMPLATES.has(key) ? SAMPLE_PHOTO : null });
      assert.doesNotMatch(html, /<script>alert/);
      assert.match(html, /Camille &lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;Laurent&quot;/);
      assert.doesNotMatch(html, /href="javascript:/i);
      for (const text of ["Maison Varenne", "IAE Lyon", "Professional Scrum Master I", "Espagnol", "Randonnée", "Guide des bonnes pratiques"]) assert.ok(html.includes(text), `${key} shows ${text}`);
      assert.match(html, /@font-face[\s\S]*url\(data:font\/woff2;base64,/, "fonts are embedded");
      assert.equal(html.includes(SAMPLE_PHOTO), PHOTO_TEMPLATES.has(key), "the photo only where supported");
    });
  }

  test("an English resume gets English headings", () => {
    for (const key of Object.keys(renderers)) assert.match(renderResumeHtml(key, { content: SAMPLE_RESUME, language: "en", photoDataUrl: null }), /Work experience/i, key);
  });

  test("every template row has its renderer, photo support and preview picture", async () => {
    const rows = await prisma.template.findMany({ where: { deletedAt: null } });
    assert.equal(rows.length, Object.keys(renderers).length);
    for (const row of rows) {
      assert.ok(renderers[row.rendererKey], `renderer for ${row.rendererKey}`);
      assert.equal(row.supportsPhoto, PHOTO_TEMPLATES.has(row.rendererKey), `photo support of ${row.rendererKey}`);
      assert.equal(row.previewStorageKey, `templates/${row.rendererKey}.jpg`);
      assert.ok(existsSync(join(process.cwd(), "apps/web/public", row.previewStorageKey)), `preview of ${row.rendererKey} (npm run templates:previews)`);
    }
  });

  test("the sidebar template's PDF has two pages for the long sample", async () => {
    const pdf = await renderPdf(renderResumeHtml("contemporary", { content: SAMPLE_RESUME, language: "fr", photoDataUrl: SAMPLE_PHOTO }));
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.equal(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)?.length, 2);
  });
});
