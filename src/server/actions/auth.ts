"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { headers } from "next/headers";
import { changePasswordSchema, loginSchema } from "@/lib/validation/auth";
import type { ActionResult } from "@/lib/validation/common";
import { clientIp, requireActor } from "@/server/auth/guard";
import { verifyCredentials } from "@/server/auth/login";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, destroyAllUserSessions, destroyCurrentSession } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { toActionError } from "./run";

export interface LoginState {
  error?: string;
  email?: string;
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  // Apenas caminhos internos (evita open redirect).
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: "Informe e-mail e senha válidos.", email };

  const ip = await clientIp();
  const result = await verifyCredentials(parsed.data.email, parsed.data.password, ip);
  if (!result.ok) {
    return {
      email,
      error:
        result.reason === "rate_limited"
          ? "Muitas tentativas sem sucesso. Aguarde 15 minutos e tente novamente."
          : "E-mail ou senha incorretos.",
    };
  }
  await createSession(result.userId, { ipAddress: ip, userAgent: (await headers()).get("user-agent") });
  redirect(safeNext(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}

export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<ActionResult> {
  try {
    const { session } = await requireActor();
    const data = changePasswordSchema.parse(input);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
    if (!(await verifyPassword(data.currentPassword, user.passwordHash))) {
      return {
        ok: false,
        error: "Senha atual incorreta.",
        fieldErrors: { currentPassword: ["Senha atual incorreta."] },
      };
    }
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(data.newPassword) } });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "user.password_change",
          entityType: "user",
          entityId: user.id,
          summary: "Senha alterada",
          ipAddress: await clientIp(),
        },
      });
    });
    // Encerra as demais sessões do usuário.
    await destroyAllUserSessions(user.id, session.sessionId);
    return { ok: true, data: undefined, message: "Senha alterada. Outras sessões foram encerradas." };
  } catch (error) {
    unstable_rethrow(error);
    return toActionError(error);
  }
}
