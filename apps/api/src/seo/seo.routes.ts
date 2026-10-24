import { Router } from "express";
import { config } from "../config";
import { hubPage, landingPaths, occupationPage, pairPage, placePage, SCOPES, type LandingPage } from "./landing";
import { indexableOffers } from "./indexable";
import { LETTER_START, TOOL_START, toolPage, toolPaths } from "./tools";
import { appTemplate, loadPublicOffer, notFoundPageHtml, offerPageHtml } from "./offer-page";

// Pages for search engines (SEO.md), outside /api: offer pages, sitemaps, robots.txt.
// In production Caddy sends these addresses to the API (deploy/Caddyfile).
export const seoRouter = Router();

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// GET /offers/:id — the app's page with the offer (no built app: development, Vite serves it).
seoRouter.get("/offers/:id", async (req, res, next) => {
  const page = appTemplate();
  if (!page) return next();
  const offer = await loadPublicOffer(String(req.params.id));
  res.set("Cache-Control", "public, max-age=300").type("html");
  if (!offer) return res.status(404).send(notFoundPageHtml(page));
  res.send(await offerPageHtml(page, offer));
});

// Landing pages (SEO.md), for all offers (/emplois), apprenticeships (/alternance) and
// internships (/stage): the hub, a job, a place (town /a/…, département, region), a job in a
// place. Specific addresses first: /emplois/a/lyon-69 is a town, not a job in a town.
const sendLanding = (res: import("express").Response, page: LandingPage) =>
  res.status(page.status).set("Cache-Control", "public, max-age=1800").type("html").send(page.html);

// Tool pages (seo/tools.ts): "adapter son CV à une offre", for an apprenticeship, an internship.
for (const path of toolPaths()) seoRouter.get(path, (_req, res) => sendLanding(res, toolPage(path)!));

for (const scope of SCOPES) {
  const p = scope.prefix;
  seoRouter.get(p, async (_req, res) => sendLanding(res, await hubPage(scope)));
  seoRouter.get(`${p}/a/:place`, async (req, res) => sendLanding(res, await placePage(scope, "city", String(req.params.place))));
  seoRouter.get(`${p}/departement/:place`, async (req, res) => sendLanding(res, await placePage(scope, "county", String(req.params.place))));
  seoRouter.get(`${p}/region/:place`, async (req, res) => sendLanding(res, await placePage(scope, "region", String(req.params.place))));
  seoRouter.get(`${p}/:occupation`, async (req, res) => sendLanding(res, await occupationPage(scope, String(req.params.occupation))));
  seoRouter.get(`${p}/:occupation/departement/:place`, async (req, res) => sendLanding(res, await pairPage(scope, String(req.params.occupation), "county", String(req.params.place))));
  seoRouter.get(`${p}/:occupation/region/:place`, async (req, res) => sendLanding(res, await pairPage(scope, String(req.params.occupation), "region", String(req.params.place))));
  seoRouter.get(`${p}/:occupation/:place`, async (req, res) => sendLanding(res, await pairPage(scope, String(req.params.occupation), "city", String(req.params.place))));
}

// GET /sitemap.xml — the landing pages' sitemaps and one sitemap per block of open public
// offers.
seoRouter.get("/sitemap.xml", async (_req, res) => {
  const count = (await indexableOffers()).length;
  const files = Math.max(1, Math.ceil(count / config.seo.sitemapSize));
  const landingFiles = Math.max(1, Math.ceil((await allLandingPaths()).length / config.seo.sitemapSize));
  const entries = [
    ...Array.from({ length: landingFiles }, (_, index) => `<sitemap><loc>${xml(`${config.webBaseUrl}/sitemaps/${index === 0 ? "landing" : `landing-${index + 1}`}.xml`)}</loc></sitemap>`),
    ...Array.from({ length: files }, (_, index) => `<sitemap><loc>${xml(`${config.webBaseUrl}/sitemaps/offers-${index + 1}.xml`)}</loc></sitemap>`),
  ];
  res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>\n`,
  );
});

// The tool pages, then the landing pages worth indexing.
const allLandingPaths = async () => [...toolPaths(), ...(await landingPaths())];

// GET /sitemaps/landing.xml, /sitemaps/landing-{n}.xml — the landing pages worth indexing.
const sendLandingSitemap = async (res: import("express").Response, n: number) => {
  const paths = (await allLandingPaths()).slice((n - 1) * config.seo.sitemapSize, n * config.seo.sitemapSize);
  if (!paths.length && n > 1) return res.status(404).type("text").send("Not found");
  const urls = paths.map((path) => `<url><loc>${xml(`${config.webBaseUrl}${path}`)}</loc><changefreq>daily</changefreq></url>`);
  res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
  );
};
seoRouter.get("/sitemaps/landing.xml", (_req, res) => sendLandingSitemap(res, 1));
seoRouter.get("/sitemaps/landing-:n.xml", (req, res) => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 2) return res.status(404).type("text").send("Not found");
  return sendLandingSitemap(res, n);
});

// GET /sitemaps/offers-{n}.xml — the open public offers worth indexing, by id, with their last change.
seoRouter.get("/sitemaps/offers-:n.xml", async (req, res) => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1) return res.status(404).type("text").send("Not found");
  // Only the offers worth indexing (seo/indexable.ts): no thin pages, one of each group of copies.
  const offers = (await indexableOffers()).slice((n - 1) * config.seo.sitemapSize, n * config.seo.sitemapSize);
  const home = n === 1 ? [`<url><loc>${xml(`${config.webBaseUrl}/`)}</loc><changefreq>daily</changefreq></url>`] : [];
  const urls = offers.map((offer) => `<url><loc>${xml(`${config.webBaseUrl}/offers/${offer.id}`)}</loc><lastmod>${offer.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`);
  res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...home, ...urls].join("\n")}\n</urlset>\n`,
  );
});

// GET /{key}.txt — proves to IndexNow that the key is ours (seo/indexing.ts). At the root:
// a key file only covers the addresses under its own folder.
seoRouter.get("/:file", (req, res, next) => {
  if (!req.params.file.endsWith(".txt") || req.params.file === "robots.txt") return next();
  const key = config.seo.indexing.indexNowKey;
  if (!key || req.params.file !== `${key}.txt`) return res.status(404).type("text").send("Not found");
  res.set("Cache-Control", "public, max-age=86400").type("text").send(key);
});

// GET /robots.txt — everything may be crawled except the personal workspace pages (empty for
// a crawler); the API stays allowed: search engines run the app, which calls it.
seoRouter.get("/robots.txt", (_req, res) => {
  const personal = ["/resumes", "/photos", "/saved", "/generated", "/letters", "/settings", "/add-offer", TOOL_START, LETTER_START];
  res.set("Cache-Control", "public, max-age=86400").type("text").send(
    `User-agent: *\nAllow: /\n${personal.map((path) => `Disallow: ${path}`).join("\n")}\n\nSitemap: ${config.webBaseUrl}/sitemap.xml\n`,
  );
});
