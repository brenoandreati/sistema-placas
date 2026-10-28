import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "@/server/context";
import { DomainError } from "@/server/errors";
import { can, type Permission } from "./permissions";
import { getCurrentSession, type CurrentSession } from "./session";

export class ForbiddenError extends DomainError {
  constructor() {
    super("Você não tem permissão para esta operação.", "FORBIDDEN");
  }
}

/** Para páginas: exige usuário autenticado (senão vai ao login) e, opcionalmente, uma permissão. */
export async function requirePageSession(permission?: Permission): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (permission && !can(session.user.role, permission)) redirect("/?acesso=negado");
  return session;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** Para server actions e route handlers: valida a sessão no servidor a cada chamada. */
export async function requireActor(permission?: Permission): Promise<{ actor: Actor; session: CurrentSession }> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (permission && !can(session.user.role, permission)) throw new ForbiddenError();
  return { actor: { userId: session.user.id, ipAddress: await clientIp() }, session };
}
