import { NextResponse, type NextRequest } from "next/server";
import { normalizeQrCode } from "@/lib/qr";
import { resolveQrCode } from "@/server/services/qr-codes";

export const dynamic = "force-dynamic";

// Sem cache: trocar o link no painel precisa valer já na próxima leitura.
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Endereço impresso nos QR codes das placas (público). Com link cadastrado, redireciona (302) e conta a leitura;
 * sem link, abre a página de ativação.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/q/[code]">) {
  const { code: raw } = await ctx.params;
  const code = normalizeQrCode(raw);
  try {
    const destination = code ? await resolveQrCode(code) : null;
    if (destination) return NextResponse.redirect(destination, { status: 302, headers: NO_STORE });
  } catch (error) {
    console.error("[qr] falha ao consultar o destino", error);
    return new NextResponse("Não foi possível abrir este QR code agora. Tente novamente em instantes.", {
      status: 503,
      headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "5" },
    });
  }
  const activation = new URL(`/q/${encodeURIComponent(code ?? raw)}/ativar`, request.nextUrl);
  return NextResponse.redirect(activation, { status: 302, headers: NO_STORE });
}
