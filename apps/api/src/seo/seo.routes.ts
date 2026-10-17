import { Router } from "express";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { cityPage, hubPage, landingPaths, occupationPage, pairPage, type LandingPage } from "./landing";
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
  res.send(offerPageHtml(page, offer));
});

// Landing pages by job and town (SEO.md): /emplois, /emplois/a/{ville}, /emplois/{métier},
// /emplois/{métier}/{ville}.
const sendLanding = (res: import("express").Response, page: LandingPage) =>
  res.status(page.status).set("Cache-Control", "public, max-age=1800").type("html").send(page.html);
seoRouter.get("/emplois", async (_req, res) => sendLanding(res, await hubPage()));
seoRouter.get("/emplois/a/:city", async (req, res) => sendLanding(res, await cityPage(String(req.params.city))));
seoRouter.get("/emplois/:occupation", async (req, res) => sendLanding(res, await occupationPage(String(req.params.occupation))));
seoRouter.get("/emplois/:occupation/:city", async (req, res) => sendLanding(res, await pairPage(String(req.params.occupation), String(req.params.city))));

const openPublicOffers = { isPublic: true, closedAt: null } as const;

// GET /sitemap.xml — the home page and one sitemap per block of open public offers.
seoRouter.get("/sitemap.xml", async (_req, res) => {
  const count = await prisma.offer.count({ where: openPublicOffers });
  const files = Math.max(1, Math.ceil(count / config.seo.sitemapSize));
  const entries = [
    `<sitemap><loc>${xml(`${config.webBaseUrl}/sitemaps/landing.xml`)}</loc></sitemap>`,
    ...Array.from({ length: files }, (_, index) => `<sitemap><loc>${xml(`${config.webBaseUrl}/sitemaps/offers-${index + 1}.xml`)}</loc></sitemap>`),
  ];
  res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>\n`,
  );
});

// GET /sitemaps/landing.xml — the landing pages worth indexing.
seoRouter.get("/sitemaps/landing.xml", async (_req, res) => {
  const urls = (await landingPaths()).map((path) => `<url><loc>${xml(`${config.webBaseUrl}${path}`)}</loc><changefreq>daily</changefreq></url>`);
  res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
  );
});

// GET /sitemaps/offers-{n}.xml — open public offers, by id, with their last change.
seoRouter.get("/sitemaps/offers-:n.xml", async (req, res) => {
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 1) return res.status(404).type("text").send("Not found");
  const offers = await prisma.offer.findMany({
    where: openPublicOffers,
    select: { id: true, updatedAt: true },
    orderBy: { id: "asc" },
    skip: (n - 1) * config.seo.sitemapSize,
    take: config.seo.sitemapSize,
  });
  const home = n === 1 ? [`<url><loc>${xml(`${config.webBaseUrl}/`)}</loc><changefreq>daily</changefreq></url>`] : [];
  const urls = offers.map((offer) => `<url><loc>${xml(`${config.webBaseUrl}/offers/${offer.id}`)}</loc><lastmod>${offer.updatedAt.toISOString().slice(0, 10)}</lastmod></url>`);
  res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...home, ...urls].join("\n")}\n</urlset>\n`,
  );
});

// GET /robots.txt — everything may be crawled except the personal workspace pages (empty for
// a crawler); the API stays allowed: search engines run the app, which calls it.
seoRouter.get("/robots.txt", (_req, res) => {
  const personal = ["/resumes", "/photos", "/saved", "/generated", "/settings", "/add-offer"];
  res.set("Cache-Control", "public, max-age=86400").type("text").send(
    `User-agent: *\nAllow: /\n${personal.map((path) => `Disallow: ${path}`).join("\n")}\n\nSitemap: ${config.webBaseUrl}/sitemap.xml\n`,
  );
});
