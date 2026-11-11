/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  confirmManualRecipientSend,
  resolveTenantUserSession,
} from "@/lib/clients/reactivation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; recipientId: string }> }
) {
  const { campaignId, recipientId } = await params;
  if (!campaignId || !recipientId) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  const sessionAuth = await resolveTenantUserSession(prisma);
  if (sessionAuth.error) return sessionAuth.error;
  if (!sessionAuth.data?.barbershopId || !sessionAuth.data?.userId) {
    return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  }

  const barbershopId = sessionAuth.data.barbershopId;
  const userId = sessionAuth.data.userId;
  const userRole = sessionAuth.data.role;
  const memberId = sessionAuth.data.memberId ?? null;

  let body: any = {};
  try {
    const rawText = await request.text();
    if (rawText && rawText.trim().length > 0) {
      body = JSON.parse(rawText);
    }
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "Corpo da requisição JSON inválido." },
      { status: 400 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      return confirmManualRecipientSend(tx, {
        barbershopId,
        campaignId,
        recipientId,
        userId,
        userRole,
        memberId,
        openPreparationId: body?.openPreparationId ?? null,
        reconciliation: body?.reconciliation ?? null,
      });
    });

    return NextResponse.json(
      {
        success: true,
        recipient: result.recipient,
        contactLog: result.contactLog,
        isExisting: result.isExisting,
        postOpenWarning: result.postOpenWarning ?? null,
        campaignStatus: result.campaignStatus,
        remainingPendingCount: result.remainingPendingCount,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err.status === 403 || err.code === "FORBIDDEN" || err.code === "PERMISSION_DENIED") {
      return NextResponse.json(
        { error: err.code || "FORBIDDEN", message: err.message },
        { status: 403 }
      );
    }
    if (err.status === 404) {
      return NextResponse.json(
        { error: "RECIPIENT_NOT_FOUND", message: err.message },
        { status: 404 }
      );
    }
    if (err.status === 409) {
      return NextResponse.json(
        {
          error: err.code || "CONFLICT",
          message: err.message,
          ...(err.lease ? { lease: err.lease } : {}),
        },
        { status: 409 }
      );
    }
    if (
      err.status === 400 ||
      err.message?.includes("Invalid recipient dispatch status transition")
    ) {
      return NextResponse.json(
        { error: err.code || "INVALID_TRANSITION", message: err.message },
        { status: 400 }
      );
    }
    console.error("Error confirming manual recipient send:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao confirmar envio manual." },
      { status: 500 }
    );
  }
}
