import { createApp } from "./app";
import { config } from "./config";
import { scheduleCleanup } from "./jobs/cleanup";
import { prisma } from "./lib/prisma";
import { stopQueue } from "./lib/queue";
import { closeBrowser } from "./templates/pdf";

const server = createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
const stopCleanup = scheduleCleanup();

// Stop cleanly: finish requests, then close Chromium and the database pool.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopCleanup?.();
    server.close(async () => {
      await closeBrowser();
      await stopQueue();
      await prisma.$disconnect();
      process.exit(0);
    });
  });
}
