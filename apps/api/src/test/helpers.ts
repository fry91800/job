// Helpers for the API integration tests. Tests run against the seeded development
// database (`npm run db:seed`) and remove the users they create.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stableUuid } from "../../../../prisma/seed/helpers";
import { useFakeAi } from "../ai/run";
import { createApp } from "../app";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { closeBrowser } from "../templates/pdf";
import { sampleExtractedOffer } from "./fixtures/sample-offer";
import { sampleParsedResume } from "./fixtures/sample-resume";

export { prisma };

export const seedOfferId = (key: string) => stableUuid(`offer:${key}`);
export const seedUserId = (key: string) => stableUuid(`user:${key}`);
export const uniqueEmail = () => `test-${randomUUID()}@example.test`;
export const TEST_PASSWORD = "correct-horse-battery";

export async function startTestServer() {
  const startedAt = new Date();
  // Every test request comes from the same IP: per-IP limits would block the suite.
  // Per-email login limits stay as configured.
  config.rateLimits.signupsPerIp.max = 1000;
  config.rateLimits.guestsPerIp.max = 1000;
  config.rateLimits.loginFailuresPerIp.max = 1000;
  config.rateLimits.passwordResetsPerIp.max = 1000;
  // Never call a real AI provider from tests. Default answers per task; tests use
  // `ai.with(task, handler, run)` for other answers.
  const ai = useFakeAi();
  ai.handlers["parse-resume"] = () => sampleParsedResume;
  ai.handlers["extract-offer"] = () => sampleExtractedOffer;
  // Emails are kept in memory (sentMails), never sent.
  config.mail.transport = "memory";
  // Uploaded files go to a temporary folder, removed at the end.
  config.storage.localDir = await mkdtemp(join(tmpdir(), "job-api-test-"));
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

  return {
    baseUrl,
    ai,
    client: (session?: string) => new TestClient(baseUrl, session),
    // Deletes the users created since the server started (registered test users,
    // guests and deleted accounts). Test files run one at a time (see api:test).
    async close() {
      server.close();
      await closeBrowser();
      await rm(config.storage.localDir, { recursive: true, force: true });
      await prisma.user.deleteMany({
        where: {
          createdAt: { gte: startedAt },
          OR: [{ email: null }, { email: { endsWith: "@example.test" } }],
        },
      });
      await prisma.$disconnect();
    },
  };
}

// Minimal browser stand-in: keeps the session cookie between requests.
export class TestClient {
  constructor(
    private readonly baseUrl: string,
    public session?: string,
  ) {}

  async request<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(this.session && { Cookie: `session=${this.session}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const cookie of response.headers.getSetCookie()) {
      const match = /^session=([^;]*)/.exec(cookie);
      if (match) this.session = match[1] && !/Expires=Thu, 01 Jan 1970/i.test(cookie) ? match[1] : undefined;
    }

    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
  }

  get = <T = any>(path: string) => this.request<T>("GET", path);
  post = <T = any>(path: string, body?: unknown) => this.request<T>("POST", path, body);
  put = <T = any>(path: string, body?: unknown) => this.request<T>("PUT", path, body);
  patch = <T = any>(path: string, body?: unknown) => this.request<T>("PATCH", path, body);
  delete = <T = any>(path: string, body?: unknown) => this.request<T>("DELETE", path, body);
}
