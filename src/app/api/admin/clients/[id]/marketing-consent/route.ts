/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { MarketingConsentStatus, MarketingConsentSource } from "@prisma/client";
import { getAdminSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import {
  recordMarketingConsent,
  getMarketingConsentStatus,
  getCustomerConsentHistory,
  DEFAULT_CRM_CHANNEL,
  DEFAULT_CRM_PURPOSE,
} from "@/lib/clients/reactivation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  if (!barbershopId) {
    return NextResponse.json({ error: "Barbearia não encontrada." }, { status: 403 });
  }

  const { id: customerId } = await params;
  if (!customerId) {
    return NextResponse.json({ error: "ID do cliente é obrigatório." }, { status: 400 });
  }

  // Tenant validation: customer must be linked to barbershop
  const link = await prisma.customerBarbershopLink.findUnique({
    where: {
      barbershopId_customerId: {
        barbershopId,
        customerId,
      },
    },
  });

  if (!link) {
    // Check if customer exists in appointments or comandas of this shop
    const [hasAppt, hasComanda] = await Promise.all([
      prisma.appointment.findFirst({ where: { barbershopId, customerId } }),
      prisma.comanda.findFirst({ where: { barbershopId, customerId } }),
    ]);
    if (!hasAppt && !hasComanda) {
      return NextResponse.json({ error: "Cliente não encontrado na barbearia." }, { status: 404 });
    }
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
  const { error, data } = await getAdminSession();
  if (error) return error;

  const barbershopId = data?.barbershopId;
  const userId = data?.userId;
  if (!barbershopId || !userId) {
    return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  }

  const { id: customerId } = await params;
  if (!customerId) {
    return NextResponse.json({ error: "ID do cliente é obrigatório." }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido (JSON esperado)." }, { status: 400 });
  }

  const { status, source, reason, evidence, eventKey } = body;

  // Idempotency: eventKey is strictly required
  if (!eventKey || typeof eventKey !== "string" || !eventKey.trim()) {
    return NextResponse.json(
      { error: "INVALID_EVENT_KEY", message: "O campo eventKey é obrigatório para idempotência." },
      { status: 400 }
    );
  }

  if (!status || (status !== MarketingConsentStatus.OPTED_IN && status !== MarketingConsentStatus.OPTED_OUT)) {
    return NextResponse.json(
      { error: "INVALID_STATUS", message: "Status de consentimento inválido. Deve ser OPTED_IN ou OPTED_OUT." },
      { status: 400 }
    );
  }

  const validSources = Object.values(MarketingConsentSource);
  const consentSource = source && validSources.includes(source)
    ? (source as MarketingConsentSource)
    : MarketingConsentSource.CUSTOMER_REQUEST_WHATSAPP;

  // Verify customer belongs to tenant
  const customer = await prisma.user.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, phone: true },
  });

  if (!customer) {
    return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  }

  const link = await prisma.customerBarbershopLink.findUnique({
    where: {
      barbershopId_customerId: {
        barbershopId,
        customerId,
      },
    },
  });

  if (!link) {
    // Check if customer exists in appointments or comandas
    const [hasAppt, hasComanda] = await Promise.all([
      prisma.appointment.findFirst({ where: { barbershopId, customerId } }),
      prisma.comanda.findFirst({ where: { barbershopId, customerId } }),
    ]);
    if (!hasAppt && !hasComanda) {
      return NextResponse.json({ error: "Cliente não vinculado a esta barbearia." }, { status: 404 });
    }
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
    if (existingEvent.customerId !== customerId || existingEvent.eventType !== status) {
      return NextResponse.json(
        {
          error: "EVENT_KEY_CONFLICT",
          message: "O eventKey informado já foi utilizado com um payload conflitante.",
        },
        { status: 409 }
      );
    }
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      return recordMarketingConsent(tx, {
        barbershopId,
        customerId,
        channel: DEFAULT_CRM_CHANNEL,
        purpose: DEFAULT_CRM_PURPOSE,
        status: status as MarketingConsentStatus,
        source: consentSource,
        reason: reason?.trim() || null,
        evidence: evidence?.trim() || null,
        eventKey: eventKey.trim(),
        actorUserId: userId,
        actorMemberId: data?.memberId ?? null,
      });
    });

    return NextResponse.json({
      success: true,
      consent: result.consent,
      event: result.event,
      isDuplicateEvent: result.isDuplicateEvent,
    }, { status: 200 });
  } catch (err: any) {
    console.error("Error recording marketing consent:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Erro ao registrar consentimento." },
      { status: 500 }
    );
  }
}
