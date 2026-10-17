import { logEvent } from "@job/backend";
import { createApp } from "./app";
import { config, isProduction } from "./config";
import { productionProblems } from "./lib/production-check";
import { scheduleAlerts } from "./alerts/send";
import { scheduleCleanup } from "./jobs/cleanup";
import { prisma } from "./lib/prisma";
import { stopQueue } from "./lib/queue";
import { closeBrowser } from "./templates/pdf";

// A production server with missing or development settings doesn't start (DEPLOYMENT.md).
if (isProduction) {
  const problems = productionProblems(process.env);
  if (problems.length) {
    for (const problem of problems) logEvent("error", "config_problem", { problem });
    process.exit(1);
  }
}

const server = createApp().listen(config.port, () => {
  logEvent("info", "api_started", { port: config.port, production: isProduction });
});
const stopCleanup = scheduleCleanup();
const stopAlerts = scheduleAlerts();

// Stop cleanly: finish requests, then close Chromium and the database pool.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopCleanup?.();
    stopAlerts?.();
    server.close(async () => {
      await closeBrowser();
      await stopQueue();
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}
