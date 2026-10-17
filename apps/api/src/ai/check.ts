// `npm run ai:check`: one tiny request to each model the tasks use (D157), to check the key,
// the model names and the latency. Costs one tiny request per model.
import "dotenv/config";
import { z } from "zod";
import { config } from "../config";
import { runAiJson, withAiModel } from "./run";

async function main() {
  const models = [...new Set([config.ai.model, ...Object.values(config.ai.taskModels)])];
  console.log(`provider ${config.ai.provider}; models by task:`, config.ai.taskModels);
  for (const model of models) {
    const started = Date.now();
    const { data } = await withAiModel(model, [], () =>
      runAiJson({
        name: "check",
        system: "Extract the skills listed in the text.",
        parts: [{ text: "Skills: React, TypeScript, Node.js" }],
        schema: z.object({ skills: z.array(z.string()) }),
        effort: "low",
      }),
    );
    console.log(`ok (${model}) in ${Date.now() - started} ms:`, data.skills.join(", "));
  }
}

main().catch((error) => {
  console.error("AI check failed:", error.status ?? "", error.code ?? "", error.message);
  process.exitCode = 1;
});
