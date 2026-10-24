import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { config } from "../config";
import { prisma, startTestServer } from "../test/helpers";
import { commonSkills, placePhrase, resetLandingIndex, SCOPES, slugify, summary } from "./landing";
import { resetIndexableOffers } from "./indexable";
import { resetAppTemplate } from "./offer-page";

// Offer pages, sitemaps and robots.txt for search engines (SEO.md), on a built-app page
// written for the test.

const PAGE = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <title>MonPoste · Trouvez une offre, adaptez votre CV</title>
    <meta name="description" content="Des milliers d'offres d'emploi." />
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

let server: Awaited<ReturnType<typeof startTestServer>>;
const ids: string[] = [];
let open: string, closed: string, privateOffer: string, landingA: string;
let companyId: string;
let occupation: { id: number; name: string };
let city: { id: number; name: string; countyCode: string | null; countyName: string | null; regionName: string | null };
const landing = config.seo.landing;

const get = (path: string) => fetch(new URL(path, server.baseUrl)).then(async (response) => ({ status: response.status, type: response.headers.get("content-type") ?? "", body: await response.text() }));
// The page's JobPosting (other blocks, like the breadcrumbs, are skipped).
const jsonLd = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]) as Record<string, unknown>).find((data) => data["@type"] === "JobPosting") ?? null;

before(async () => {
  const dist = mkdtempSync(join(tmpdir(), "seo-"));
  writeFileSync(join(dist, "index.html"), PAGE);
  config.seo.webDistDir = dist;
  resetAppTemplate();
  server = await startTestServer();

  const company = await prisma.company.create({ data: { name: "SEO Test SAS", normalizedName: "seo test sas test", website: "https://seo-test.example" } });
  companyId = company.id;
  const location = await prisma.location.findFirstOrThrow({ where: { type: "city", countryCode: "FR" } });
  const base = { source: "test-seo", language: "fr", companyId, companyName: "SEO Test SAS", locationId: location.id, contractType: "permanent" as const };
  const create = async (fields: Record<string, unknown>) => {
    const offer = await prisma.offer.create({ data: { ...base, ...fields } as never });
    ids.push(offer.id);
    return offer.id;
  };
  open = await create({
    title: "Développeur <Java> H/F",
    description: `## Missions\n\nDévelopper des **API** sécurisées.\n\n- Spring\n- PostgreSQL\n\n${"Vous travaillerez avec les équipes produit et sécurité sur des services utilisés chaque jour. ".repeat(6)}`,
    salaryMin: 45000, salaryMax: 55000, salaryCurrency: "EUR", salaryPeriod: "year",
    publishedAt: new Date("2026-10-10T00:00:00Z"),
    sources: { create: { source: "test-seo", externalId: "seo-1", url: "https://jobs.seo-test.example/1", expiresAt: new Date("2026-12-31T00:00:00Z") } },
  });
  closed = await create({ title: "Comptable H/F", description: "Tenue de la comptabilité.", closedAt: new Date() });

  // A job of the ROME catalogue with two open offers in one town, for the landing pages.
  const rome = await prisma.occupation.create({
    data: { source: "rome", externalId: "TSEO1", names: { create: { language: "fr", name: "Testeur / Testeuse SEO", normalizedName: "testeur testeuse seo", isCanonical: true } } },
  });
  occupation = { id: rome.id, name: "Testeur / Testeuse SEO" };
  city = await prisma.location.findUniqueOrThrow({ where: { id: location.id }, select: { id: true, name: true, countyCode: true, countyName: true, regionName: true } });
  for (const title of ["Poste landing A", "Poste landing B"]) {
    const id = await create({ title, description: "Une offre pour les pages par métier.", publishedAt: new Date(), occupations: { create: { occupationId: occupation.id } } });
    if (title.endsWith("A")) landingA = id;
  }
  for (const title of ["Alternant landing C", "Alternant landing D"]) {
    await create({ title, description: "Une offre en alternance.", contractType: "apprenticeship", publishedAt: new Date(), occupations: { create: { occupationId: occupation.id } } });
  }
  config.seo.landing = { ...landing, minOccupation: 2, minPair: 2, minCity: 2 };
  resetLandingIndex();
  privateOffer = await create({ title: "Offre privée", description: "Ajoutée par un utilisateur.", isPublic: false });
});

after(async () => {
  await prisma.offer.deleteMany({ where: { id: { in: ids } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.occupation.deleteMany({ where: { source: "rome", externalId: "TSEO1" } });
  config.seo.webDistDir = undefined;
  config.seo.landing = landing;
  resetAppTemplate();
  resetLandingIndex();
  await server.close();
});

describe("offer pages for search engines", () => {
  test("an open offer: its content in the page, meta tags, canonical, JobPosting", async () => {
    const { status, type, body } = await get(`/offers/${open}`);
    assert.equal(status, 200);
    assert.match(type, /text\/html/);
    assert.match(body, /<title>Développeur &lt;Java&gt; H\/F – SEO Test SAS – .+ \| MonPoste<\/title>/);
    assert.match(body, new RegExp(`<link rel="canonical" href="${config.webBaseUrl}/offers/${open}" />`));
    assert.match(body, /<div id="root"><article class="seo-offer">[\s\S]*<h1>Développeur &lt;Java&gt; H\/F<\/h1>/, "the offer, escaped, inside the app's root");
    assert.match(body, /<h2>Missions<\/h2>[\s\S]*<strong>API<\/strong>[\s\S]*<li>Spring<\/li>/);
    assert.match(body, /CDI · .*45\s000 – 55\s000 € par an/, "French number format (narrow spaces)");
    assert.match(body, /<meta name="description" content="CDI, [^"(]+ \(\d+\)\. Missions Développer des API/);
    assert.match(body, /href="https:\/\/jobs\.seo-test\.example\/1" rel="nofollow noopener">Voir l'offre d'origine et postuler/);
    assert.match(body, /src="\/assets\/index-abc\.js"/, "the app still starts on top");
    assert.doesNotMatch(body, /noindex/);

    const posting = jsonLd(body)!;
    assert.equal(posting["@type"], "JobPosting");
    assert.equal(posting.title, "Développeur <Java> H/F");
    assert.deepEqual(posting.hiringOrganization, { "@type": "Organization", name: "SEO Test SAS", sameAs: "https://seo-test.example" });
    assert.equal(posting.validThrough, "2026-12-31T00:00:00.000Z");
    assert.equal(posting.datePosted, "2026-10-10T00:00:00.000Z");
    assert.deepEqual((posting.baseSalary as { value: unknown }).value, { "@type": "QuantitativeValue", minValue: 45000, maxValue: 55000, unitText: "YEAR" });
    assert.match(String(posting.description), /<h3>Missions<\/h3>/);
    assert.ok(!/<\/script/i.test(body.split('application/ld+json">')[1].split("</script>")[0]), "no early end of the data block");
  });

  test("copies of one offer point to the newest; thin offers aren't indexed; neither in the sitemaps", async () => {
    const long = "Vous animerez le réseau de partenaires et développerez le portefeuille clients de l'agence. ".repeat(7);
    const older = await prisma.offer.create({ data: { source: "test-seo", language: "fr", title: "Consultant immobilier H/F", description: long, companyId, companyName: "SEO Test SAS", locationId: city.id, publishedAt: new Date("2026-10-01T00:00:00Z") } });
    const newer = await prisma.offer.create({ data: { source: "test-seo", language: "fr", title: "Consultant  immobilier h/f", description: long, companyId, companyName: "SEO Test SAS", locationId: city.id, publishedAt: new Date("2026-10-15T00:00:00Z") } });
    const thin = await prisma.offer.create({ data: { source: "test-seo", language: "fr", title: "Voir l'annonce", description: "Postulez sur notre site.", companyId, companyName: "SEO Test SAS", locationId: city.id } });
    ids.push(older.id, newer.id, thin.id);
    resetIndexableOffers();
    const copy = await get(`/offers/${older.id}`);
    assert.match(copy.body, new RegExp(`<link rel="canonical" href="${config.webBaseUrl}/offers/${newer.id}" />`), "the copy points to the newest");
    assert.doesNotMatch(copy.body, /noindex/);
    assert.equal(jsonLd(copy.body), null, "no JobPosting on a copy");
    assert.ok(jsonLd((await get(`/offers/${newer.id}`)).body), "the representative keeps it");
    const short = await get(`/offers/${thin.id}`);
    assert.match(short.body, /<meta name="robots" content="noindex" \/>/);
    assert.equal(jsonLd(short.body), null);
    const sitemap = (await get("/sitemaps/offers-1.xml")).body;
    assert.match(sitemap, new RegExp(newer.id));
    assert.doesNotMatch(sitemap, new RegExp(`${older.id}|${thin.id}`));
  });

  test("an offer page leads to its landing pages, with breadcrumbs and similar offers; so does the app", async () => {
    const { body } = await get(`/offers/${landingA}`);
    const job = slugify(occupation.name);
    assert.match(body, new RegExp(`href="/emplois/${job}/${slugify(`${city.name}-${city.countyCode}`)}"`), "the job in its town");
    assert.match(body, new RegExp(`href="/emplois/${job}"`), "the job in France");
    assert.match(body, /<nav class="landing-crumbs"/);
    assert.match(body, /"@type":"BreadcrumbList"/);
    assert.match(body, /<h2>Offres similaires<\/h2>[\s\S]*Poste landing B/);
    const detail = (await (await fetch(new URL(`/api/offers/${landingA}`, server.baseUrl))).json()) as { landingLinks: { href: string; label: string }[] };
    assert.ok(detail.landingLinks.some((link) => link.href === `/emplois/${job}`), JSON.stringify(detail.landingLinks));
  });

  test("a closed offer: shown as no longer available, not indexed, no JobPosting", async () => {
    const { status, body } = await get(`/offers/${closed}`);
    assert.equal(status, 200);
    assert.match(body, /Cette offre n'est plus disponible/);
    assert.match(body, /<meta name="robots" content="noindex" \/>/);
    assert.equal(jsonLd(body), null);
  });

  test("private and unknown offers: 404 with the app's page, not indexed", async () => {
    for (const id of [privateOffer, "00000000-0000-0000-0000-000000000000", "not-an-id"]) {
      const { status, body } = await get(`/offers/${id}`);
      assert.equal(status, 404, id);
      assert.match(body, /noindex/);
      assert.doesNotMatch(body, /Offre privée/);
    }
  });
});

describe("sitemaps and robots.txt", () => {
  test("the index points to offer sitemaps listing open public offers only", async () => {
    const index = await get("/sitemap.xml");
    assert.match(index.type, /xml/);
    assert.match(index.body, new RegExp(`<loc>${config.webBaseUrl}/sitemaps/offers-1.xml</loc>`));
    const first = await get("/sitemaps/offers-1.xml");
    assert.match(first.body, new RegExp(`/offers/${open}</loc>`));
    assert.doesNotMatch(first.body, new RegExp(closed));
    assert.doesNotMatch(first.body, new RegExp(privateOffer));
    assert.equal((await get("/sitemaps/offers-0.xml")).status, 404);
  });

  test("the IndexNow key file: our key only", async () => {
    const saved = config.seo.indexing.indexNowKey;
    config.seo.indexing.indexNowKey = "abcdef0123456789abcdef0123456789";
    try {
      const file = await get("/abcdef0123456789abcdef0123456789.txt");
      assert.deepEqual([file.status, file.body], [200, "abcdef0123456789abcdef0123456789"]);
      assert.equal((await get("/other.txt")).status, 404);
      assert.match((await get("/robots.txt")).body, /Sitemap:/, "robots.txt still answered");
    } finally {
      config.seo.indexing.indexNowKey = saved;
    }
  });

  test("robots.txt names the sitemap and keeps the personal pages out", async () => {
    const { body } = await get("/robots.txt");
    assert.match(body, new RegExp(`Sitemap: ${config.webBaseUrl}/sitemap.xml`));
    assert.match(body, /Disallow: \/resumes/);
    assert.doesNotMatch(body, /Disallow: \/api/);
  });
});

describe("tool pages", () => {
  test("adapting a resume: own text, the app's guided path, in the sitemap; the path itself not crawled", async () => {
    for (const path of ["/adapter-son-cv", "/adapter-son-cv/alternance", "/adapter-son-cv/stage"]) {
      const page = await get(path);
      assert.equal(page.status, 200, path);
      assert.match(page.body, /<a class="landing-cta" href="\/adapter-mon-cv">/, path);
      assert.match(page.body, new RegExp(`<link rel="canonical" href="${config.webBaseUrl}${path}" />`));
      assert.match(page.body, /"@type":"WebApplication"/);
      assert.match(page.body, new RegExp(`générer ${config.limits.aiGenerations.guestTotal} CV adaptés`), "the real limits");
    }
    assert.match((await get("/adapter-son-cv/alternance")).body, /<h1>CV pour une alternance/);
    assert.match((await get("/sitemaps/landing.xml")).body, /\/adapter-son-cv\/stage<\/loc>/);
    assert.match((await get("/robots.txt")).body, /Disallow: \/adapter-mon-cv/);
  });
});

describe("landing pages by job and town", () => {
  const citySlug = () => slugify(`${city.name}-${city.countyCode}`);

  test("a job, a job in a town, a town: their offers and links between them", async () => {
    const job = await get(`/emplois/${slugify(occupation.name)}`);
    assert.equal(job.status, 200);
    assert.match(job.body, /<h1>Offres d(&#39;|')emploi Testeur \/ Testeuse SEO<\/h1>/);
    assert.match(job.body, /Poste landing A/);
    assert.match(job.body, new RegExp(`href="/emplois/${slugify(occupation.name)}/${citySlug()}"`), "links to the job in its towns");
    assert.match(job.body, new RegExp(`<link rel="canonical" href="${config.webBaseUrl}/emplois/${slugify(occupation.name)}" />`));
    assert.doesNotMatch(job.body, /assets\/index-abc\.js/, "no app on top of these pages");

    const pair = await get(`/emplois/${slugify(occupation.name)}/${citySlug()}`);
    assert.equal(pair.status, 200);
    assert.match(pair.body, new RegExp(`à ${city.name}</h1>`));
    assert.match(pair.body, /4 offres en cours/, "every contract, apprenticeships included");
    assert.match(pair.body, /href="\/offers\/[0-9a-f-]{36}">Poste landing B<\/a>/);
    assert.match(pair.body, /href="\/\?q=[^"]*locationId=/, "a link to the app's search");

    const town = await get(`/emplois/a/${citySlug()}`);
    assert.equal(town.status, 200);
    assert.match(town.body, /Poste landing A/);
    assert.doesNotMatch(town.body, /Comptable H\/F/, "closed offers are not listed");
  });

  test("départements and regions, alone and with the job", async () => {
    assert.ok(city.countyCode && city.countyName && city.regionName, "the test town has its département and region");
    const county = await get(`/emplois/departement/${slugify(`${city.countyName}-${city.countyCode}`)}`);
    assert.equal(county.status, 200);
    assert.match(county.body, /Poste landing A/);
    assert.match(county.body, new RegExp(`href="/emplois/${slugify(occupation.name)}/departement/`), "links to the job in the département");
    const region = await get(`/emplois/${slugify(occupation.name)}/region/${slugify(city.regionName!)}`);
    assert.equal(region.status, 200);
    assert.match(region.body, /Poste landing B/);
    assert.match(region.body, new RegExp(`<link rel="canonical" href="${config.webBaseUrl}/emplois/${slugify(occupation.name)}/region/${slugify(city.regionName!)}" />`));
    assert.equal(placePhrase({ kind: "region", name: "Grand Est", label: "Grand Est" }), "dans le Grand Est");
    assert.equal(placePhrase({ kind: "region", name: "Bretagne", label: "Bretagne" }), "en Bretagne");
    assert.equal(placePhrase({ kind: "county", name: "Rhône", label: "Rhône (69)" }), "– Rhône (69)");
  });

  test("apprenticeships: their own pages, only their offers; linked from the general pages", async () => {
    const job = await get(`/alternance/${slugify(occupation.name)}/${citySlug()}`);
    assert.equal(job.status, 200);
    assert.match(job.body, new RegExp(`<h1>Alternance Testeur / Testeuse SEO à ${city.name}</h1>`));
    assert.match(job.body, /Alternant landing C/);
    assert.doesNotMatch(job.body, /Poste landing A/, "other contracts aren't listed");
    assert.match(job.body, /contractType=apprenticeship/, "the app's search keeps the contract");
    const general = await get(`/emplois/${slugify(occupation.name)}/${citySlug()}`);
    assert.match(general.body, new RegExp(`href="/alternance/${slugify(occupation.name)}/${citySlug()}"`));
    assert.equal((await get(`/stage/${slugify(occupation.name)}`)).status, 404, "no internships: no page");
    const sitemap = await get("/sitemaps/landing.xml");
    assert.match(sitemap.body, new RegExp(`/alternance/${slugify(occupation.name)}/${citySlug()}</loc>`));
    assert.match(sitemap.body, new RegExp(`/emplois/region/${slugify(city.regionName!)}</loc>`));
  });

  test("the summary: only what the data supports, salaries per year or per month", () => {
    const [emplois, alternance] = SCOPES;
    const stats = {
      total: 40, recent: 6, remote: 8,
      contracts: [["permanent", 24], ["fixed_term", 10], ["internship", 6]] as [string, number][],
      salary: { count: 12, low: 32000, median: 36000, high: 41000 },
      employers: [{ name: "Acme", count: 9 }, { name: "Globex", count: 4 }, { name: "Seule", count: 1 }],
      skills: ["SQL", "Python", "Anglais"],
    };
    // French numbers use narrow no-break spaces: plain spaces here.
    const plain = (html: string) => html.replace(/[\u202f\u00a0]/g, " ");
    const text = plain(summary(emplois, stats, "à Lyon"));
    assert.match(text, /40 offres en cours à Lyon, dont 6 publiées ces 7 derniers jours\./);
    assert.match(text, /60 % en CDI, 25 % en CDD, 15 % en stage/);
    assert.match(text, /20 % des offres permettent le télétravail/);
    assert.match(text, /entre 32 000 € et 41 000 € brut par an .* 36 000 € en valeur médiane \(sur 12 offres\)/);
    assert.match(text, /Acme \(9\), Globex \(4\)\./, "employers with a single offer aren't listed");
    assert.match(plain(summary(alternance, { ...stats, salary: { count: 6, low: 9600, median: 10800, high: 12000 } }, "à Lyon")), /entre 800 € et 1 000 € brut par mois/);
    assert.doesNotMatch(summary(emplois, { ...stats, salary: null, remote: 0 }, "à Lyon"), /Salaire|télétravail/);
    assert.equal(summary(emplois, { ...stats, total: 0 }, "à Lyon"), "");
  });

  test("skills: common enough, one of each family, no matching noise", () => {
    const rows = [{ name: "Travail en équipe", count: 30 }, { name: "travailler en équipe", count: 25 }, { name: "histoire", count: 20 }, { name: "SQL", count: 12 }, { name: "Rare", count: 2 }];
    assert.deepEqual(commonSkills(rows, 100), ["Travail en équipe", "SQL"]);
  });

  test("breadcrumbs: on the page and as structured data", async () => {
    const pair = await get(`/emplois/${slugify(occupation.name)}/${citySlug()}`);
    assert.match(pair.body, /<nav class="landing-crumbs"/);
    assert.match(pair.body, /<h2>En bref<\/h2>/);
    const crumbs = [...pair.body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1])).find((data) => data["@type"] === "BreadcrumbList");
    assert.ok(crumbs, "a BreadcrumbList");
    assert.equal(crumbs.itemListElement[0].item, `${config.webBaseUrl}/emplois`);
    assert.equal(crumbs.itemListElement.at(-1).item, `${config.webBaseUrl}/emplois/${slugify(occupation.name)}/${citySlug()}`);
  });

  test("too few offers or unknown: 404, not indexed", async () => {
    config.seo.landing = { ...config.seo.landing, minPair: 5 };
    resetLandingIndex();
    try {
      const pair = await get(`/emplois/${slugify(occupation.name)}/${citySlug()}`);
      assert.equal(pair.status, 404);
      assert.match(pair.body, /noindex/);
    } finally {
      config.seo.landing = { ...config.seo.landing, minPair: 2 };
      resetLandingIndex();
    }
    assert.equal((await get("/emplois/metier-inconnu")).status, 404);
  });

  test("the hub and the landing sitemap list the pages", async () => {
    const hub = await get("/emplois");
    assert.match(hub.body, new RegExp(`href="/emplois/${slugify(occupation.name)}"`));
    const sitemap = await get("/sitemaps/landing.xml");
    assert.match(sitemap.body, new RegExp(`/emplois/${slugify(occupation.name)}/${citySlug()}</loc>`));
    assert.match((await get("/sitemap.xml")).body, /sitemaps\/landing\.xml/);
  });
});
