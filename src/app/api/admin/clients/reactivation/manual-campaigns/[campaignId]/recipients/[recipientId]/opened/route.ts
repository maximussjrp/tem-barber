/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { revalidateAndOpenManualRecipient } from "@/lib/clients/reactivation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; recipientId: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  const userId = data?.userId;
  if (!barbershopId || !userId) {
    return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  }

  const { campaignId, recipientId } = await params;
  if (!campaignId || !recipientId) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      return revalidateAndOpenManualRecipient(tx, {
        barbershopId,
        campaignId,
        recipientId,
        userId,
        memberId: data?.memberId ?? null,
      });
    });

    return NextResponse.json(
      {
        success: true,
        whatsappUrl: result.whatsappUrl,
        recipient: result.recipient,
        isReplay: result.isReplay,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err.status === 404) {
      return NextResponse.json({ error: "RECIPIENT_NOT_FOUND", message: err.message }, { status: 404 });
    }
    if (err.code?.startsWith("STALE_") || err.status === 400) {
      return NextResponse.json(
        { error: err.code || "DISPATCH_INELIGIBLE", message: err.message },
        { status: 400 }
      );
    }
    console.error("Error opening recipient for WhatsApp:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao validar e preparar abertura do WhatsApp." },
      { status: 500 }
    );
  }
}
