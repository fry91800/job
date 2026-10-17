import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { backendConfig } from "../config";
import { checkAiBudget, recordAiUsage } from "./budget";
import { FakeProvider } from "./fake";
import { GeminiProvider } from "./gemini";
import { AiError, type AiPart, type AiProvider } from "./provider";

let provider: AiProvider | undefined;

// The model a task runs on: its own (backendConfig.ai.taskModels), else the default.
export function aiModelFor(task: string): string {
  return backendConfig.ai.taskModels[task] ?? backendConfig.ai.model;
}

// For `npm run ai:compare`: runs `fn` with every AI call on `model`, and lists the calls
// (tokens, estimated cost, duration) in `calls`.
export type AiCall = { task: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; ms: number };
const runContext = new AsyncLocalStorage<{ model?: string; calls: AiCall[] }>();

export function withAiModel<T>(model: string | undefined, calls: AiCall[], fn: () => Promise<T>): Promise<T> {
  return runContext.run({ model, calls }, fn);
}

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
  // Background work (the collector's bot pages): stops at a share of the daily budget, so
  // users keep the rest.
  background?: boolean;
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
// Returns the data and the `provider:model` id to store. Refused (503 ai_budget_reached)
// once the day's AI budget is spent; every call's tokens count towards it.
export async function runAiJson<T extends z.ZodType>(task: AiTask<T>): Promise<{ data: z.output<T>; model: string }> {
  const ai = getAiProvider();
  const jsonSchema = task.jsonSchema ?? (z.toJSONSchema(task.schema, { io: "output", unrepresentable: "any" }) as Record<string, unknown>);

  const context = runContext.getStore();
  const requested = context?.model ?? aiModelFor(task.name);
  let answeredBy = requested;

  for (let attempt = 1; attempt <= 2; attempt++) {
    await checkAiBudget(task.background ?? false);
    const started = Date.now();
    const { text, model, usage } = await ai.generateJson({ task: task.name, model: requested, system: task.system, parts: task.parts, jsonSchema, temperature: task.temperature, effort: task.effort });
    answeredBy = model;
    const costUsd = await recordAiUsage(task.name, model, usage);
    context?.calls.push({ task: task.name, model, inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, costUsd, ms: Date.now() - started });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      console.warn(`ai ${task.name}: answer is not JSON (attempt ${attempt})`);
      continue;
    }
    const result = task.schema.safeParse(task.prepare ? task.prepare(json) : json);
    if (result.success) return { data: result.data, model: `${ai.name}:${answeredBy}` };
    // Log the validation problems only, never the content (personal data).
    console.warn(`ai ${task.name}: invalid answer (attempt ${attempt})`, result.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  throw AiError.invalidOutput();
}
