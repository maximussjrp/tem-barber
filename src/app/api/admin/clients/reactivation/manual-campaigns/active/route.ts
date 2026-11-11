import { NextRequest, NextResponse } from "next/server";
import { RecipientDispatchStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  getActiveManualCampaign,
  requireCrmQueueViewSession,
  type ManualCampaignOrigin,
} from "@/lib/clients/reactivation";
import { resolveUiQueuePermissions } from "@/lib/clients/reactivation/crm-queue-auth";

/**
 * GET /api/admin/clients/reactivation/manual-campaigns/active
 * Estritamente read-only (G1-C05): retorna a campanha assistida ativa com destinatários pendentes
 * e os dados persistidos da rodada de trabalho vigente (G21-03).
 */
export async function GET(request: NextRequest) {
  const { error, data } = await requireCrmQueueViewSession(prisma);
  if (error) return error;

  const sp = request.nextUrl.searchParams;
  const originParam = sp.get("origin");

  // G23-01: Endpoint /active é restrito exclusivamente à fila assistida (CLIENTS_BASE_ASSISTED_QUEUE)
  if (originParam && originParam !== "CLIENTS_BASE_ASSISTED_QUEUE") {
    return NextResponse.json(
      {
        error: "INVALID_ORIGIN",
        code: "INVALID_ORIGIN",
        message:
          "O endpoint /active é restrito exclusivamente à fila assistida (CLIENTS_BASE_ASSISTED_QUEUE). Não é permitido consultar campanhas legadas por esta rota.",
      },
      { status: 400 }
    );
  }
  const origin: ManualCampaignOrigin = "CLIENTS_BASE_ASSISTED_QUEUE";
  const requestedRoundId = sp.get("workRoundId");

  try {
    const activeCampaign = await getActiveManualCampaign(prisma, {
      barbershopId: data.barbershopId,
      origin,
      currentUserId: data.userId,
    });

    let effectiveWorkRoundId =
      requestedRoundId || (activeCampaign?.workRoundId as string | undefined);

    // Se não veio pelo activeCampaign nem pela query, consulta a campanha mais recente da fila assistida
    if (!effectiveWorkRoundId && origin === "CLIENTS_BASE_ASSISTED_QUEUE") {
      const latestQueueCamp = await prisma.reactivationCampaign.findFirst({
        where: {
          barbershopId: data.barbershopId,
          targetSegment: {
            path: ["origin"],
            equals: "CLIENTS_BASE_ASSISTED_QUEUE",
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { targetSegment: true },
      });
      if (latestQueueCamp?.targetSegment) {
        effectiveWorkRoundId = (
          latestQueueCamp.targetSegment as Record<string, unknown>
        )?.workRoundId as string | undefined;
      }
    }

    let workRoundInfo: {
      workRoundId: string;
      processedCustomerIds: string[];
      skippedCustomerIds: string[];
      sentCustomerIds: string[];
    } | null = null;

    if (effectiveWorkRoundId && origin === "CLIENTS_BASE_ASSISTED_QUEUE") {
      const roundRecipients = await prisma.reactivationCampaignRecipient.findMany({
        where: {
          barbershopId: data.barbershopId,
          campaign: {
            targetSegment: {
              path: ["workRoundId"],
              equals: effectiveWorkRoundId,
            },
          },
          dispatchStatus: {
            in: [
              RecipientDispatchStatus.SENT_CONFIRMED,
              RecipientDispatchStatus.EXCLUDED,
            ],
          },
        },
        select: {
          customerId: true,
          dispatchStatus: true,
          failureReason: true,
        },
      });

      workRoundInfo = {
        workRoundId: effectiveWorkRoundId,
        processedCustomerIds: Array.from(
          new Set((roundRecipients || []).map((r) => r.customerId))
        ),
        skippedCustomerIds: (roundRecipients || [])
          .filter((r) => r.failureReason === "SKIPPED_BY_USER")
          .map((r) => r.customerId),
        sentCustomerIds: (roundRecipients || [])
          .filter((r) => r.dispatchStatus === RecipientDispatchStatus.SENT_CONFIRMED)
          .map((r) => r.customerId),
      };
    }

    const permissions = await resolveUiQueuePermissions({
      userId: data.userId,
      role: data.role,
      memberId: data.memberId ?? null,
      barbershopId: data.barbershopId,
      db: prisma,
    });

    return NextResponse.json(
      {
        success: true,
        barbershopId: data.barbershopId,
        permissions,
        activeCampaign,
        workRound: workRoundInfo,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error fetching active manual campaign:", err);
    return NextResponse.json(
      {
        error: "INTERNAL_ERROR",
        message: "Erro ao consultar fila assistida ativa.",
      },
      { status: 500 }
    );
  }
}
