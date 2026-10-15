// Test runner: the tests run against their own database (`job_test` next to the
// development one, or TEST_DATABASE_URL) and their own file storage, so the seed they need
// never wipes development data (collected offers, catalogue, uploads).
//   npm test                              every test
//   npm test -- apps/api/src/x.test.ts   only these files
// Each run applies the migrations and reseeds the test database first.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import pg from "pg";

const DEFAULT_TESTS = ["packages/shared/src/**/*.test.ts", "apps/api/src/**/*.test.ts", "apps/job_collector/src/**/*.test.ts", "apps/web/src/**/*.test.ts"];

const devUrl = process.env.DATABASE_URL;
if (!devUrl) throw new Error("DATABASE_URL is not defined");

function testUrlFrom(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname.slice(1)}_test`;
  return parsed.toString();
}

const testUrl = process.env.TEST_DATABASE_URL ?? testUrlFrom(devUrl);
const testDb = decodeURIComponent(new URL(testUrl).pathname.slice(1));
if (testUrl === devUrl || !testDb.endsWith("_test")) {
  throw new Error(`The test database name must end with "_test" and differ from DATABASE_URL (got "${testDb}")`);
}

// Created on first use, from a connection to the development database's server.
async function ensureDatabase() {
  const admin = new pg.Client({ connectionString: devUrl });
  await admin.connect();
  try {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [testDb]);
    if (!rowCount) {
      await admin.query(`CREATE DATABASE "${testDb.replaceAll('"', '""')}"`);
      console.log(`Created database ${testDb}`);
    }
  } finally {
    await admin.end();
  }
}

// The fake AI provider: tests never call (or pay for) a real model.
const env = { ...process.env, DATABASE_URL: testUrl, STORAGE_LOCAL_DIR: process.env.TEST_STORAGE_LOCAL_DIR ?? "storage-test", AI_PROVIDER: "fake" };

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
  await ensureDatabase();
  run("npx", ["prisma", "migrate", "deploy", "--config", "prisma7.config.ts"]);
  run("npx", ["prisma", "db", "seed", "--config", "prisma7.config.ts"]);
  const files = process.argv.slice(2);
  run(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...(files.length ? files : DEFAULT_TESTS)]);
}

void main();
