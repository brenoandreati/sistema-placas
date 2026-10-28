import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import type { UserRole } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

// Sessões armazenadas no banco. O cookie carrega um token aleatório de 256 bits;
// o banco guarda apenas o hash SHA-256 (um vazamento do banco não expõe sessões válidas).

export const SESSION_COOKIE = "placas_session";
const ABSOLUTE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

function idleTtlMs(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS ?? "12");
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 60 * 60 * 1000;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface CurrentSession {
  sessionId: string;
  user: SessionUser;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + idleTtlMs());
  await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ABSOLUTE_MAX_MS / 1000,
  });
}

async function validateToken(token: string): Promise<CurrentSession | null> {
  const id = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, email: true, role: true, active: true } } },
  });
  if (!session) return null;
  const now = Date.now();
  const expired = session.expiresAt.getTime() <= now || session.createdAt.getTime() + ABSOLUTE_MAX_MS <= now;
  if (expired || !session.user.active) {
    await prisma.session.delete({ where: { id } }).catch(() => undefined);
    return null;
  }
  // Renovação deslizante: estende a validade quando metade do prazo de inatividade já passou.
  const ttl = idleTtlMs();
  if (session.expiresAt.getTime() - now < ttl / 2) {
    await prisma.session.update({ where: { id }, data: { expiresAt: new Date(now + ttl) } }).catch(() => undefined);
  }
  const { active: _active, ...user } = session.user;
  void _active;
  return { sessionId: id, user };
}

/** Sessão da requisição atual (memoizada por requisição). */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateToken(token);
});

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  }
  store.delete(SESSION_COOKIE);
}

export async function destroyAllUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
}
