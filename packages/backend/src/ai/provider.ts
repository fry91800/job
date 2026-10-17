import { HttpError } from "../lib/http-error";

// What a feature asks from an AI provider: JSON matching a schema, from instructions
// and content (text or files such as PDFs). Each provider implements this interface;
// features only use `runAiJson` (./run.ts).

export type AiPart = { text: string } | { file: { mimeType: string; data: Buffer } };

export type AiJsonRequest = {
  task: string; // e.g. "parse-resume", for logs and test doubles
  model?: string; // the provider's default model when not set
  system: string;
  parts: AiPart[];
  jsonSchema: Record<string, unknown>; // JSON Schema of the expected answer
  temperature?: number;
  // "low" for straightforward tasks (extraction): faster and cheaper on models that
  // "think" before answering. Providers map it to their own setting.
  effort?: "low" | "default";
};

// Tokens a call used, for the daily budget (./budget.ts). Output includes thinking.
export type AiUsage = { inputTokens: number; outputTokens: number };
export type AiAnswer = { text: string; model: string; usage?: AiUsage };

export interface AiProvider {
  readonly name: string; // stored as `provider:model` (e.g. generated_resumes.ai_model)
  readonly model: string;
  // Returns the raw text of the answer (expected to be JSON), the model that answered and
  // the tokens it used.
  generateJson(request: AiJsonRequest): Promise<AiAnswer>;
}

// AI failures as HTTP errors. Nothing is saved and no quota is used when they happen (G5).
export class AiError extends HttpError {
  static unavailable(message = "The AI service is busy, try again in a moment") {
    return new AiError(503, "ai_unavailable", message);
  }
  static timeout() {
    return new AiError(504, "ai_timeout", "The AI took too long to answer, try again");
  }
  static failed(message = "The AI request failed") {
    return new AiError(502, "ai_failed", message);
  }
  static budgetReached() {
    return new AiError(503, "ai_budget_reached", "The AI is paused until tomorrow (daily budget reached)");
  }
  static invalidOutput() {
    return new AiError(502, "ai_invalid_output", "The AI returned an unusable answer, try again");
  }
}
