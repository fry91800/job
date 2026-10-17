// `npm run jobs:alerts`: sends the job alerts that are due (GROWTH.md phase 2) and exits.
import { runAlerts } from "../alerts/send";
import { prisma } from "../lib/prisma";

runAlerts()
  .then((result) => console.log("job alerts:", JSON.stringify(result)))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
