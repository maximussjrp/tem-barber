import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/subscription-utils";
import {
  revokeTenantAccessGrant,
  AccessGrantError,
} from "@/lib/billing/access-grants";

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Não autenticado." },
      { status: 401 }
    );
  }

  const user = session.user as { id?: string; email?: string | null; role?: string };
  const email = user.email ?? null;
  const role = user.role;

  const isPlatform = isPlatformAdmin(email) || role === "SUPER_ADMIN";
  if (!isPlatform) {
    return NextResponse.json(
      {
        error: "FORBIDDEN",
        message: "Apenas administradores da plataforma podem revogar cortesias.",
      },
      { status: 403 }
    );
  }

  try {
    const params = await props.params;
    const grantId = params.id;

    if (!grantId) {
      return NextResponse.json(
        { error: "ACCESS_GRANT_NOT_FOUND", message: "ID da cortesia é obrigatório." },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const reason = body?.reason;

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return NextResponse.json(
        {
          error: "ACCESS_GRANT_REASON_REQUIRED",
          message: "O motivo da revogação é obrigatório.",
        },
        { status: 400 }
      );
    }

    const actorUserId = user.id || "platform-admin";

    const result = await revokeTenantAccessGrant({
      grantId,
      reason,
      actorUserId,
      actorEmail: email,
    });

    return NextResponse.json(
      {
        grant: result.grant,
        alreadyRevoked: result.alreadyRevoked,
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof AccessGrantError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.statusCode }
      );
    }

    console.error("Erro inesperado ao revogar acesso cortesia:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao revogar acesso cortesia." },
      { status: 500 }
    );
  }
}
