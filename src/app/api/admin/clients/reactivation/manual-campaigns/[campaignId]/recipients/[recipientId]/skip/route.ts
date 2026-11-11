/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  skipManualRecipient,
  requireCrmQueueManageSession,
} from "@/lib/clients/reactivation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; recipientId: string }> }
) {
  const { error, data } = await requireCrmQueueManageSession(prisma);
  if (error) return error;

  const { campaignId, recipientId } = await params;
  if (!campaignId || !recipientId) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

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
      return skipManualRecipient(tx, {
        barbershopId: data.barbershopId,
        campaignId,
        recipientId,
        userId: data.userId,
        userRole: data.role,
        memberId: data.memberId ?? null,
        reason: body?.reason ?? null,
        reconciliation: body?.reconciliation ?? null,
      });
    });

    return NextResponse.json(
      {
        success: true,
        recipient: result.recipient,
        isReplay: result.isReplay,
        campaignStatus: result.campaignStatus,
        remainingPendingCount: result.remainingPendingCount,
      },
      { status: 200 }
    );
  } catch (err: any) {
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
        { error: "INVALID_TRANSITION", message: err.message },
        { status: 400 }
      );
    }
    console.error("Error skipping manual recipient:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao pular destinatário na fila." },
      { status: 500 }
    );
  }
}
