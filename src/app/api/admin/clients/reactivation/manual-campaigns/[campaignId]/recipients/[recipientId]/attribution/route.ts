/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getRecipientAttributionDetail } from "@/lib/clients/reactivation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; recipientId: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  }

  const { campaignId, recipientId } = await params;
  if (!campaignId || !recipientId) {
    return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });
  }

  try {
    const detail = await getRecipientAttributionDetail(prisma, {
      barbershopId,
      campaignId,
      recipientId,
    });

    return NextResponse.json(
      {
        success: true,
        detail,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err.status === 404 || err.message?.startsWith("RECIPIENT_NOT_FOUND")) {
      return NextResponse.json(
        { error: "RECIPIENT_NOT_FOUND", message: "Destinatário não encontrado." },
        { status: 404 }
      );
    }
    console.error("Error retrieving recipient attribution detail:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao buscar detalhes de atribuição do destinatário." },
      { status: 500 }
    );
  }
}