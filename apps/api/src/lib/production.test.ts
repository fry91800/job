import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { backendConfig, resetAlerts, sendAlert } from "@job/backend";
import { createApp } from "../app";
import { config } from "../config";
import { startTestServer } from "../test/helpers";
import { productionProblems } from "./production-check";

// Production readiness (DEPLOYMENT.md): startup checks, headers, request ids, alerts.

let server: Awaited<ReturnType<typeof startTestServer>>;
before(async () => {
  server = await startTestServer();
});
after(() => server.close());

const goodEnv = {
  DATABASE_URL: "postgresql://job@db/job",
  WEB_BASE_URL: "https://jobs.example.com",
  WEB_ORIGINS: "https://jobs.example.com",
  TRUST_PROXY: "1",
  SMTP_HOST: "smtp.provider.example",
  MAIL_FROM: "Jobs <no-reply@jobs.example.com>",
  STORAGE_LOCAL_DIR: "/data/storage",
  GEMINI_API_KEY: "key",
};

describe("production readiness", () => {
  test("the startup check accepts a complete production configuration and names what is wrong", () => {
    assert.deepEqual(productionProblems(goodEnv), []);
    const problems = productionProblems({ ...goodEnv, GEMINI_API_KEY: "", WEB_BASE_URL: "http://localhost:5174", SMTP_HOST: "localhost", AI_PROVIDER: undefined });
    assert.deepEqual(
      problems.map((problem) => problem.split(" ")[0]),
      ["GEMINI_API_KEY", "WEB_BASE_URL", "SMTP_HOST"],
      problems.join("; "),
    );
    assert.ok(productionProblems({ ...goodEnv, TRUST_PROXY: undefined }).some((problem) => problem.startsWith("TRUST_PROXY")));
  });

  test("every answer has a request id and the browser protections", async () => {
    const response = await fetch(`${server.baseUrl}/api/health`);
    assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  });

  test("behind the reverse proxy, the visitor's address is the forwarded one", () => {
    const previous = config.trustProxy;
    try {
      config.trustProxy = 1;
      assert.equal(createApp().get("trust proxy"), 1);
    } finally {
      config.trustProxy = previous;
    }
  });

  test("alerts go to the webhook once per interval", async () => {
    const received: { text: string; content: string }[] = [];
    const webhook = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.end("ok");
      });
    });
    webhook.listen(0, "127.0.0.1");
    await new Promise((resolve) => webhook.once("listening", resolve));
    const previous = backendConfig.alerts.webhookUrl;
    backendConfig.alerts.webhookUrl = `http://127.0.0.1:${(webhook.address() as AddressInfo).port}/hook`;
    resetAlerts();
    try {
      assert.equal(await sendAlert("test-run", "Collection failed"), true);
      assert.equal(await sendAlert("test-run", "Collection failed again"), false, "same alert within the interval");
      assert.equal(received.length, 1);
      assert.match(received[0].text, /^\[monposte\] Collection failed$/);
      assert.equal(received[0].content, received[0].text, "Slack and Discord fields");
    } finally {
      backendConfig.alerts.webhookUrl = previous;
      webhook.close();
    }
  });
});
