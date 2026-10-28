// Cria um usuário ou redefine a senha de um existente.
// Uso: npm run user:create -- --email voce@exemplo.com --name "Seu Nome" [--role ADMIN|MANAGER|OPERATOR|VIEWER] [--reset]
// A senha é lida de USER_PASSWORD ou solicitada no terminal (sem eco).
import "dotenv/config";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type UserRole } from "../src/generated/prisma/client";
import { passwordPolicy } from "../src/lib/validation/auth";
import { hashPassword } from "../src/server/auth/password";

const ROLES: UserRole[] = ["ADMIN", "MANAGER", "OPERATOR", "VIEWER"];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function askHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const role = (arg("role")?.toUpperCase() ?? "ADMIN") as UserRole;
  const reset = process.argv.includes("--reset");
  if (!email) throw new Error("Informe --email.");
  if (!ROLES.includes(role)) throw new Error(`Papel inválido. Use: ${ROLES.join(", ")}.`);

  const password = process.env.USER_PASSWORD ?? (await askHidden("Senha (mín. 10 caracteres, letras e números): "));
  const check = passwordPolicy.safeParse(password);
  if (!check.success) throw new Error(check.error.issues[0]?.message ?? "Senha inválida.");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && !reset) throw new Error(`Usuário ${email} já existe. Use --reset para redefinir a senha.`);
    const passwordHash = await hashPassword(password);
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, active: true } });
      await prisma.session.deleteMany({ where: { userId: existing.id } });
      await prisma.auditLog.create({
        data: {
          userId: existing.id,
          action: "user.password_reset",
          entityType: "user",
          entityId: existing.id,
          summary: "Senha redefinida pela linha de comando",
        },
      });
      console.log(`✔ Senha de ${email} redefinida. Sessões anteriores encerradas.`);
    } else {
      if (!name) throw new Error("Informe --name para criar um usuário.");
      const user = await prisma.user.create({ data: { email, name, role, passwordHash } });
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "user.create",
          entityType: "user",
          entityId: user.id,
          summary: `Usuário ${email} (${role}) criado pela linha de comando`,
        },
      });
      console.log(`✔ Usuário ${email} criado com papel ${role}.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`✖ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
