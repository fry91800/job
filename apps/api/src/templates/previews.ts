// `npm run templates:previews`: renders every template with the sample resume (sample.ts):
//   - apps/web/public/templates/<key>.jpg: the first page, 420 px wide, for the template
//     choice in the app;
//   - with `--pdf <folder>`: the whole PDF of each template, to check page breaks.
//   npm run templates:previews -- [--only elegant,minimal] [--pdf /tmp/previews] [--lang en]
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { closeBrowser, renderPdf } from "./pdf";
import { PHOTO_TEMPLATES, renderers, renderResumeHtml } from "./render";
import { SAMPLE_PHOTO, SAMPLE_RESUME } from "./sample";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const only = option("only")?.split(",");
  const pdfDir = option("pdf");
  const language = option("lang") ?? "fr";
  const outDir = join(process.cwd(), "apps/web/public/templates");
  mkdirSync(outDir, { recursive: true });
  if (pdfDir) mkdirSync(pdfDir, { recursive: true });

  const browser = await chromium.launch();
  for (const key of Object.keys(renderers)) {
    if (only && !only.includes(key)) continue;
    const html = renderResumeHtml(key, { content: SAMPLE_RESUME, language, photoDataUrl: PHOTO_TEMPLATES.has(key) ? SAMPLE_PHOTO : null });
    // The first A4 page (794 × 1123 CSS px) drawn at 420 px wide: light enough for phones.
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 420 / 794 });
    await page.emulateMedia({ media: "print" });
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: join(outDir, `${key}.jpg`), type: "jpeg", quality: 85, clip: { x: 0, y: 0, width: 794, height: 1123 } });
    await page.close();
    if (pdfDir) writeFileSync(join(pdfDir, `${key}-${language}.pdf`), await renderPdf(html));
    console.log(`${key}: ok`);
  }
  await browser.close();
  await closeBrowser();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
