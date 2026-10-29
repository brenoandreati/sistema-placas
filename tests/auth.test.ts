// Login com nome de usuário ou e-mail.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loginSchema } from "@/lib/validation/auth";
import { verifyCredentials } from "@/server/auth/login";
import { hashPassword } from "@/server/auth/password";
import { disconnectDb, prisma } from "@/server/db";
import { resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await disconnectDb();
});

describe("login", () => {
  it("aceita nome de usuário ou e-mail e normaliza maiúsculas e espaços", () => {
    expect(loginSchema.parse({ email: " Loja.Placas ", password: "x" }).email).toBe("loja.placas");
    expect(loginSchema.parse({ email: "Admin@Exemplo.com", password: "x" }).email).toBe("admin@exemplo.com");
    for (const invalid of ["", "ab", "com espaço", "a/b", ".comeca-com-ponto"]) {
      expect(loginSchema.safeParse({ email: invalid, password: "x" }).success).toBe(false);
    }
  });

  it("entra com o nome de usuário", async () => {
    const user = await prisma.user.create({
      data: { name: "Loja", email: "loja.placas", passwordHash: await hashPassword("SenhaTeste123"), role: "ADMIN" },
    });
    await expect(verifyCredentials("loja.placas", "SenhaTeste123", null)).resolves.toEqual({
      ok: true,
      userId: user.id,
    });
    await expect(verifyCredentials("loja.placas", "OutraSenha123", null)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
