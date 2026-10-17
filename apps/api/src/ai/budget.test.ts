import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { aiSpentToday, AiError, resetAiBudgetAlerts, useFakeAi, type FakeProvider } from "@job/backend";
import { z } from "zod";
import { config } from "../config";
import { prisma } from "../test/helpers";
import { runAiJson } from "./run";

// The daily AI budget (backendConfig.ai.budget): every call's tokens are priced and
// counted; calls are refused once the day's total reaches the budget, background ones at
// their share of it.

const budget = { ...config.ai.budget };
let fake: FakeProvider;
const today = () => new Date(new Date().toISOString().slice(0, 10));

const call = (background = false) =>
  runAiJson({ name: "test-budget", system: "test", parts: [{ text: "test" }], schema: z.object({ ok: z.boolean() }), background });

before(() => {
  fake = useFakeAi();
  fake.handlers["test-budget"] = () => ({ ok: true });
  // 100 000 input tokens at $1.50 per million: $0.15 a call.
  fake.usage = { inputTokens: 100_000, outputTokens: 0 };
  Object.assign(config.ai.budget, { dailyUsd: 0.4, backgroundShare: 0.5, inputUsdPerMillion: 1.5, outputUsdPerMillion: 7.5 });
});
beforeEach(async () => {
  await prisma.aiUsage.deleteMany({ where: { day: today() } });
  resetAiBudgetAlerts();
});
after(async () => {
  Object.assign(config.ai.budget, budget);
  fake.usage = undefined;
  await prisma.aiUsage.deleteMany({ where: { day: today() } });
});

describe("daily AI budget", () => {
  test("calls are priced and counted per task, then refused once the budget is spent", async () => {
    await call();
    await call();
    const row = await prisma.aiUsage.findUniqueOrThrow({ where: { day_task: { day: today(), task: "test-budget" } } });
    assert.equal(row.calls, 2);
    assert.equal(row.inputTokens, 200_000n);
    assert.ok(Math.abs(row.costUsd - 0.3) < 1e-9);

    await call(); // $0.30 spent, under $0.40: allowed
    assert.ok(Math.abs((await aiSpentToday()) - 0.45) < 1e-9);
    await assert.rejects(call(), (error: unknown) => error instanceof AiError && error.status === 503 && error.code === "ai_budget_reached");
    assert.equal((await prisma.aiUsage.findUniqueOrThrow({ where: { day_task: { day: today(), task: "test-budget" } } })).calls, 3, "a refused call costs nothing");
  });

  test("background work stops at its share, leaving the rest to users", async () => {
    await call(true); // $0 spent
    await call(true); // $0.15, under $0.20
    await assert.rejects(call(true), (error: unknown) => error instanceof AiError && error.code === "ai_budget_reached");
    await call(); // users still have $0.10 left
  });

  test("an invalid answer that is retried counts twice", async () => {
    let attempts = 0;
    await fake.with("test-budget", () => (++attempts === 1 ? "not json" : { ok: true }), () => call());
    assert.equal((await prisma.aiUsage.findUniqueOrThrow({ where: { day_task: { day: today(), task: "test-budget" } } })).calls, 2);
  });
});
