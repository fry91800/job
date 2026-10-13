// Collector commands: `npm run collector -- <command>`.
//   catalogue [--esco <folder>] [--refresh]   import ROME, the ROME ↔ ESCO links, ESCO, manual skills
//   run <connector>                           run one connector now
//   maintenance                               close expired offers
//   metrics                                   coverage and quality numbers
//   token <source> <name>                     create a token for POST /api/collector/ingest
//   contract                                  the ingestion contract as JSON Schema
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@job/backend";
import { collectedOfferJsonSchema } from "@job/shared";
import { importCatalogue } from "./catalogue/import";
import { connectors, findConnector } from "./connectors/registry";
import { collectorMetrics } from "./metrics";
import { runMaintenance } from "./pipeline/close";
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
    case "maintenance":
      console.log(await runMaintenance());
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
      console.log("Commands: catalogue [--esco <folder>] [--refresh] | run <connector> | maintenance | metrics | token <source> <name> | contract");
      process.exitCode = command ? 1 : 0;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
