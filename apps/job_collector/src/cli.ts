// Collector commands: `npm run collector -- <command>`.
//   catalogue [--esco <folder>] [--refresh]   import ROME, the ROME ↔ ESCO links, ESCO, manual skills
//   run <connector>                           run one connector now
//   maintenance                               close expired offers
//   reenrich                                  recompute stored offers' skills, occupations and quality; resumes' merged skills
//   metrics                                   coverage and quality numbers
//   discover [--ats greenhouse,ashby] [--crawls N | --crawl CC-MAIN-…,…]   find boards in Common Crawl
//   census [--crawls N]                       companies per recruiting tool in Common Crawl, with French pages
//   inspect <address…> [--file F] [--json F]  what a career site runs on (supported tool, JobPosting, other tool)
//   boards check [--ats X] [--limit N]        check candidate / due boards
//   boards add <ats> <slug> [--name N]        add a board by hand (checked right away); careersite <address>
//   boards list [--status S]                  boards by tool and status
//   boards export [file]                      save the board registry (default data/boards-<date>.json.gz)
//   boards import <file>                      merge a saved registry (newer checks win)
//   token <source> <name>                     create a token for POST /api/collector/ingest
//   contract                                  the ingestion contract as JSON Schema
import { createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { prisma } from "@job/backend";
import { collectedOfferJsonSchema } from "@job/shared";
import { atsAdapters, findAdapter } from "./ats/registry";
import { importCatalogue } from "./catalogue/import";
import { connectors, findConnector } from "./connectors/registry";
import { checkBoard, checkBoards } from "./discovery/check-boards";
import { atsCensus } from "./discovery/ats-census";
import { inspectSites, readSiteList } from "./discovery/inspect";
import { discoverBoards, recentCrawls } from "./discovery/common-crawl";
import { exportBoards, importBoards } from "./discovery/registry-file";
import { collectorMetrics } from "./metrics";
import { checkBotSources } from "./bots/health";
import { runMaintenance } from "./pipeline/close";
import { reenrich } from "./pipeline/reenrich";
import { normalizeCompanyName } from "./pipeline/text";
import { runConnector } from "./runs/run-connector";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "catalogue":
      await importCatalogue({ escoDir: option(args, "--esco"), refresh: args.includes("--refresh") });
      break;
    case "run": {
      const connector = findConnector(args[0] ?? "");
      if (!connector) throw new Error(`Unknown connector "${args[0]}". Known: ${connectors.map((item) => item.key).join(", ")}`);
      await runConnector(connector);
      break;
    }
    case "census": {
      const crawls = option(args, "--crawls");
      await atsCensus({ crawls: crawls ? Number(crawls) : undefined });
      break;
    }
    case "discover": {
      const names = option(args, "--ats")?.split(",") ?? atsAdapters.filter((adapter) => adapter.discovery).map((adapter) => adapter.ats);
      const crawl = option(args, "--crawl");
      const crawlCount = option(args, "--crawls");
      for (const name of names) {
        const adapter = findAdapter(name);
        if (!adapter) throw new Error(`Unknown ATS "${name}". Known: ${atsAdapters.map((item) => item.ats).join(", ")}`);
        await discoverBoards(adapter, { crawls: crawl ? crawl.split(",") : crawlCount ? await recentCrawls(Number(crawlCount)) : undefined });
      }
      break;
    }
    case "inspect": {
      // inspect <address…> [--file list.txt] [--json out.json]
      const file = option(args, "--file");
      const json = option(args, "--json");
      const addresses = args.filter((arg, index) => !arg.startsWith("--") && !["--file", "--json"].includes(args[index - 1] ?? ""));
      const sites = [...(file ? await readSiteList(file) : []), ...addresses.map((address) => ({ name: address, address }))];
      if (!sites.length) throw new Error("Usage: inspect <address…> [--file list.txt] [--json out.json]");
      await inspectSites(sites, { json });
      break;
    }
    case "boards": {
      const [action, ...rest] = args;
      if (action === "check") {
        const limit = option(rest, "--limit");
        await checkBoards({ ats: option(rest, "--ats"), limit: limit ? Number(limit) : undefined });
      } else if (action === "add") {
        const [ats, given] = rest;
        // Career sites: an address is accepted ("https://careers.x.com/" → careers.x.com).
        const slug = ats === "careersite" && given ? given.replace(/^https?:\/\//, "").replace(/\/+$/, "") : given;
        if (!ats || !slug || !findAdapter(ats)) throw new Error(`Usage: boards add <${atsAdapters.map((item) => item.ats).join("|")}> <slug>`);
        const board = await prisma.companySource.upsert({
          where: { ats_slug: { ats, slug } },
          create: { ats, slug, status: "candidate", discoveredFrom: "manual" },
          update: {},
        });
        const result = await checkBoard(board);
        // --name "Savencia": the company's name, when the site doesn't give it (Oracle).
        const name = option(rest, "--name");
        const checked = await prisma.companySource.findUniqueOrThrow({ where: { id: board.id } });
        if (name && checked.companyId) await prisma.company.update({ where: { id: checked.companyId }, data: { name, normalizedName: normalizeCompanyName(name) } });
        console.log(`${ats}/${slug}:`, result);
      } else if (action === "list") {
        const status = option(rest, "--status");
        const rows = await prisma.companySource.groupBy({ by: ["ats", "status"], _count: true, where: status ? { status } : {}, orderBy: [{ ats: "asc" }, { status: "asc" }] });
        for (const row of rows) console.log(`${row.ats.padEnd(16)} ${row.status.padEnd(10)} ${row._count}`);
      } else if (action === "export") {
        const file = rest[0] ?? `data/boards-${new Date().toISOString().slice(0, 10)}.json.gz`;
        await mkdir(dirname(file), { recursive: true });
        console.log(`${await exportBoards(file)} board(s) saved to ${file}`);
      } else if (action === "import") {
        if (!rest[0]) throw new Error("Usage: boards import <file>");
        console.log(await importBoards(rest[0]));
      } else {
        throw new Error("Usage: boards check|add|list|export|import");
      }
      break;
    }
    case "reenrich":
      await reenrich();
      break;
    case "maintenance":
      console.log({ ...(await checkBotSources()), ...(await runMaintenance()) });
      break;
    case "metrics":
      console.dir(await collectorMetrics(), { depth: 4 });
      break;
    case "token": {
      const [source, ...name] = args;
      if (!source || !/^[a-z0-9][a-z0-9-]{1,49}$/.test(source) || name.length === 0) throw new Error("Usage: token <source-key> <name>");
      const token = randomBytes(32).toString("base64url");
      await prisma.collectorToken.create({ data: { source, name: name.join(" "), tokenHash: createHash("sha256").update(token).digest("hex") } });
      console.log(`Token for source "${source}" (shown once, keep it secret):\n${token}`);
      break;
    }
    case "contract":
      console.log(JSON.stringify(collectedOfferJsonSchema(), null, 2));
      break;
    default:
      console.log("Commands: catalogue [--esco <folder>] [--refresh] | discover [--ats …] [--crawls N] | census [--crawls N] | boards check|add|list|export|import | run <connector> | maintenance | reenrich | metrics | token <source> <name> | contract");
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
