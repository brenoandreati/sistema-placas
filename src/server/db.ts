import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

/**
 * Contexto da requisição no Cloudflare Workers (definido pelo OpenNext a cada requisição).
 * Em Node.js (desenvolvimento, testes, servidor próprio) é indefinido.
 */
interface CloudflareRequestContext {
  env?: Record<string, unknown>;
  ctx?: object;
}
function cloudflareContext(): CloudflareRequestContext | undefined {
  return (globalThis as Record<symbol, CloudflareRequestContext | undefined>)[Symbol.for("__cloudflare-context__")];
}

function createClient(connectionString: string | undefined, options: { workers?: boolean } = {}): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurada. Copie .env.example para .env e ajuste a conexão.");
  }
  const adapter = new PrismaPg({
    connectionString,
    // No Workers cada requisição tem o próprio pool; poucas conexões bastam.
    ...(options.workers ? { max: 4, idleTimeoutMillis: 5_000 } : {}),
  });
  return new PrismaClient({
    adapter,
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
}

// No Workers, conexões (sockets) não podem ser compartilhadas entre requisições:
// cada requisição recebe o seu cliente, descartado junto com o contexto da requisição.
const perRequest = new WeakMap<object, PrismaClient>();

function getClient(): PrismaClient {
  const cf = cloudflareContext();
  if (cf?.ctx) {
    let client = perRequest.get(cf.ctx);
    if (!client) {
      const url = (cf.env?.DATABASE_URL as string | undefined) ?? process.env.DATABASE_URL;
      client = createClient(url, { workers: true });
      perRequest.set(cf.ctx, client);
    }
    return client;
  }
  if (!globalForPrisma.__prisma) {
    globalForPrisma.__prisma = createClient(process.env.DATABASE_URL);
  }
  return globalForPrisma.__prisma;
}

/**
 * Cliente Prisma criado sob demanda (evita exigir DATABASE_URL durante o build).
 * Em Node.js a instância é única por processo; no Cloudflare Workers, única por requisição.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.__prisma) {
    await globalForPrisma.__prisma.$disconnect();
    globalForPrisma.__prisma = undefined;
  }
}
