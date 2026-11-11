/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  revalidateAndOpenManualRecipient,
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
      return revalidateAndOpenManualRecipient(tx, {
        barbershopId,
        campaignId,
        recipientId,
        userId,
        userRole,
        memberId,
        templateKey: body?.templateKey,
        messageText: body?.messageText,
        reconciliation: body?.reconciliation ?? null,
        returnOutcomeOnStale: true,
      });
    });

    // R-09: Quando uma supressão ao vivo ocorre (STALE_*), a transação já comitou o novo status do destinatário
    if (result && result.ok === false) {
      return NextResponse.json(
        {
          error: result.code || "DISPATCH_INELIGIBLE",
          message: result.message,
          recipient: result.recipient,
          campaignStatus: result.campaignStatus,
          remainingPendingCount: result.remainingPendingCount,
        },
        { status: result.status || 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        whatsappUrl: result.whatsappUrl,
        recipient: result.recipient,
        isReplay: result.isReplay,
        openPreparationId: result.openPreparationId,
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
    if (err.code?.startsWith("STALE_") || err.status === 400) {
      return NextResponse.json(
        {
          error: err.code || "DISPATCH_INELIGIBLE",
          message: err.message,
          ...(err.recipient ? { recipient: err.recipient } : {}),
          ...(err.campaignStatus ? { campaignStatus: err.campaignStatus } : {}),
        },
        { status: 400 }
      );
    }
    console.error("Error opening recipient for WhatsApp:", err);
    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: "Erro ao validar e preparar abertura do WhatsApp.",
      },
      { status: 500 }
    );
  }
}
