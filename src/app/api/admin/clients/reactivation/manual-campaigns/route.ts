/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { prepareManualReactivationCampaign } from "@/lib/clients/reactivation";

export async function POST(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  const userId = data?.userId;
  if (!barbershopId || !userId) {
    return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido (JSON esperado)." }, { status: 400 });
  }

  const { requestKey, selectedCustomerIds, templateKey, name } = body;

  if (!requestKey || typeof requestKey !== "string" || !requestKey.trim()) {
    return NextResponse.json(
      { error: "INVALID_REQUEST_KEY", message: "O campo requestKey é obrigatório para idempotência." },
      { status: 400 }
    );
  }

  if (!Array.isArray(selectedCustomerIds) || selectedCustomerIds.length === 0) {
    return NextResponse.json(
      { error: "EMPTY_SELECTION", message: "Selecione ao menos um cliente para preparar os contatos." },
      { status: 400 }
    );
  }

  if (selectedCustomerIds.length > 50) {
    return NextResponse.json(
      { error: "BATCH_LIMIT_EXCEEDED", message: "O limite máximo por lote é de 50 contatos." },
      { status: 400 }
    );
  }

  if (!templateKey || typeof templateKey !== "string") {
    return NextResponse.json(
      { error: "INVALID_TEMPLATE", message: "O campo templateKey é obrigatório." },
      { status: 400 }
    );
  }

  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const baseUrl = host ? `${proto}://${host}` : process.env.NEXTAUTH_URL || "";

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      return prepareManualReactivationCampaign(tx, {
        barbershopId,
        userId,
        memberId: data?.memberId ?? null,
        requestKey: requestKey.trim(),
        selectedCustomerIds,
        templateKey: templateKey.trim(),
        name: name?.trim() || undefined,
        baseUrl,
      });
    });

    return NextResponse.json(
      {
        success: true,
        campaign: result.campaign,
        accepted: result.accepted,
        rejected: result.rejected,
        isExisting: result.isExisting,
      },
      { status: result.isExisting ? 200 : 201 }
    );
  } catch (err: any) {
    if (err.code === "CONFLICT" || err.status === 409) {
      return NextResponse.json(
        { error: "REQUEST_KEY_CONFLICT", message: err.message },
        { status: 409 }
      );
    }
    if (err.message?.startsWith("INVALID_") || err.message?.startsWith("BATCH_") || err.message?.startsWith("EMPTY_")) {
      return NextResponse.json({ error: "BAD_REQUEST", message: err.message }, { status: 400 });
    }
    console.error("Error preparing manual campaign:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao preparar lote de contatos." },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  const userRole = data?.role;
  if (!barbershopId || userRole === "BARBER") {
    return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get("limit") || "20", 10);
  const limit = Math.max(1, Math.min(isNaN(limitParam) ? 20 : limitParam, 50));
  const cursor = searchParams.get("cursor");

  try {
    const campaigns = await prisma.reactivationCampaign.findMany({
      where: { barbershopId },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        recipients: {
          select: {
            id: true,
            dispatchStatus: true,
            conversionStatus: true,
            revenueAttributed: true,
          },
        },
      },
    });

    let nextCursor: string | null = null;
    let items = campaigns;
    if (campaigns.length > limit) {
      const nextItem = campaigns[limit];
      nextCursor = nextItem.id;
      items = campaigns.slice(0, limit);
    }

    const formattedItems = items.map((c: any) => {
      const contacts = c.recipients.filter((r: any) => r.dispatchStatus === "SENT_CONFIRMED").length;
      const reactivated = c.recipients.filter((r: any) =>
        r.conversionStatus === "REVENUE_ATTRIBUTED" ||
        r.conversionStatus === "ATTENDED" ||
        r.conversionStatus === "DIRECT_RETURN"
      ).length;
      const totalRevenue = c.recipients.reduce((acc: number, r: any) => {
        return acc + (r.revenueAttributed ? Number(r.revenueAttributed) : 0);
      }, 0);

      return {
        id: c.id,
        name: c.name,
        channel: c.channel,
        status: c.status,
        scoreVersion: c.scoreVersion,
        recurrenceVersion: c.recurrenceVersion,
        attributionVersion: c.attributionVersion,
        bookingAttributionWindowDays: c.bookingAttributionWindowDays,
        directReturnWindowDays: c.directReturnWindowDays,
        cooldownDays: c.cooldownDays,
        totalRecipients: c.totalRecipients || c.recipients.length,
        contacts,
        reactivatedCustomers: reactivated,
        recoveredRevenue: totalRevenue,
        createdAt: c.createdAt.toISOString(),
        completedAt: c.completedAt ? c.completedAt.toISOString() : null,
      };
    });

    return NextResponse.json({
      success: true,
      items: formattedItems,
      nextCursor,
    });
  } catch (err: any) {
    if (err.code === "P2025") {
      return NextResponse.json(
        { error: "INVALID_CURSOR", message: "Cursor de paginação inválido ou não encontrado." },
        { status: 400 }
      );
    }
    console.error("Error listing reactivation campaigns:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao listar campanhas de reativação." },
      { status: 500 }
    );
  }
}

