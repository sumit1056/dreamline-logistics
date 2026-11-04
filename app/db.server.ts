import { PrismaClient } from "@prisma/client";

// Ensure connection pool limits are configured for Neon PgBouncer
const rawDbUrl = process.env.DATABASE_URL || "";
let optimizedDbUrl = rawDbUrl;
if (optimizedDbUrl && !optimizedDbUrl.includes("connection_limit")) {
  const sep = optimizedDbUrl.includes("?") ? "&" : "?";
  optimizedDbUrl = `${optimizedDbUrl}${sep}connection_limit=20&pool_timeout=60`;
  process.env.DATABASE_URL = optimizedDbUrl;
}

let prisma: PrismaClient;

declare global {
  var __db__: PrismaClient | undefined;
}

// In development, we use global to avoid creating multiple client connections 
// when hot-reloading code.
if (process.env.NODE_ENV === "production") {
  prisma = new PrismaClient({
    log: ["warn", "error"],
    datasources: optimizedDbUrl ? { db: { url: optimizedDbUrl } } : undefined,
  });
} else {
  if (!global.__db__) {
    global.__db__ = new PrismaClient({
      log: ["warn", "error"],
      datasources: optimizedDbUrl ? { db: { url: optimizedDbUrl } } : undefined,
    });
  }
  prisma = global.__db__;
}

export async function withDbRetry<T>(fn: () => Promise<T>, retries = 3, initialDelayMs = 1000): Promise<T> {
  let delay = initialDelayMs;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isConnectionError =
        err?.code === "P1001" ||
        err?.code === "P1002" ||
        err?.code === "P2024" ||
        err?.message?.includes("Timed out fetching a new connection from the connection pool") ||
        err?.message?.includes("connection pool") ||
        err?.message?.includes("Can't reach database server") ||
        err?.message?.includes("connection closed") ||
        err?.message?.includes("Connection refused") ||
        err?.message?.includes("Connection reset") ||
        err?.message?.includes("SSL connection has been closed unexpectedly");

      if (isConnectionError && attempt <= retries) {
        console.warn(`[Neon DB Retry] Attempt ${attempt} hit ${err?.code || 'pool issue'}: ${err?.message?.slice(0, 80)}. Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.round(delay * 1.5);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to execute database query after retries");
}

export { prisma };
