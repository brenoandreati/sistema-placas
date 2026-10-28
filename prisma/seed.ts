// Seed de produção: cria somente dados de referência e o administrador inicial.
// Não insere dados fictícios. Para dados de demonstração, veja prisma/seed-demo.ts.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { ensureReferenceData } from "../src/server/reference-data";

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    await ensureReferenceData(prisma);
    console.log("✔ Dados de referência (configurações, caixa, formas de pagamento e categorias).");

    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    const name = process.env.ADMIN_NAME?.trim() || "Administrador";
    if (!email || !password) {
      console.log("ℹ ADMIN_EMAIL/ADMIN_PASSWORD não definidos: nenhum usuário criado. Use `npm run user:create`.");
      return;
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`ℹ Usuário ${email} já existe (senha não alterada).`);
      return;
    }
    if (password.length < 10) {
      throw new Error("ADMIN_PASSWORD deve ter ao menos 10 caracteres.");
    }
    await prisma.user.create({
      data: { email, name, role: "ADMIN", passwordHash: await hashPassword(password) },
    });
    console.log(`✔ Administrador ${email} criado. Troque a senha após o primeiro acesso.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
