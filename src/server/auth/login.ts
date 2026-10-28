import "server-only";
import { prisma } from "@/server/db";
import { DUMMY_HASH, verifyPassword } from "./password";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_EMAIL = 5;
const MAX_FAILURES_PER_IP = 20;

export type LoginResult = { ok: true; userId: string } | { ok: false; reason: "invalid" | "rate_limited" };

/** Verifica credenciais com limite de tentativas por e-mail e por IP. */
export async function verifyCredentials(
  email: string,
  password: string,
  ipAddress: string | null,
): Promise<LoginResult> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [emailFailures, ipFailures] = await Promise.all([
    prisma.loginAttempt.count({ where: { email, success: false, createdAt: { gte: since } } }),
    ipAddress
      ? prisma.loginAttempt.count({ where: { ipAddress, success: false, createdAt: { gte: since } } })
      : Promise.resolve(0),
  ]);
  if (emailFailures >= MAX_FAILURES_PER_EMAIL || ipFailures >= MAX_FAILURES_PER_IP) {
    return { ok: false, reason: "rate_limited" };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Compara contra um hash fixo quando o usuário não existe (tempo de resposta uniforme).
  const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  const success = Boolean(user && user.active && valid);
  await prisma.loginAttempt.create({ data: { email, ipAddress, success } });
  if (!success || !user) return { ok: false, reason: "invalid" };
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { ok: true, userId: user.id };
}
