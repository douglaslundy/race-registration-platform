import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedPrefixes = ["/dashboard", "/organizador", "/admin", "/inscricao"];
const adminOnly = ["/admin"];
const organizerOnly = ["/organizador"];

export default auth((req: NextRequest & { auth: { user?: { role?: string } } | null }) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  const isProtected = protectedPrefixes.some((p) => pathname.startsWith(p));
  if (isProtected && !session?.user) {
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session?.user) {
    const role = session.user.role;

    // ASSISTANT nunca é barrado aqui: o papel sozinho não diz a que áreas ele tem acesso (isso
    // depende das AssistantPermission e do escopo do criador). Os guards de página/rota
    // (requireOrganizer / requireAdmin / requirePermission / requireAnyPermission) resolvem isso
    // com consulta ao banco — coisa que este middleware (edge) não faz. Barrar o ASSISTANT aqui
    // mandava pra /acesso-negado quem só precisava entregar kit.
    if (role === "ASSISTANT") return NextResponse.next();

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

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth).*)"],
};
