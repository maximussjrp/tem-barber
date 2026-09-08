/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { getCampaignAttributionSummary } from "@/lib/clients/reactivation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  }

  const { campaignId } = await params;
  if (!campaignId) {
    return NextResponse.json({ error: "ID da campanha não informado." }, { status: 400 });
  }

  try {
    const summary = await getCampaignAttributionSummary(prisma, {
      barbershopId,
      campaignId,
    });

    return NextResponse.json(
      {
        success: true,
        summary,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err.status === 404 || err.message?.startsWith("CAMPAIGN_NOT_FOUND")) {
      return NextResponse.json(
        { error: "CAMPAIGN_NOT_FOUND", message: "Campanha não encontrada." },
        { status: 404 }
      );
    }
    console.error("Error retrieving campaign attribution summary:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao buscar sumário de atribuição da campanha." },
      { status: 500 }
    );
  }
}