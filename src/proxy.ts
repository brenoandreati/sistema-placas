import { NextResponse, type NextRequest } from "next/server";

// Verificação otimista: sem cookie de sessão, redireciona para o login.
// A validação real da sessão acontece no servidor (layouts, server actions e route handlers).
const SESSION_COOKIE = "placas_session";
const PUBLIC_PATHS = ["/login", "/api/health"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();

  if (!request.cookies.has(SESSION_COOKIE)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Ícones e manifesto ficam públicos: o iPhone e o Chrome os buscam sem o cookie de sessão.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|icons/|robots.txt).*)",
  ],
};
