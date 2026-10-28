import { Prisma } from "@/generated/prisma/client";

/** Erro de regra de negócio: a mensagem é segura para exibir ao usuário. */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string = "DOMAIN_ERROR",
    public readonly field?: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Registro não encontrado.") {
    super(message, "NOT_FOUND");
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function assertFound<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) throw new NotFoundError(message);
  return value;
}
