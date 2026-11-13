/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import {
  prepareManualReactivationCampaign,
  requireCrmQueueManageSession,
  requireCrmQueueViewSession,
  resolveCampaignOrigin,
  type ManualCampaignOrigin,
} from "@/lib/clients/reactivation";

export async function POST(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corpo da requisição inválido (JSON esperado)." },
      { status: 400 }
    );
  }

  const {
    requestKey,
    selectedCustomerIds,
    templateKey,
    name,
    origin,
    operationMode,
    sourceFilter,
    workRoundId,
  } = body;

  const isAssistedQueue = origin === "CLIENTS_BASE_ASSISTED_QUEUE";

  // G21-04: Separação de autorização conforme a origem da operação.
  // Fila Assistida exige estritamente OWNER ou MANAGER com CLIENTS_MANAGE efetiva (DEC-02 = A).
  // Campanhas legadas do Smart CRM preservam o contrato de autenticação existente.
  let barbershopId: string;
  let userId: string;
  let memberId: string | null = null;

  if (isAssistedQueue) {
    const queueAuth = await requireCrmQueueManageSession(prisma);
    if (queueAuth.error) return queueAuth.error;
    barbershopId = queueAuth.data.barbershopId;
    userId = queueAuth.data.userId;
    memberId = queueAuth.data.memberId ?? null;
  } else {
    const adminAuth = await getAdminSession();
    if (adminAuth.error) return adminAuth.error;
    if (!adminAuth.data?.barbershopId || !adminAuth.data?.userId) {
      return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
    }
    barbershopId = adminAuth.data.barbershopId;
    userId = adminAuth.data.userId;
    memberId = adminAuth.data.memberId ?? null;
  }

  if (!requestKey || typeof requestKey !== "string" || !requestKey.trim()) {
    return NextResponse.json(
      {
        error: "INVALID_REQUEST_KEY",
        message: "O campo requestKey é obrigatório para idempotência.",
      },
      { status: 400 }
    );
  }

  if (!Array.isArray(selectedCustomerIds) || selectedCustomerIds.length === 0) {
    return NextResponse.json(
      {
        error: "EMPTY_SELECTION",
        message: "Selecione ao menos um cliente para preparar os contatos.",
      },
      { status: 400 }
    );
  }

  if (selectedCustomerIds.length > 50) {
    return NextResponse.json(
      {
        error: "BATCH_LIMIT_EXCEEDED",
        message: "O limite máximo por lote é de 50 contatos.",
      },
      { status: 400 }
    );
  }

  if (!templateKey || typeof templateKey !== "string") {
    return NextResponse.json(
      { error: "INVALID_TEMPLATE", message: "O campo templateKey é obrigatório." },
      { status: 400 }
    );
  }

  const host =
    request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const baseUrl = host ? `${proto}://${host}` : process.env.NEXTAUTH_URL || "";

  const normalizedOrigin: ManualCampaignOrigin =
    origin === "CLIENTS_BASE_ASSISTED_QUEUE"
      ? "CLIENTS_BASE_ASSISTED_QUEUE"
      : "SMART_CRM_REACTIVATION";

  try {
    const result = await prisma.$transaction(async (tx) => {
      return prepareManualReactivationCampaign(tx, {
        barbershopId,
        userId,
        memberId,
        requestKey: requestKey.trim(),
        selectedCustomerIds,
        templateKey: templateKey.trim(),
        name: name?.trim() || undefined,
        baseUrl,
        origin: normalizedOrigin,
        ...(operationMode === "ASSISTED_QUEUE" || operationMode === "MARKETING_CAMPAIGN"
          ? { operationMode }
          : {}),
        sourceFilter: sourceFilter ?? null,
        workRoundId: workRoundId ?? null,
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
    if (err.code === "ACTIVE_QUEUE_ALREADY_EXISTS") {
      return NextResponse.json(
        {
          error: "ACTIVE_QUEUE_ALREADY_EXISTS",
          message: err.message,
          activeCampaignId: err.activeCampaignId,
        },
        { status: 409 }
      );
    }
    if (err.code === "CONFLICT" || err.status === 409) {
      return NextResponse.json(
        { error: "REQUEST_KEY_CONFLICT", message: err.message },
        { status: 409 }
      );
    }
    if (
      err.message?.startsWith("INVALID_") ||
      err.message?.startsWith("BATCH_") ||
      err.message?.startsWith("EMPTY_")
    ) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: err.message },
        { status: 400 }
      );
    }
    console.error("Error preparing manual campaign:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao preparar lote de contatos." },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = parseInt(searchParams.get("limit") || "20", 10);
  const limit = Math.max(1, Math.min(isNaN(limitParam) ? 20 : limitParam, 50));
  const cursor = searchParams.get("cursor");
  const originFilter = searchParams.get("origin") || "SMART_CRM_REACTIVATION";
  const isAssistedQueue = originFilter === "CLIENTS_BASE_ASSISTED_QUEUE";

  // G21-04: Separação de políticas conforme a origem consultada.
  // Fila Assistida exige estritamente OWNER ou MANAGER com CLIENTS_MANAGE efetiva.
  // Listagem legada do Smart CRM preserva autorização original (bloqueia apenas BARBER).
  let barbershopId: string;

  if (isAssistedQueue) {
    const queueAuth = await requireCrmQueueViewSession(prisma);
    if (queueAuth.error) return queueAuth.error;
    barbershopId = queueAuth.data.barbershopId;
  } else {
    const adminAuth = await getAdminSession();
    if (adminAuth.error) return adminAuth.error;
    const userRole = adminAuth.data?.role;
    if (!adminAuth.data?.barbershopId || userRole === "BARBER") {
      return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
    }
    barbershopId = adminAuth.data.barbershopId;
  }

  try {
    const whereClause: Prisma.ReactivationCampaignWhereInput = { barbershopId };
    if (isAssistedQueue) {
      whereClause.targetSegment = {
        path: ["origin"],
        equals: "CLIENTS_BASE_ASSISTED_QUEUE",
      };
    } else {
      // G21-06 / G22-03: Suporta todas as variações de campanhas legadas em PostgreSQL JSON:
      // 1) targetSegment vazio {}
      // 2) sem propriedade origin (DbNull)
      // 3) com origin: null (JsonNull)
      // 4) com origin: "SMART_CRM_REACTIVATION"
      // 5) qualquer outro targetSegment não igual a CLIENTS_BASE_ASSISTED_QUEUE
      whereClause.OR = [
        { targetSegment: { equals: {} } },
        { targetSegment: { path: ["origin"], equals: Prisma.DbNull } },
        { targetSegment: { path: ["origin"], equals: Prisma.JsonNull } },
        { targetSegment: { path: ["origin"], equals: "SMART_CRM_REACTIVATION" } },
        {
          NOT: {
            targetSegment: {
              path: ["origin"],
              equals: "CLIENTS_BASE_ASSISTED_QUEUE",
            },
          },
        },
      ];
    }

    const campaigns = await prisma.reactivationCampaign.findMany({
      where: whereClause,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
      items = campaigns.slice(0, limit);
      nextCursor = items[items.length - 1].id;
    }

    const formattedItems = items.map((c: any) => {
      const campOrigin = resolveCampaignOrigin(c);
      const isGeneralQueue = campOrigin === "CLIENTS_BASE_ASSISTED_QUEUE";
      const contacts = (c.recipients || []).filter(
        (r: any) => r.dispatchStatus === "SENT_CONFIRMED"
      ).length;
      const reactivated = isGeneralQueue
        ? 0
        : (c.recipients || []).filter(
            (r: any) =>
              r.conversionStatus === "REVENUE_ATTRIBUTED" ||
              r.conversionStatus === "ATTENDED" ||
              r.conversionStatus === "DIRECT_RETURN"
          ).length;
      const totalRevenue = isGeneralQueue
        ? 0
        : (c.recipients || []).reduce((acc: number, r: any) => {
            return acc + (r.revenueAttributed ? Number(r.revenueAttributed) : 0);
          }, 0);

      return {
        id: c.id,
        name: c.name,
        channel: c.channel,
        status: c.status,
        origin: campOrigin,
        scoreVersion: c.scoreVersion,
        recurrenceVersion: c.recurrenceVersion,
        attributionVersion: c.attributionVersion,
        bookingAttributionWindowDays: c.bookingAttributionWindowDays,
        directReturnWindowDays: c.directReturnWindowDays,
        cooldownDays: c.cooldownDays,
        totalRecipients: c.totalRecipients || (c.recipients || []).length,
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
        {
          error: "INVALID_CURSOR",
          message: "Cursor de paginação inválido ou não encontrado.",
        },
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
