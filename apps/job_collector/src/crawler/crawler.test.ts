import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, prisma } from "@job/backend";
import { atsConnector } from "../ats/connector";
import { collectorConfig } from "../config";
import { runConnector } from "../runs/run-connector";
import { careerSite, careerSiteFromUrl, resetCareerSiteMemory } from "./career-site";
import { findOfferPages, looksLikeOfferPage, offerScore, pageKey, parseSitemap } from "./discover-pages";
import { resetCrawler } from "./fetcher";
import { extractJobPostings, frenchPlace, jobPostingOffer } from "./job-posting";
import { parseRobots } from "./robots";

// A local career site: robots.txt, a sitemap index, offer pages with JobPosting markup.
// Its board is "127.0.0.1:<port>" in the test database.

const LONG = "Vous rejoindrez l'équipe produit et développerez de nouvelles fonctionnalités en TypeScript et PostgreSQL. ".repeat(3);
const posting = (fields: object = {}) => ({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Développeur TypeScript (H/F)",
  description: `<p>${LONG}</p>`,
  datePosted: "2026-10-10",
  validThrough: "2027-01-31T00:00:00Z",
  employmentType: ["FULL_TIME"],
  hiringOrganization: { "@type": "Organization", name: "Test Crawl SAS", sameAs: "https://test-crawl.example" },
  jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Nantes", postalCode: "44000", addressCountry: "FR" } },
  baseSalary: { "@type": "MonetaryAmount", currency: "EUR", value: { "@type": "QuantitativeValue", minValue: 45000, maxValue: 55000, unitText: "YEAR" } },
  ...fields,
});
const page = (...postings: object[]) =>
  `<html><head>${postings.map((item) => `<script type="application/ld+json">${JSON.stringify(item)}</script>`).join("")}</head><body><h1>Offre</h1></body></html>`;

let jobs: Record<string, string> = {};
let lastmod = "2026-10-10";
let requests: string[] = [];
let server: http.Server;
let slug: string;

function route(path: string): [number, string, string] {
  if (path === "/robots.txt") return [200, "text/plain", `User-agent: *\nDisallow: /jobs/private\nSitemap: http://${slug}/sitemap-index.xml\n`];
  if (path === "/sitemap-index.xml") return [200, "application/xml", `<sitemapindex><sitemap><loc>http://${slug}/sitemap-jobs.xml</loc></sitemap></sitemapindex>`];
  if (path === "/sitemap-jobs.xml") {
    const urls = [...Object.keys(jobs), "/jobs/private-1", "/about"].map((key) => `<url><loc>http://${slug}${key}</loc><lastmod>${lastmod}</lastmod></url>`);
    return [200, "application/xml", `<urlset>${urls.join("")}</urlset>`];
  }
  // One company's section of a site shared by many (like join.com/companies/{company}).
  if (path === "/companies/test-co") {
    const links = ["/companies/test-co/123-developpeur-h-f", "/companies/other-co/9-commercial", "/about", "/companies/test-co"];
    return [200, "text/html", `<html><body>${links.map((href) => `<a href="${href}">x</a>`).join("")}</body></html>`];
  }
  if (jobs[path]) return [200, "text/html; charset=utf-8", jobs[path]];
  return [404, "text/html", "not found"];
}

const TEST_SITE = () => ({ ats: "careersite", slug });

before(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url!);
    const [status, type, body] = route(new URL(req.url!, "http://localhost").pathname);
    res.writeHead(status, { "Content-Type": type }).end(body);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  slug = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(collectorConfig.crawler, { scheme: "http", minDelayMs: 0, allowedPrivateAddresses: ["127.0.0.1"] });
  collectorConfig.ats.pauseBetweenBoardsMs = 0;
  collectorConfig.ats.detailRefreshDays = 1_000_000_000; // no weekly refresh during the tests
  backendConfig.geoapify.apiKey = undefined;
});

after(async () => {
  server.close();
  const sources = await prisma.offerSource.findMany({ where: { source: "careersite", externalId: { startsWith: slug } }, select: { offerId: true } });
  await prisma.offer.deleteMany({ where: { id: { in: sources.map((row) => row.offerId) } } });
  await prisma.rawOffer.deleteMany({ where: { source: "careersite", externalId: { startsWith: slug } } });
  await prisma.companySource.deleteMany({ where: TEST_SITE() });
  await prisma.company.deleteMany({ where: { normalizedName: "test crawl" } });
  await prisma.collectorRun.deleteMany({ where: { connector: "test-careersite" } });
  await prisma.$disconnect();
});

describe("robots.txt", () => {
  test("our group, else *; longest rule wins; wildcards; crawl-delay and sitemaps", () => {
    const robots = parseRobots(
      ["User-agent: *", "Disallow: /", "", "User-agent: MonPosteBot", "Disallow: /private", "Allow: /private/jobs", "Disallow: /*.pdf$", "Crawl-delay: 5", "Sitemap: https://x.example/sitemap.xml"].join("\n"),
      "MonPosteBot",
    );
    assert.equal(robots.allows("/jobs/1"), true);
    assert.equal(robots.allows("/private/team"), false);
    assert.equal(robots.allows("/private/jobs/1"), true, "the longer allow wins");
    assert.equal(robots.allows("/files/offer.pdf"), false);
    assert.equal(robots.allows("/files/offer.pdf?x=1"), true, "$ anchors the end");
    assert.equal(robots.crawlDelayMs, 5000);
    assert.deepEqual(robots.sitemaps, ["https://x.example/sitemap.xml"]);

    const others = parseRobots("User-agent: *\nDisallow: /admin\nDisallow:\n", "MonPosteBot");
    assert.equal(others.allows("/admin/x"), false);
    assert.equal(others.allows("/jobs"), true);
  });
});

describe("offer pages", () => {
  test("sitemaps, offer-like addresses, language prefixes", () => {
    const { sitemaps, urls } = parseSitemap(
      `<sitemapindex><sitemap><loc>https://x.example/s1.xml</loc></sitemap></sitemapindex><urlset><url><loc><![CDATA[https://x.example/jobs/1?a=1&amp;b=2]]></loc><lastmod>2026-10-01</lastmod></url></urlset>`,
    );
    assert.deepEqual(sitemaps, ["https://x.example/s1.xml"]);
    assert.deepEqual(urls, [{ loc: "https://x.example/jobs/1?a=1&b=2", lastmod: "2026-10-01" }]);

    for (const path of ["/jobs/123-dev", "/fr/offres/developpeur-h-f", "/global/en/job/R0341671/Architecte", "/carrieres/offre-emploi/42"]) assert.ok(looksLikeOfferPage(new URL(path, "https://x.example")), path);
    for (const path of ["/jobs", "/fr/offres/", "/about/team", "/jobs/brochure.pdf"]) assert.ok(!looksLikeOfferPage(new URL(path, "https://x.example")), path);
    assert.equal(pageKey(new URL("https://x.example/fr/jobs/1")), pageKey(new URL("https://x.example/en/jobs/1")));
  });
});

describe("career sites of recruiting tools", () => {
  test("one host per company, or one company's section of a shared site", () => {
    const site = (url: string) => careerSiteFromUrl(new URL(url));
    assert.equal(site("https://acme.teamtailor.com/jobs/1-dev"), "acme.teamtailor.com");
    assert.equal(site("https://acme.jobs.personio.de/job/2468793"), "acme.jobs.personio.de");
    assert.equal(site("https://acme.welcomekit.co/jobs/dev"), "acme.welcomekit.co");
    assert.equal(site("https://join.com/companies/Acme/16703211-dev"), "join.com/companies/acme");
    assert.equal(site("https://jobs.jobvite.com/acme/job/oGZcAfwb"), "jobs.jobvite.com/acme");
    for (const url of ["https://www.teamtailor.com/fr/", "https://join.com/pricing", "https://jobs.jobvite.com/careers", "https://example.com/jobs/1"]) assert.equal(site(url), null, url);
  });

  test("a section of a shared site: only its own addresses, any deeper one may be an offer", async () => {
    const pages = await findOfferPages(`http://${slug}/companies/test-co`, { section: true });
    assert.deepEqual(pages.map((item) => item.key), ["/companies/test-co/123-developpeur-h-f"]);
  });
});

describe("JobPosting", () => {
  test("found in arrays and @graph; mapped to the contract; France only", () => {
    const html = page([posting(), { "@type": "Organization", name: "x" }], { "@graph": [posting({ title: "Data Engineer", jobLocation: { address: { addressLocality: "London", addressCountry: "GB" } } })] });
    const found = extractJobPostings(html);
    assert.equal(found.length, 2);
    assert.equal(frenchPlace(found[1]), null, "London");

    const place = frenchPlace(found[0]);
    assert.ok(place && place !== "remote");
    const offer = jobPostingOffer(found[0], { url: "https://x.example/jobs/1", key: "/jobs/1", source: "careersite", siteSlug: "x.example", place });
    assert.deepEqual(
      [offer.externalId, offer.location?.city, offer.location?.postcode, offer.salary, offer.company?.name, offer.expiresAt],
      ["x.example:/jobs/1", "Nantes", "44000", { min: 45000, max: 55000, currency: "EUR", period: "year" }, "Test Crawl SAS", "2027-01-31T00:00:00.000Z"],
    );
    assert.equal(offer.contractType, null, "FULL_TIME alone says nothing about the contract");

    const remote = posting({ jobLocation: undefined, jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "France" } });
    assert.equal(frenchPlace(remote), "remote");
    const encoded = jobPostingOffer(posting({ description: "&lt;p&gt;Texte&lt;/p&gt;" }), { url: "https://x.example/jobs/2", key: "/jobs/2", source: "careersite", siteSlug: "x.example", place });
    assert.equal(encoded.description.content, "<p>Texte</p>");
  });
});

describe("career-site runs", () => {
  test("check, collect, skip unchanged pages, close offers gone from the sitemap", async () => {
    resetCrawler();
    resetCareerSiteMemory();
    jobs = {
      "/jobs/1-developpeur": page(posting()),
      "/jobs/2-data-engineer": page(posting({ title: "Data Engineer", hiringOrganization: { "@type": "Organization", name: "TEST CRAWL Lyon" }, jobLocation: { address: { addressLocality: "Lyon", addressCountry: "France" } } })),
      "/jobs/3-london": page(posting({ title: "Sales London", jobLocation: { address: { addressLocality: "London", addressCountry: "GB" } } })),
      "/jobs/4-no-markup": "<html><body>Pas de JobPosting</body></html>",
    };
    await prisma.companySource.create({ data: { ...TEST_SITE(), status: "candidate" } });

    const check = await careerSite.check(slug);
    assert.equal(check.companyName, "Test Crawl SAS");
    assert.equal(check.jobCount, 4);
    await prisma.companySource.update({ where: { ats_slug: TEST_SITE() }, data: { status: "active", company: { create: { name: "Test Crawl", normalizedName: "test crawl" } } } });

    const connector = atsConnector(careerSite, { where: TEST_SITE(), key: "test-careersite" });
    requests = [];
    const first = await runConnector(connector, { log: () => {} });
    assert.equal(first.counts.created, 2, "two French offers; London and the page without markup are skipped");
    assert.ok(!requests.some((path) => path.startsWith("/jobs/private")), "robots.txt obeyed");
    assert.ok(!requests.includes("/about"), "not an offer page");
    const saved = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "careersite", externalId: `${slug}:/jobs/1-developpeur` } }, include: { offer: true } });
    assert.deepEqual([saved.offer.title, saved.offer.salaryMin, saved.offer.source], ["Développeur TypeScript (H/F)", 45000, "careersite"]);
    const branch = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "careersite", externalId: `${slug}:/jobs/2-data-engineer` } }, include: { offer: { include: { company: true } } } });
    assert.equal(branch.offer.company?.name, "Test Crawl", "a branch of the board's company is shown as the company");

    // Same sitemap dates: no offer page is fetched again.
    requests = [];
    const second = await runConnector(connector, { log: () => {} });
    assert.equal(second.counts.received, 0);
    assert.ok(!requests.some((path) => path.startsWith("/jobs/")), requests.join(", "));

    // Offer 2 leaves the sitemap: closed. Offer 1 changes date: fetched again.
    delete jobs["/jobs/2-data-engineer"];
    lastmod = "2026-10-12";
    const third = await runConnector(connector, { log: () => {} });
    assert.equal(third.counts.received, 1);
    const closed = await prisma.offerSource.findUniqueOrThrow({ where: { source_externalId: { source: "careersite", externalId: `${slug}:/jobs/2-data-engineer` } } });
    assert.ok(closed.closedAt);
  });

  test("robots.txt rules can be ignored by configuration (sitemaps still read from it)", async () => {
    jobs["/jobs/private-1"] = page(posting({ title: "Offre privée" }));
    collectorConfig.crawler.respectRobotsTxt = false;
    try {
      requests = [];
      const run = await runConnector(atsConnector(careerSite, { where: TEST_SITE(), key: "test-careersite" }), { log: () => {} });
      assert.ok(requests.includes("/jobs/private-1"), requests.join(", "));
      assert.equal(run.counts.created, 1);
    } finally {
      collectorConfig.crawler.respectRobotsTxt = true;
      delete jobs["/jobs/private-1"];
    }
  });
});

describe("offer pages first", () => {
  test("single offers before listings and advice pages, French ones first", () => {
    const score = (url: string) => offerScore(new URL(url));
    const offer = score("https://careers.loreal.com/en/job/paris/stage-supply-chain/3456/46095759424");
    assert.ok(offer > score("https://careers.loreal.com/en/category/retail-jobs/3456/32362496/1"), "a category listing");
    assert.ok(offer > score("https://careers.societegenerale.com/en/tips-candidates/before-job-interview/cover-letter"), "an advice page");
    assert.ok(score("https://careers.societegenerale.com/offres-d-emploi/analyste-trading-2600032A-fr") > score("https://careers.societegenerale.com/en/job-offers/algo-developer-260002H8-en"), "the French offer first");
  });
});
