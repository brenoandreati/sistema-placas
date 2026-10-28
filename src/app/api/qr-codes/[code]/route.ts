import { NextResponse } from "next/server";
import { normalizeQrCode, qrPublicUrl } from "@/lib/qr";
import { qrSvgFile } from "@/lib/qr-svg";
import { requestOrigin } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { getQrCode } from "@/server/services/qr-codes";
import { getSettingsView } from "@/server/services/settings";

export const dynamic = "force-dynamic";

/** Imagem SVG de um QR code, para levar à arte da placa em outro programa (Canva, Corel, Illustrator...). */
export async function GET(_request: Request, ctx: RouteContext<"/api/qr-codes/[code]">) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(session.user.role, "sales.read")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const code = normalizeQrCode((await ctx.params).code);
  const qr = code ? await getQrCode(code) : null;
  if (!qr) return NextResponse.json({ error: "QR code não encontrado" }, { status: 404 });

  const settings = await getSettingsView();
  const svg = qrSvgFile(qrPublicUrl(settings.qrBaseUrl ?? (await requestOrigin()), qr.code));
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="qr-${qr.code}.svg"`,
      "Cache-Control": "private, no-store",
    },
  });
}
