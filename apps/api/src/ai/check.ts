// `npm run ai:check`: one tiny request to the configured AI provider and model, to check
// the key, the model name and the latency. Costs one request of your quota.
import "dotenv/config";
import { z } from "zod";
import { config } from "../config";
import { runAiJson } from "./run";

async function main() {
  console.log(`provider ${config.ai.provider}, model ${config.ai.model}`);
  for (const effort of ["low"] as const) {
    const started = Date.now();
    const { data, model } = await runAiJson({
      name: "check",
      system: "Extract the skills listed in the text.",
      parts: [{ text: "Skills: React, TypeScript, Node.js" }],
      schema: z.object({ skills: z.array(z.string()) }),
      effort,
    });
    console.log(`ok (${model}, effort ${effort}) in ${Date.now() - started} ms:`, data.skills.join(", "));
  }
}

main().catch((error) => {
  console.error("AI check failed:", error.status ?? "", error.code ?? "", error.message);
  process.exitCode = 1;
});
