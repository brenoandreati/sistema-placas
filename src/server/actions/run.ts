import "server-only";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/validation/common";
import { requireActor } from "@/server/auth/guard";
import type { Permission } from "@/server/auth/permissions";
import type { Actor } from "@/server/context";
import { DomainError } from "@/server/errors";

/**
 * Envelope padrão das server actions:
 * 1. valida a sessão e a permissão no servidor (nunca confia no cliente);
 * 2. executa a operação de domínio;
 * 3. revalida as páginas para que todos os indicadores reflitam a mudança;
 * 4. converte erros em mensagens seguras para o usuário.
 */
export async function runAction<T>(
  permission: Permission,
  operation: (actor: Actor) => Promise<T>,
  options: { revalidate?: boolean; message?: string } = {},
): Promise<ActionResult<T>> {
  try {
    const { actor } = await requireActor(permission);
    const data = await operation(actor);
    if (options.revalidate !== false) revalidatePath("/", "layout");
    return { ok: true, data, message: options.message };
  } catch (error) {
    unstable_rethrow(error);
    return toActionError(error);
  }
}

export function toActionError(error: unknown): { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> } {
  if (error instanceof z.ZodError) {
    const flattened = z.flattenError(error);
    const first = error.issues[0]?.message;
    return {
      ok: false,
      error: first ? `Revise os campos: ${first}` : "Revise os campos destacados.",
      fieldErrors: flattened.fieldErrors as Record<string, string[] | undefined>,
    };
  }
  if (error instanceof DomainError) {
    return { ok: false, error: error.message, fieldErrors: error.field ? { [error.field]: [error.message] } : undefined };
  }
  console.error("[action] erro inesperado", error);
  return { ok: false, error: "Não foi possível concluir a operação. Tente novamente em instantes." };
}
