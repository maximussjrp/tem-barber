import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function proxy(req) {
    const token = req.nextauth.token;
    const path = req.nextUrl.pathname;

    if (!token) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    const role = token.role as string | undefined;

    // 1. Proteger rotas de gerência/administração do estabelecimento
    if (path.startsWith("/admin")) {
      const hasAdminAccess =
        role === "SUPER_ADMIN" || role === "OWNER" || role === "MANAGER";

      if (!hasAdminAccess) {
        if (role === "BARBER") {
          return NextResponse.redirect(new URL("/member/agenda", req.url));
        }
        return NextResponse.redirect(new URL("/acesso-negado", req.url));
      }
    }

    // 2. Proteger rotas operacionais do barbeiro/colaborador
    if (path.startsWith("/member")) {
      const hasMemberAccess =
        role === "SUPER_ADMIN" ||
        role === "OWNER" ||
        role === "MANAGER" ||
        role === "BARBER";

      if (!hasMemberAccess) {
        return NextResponse.redirect(new URL("/acesso-negado", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ["/admin/:path*", "/member/:path*"],
};
