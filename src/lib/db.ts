import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { requiredEnv } from "./env";

/**
 * OLYMPUS: TYPED LAZY PRISMA SINGLETON
 *
 * This advanced pattern solves two conflicting requirements:
 * 1. IDE/TypeScript Support: By using ": PrismaClient", the IDE correctly identifies
 *    models like publicMirror, financialLog, and marketConfig.
 * 2. Next.js 16 Build Stability: By using a Proxy, we defer the actual "new PrismaClient()"
 *    call until a real query is made. This prevents build-time worker crashes
 *    when the database environment is partially initialized.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPool: Pool | undefined;
};

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(target, prop) {
    // Standard safety for internal properties
    if (typeof prop !== 'string') return (target as any)[prop];
    if (prop === 'then' || prop === 'constructor' || prop === '$$typeof') {
        return (target as any)[prop];
    }

    // Lazy initialization on first access
    if (!globalForPrisma.prisma) {
      globalForPrisma.prismaPool = new Pool({
        connectionString: requiredEnv("DATABASE_URL"),
        max: Math.max(2, Math.min(50, Number(process.env.DATABASE_POOL_MAX) || 10)),
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        statement_timeout: 15000,
        options: "-c timezone=UTC",
      });
      const adapter = new PrismaPg(globalForPrisma.prismaPool);
      globalForPrisma.prisma = new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
      });
    }

    const value = (globalForPrisma.prisma as any)[prop];
    return typeof value === 'function' ? value.bind(globalForPrisma.prisma) : value;
  }
});

export async function closeDatabase() {
  const client = globalForPrisma.prisma;
  const pool = globalForPrisma.prismaPool;
  globalForPrisma.prisma = undefined;
  globalForPrisma.prismaPool = undefined;
  await client?.$disconnect();
  if (pool && !pool.ended) await pool.end();
}
