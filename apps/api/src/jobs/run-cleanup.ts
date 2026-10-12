// `npm run jobs:cleanup`: runs the cleanup once (e.g. from cron) and exits.
import { prisma } from "../lib/prisma";
import { runCleanup } from "./cleanup";

runCleanup()
  .then((result) => console.log("cleanup:", JSON.stringify(result)))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
