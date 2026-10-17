import { backendConfig } from "../config";
import { sendAlert } from "../ops/alert";
import { logEvent } from "../ops/log";
import { prisma } from "../prisma";
import { AiError, type AiUsage } from "./provider";

// Daily AI budget (backendConfig.ai.budget): every call's tokens are priced and added to
// the day's row of its task in `ai_usage`, shared by the API and the worker. Before a call,
// the day's total is compared to the budget. Calls already started when it is reached
// still finish, so a day can end slightly above it.

const today = () => new Date(new Date().toISOString().slice(0, 10)); // midnight UTC

export async function aiSpentToday(): Promise<number> {
  const { _sum } = await prisma.aiUsage.aggregate({ _sum: { costUsd: true }, where: { day: today() } });
  return _sum.costUsd ?? 0;
}

// The day each alert was last sent: at most one of each per day and process.
const alerted = new Map<string, string>();

function alertOnce(key: string, text: string): void {
  const day = today().toISOString().slice(0, 10);
  if (alerted.get(key) === day) return;
  alerted.set(key, day);
  void sendAlert(key, text);
}

export async function checkAiBudget(background: boolean): Promise<void> {
  const { dailyUsd, backgroundShare } = backendConfig.ai.budget;
  const limit = background ? dailyUsd * backgroundShare : dailyUsd;
  const spent = await aiSpentToday();
  if (spent < limit) return;
  if (background) {
    logEvent("info", "ai_background_budget_reached", { spentUsd: round(spent), limitUsd: limit });
  } else {
    alertOnce("ai-budget-reached", `AI daily budget reached ($${round(spent)} of $${dailyUsd}): AI features are paused until midnight UTC. Raise AI_DAILY_BUDGET_USD to resume.`);
  }
  throw AiError.budgetReached();
}

// USD per million tokens for a model; one missing from the table is priced as the most
// expensive (and logged once), so the budget never underestimates.
const unpriced = new Set<string>();

export function aiPrice(model: string): { input: number; output: number } {
  const prices = backendConfig.ai.prices;
  if (prices[model]) return prices[model];
  if (!unpriced.has(model)) {
    unpriced.add(model);
    logEvent("warn", "ai_model_without_price", { model });
  }
  return Object.values(prices).reduce((max, price) => (price.output > max.output ? price : max));
}

// Adds a call to the day's usage; returns its estimated cost.
export async function recordAiUsage(task: string, model: string, usage: AiUsage | undefined): Promise<number> {
  const { dailyUsd, warnAt } = backendConfig.ai.budget;
  const input = usage?.inputTokens ?? 0;
  const output = usage?.outputTokens ?? 0;
  const price = aiPrice(model);
  const cost = (input * price.input + output * price.output) / 1_000_000;
  try {
    await prisma.$executeRaw`
      INSERT INTO ai_usage (day, task, model, calls, input_tokens, output_tokens, cost_usd)
      VALUES (${today()}::date, ${task}, ${model}, 1, ${input}, ${output}, ${cost})
      ON CONFLICT (day, task, model) DO UPDATE SET
        calls = ai_usage.calls + 1,
        input_tokens = ai_usage.input_tokens + EXCLUDED.input_tokens,
        output_tokens = ai_usage.output_tokens + EXCLUDED.output_tokens,
        cost_usd = ai_usage.cost_usd + EXCLUDED.cost_usd`;
    const spent = await aiSpentToday();
    if (spent >= dailyUsd * warnAt && spent < dailyUsd) alertOnce("ai-budget-warning", `AI spending today: $${round(spent)} of the $${dailyUsd} daily budget.`);
  } catch (error) {
    // The call is done (and paid): its answer is still used.
    logEvent("error", "ai_usage_not_recorded", { task, error: error instanceof Error ? error.message : String(error) });
  }
  return cost;
}

const round = (usd: number) => Math.round(usd * 100) / 100;

// Tests.
export function resetAiBudgetAlerts(): void {
  alerted.clear();
}
