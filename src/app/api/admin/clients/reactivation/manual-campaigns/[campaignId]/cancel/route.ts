/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  cancelManualCampaign,
  requireCrmQueueManageSession,
} from "@/lib/clients/reactivation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { error, data } = await requireCrmQueueManageSession(prisma);
  if (error) return error;

  const { campaignId } = await params;
  if (!campaignId) {
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
      return cancelManualCampaign(tx, {
        barbershopId: data.barbershopId,
        campaignId,
        userId: data.userId,
        userRole: data.role,
        memberId: data.memberId ?? null,
        reason: body?.reason ?? null,
      });
    });

    return NextResponse.json(
      {
        success: true,
        campaign: result.campaign,
        cancelledRecipientsCount: result.cancelledRecipientsCount,
        isReplay: result.isReplay,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err.status === 404) {
      return NextResponse.json(
        { error: "CAMPAIGN_NOT_FOUND", message: err.message },
        { status: 404 }
      );
    }
    if (
      err.status === 400 ||
      err.message?.includes("Invalid campaign status transition")
    ) {
      return NextResponse.json(
        { error: "INVALID_TRANSITION", message: err.message },
        { status: 400 }
      );
    }
    console.error("Error cancelling manual campaign:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao cancelar a fila assistida." },
      { status: 500 }
    );
  }
}
