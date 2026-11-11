/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { MarketingConsentStatus, MarketingConsentSource } from "@prisma/client";
import { getOperationalStaffSession } from "@/lib/operational-session";
import prisma from "@/lib/prisma";
import {
  recordMarketingConsent,
  getMarketingConsentStatus,
  getCustomerConsentHistory,
  DEFAULT_CRM_CHANNEL,
  DEFAULT_CRM_PURPOSE,
} from "@/lib/clients/reactivation";
import { requireCrmQueueSession } from "@/lib/clients/reactivation/crm-queue-auth";

async function hasCanonicalTenantAccess(
  barbershopId: string,
  customerId: string
): Promise<boolean> {
  const link = await prisma.customerBarbershopLink.findUnique({
    where: {
      barbershopId_customerId: {
        barbershopId,
        customerId,
      },
    },
  });
  if (link) return true;

  const clubDelegate = (prisma as any).customerClubSubscription;
  const [hasAppt, hasComanda, hasClub] = await Promise.all([
    prisma.appointment.findFirst({ where: { barbershopId, customerId } }),
    prisma.comanda.findFirst({ where: { barbershopId, customerId } }),
    typeof clubDelegate?.findFirst === "function"
      ? clubDelegate.findFirst({ where: { barbershopId, customerId } })
      : Promise.resolve(null),
  ]);

  return Boolean(hasAppt || hasComanda || hasClub);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getOperationalStaffSession({
    requiredPermission: "CLIENTS_VIEW",
  });
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 403 });
  }

  const { id: customerId } = await params;
  if (!customerId) {
    return NextResponse.json({ error: "ID do cliente é obrigatório." }, { status: 400 });
  }

  const linked = await hasCanonicalTenantAccess(barbershopId, customerId);
  if (!linked) {
    return NextResponse.json(
      { error: "Cliente não encontrado na barbearia." },
      { status: 404 }
    );
  }

  const [statusResult, history] = await Promise.all([
    getMarketingConsentStatus(prisma, {
      barbershopId,
      customerId,
      channel: DEFAULT_CRM_CHANNEL,
      purpose: DEFAULT_CRM_PURPOSE,
    }),
    getCustomerConsentHistory(prisma, {
      barbershopId,
      customerId,
      channel: DEFAULT_CRM_CHANNEL,
      purpose: DEFAULT_CRM_PURPOSE,
    }),
  ]);

  return NextResponse.json({
    status: statusResult.status,
    consent: statusResult.consent,
    history,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: customerId } = await params;
  if (!customerId) {
    return NextResponse.json({ error: "ID do cliente é obrigatório." }, { status: 400 });
  }

  // G24-01 / DEC-05: Toda mutação de consentimento exige estritamente permissão efetiva CLIENTS_MANAGE,
  // independentemente de context, origin ou source no payload.
  // WHATSAPP_ASSISTED_OPERATE isolada NÃO autoriza registrar ou alterar consentimento.
  const consentAuth = await requireCrmQueueSession({
    requiredPermission: "CLIENTS_MANAGE",
    db: prisma,
  });
  if (consentAuth.error) return consentAuth.error;

  const barbershopId = consentAuth.data.barbershopId;
  const userId = consentAuth.data.userId;
  const memberId = consentAuth.data.memberId ?? null;

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
    status,
    source,
    reason,
    evidence,
    eventKey,
    context,
    declaredPriorAuthorization,
  } = body;

  // Idempotency: eventKey is strictly required
  if (!eventKey || typeof eventKey !== "string" || !eventKey.trim()) {
    return NextResponse.json(
      {
        error: "INVALID_EVENT_KEY",
        message: "O campo eventKey é obrigatório para idempotência.",
      },
      { status: 400 }
    );
  }

  if (
    !status ||
    (status !== MarketingConsentStatus.OPTED_IN &&
      status !== MarketingConsentStatus.OPTED_OUT)
  ) {
    return NextResponse.json(
      {
        error: "INVALID_STATUS",
        message: "Status de consentimento inválido. Deve ser OPTED_IN ou OPTED_OUT.",
      },
      { status: 400 }
    );
  }

  // Verify customer exists and belongs to tenant across all 4 canonical sources (R-02)
  const customer = await prisma.user.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, phone: true },
  });

  if (!customer) {
    return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  }

  const linked = await hasCanonicalTenantAccess(barbershopId, customerId);
  if (!linked) {
    return NextResponse.json(
      { error: "Cliente não vinculado a esta barbearia." },
      { status: 404 }
    );
  }

  // Check conflicting eventKey with different payload
  const existingEvent = await prisma.customerMarketingConsentEvent.findUnique({
    where: {
      barbershopId_eventKey: {
        barbershopId,
        eventKey: eventKey.trim(),
      },
    },
  });

  if (existingEvent) {
    if (
      existingEvent.customerId !== customerId ||
      existingEvent.eventType !== status
    ) {
      return NextResponse.json(
        {
          error: "EVENT_KEY_CONFLICT",
          message:
            "O eventKey informado já foi utilizado com um payload conflitante.",
        },
        { status: 409 }
      );
    }
  }

  const validSources = Object.values(MarketingConsentSource);

  // DEC-03 = A / G1-C12: Proíbe consentimento presumido ou fallback silencioso para OPTED_IN
  if (status === MarketingConsentStatus.OPTED_IN) {
    if (!source || !validSources.includes(source)) {
      return NextResponse.json(
        {
          error: "INVALID_CONSENT_SOURCE",
          message:
            "A origem comprovada do consentimento (source) é obrigatória para registrar OPTED_IN.",
        },
        { status: 400 }
      );
    }

    const requiresExplicitProof =
      context === "ASSISTED_QUEUE_DRAWER" ||
      declaredPriorAuthorization !== undefined ||
      source === MarketingConsentSource.ADMIN_WITH_PROOF ||
      evidence !== undefined;

    if (requiresExplicitProof) {
      if (
        (context === "ASSISTED_QUEUE_DRAWER" ||
          declaredPriorAuthorization !== undefined) &&
        declaredPriorAuthorization !== true
      ) {
        return NextResponse.json(
          {
            error: "PRIOR_AUTHORIZATION_DECLARATION_REQUIRED",
            message:
              "É obrigatório confirmar expressamente que a autorização prévia já foi obtida do cliente.",
          },
          { status: 400 }
        );
      }

      const trimmedEvidence = String(evidence ?? reason ?? "").trim();
      if (trimmedEvidence.length < 10) {
        return NextResponse.json(
          {
            error: "CONSENT_EVIDENCE_REQUIRED",
            message:
              "Informe a evidência de como a autorização do cliente foi obtida (mínimo de 10 caracteres).",
          },
          { status: 400 }
        );
      }
    }
  }

  const consentSource =
    source && validSources.includes(source)
      ? (source as MarketingConsentSource)
      : MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP;

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      return recordMarketingConsent(tx, {
        barbershopId,
        customerId,
        channel: DEFAULT_CRM_CHANNEL,
        purpose: DEFAULT_CRM_PURPOSE,
        status: status as MarketingConsentStatus,
        source: consentSource,
        reason: reason?.trim() || evidence?.trim() || null,
        evidence: evidence?.trim() || reason?.trim() || null,
        eventKey: eventKey.trim(),
        actorUserId: userId,
        actorMemberId: memberId,
      });
    });

    return NextResponse.json(
      {
        success: true,
        consent: result.consent,
        event: result.event,
        isDuplicateEvent: result.isDuplicateEvent,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Error recording marketing consent:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao registrar consentimento." },
      { status: 500 }
    );
  }
}
