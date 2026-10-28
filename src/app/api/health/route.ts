import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

/** Verificação de saúde para monitoramento (não expõe dados). */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "error" }, { status: 503 });
  }
}
