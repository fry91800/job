import { z } from "zod";
import { backendConfig } from "../config";
import { FakeProvider } from "./fake";
import { GeminiProvider } from "./gemini";
import { AiError, type AiPart, type AiProvider } from "./provider";

let provider: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  if (!provider) {
    switch (backendConfig.ai.provider) {
      case "gemini":
        if (!backendConfig.ai.geminiApiKey) throw AiError.failed("AI is not configured (GEMINI_API_KEY missing)");
        provider = new GeminiProvider(backendConfig.ai.geminiApiKey, backendConfig.ai.model, backendConfig.ai.timeoutMs);
        break;
      case "fake":
        provider = new FakeProvider();
        break;
      default:
        throw new Error(`Unknown AI provider "${backendConfig.ai.provider}"`);
    }
  }
  return provider;
}

// For tests: the fake provider, after switching to it.
export function useFakeAi(): FakeProvider {
  backendConfig.ai.provider = "fake";
  provider = new FakeProvider();
  return provider as FakeProvider;
}

export type AiTask<T extends z.ZodType> = {
  name: string; // for logs
  system: string;
  parts: AiPart[];
  schema: T; // the answer is validated with it
  jsonSchema?: Record<string, unknown>; // defaults to the JSON Schema of `schema`
  // Adjusts the parsed answer before validation (e.g. adds fields the AI is not asked for).
  prepare?: (answer: unknown) => unknown;
  temperature?: number;
  effort?: "low" | "default";
};

// Removes properties from a JSON Schema, at every depth (e.g. the item `id`s the AI must
// not produce).
export function withoutProperties(schema: unknown, names: string[]): unknown {
  if (Array.isArray(schema)) return schema.map((item) => withoutProperties(item, names));
  if (schema === null || typeof schema !== "object") return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && value && typeof value === "object") {
      result.properties = Object.fromEntries(
        Object.entries(value).filter(([name]) => !names.includes(name)).map(([name, sub]) => [name, withoutProperties(sub, names)]),
      );
    } else if (key === "required" && Array.isArray(value)) {
      result.required = value.filter((name) => !names.includes(name));
    } else {
      result[key] = withoutProperties(value, names);
    }
  }
  return result;
}

// Runs an AI task: asks for JSON, validates it, and retries once if the answer is not
// valid JSON or doesn't match the schema (FEATURE M4 "one automatic retry").
// Returns the data and the `provider:model` id to store.
export async function runAiJson<T extends z.ZodType>(task: AiTask<T>): Promise<{ data: z.output<T>; model: string }> {
  const ai = getAiProvider();
  const jsonSchema = task.jsonSchema ?? (z.toJSONSchema(task.schema, { io: "output", unrepresentable: "any" }) as Record<string, unknown>);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await ai.generateJson({ task: task.name, system: task.system, parts: task.parts, jsonSchema, temperature: task.temperature, effort: task.effort });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      console.warn(`ai ${task.name}: answer is not JSON (attempt ${attempt})`);
      continue;
    }
    const result = task.schema.safeParse(task.prepare ? task.prepare(json) : json);
    if (result.success) return { data: result.data, model: `${ai.name}:${ai.model}` };
    // Log the validation problems only, never the content (personal data).
    console.warn(`ai ${task.name}: invalid answer (attempt ${attempt})`, result.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  throw AiError.invalidOutput();
}
