import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { prisma } from "@job/backend";
import { collectorConfig } from "../config";
import { resetCrawler } from "../crawler/fetcher";
import { inspectSite } from "./inspect";

// `inspect` on a local company site: from the home page to the career pages, then what they
// run on.

let pages: Record<string, string> = {};
let server: http.Server;
let host: string;

before(async () => {
  server = http.createServer((req, res) => {
    const body = pages[new URL(req.url!, "http://localhost").pathname];
    res.writeHead(body === undefined ? 404 : 200, { "Content-Type": "text/html; charset=utf-8" }).end(body ?? "not found");
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(collectorConfig.crawler, { minDelayMs: 0, allowedPrivateAddresses: ["127.0.0.1"] });
});

after(async () => {
  server.close();
  await prisma.$disconnect();
});

const site = (routes: Record<string, string>) => {
  pages = { "/robots.txt": "User-agent: *\nDisallow:\n", ...routes };
  resetCrawler();
};

describe("inspect", () => {
  test("a supported tool linked from the career page (Workday)", async () => {
    site({
      "/": `<a href="/a-propos">À propos</a><a href="/carrieres">Carrières</a>`,
      "/carrieres": `<h1>Rejoignez-nous</h1><a href="https://acme.wd3.myworkdayjobs.com/fr-FR/Careers">Voir nos offres</a>`,
    });
    const result = await inspectSite(`http://${host}/`);
    assert.equal(result.status, "ok");
    assert.deepEqual(result.supported, [{ ats: "workday", slug: "acme.wd3.myworkdayjobs.com/Careers", registry: null }]);
    assert.match(result.verdict, /^supported: workday\/acme\.wd3\.myworkdayjobs\.com\/Careers \(new\)/);
  });

  test("a site with JobPosting on its offer pages", async () => {
    const posting = { "@context": "https://schema.org", "@type": "JobPosting", title: "Technicien H/F", description: "x", datePosted: "2026-10-10" };
    site({
      "/": `<a href="/emploi">Nos offres d'emploi</a>`,
      "/emploi": `<a href="/emploi/offre-12345-technicien">Technicien</a>`,
      "/emploi/offre-12345-technicien": `<script type="application/ld+json">${JSON.stringify(posting)}</script>`,
    });
    const result = await inspectSite(`http://${host}/`);
    assert.equal(result.jobPosting, true);
    assert.match(result.verdict, /^JobPosting on its pages → careersite 127\.0\.0\.1/);
  });

  test("a SuccessFactors career site (its script on the employer's host)", async () => {
    site({ "/": `<script>j2w.init({ "locale": "fr_FR" });</script>` });
    const result = await inspectSite(`http://${host}/`);
    assert.deepEqual(result.supported, [{ ats: "successfactors", slug: host, registry: null }]);
    assert.deepEqual(result.unsupported, []);
  });

  test("Talentsoft and Gestmax sites on the employer's domain, by their assets", async () => {
    site({ "/": `<link href="/DynamicContent/Fonts/talentsoft-font-icons/fonts/talentsoft.woff">` });
    assert.deepEqual((await inspectSite(`http://${host}/`)).supported, [{ ats: "talentsoft", slug: host, registry: null }]);
    site({ "/": `<body class="gestmax-template"><img src="/_generic_bootstrap_rgaa/public/img/print.svg"></body>` });
    assert.deepEqual((await inspectSite(`http://${host}/`)).supported, [{ ats: "gestmax", slug: host, registry: null }]);
  });

  test("a tool we don't support yet, named by its code", async () => {
    site({ "/": `<script src="https://cdn.phenompeople.com/CareerConnectResources/app.js"></script>` });
    const result = await inspectSite(`http://${host}/`);
    assert.deepEqual(result.unsupported, ["phenom"]);
    assert.equal(result.verdict, "unsupported tool: phenom");
  });

  test("a site that refuses the crawler", async () => {
    site({});
    pages["/robots.txt"] = "User-agent: *\nDisallow: /\n";
    const result = await inspectSite(`http://${host}/`);
    assert.equal(result.status, "robots");
    assert.equal(result.verdict, "robots.txt forbids it");
  });
});
