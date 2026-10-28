import { execSync } from "node:child_process";
import { testDatabaseUrl } from "./test-db-url";

/** Aplica as migrations no banco de testes antes da suíte. */
export default function setup() {
  const url = testDatabaseUrl();
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url },
  });
}
