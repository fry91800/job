import { chromium, type Browser } from "playwright-core";

// HTML → PDF with headless Chromium (FEATURE M3). One browser is started on first use
// and shared; each render uses its own page. Install the browser once with
// `npm run api:install-browser`.

let browser: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = chromium.launch().catch((error) => {
      browser = null;
      throw error;
    });
  }
  return browser;
}

export async function renderPdf(html: string): Promise<Buffer> {
  const page = await (await getBrowser()).newPage();
  try {
    // Templates are self-contained: block every network request.
    await page.route("**/*", (route) => route.abort());
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (!browser) return;
  const current = browser;
  browser = null;
  await (await current).close();
}
