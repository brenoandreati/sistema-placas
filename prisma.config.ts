import "dotenv/config";
import { defineConfig } from "prisma/config";

// A CLI do Prisma (migrations) pode usar uma conexão com privilégios de dono do schema
// (MIGRATION_DATABASE_URL), enquanto a aplicação usa DATABASE_URL com um papel restrito.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
});
