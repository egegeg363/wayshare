import "server-only";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

export type Tx = Prisma.TransactionClient;

function createPrismaClient() {
  // Relative SQLite paths resolve against the project root (where `next` runs),
  // matching the location `prisma db push` writes to.
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
  return new PrismaClient({ adapter });
}

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { __wayshare_prisma?: PrismaClient };

export const prisma = globalForPrisma.__wayshare_prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.__wayshare_prisma = prisma;

const RETRYABLE_CODES = new Set(["P2034"]); // write conflict / deadlock / serialization failure

/**
 * Run `fn` in a SERIALIZABLE interactive transaction, retrying on serialization conflicts.
 * Every money-moving or capacity-changing write goes through here, so on SQLite all writers
 * are serialised and on PostgreSQL concurrent bookings cannot oversell seats or detour budget.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 15_000,
      });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_CODES.has(error.code);
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
    }
  }
}
