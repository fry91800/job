import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { toGeminiSchema } from "./gemini";
import { withoutProperties } from "./run";

describe("AI JSON schemas", () => {
  test("Gemini gets the shape only: no lengths, patterns, list sizes; const becomes enum", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        version: { type: "number", const: 1 },
        name: { type: "string", minLength: 1, maxLength: 300, pattern: "^a" },
        tags: { type: "array", items: { type: "string", maxLength: 5 }, maxItems: 10 },
      },
      required: ["version", "name", "tags"],
      additionalProperties: false,
    };
    assert.deepEqual(toGeminiSchema(schema), {
      type: "object",
      properties: {
        version: { type: "number", enum: [1] },
        name: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["version", "name", "tags"],
      additionalProperties: false,
    });
  });

  test("withoutProperties removes a property at every depth, from properties and required", () => {
    const schema = {
      type: "object",
      properties: {
        id: { type: "string" },
        items: { type: "array", items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"] } },
      },
      required: ["id", "items"],
    };
    assert.deepEqual(withoutProperties(schema, ["id"]), {
      type: "object",
      properties: { items: { type: "array", items: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } } },
      required: ["items"],
    });
  });
});
