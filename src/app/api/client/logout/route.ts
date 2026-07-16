import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { authOptions } from "@/lib/auth";

type SessionUser = {
  authLevel?: string;
};

const SESSION_COOKIE_NAMES = [
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
];

function isClientSession(user: SessionUser | undefined) {
  return (
    user?.authLevel === "phone_lookup" ||
    user?.authLevel === "verified_link" ||
    user?.authLevel === "verified_otp"
  );
}

function isSessionCookie(name: string) {
  return (
    SESSION_COOKIE_NAMES.includes(name) ||
    name.startsWith("next-auth.session-token.") ||
    name.startsWith("__Secure-next-auth.session-token.")
  );
}

export async function POST() {
  const session = await getServerSession(authOptions);
  const response = NextResponse.json({ ok: true });

  if (!isClientSession(session?.user as SessionUser | undefined)) {
    return response;
  }

  const cookieStore = await cookies();
  const cookieNames = new Set([
    ...SESSION_COOKIE_NAMES,
    ...cookieStore.getAll().map((cookie) => cookie.name).filter(isSessionCookie),
  ]);

  for (const name of cookieNames) {
    response.cookies.set(name, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: name.startsWith("__Secure-"),
    });
  }

  return response;
}
