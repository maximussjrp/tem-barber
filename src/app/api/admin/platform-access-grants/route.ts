import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/subscription-utils";
import {
  createTenantAccessGrant,
  AccessGrantError,
} from "@/lib/billing/access-grants";

export async function POST(req: Request) {
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
        message: "Apenas administradores da plataforma podem conceder cortesias.",
      },
      { status: 403 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { barbershopId, daysGranted, reason, idempotencyKey } = body;

    if (!barbershopId || typeof barbershopId !== "string") {
      return NextResponse.json(
        { error: "BARBERSHOP_NOT_FOUND", message: "ID da barbearia é obrigatório." },
        { status: 400 }
      );
    }

    if (
      daysGranted === undefined ||
      daysGranted === null ||
      typeof daysGranted !== "number" ||
      !Number.isInteger(daysGranted) ||
      daysGranted < 1 ||
      daysGranted > 3650
    ) {
      return NextResponse.json(
        {
          error: "ACCESS_GRANT_INVALID_DAYS",
          message: "O número de dias deve ser um inteiro entre 1 e 3650.",
        },
        { status: 400 }
      );
    }

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return NextResponse.json(
        {
          error: "ACCESS_GRANT_REASON_REQUIRED",
          message: "O motivo da cortesia é obrigatório.",
        },
        { status: 400 }
      );
    }

    if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
      return NextResponse.json(
        {
          error: "ACCESS_GRANT_IDEMPOTENCY_KEY_REQUIRED",
          message: "A chave de idempotência é obrigatória.",
        },
        { status: 400 }
      );
    }

    const actorUserId = user.id || "platform-admin";

    const result = await createTenantAccessGrant({
      barbershopId,
      daysGranted,
      reason,
      idempotencyKey,
      actorUserId,
      actorEmail: email,
    });

    return NextResponse.json(
      {
        grant: result.grant,
        alreadyExisted: result.alreadyExisted,
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

    console.error("Erro inesperado ao criar acesso cortesia:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao criar acesso cortesia." },
      { status: 500 }
    );
  }
}
