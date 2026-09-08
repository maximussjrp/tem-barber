import {
  Prisma,
  MarketingConsentStatus,
  MarketingConsentSource,
  CustomerMarketingConsent,
  CustomerMarketingConsentEvent,
} from "@prisma/client";
import {
  DEFAULT_CRM_CHANNEL,
  DEFAULT_CRM_PURPOSE,
  VirtualMarketingConsentStatus,
} from "./constants";

export interface RecordMarketingConsentParams {
  barbershopId: string;
  customerId: string;
  channel?: string;
  purpose?: string;
  status: MarketingConsentStatus;
  source: MarketingConsentSource;
  reason?: string | null;
  evidence?: string | null;
  eventKey: string;
  actorUserId?: string | null;
  actorMemberId?: string | null;
  occurredAt?: Date;
}

export interface RecordMarketingConsentResult {
  consent: CustomerMarketingConsent;
  event: CustomerMarketingConsentEvent;
  isDuplicateEvent: boolean;
}

export interface GetMarketingConsentStatusParams {
  barbershopId: string;
  customerId: string;
  channel?: string;
  purpose?: string;
}

export interface GetMarketingConsentStatusResult {
  status: VirtualMarketingConsentStatus;
  consent: CustomerMarketingConsent | null;
}

export interface GetCustomerConsentHistoryParams {
  barbershopId: string;
  customerId: string;
  channel?: string;
  purpose?: string;
}

/**
 * Registra ou atualiza o consentimento de marketing de um cliente com idempotência
 * e proteção de concorrência baseada em pg_advisory_xact_lock para evitar race conditions
 * quando não há linha inicial.
 */
export async function recordMarketingConsent(
  tx: Prisma.TransactionClient,
  params: RecordMarketingConsentParams
): Promise<RecordMarketingConsentResult> {
  const channel = params.channel ?? DEFAULT_CRM_CHANNEL;
  const purpose = params.purpose ?? DEFAULT_CRM_PURPOSE;
  const occurredAt = params.occurredAt ?? new Date();

  // Trava transacional no nível de advisory lock para garantir que concorrência na primeira inserção
  // (onde não existe linha para SELECT FOR UPDATE) seja estritamente serializada por escopo lógico.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('consent:' || ${params.barbershopId} || ':' || ${params.customerId} || ':' || ${channel} || ':' || ${purpose})
    )
  `;

  // Checa idempotência do evento pelo eventKey único do tenant
  const existingEvent = await tx.customerMarketingConsentEvent.findUnique({
    where: {
      barbershopId_eventKey: {
        barbershopId: params.barbershopId,
        eventKey: params.eventKey,
      },
    },
  });

  if (existingEvent) {
    // Validação de conflito de payload para mesma chave
    if (
      existingEvent.eventType !== params.status ||
      existingEvent.customerId !== params.customerId ||
      existingEvent.channel !== channel ||
      existingEvent.purpose !== purpose
    ) {
      throw new Error(
        "CONFLICTING_EVENT_KEY: Conflito de idempotência. Um evento com payload diferente já existe para esta eventKey."
      );
    }

    const existingConsent = await tx.customerMarketingConsent.findUnique({
      where: {
        barbershopId_customerId_channel_purpose: {
          barbershopId: params.barbershopId,
          customerId: params.customerId,
          channel,
          purpose,
        },
      },
    });

    if (!existingConsent) {
      throw new Error(
        `Inconsistent state: Consent event ${existingEvent.id} exists but consent aggregate is missing.`
      );
    }

    return {
      consent: existingConsent,
      event: existingEvent,
      isDuplicateEvent: true,
    };
  }

  // Cria o registro imutável do evento de auditoria
  const event = await tx.customerMarketingConsentEvent.create({
    data: {
      barbershopId: params.barbershopId,
      customerId: params.customerId,
      channel,
      purpose,
      eventType: params.status,
      source: params.source,
      reason: params.reason ?? null,
      evidence: params.evidence ?? null,
      eventKey: params.eventKey,
      actorUserId: params.actorUserId ?? null,
      actorMemberId: params.actorMemberId ?? null,
      occurredAt,
    },
  });

  // Upsert do estado consolidado de consentimento apontando para lastEventId
  const consent = await tx.customerMarketingConsent.upsert({
    where: {
      barbershopId_customerId_channel_purpose: {
        barbershopId: params.barbershopId,
        customerId: params.customerId,
        channel,
        purpose,
      },
    },
    create: {
      barbershopId: params.barbershopId,
      customerId: params.customerId,
      channel,
      purpose,
      status: params.status,
      source: params.source,
      evidence: params.evidence ?? null,
      lastEventId: event.id,
      optedOutAt: params.status === MarketingConsentStatus.OPTED_OUT ? occurredAt : null,
      lastConfirmedAt: params.status === MarketingConsentStatus.OPTED_IN ? occurredAt : null,
    },
    update: {
      status: params.status,
      source: params.source,
      evidence: params.evidence ?? null,
      lastEventId: event.id,
      optedOutAt:
        params.status === MarketingConsentStatus.OPTED_OUT
          ? occurredAt
          : undefined,
      lastConfirmedAt:
        params.status === MarketingConsentStatus.OPTED_IN
          ? occurredAt
          : undefined,
    },
  });

  return {
    consent,
    event,
    isDuplicateEvent: false,
  };
}

/**
 * Consulta o status atual de consentimento para o canal e finalidade.
 * Conforme frozen rule: NO_ROW_MEANS_UNKNOWN.
 * Smart CRM NUNCA infere consentimento a partir de agendamentos, visitas ou telefone.
 */
export async function getMarketingConsentStatus(
  prisma: Prisma.TransactionClient | Prisma.DefaultPrismaClient,
  params: GetMarketingConsentStatusParams
): Promise<GetMarketingConsentStatusResult> {
  const channel = params.channel ?? DEFAULT_CRM_CHANNEL;
  const purpose = params.purpose ?? DEFAULT_CRM_PURPOSE;

  const consent = await (prisma as Prisma.TransactionClient).customerMarketingConsent.findUnique({
    where: {
      barbershopId_customerId_channel_purpose: {
        barbershopId: params.barbershopId,
        customerId: params.customerId,
        channel,
        purpose,
      },
    },
  });

  if (!consent) {
    return {
      status: "UNKNOWN",
      consent: null,
    };
  }

  return {
    status: consent.status as VirtualMarketingConsentStatus,
    consent,
  };
}

/**
 * Retorna o histórico de eventos de consentimento de um cliente.
 */
export async function getCustomerConsentHistory(
  prisma: Prisma.TransactionClient | Prisma.DefaultPrismaClient,
  params: GetCustomerConsentHistoryParams
): Promise<CustomerMarketingConsentEvent[]> {
  const where: Prisma.CustomerMarketingConsentEventWhereInput = {
    barbershopId: params.barbershopId,
    customerId: params.customerId,
  };

  if (params.channel) {
    where.channel = params.channel;
  }
  if (params.purpose) {
    where.purpose = params.purpose;
  }

  return (prisma as Prisma.TransactionClient).customerMarketingConsentEvent.findMany({
    where,
    orderBy: {
      occurredAt: "desc",
    },
  });
}
