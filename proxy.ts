import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedPrefixes = ["/dashboard", "/organizador", "/admin", "/inscricao"];
const adminOnly = ["/admin"];
const organizerOnly = ["/organizador"];

export default auth((req: NextRequest & { auth: { user?: { role?: string; active?: boolean } } | null }) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  // Expõe o pathname pros Server Components (layouts/páginas não recebem a URL nativamente no
  // App Router). O guard de permissão da área do organizador lê isto via headers().
  const forwardHeaders = new Headers(req.headers);
  forwardHeaders.set("x-pathname", pathname);
  const pass = () => NextResponse.next({ request: { headers: forwardHeaders } });

  const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));
  if (isProtected && !session?.user) {
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session?.user) {
    const role = session.user.role;

    // Usuário bloqueado (ou excluído) que ainda carrega uma sessão viva: o `jwt` recarrega
    // `active` do banco a cada request, então isto passa a valer no próximo clique — sem
    // depender da expiração do token.
    if (session.user.active === false && isProtected) {
      return NextResponse.redirect(new URL("/acesso-negado", req.url));
    }

    // ASSISTANT nunca é barrado aqui: o papel sozinho não diz a que áreas ele tem acesso (isso
    // depende das AssistantPermission e do escopo do criador). Os guards de página/rota
    // (requireOrganizer / requireAdmin / requirePermission / requireAnyPermission) resolvem isso
    // com consulta ao banco — coisa que este middleware (edge) não faz. Barrar o ASSISTANT aqui
    // mandava pra /acesso-negado quem só precisava entregar kit.
    if (role === "ASSISTANT") return pass();

    if (adminOnly.some((p) => pathname.startsWith(p)) && role !== "ADMIN") {
      return NextResponse.redirect(new URL("/acesso-negado", req.url));
    }

    if (
      organizerOnly.some((p) => pathname.startsWith(p)) &&
      role !== "ORGANIZER" &&
      role !== "ADMIN"
    ) {
      return NextResponse.redirect(new URL("/acesso-negado", req.url));
    }
  }

  return pass();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth).*)"],
};
