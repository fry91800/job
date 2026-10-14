import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not defined");
}

// Under `node --test` (it sets NODE_TEST_CONTEXT), only a test database: the tests reseed
// it, which would wipe development data. `npm test` points DATABASE_URL to it.
if (process.env.NODE_TEST_CONTEXT && !new URL(connectionString).pathname.endsWith("_test")) {
  throw new Error("Tests must run against a test database (name ending in _test): use `npm test`");
}

const adapter = new PrismaPg({ connectionString });

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
