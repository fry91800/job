import { ApiError, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { AiError, type AiAnswer, type AiJsonRequest, type AiProvider } from "./provider";

// Gemini's structured output rejects or chokes on some JSON Schema features (complex
// schemas get "400 invalid argument", numeric `const` hangs). Only the shape is sent:
// lengths, patterns and list sizes are dropped. The answer is validated with the full Zod
// schema afterwards (runAiJson), so nothing is lost.
const DROPPED_KEYWORDS = new Set(["$schema", "minLength", "maxLength", "pattern", "minItems", "maxItems", "format"]);

export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (DROPPED_KEYWORDS.has(key)) continue;
    if (key === "const") result.enum = [value];
    else result[key] = toGeminiSchema(value);
  }
  return result;
}

// Google Gemini, with structured output (the answer follows the JSON Schema).
export class GeminiProvider implements AiProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  // Temporary errors (503 "high demand", 429 per-minute rate limit) are retried twice
  // with a short pause, as long as the whole request stays within the timeout. An
  // exhausted quota (429 "exceeded your current quota") is not retried.
  async generateJson(request: AiJsonRequest): Promise<AiAnswer> {
    const deadline = Date.now() + this.timeoutMs;
    const pauses = [2000, 5000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.call(request, deadline);
      } catch (error) {
        const pause = pauses[attempt];
        const temporary = error instanceof ApiError && (error.status === 503 || (error.status === 429 && !isQuotaExhausted(error)));
        if (!temporary || pause === undefined || Date.now() + pause >= deadline) throw toAiError(error);
        await new Promise((resolve) => setTimeout(resolve, pause));
      }
    }
  }

  private async call(request: AiJsonRequest, deadline: number): Promise<AiAnswer> {
    const model = request.model ?? this.model;
    const response = await this.client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: request.parts.map((part) =>
            "text" in part ? { text: part.text } : { inlineData: { mimeType: part.file.mimeType, data: part.file.data.toString("base64") } },
          ),
        },
      ],
      config: {
        systemInstruction: request.system,
        responseMimeType: "application/json",
        responseJsonSchema: toGeminiSchema(request.jsonSchema),
        temperature: request.temperature,
        ...(request.effort === "low" && { thinkingConfig: lowThinking(model) }),
        abortSignal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1000)),
      },
    });
    const text = response.text;
    if (!text) throw AiError.invalidOutput();
    const metadata = response.usageMetadata;
    const usage = metadata && {
      inputTokens: (metadata.promptTokenCount ?? 0) + (metadata.toolUsePromptTokenCount ?? 0),
      outputTokens: (metadata.candidatesTokenCount ?? 0) + (metadata.thoughtsTokenCount ?? 0),
    };
    return { text, model, usage };
  }
}

// Less thinking for straightforward tasks: Gemini 2.x models take a token budget (0: none),
// later ones a level.
function lowThinking(model: string) {
  return /^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: ThinkingLevel.LOW };
}

function isQuotaExhausted(error: ApiError): boolean {
  return /exceeded your current quota/i.test(error.message);
}

function toAiError(error: unknown): unknown {
  if (error instanceof AiError) return error;
  if (error instanceof ApiError && error.status === 429 && isQuotaExhausted(error)) {
    console.error("gemini quota exhausted");
    return AiError.unavailable("The AI quota is exhausted for now, try again later");
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return AiError.timeout();
  if (error instanceof ApiError) {
    // 429: quota or rate limit (frequent on the free tier); 5xx: Google side.
    if (error.status === 429 || error.status >= 500) return AiError.unavailable();
    console.error("gemini request failed", error.status, error.message);
    return AiError.failed();
  }
  return error;
}
