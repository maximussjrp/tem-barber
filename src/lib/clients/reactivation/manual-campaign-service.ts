/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "crypto";
import {
  Prisma,
  CampaignStatus,
  RecipientDispatchStatus,
  CustomerTimingState,
} from "@prisma/client";
import {
  validateBrazilianMobilePhone,
  normalizeBrazilianMobilePhone,
} from "@/lib/phone/br-phone";
import { phoneBlockVariants } from "@/lib/customers";
import { generateWhatsAppLink } from "@/lib/whatsapp";
import {
  WHATSAPP_TEMPLATES,
  buildClientWhatsappMessage,
} from "@/lib/customer-whatsapp-templates";
import {
  assertValidCampaignTransition,
  assertValidDispatchTransition,
} from "./state-machines";
import { createReactivationContactLog } from "./campaign-contacts";
import { getSaoPauloCivilDateString } from "./canonical-visit-engine";
import { DEFAULT_CRM_CHANNEL, DEFAULT_CRM_PURPOSE } from "./constants";
import { checkCrmQueuePermission } from "./crm-queue-auth";

export type ManualCampaignOrigin =
  | "SMART_CRM_REACTIVATION"
  | "CLIENTS_BASE_ASSISTED_QUEUE";

export const RECIPIENT_OPEN_LEASE_TTL_MS = 5 * 60 * 1000; // 5 minutes (S-01)

/**
 * G3.1: Cliente Prisma estritamente tipado para as operações da fila assistida.
 * Substitui a assinatura permissiva `Prisma.TransactionClient | any`, permitindo que o
 * `tsc --noEmit` rejeite relações/colunas inexistentes (ex.: BUG-G3-01 / BUG-G3-03).
 * O PrismaClient completo também é estruturalmente compatível com este tipo.
 */
export type ManualCampaignDb = Prisma.TransactionClient;

/**
 * G3.1 / BUG-G3-03: O schema de ReactivationCampaignRecipient não possui coluna própria
 * para o instante de abertura do WhatsApp. O momento da PRIMEIRA abertura é persistido em
 * `payloadSnapshot.whatsappOpenedAt` (ISO-8601) e a última abertura em `payloadSnapshot.lastOpenedAt`.
 * Destinatários antigos sem esses campos retornam `null` (compatibilidade retroativa).
 */
export function resolveRecipientWhatsappOpenedAt(
  payloadSnapshot: Prisma.JsonValue | null | undefined
): Date | null {
  if (!payloadSnapshot || typeof payloadSnapshot !== "object" || Array.isArray(payloadSnapshot)) {
    return null;
  }
  const payload = payloadSnapshot as Record<string, unknown>;
  const raw =
    typeof payload.whatsappOpenedAt === "string"
      ? payload.whatsappOpenedAt
      : typeof payload.lastOpenedAt === "string"
        ? payload.lastOpenedAt
        : null;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface OperatorTransferReconciliationInput {
  confirmedReconciliation: boolean;
  reason: string;
}

export interface PrepareManualCampaignInput {
  barbershopId: string;
  userId?: string;
  operatorUserId?: string;
  memberId?: string | null;
  operatorMemberId?: string | null;
  requestKey: string;
  selectedCustomerIds: string[];
  templateKey: string;
  name?: string;
  baseUrl?: string;
  origin?: ManualCampaignOrigin;
  sourceFilter?: string | null;
  workRoundId?: string | null;
  excludeCustomerIds?: string[];
}

export interface PrepareManualCampaignResult {
  campaign: any;
  accepted: Array<{
    recipientId: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    dispatchStatus: RecipientDispatchStatus;
    previewMessage: string;
    timingState: CustomerTimingState;
    score: number;
    queueIndex?: number;
  }>;
  rejected: Array<{
    customerId: string;
    customerName: string;
    reasonCode: string;
    reasonDetail: string;
  }>;
  isExisting: boolean;
}

export interface RevalidateAndOpenRecipientInput {
  barbershopId: string;
  campaignId: string;
  recipientId: string;
  userId?: string;
  userRole?: string;
  operatorUserId?: string;
  operatorName?: string | null;
  memberId?: string | null;
  operatorMemberId?: string | null;
  templateKey?: string;
  messageText?: string;
  reconciliation?: OperatorTransferReconciliationInput | null;
  returnOutcomeOnStale?: boolean;
  now?: Date;
}

export interface RevalidateAndOpenRecipientResult {
  ok?: boolean;
  status?: number;
  code?: string;
  message?: string;
  whatsappUrl: string;
  recipient: any;
  isReplay: boolean;
  openPreparationId?: string;
  campaignStatus?: CampaignStatus;
  remainingPendingCount?: number;
}

export interface ConfirmRecipientSendInput {
  barbershopId: string;
  campaignId: string;
  recipientId: string;
  userId?: string;
  userRole?: string;
  operatorUserId?: string;
  operatorName?: string | null;
  memberId?: string | null;
  operatorMemberId?: string | null;
  openPreparationId?: string | null;
  reconciliation?: OperatorTransferReconciliationInput | null;
  now?: Date;
}

export interface ConfirmRecipientSendResult {
  recipient: any;
  contactLog: any;
  isExisting: boolean;
  postOpenWarning?: string | null;
  campaignStatus?: CampaignStatus;
  remainingPendingCount?: number;
}

export interface SkipRecipientInput {
  barbershopId: string;
  campaignId: string;
  recipientId: string;
  userId: string;
  userRole?: string;
  operatorName?: string | null;
  memberId?: string | null;
  reason?: string | null;
  reconciliation?: OperatorTransferReconciliationInput | null;
  now?: Date;
}

export interface SkipRecipientResult {
  recipient: any;
  isReplay: boolean;
  campaignStatus: CampaignStatus;
  remainingPendingCount: number;
}

export interface CancelManualCampaignInput {
  barbershopId: string;
  campaignId: string;
  userId: string;
  userRole?: string;
  memberId?: string | null;
  reason?: string | null;
  now?: Date;
}

export interface CancelManualCampaignResult {
  campaign: any;
  cancelledRecipientsCount: number;
  isReplay: boolean;
}

/**
 * Determina a origem canônica da campanha.
 * Campanhas legadas sem `targetSegment.origin` são preservadas como SMART_CRM_REACTIVATION (S-08 / G1-C07).
 */
export function resolveCampaignOrigin(
  campaign: { targetSegment?: unknown } | null | undefined
): ManualCampaignOrigin {
  const seg = (campaign?.targetSegment as Record<string, unknown> | null) ?? {};
  if (seg.origin === "CLIENTS_BASE_ASSISTED_QUEUE") {
    return "CLIENTS_BASE_ASSISTED_QUEUE";
  }
  return "SMART_CRM_REACTIVATION";
}

/**
 * Gera um hash SHA-256 determinístico de 64 caracteres hexadecimais para vincular
 * telefone, template e texto ao openPreparationId (S-02 / B07 / G21-05).
 */
export function computePreparationFingerprint(
  phoneNormalized: string,
  templateKey: string,
  messageText: string
): string {
  const raw = `${phoneNormalized}|${templateKey}|${messageText.trim()}`;
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export function buildOpenPreparationId(
  recipientId: string,
  attemptNumber: number,
  phoneNormalized: string,
  templateKey: string,
  messageText: string
): string {
  const fp = computePreparationFingerprint(phoneNormalized, templateKey, messageText);
  return `prep_${recipientId}_v${attemptNumber}_${fp}`;
}

export async function acquireDispatchAdvisoryLock(
  prisma: ManualCampaignDb,
  barbershopId: string,
  recipientId: string
): Promise<void> {
  if (typeof prisma?.$executeRawUnsafe === "function") {
    await prisma.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext('crm_dispatch:' || $1 || ':' || $2))`,
      barbershopId,
      recipientId
    );
  }
}

export async function acquireCampaignOperationAdvisoryLock(
  prisma: ManualCampaignDb,
  barbershopId: string,
  campaignId: string
): Promise<void> {
  if (typeof prisma?.$executeRawUnsafe === "function") {
    await prisma.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext('crm_campaign_op:' || $1 || ':' || $2))`,
      barbershopId,
      campaignId
    );
  }
}

async function acquireCampaignAdvisoryLock(
  prisma: ManualCampaignDb,
  barbershopId: string
): Promise<void> {
  if (typeof prisma?.$executeRawUnsafe === "function") {
    await prisma.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext('crm_campaign_create:' || $1))`,
      barbershopId
    );
  }
}

/**
 * Avança o ciclo de vida da campanha respeitando CAMPAIGN_STATUS_TRANSITIONS (G1-C02):
 * READY -> IN_PROGRESS -> COMPLETED (nunca READY -> COMPLETED direto).
 */
export async function advanceCampaignLifecycleOnRecipientWrite(
  prisma: ManualCampaignDb,
  campaign: { id: string; status: CampaignStatus; startedAt?: Date | null } | null | undefined,
  now: Date
): Promise<{ campaignStatus: CampaignStatus; remainingPendingCount: number }> {
  if (!campaign?.id) {
    return { campaignStatus: CampaignStatus.IN_PROGRESS, remainingPendingCount: 0 };
  }

  let currentStatus: CampaignStatus = campaign.status || CampaignStatus.READY;
  let startedAt = campaign.startedAt ?? null;

  if (
    currentStatus === CampaignStatus.COMPLETED ||
    currentStatus === CampaignStatus.CANCELLED
  ) {
    return { campaignStatus: currentStatus, remainingPendingCount: 0 };
  }

  // Passo 1: READY -> IN_PROGRESS
  if (currentStatus === CampaignStatus.READY) {
    assertValidCampaignTransition(currentStatus, CampaignStatus.IN_PROGRESS);
    currentStatus = CampaignStatus.IN_PROGRESS;
    startedAt = startedAt ?? now;
    if (typeof prisma?.reactivationCampaign?.update === "function") {
      await prisma.reactivationCampaign.update({
        where: { id: campaign.id },
        data: {
          status: currentStatus,
          startedAt,
        },
      });
    }
  }

  // Passo 2: Conta pendentes (READY ou WHATSAPP_OPENED)
  let remainingPendingCount = 0;
  if (typeof prisma?.reactivationCampaignRecipient?.count === "function") {
    remainingPendingCount = await prisma.reactivationCampaignRecipient.count({
      where: {
        campaignId: campaign.id,
        dispatchStatus: {
          in: [
            RecipientDispatchStatus.READY,
            RecipientDispatchStatus.WHATSAPP_OPENED,
          ],
        },
      },
    });

    if (
      remainingPendingCount === 0 &&
      currentStatus === CampaignStatus.IN_PROGRESS
    ) {
      assertValidCampaignTransition(currentStatus, CampaignStatus.COMPLETED);
      currentStatus = CampaignStatus.COMPLETED;
      if (typeof prisma?.reactivationCampaign?.update === "function") {
        await prisma.reactivationCampaign.update({
          where: { id: campaign.id },
          data: {
            status: currentStatus,
            completedAt: now,
          },
        });
      }
    }
  }

  return { campaignStatus: currentStatus, remainingPendingCount };
}

/**
 * Valida se um destinatário em WHATSAPP_OPENED está reservado por outro operador (S-01).
 * - Se o lease de outro operador estiver ativo (now < leaseExpiresAt): bloqueia sempre (409 RECIPIENT_LOCKED_BY_OTHER_OPERATOR).
 * - Se o lease de outro operador expirou (now >= leaseExpiresAt): exige reconciliação humana explícita (409 RECIPIENT_REQUIRES_HUMAN_RECONCILIATION).
 */
function checkOperatorLeaseAndReconciliation(params: {
  recipientStatus: RecipientDispatchStatus;
  payload: Record<string, any>;
  currentOperatorUserId: string;
  currentOperatorName: string;
  reconciliation?: OperatorTransferReconciliationInput | null;
  now: Date;
}): {
  transferEntry: {
    previousOperatorUserId: string;
    previousOperatorName: string;
    newOperatorUserId: string;
    newOperatorName: string;
    reason: string;
    transferredAt: string;
    previousLeaseExpiresAt: string | null;
  } | null;
} {
  const {
    recipientStatus,
    payload,
    currentOperatorUserId,
    currentOperatorName,
    reconciliation,
    now,
  } = params;

  const leaseHolderId = payload.leaseOperatorUserId as string | undefined;
  const leaseExpiresAtStr = payload.leaseExpiresAt as string | undefined;

  if (
    !leaseHolderId ||
    !currentOperatorUserId ||
    leaseHolderId === currentOperatorUserId
  ) {
    return { transferEntry: null };
  }

  const leaseExpiresMs = leaseExpiresAtStr
    ? new Date(leaseExpiresAtStr).getTime()
    : 0;
  const isLeaseActive =
    !Number.isNaN(leaseExpiresMs) && leaseExpiresMs > now.getTime();

  // S-01: Enquanto o lease de 5 minutos estiver ativo, NENHUM segundo operador pode assumir
  if (isLeaseActive) {
    const err: any = new Error(
      `RECIPIENT_LOCKED_BY_OTHER_OPERATOR: Destinatário reservado pelo operador ${
        payload.leaseOperatorName || leaseHolderId
      } até ${leaseExpiresAtStr}.`
    );
    err.status = 409;
    err.code = "RECIPIENT_LOCKED_BY_OTHER_OPERATOR";
    err.lease = {
      operatorUserId: leaseHolderId,
      operatorName: payload.leaseOperatorName || "Outro operador",
      expiresAt: leaseExpiresAtStr,
    };
    throw err;
  }

  // S-01: Se o destinatário já está em WHATSAPP_OPENED por outro operador e o lease expirou,
  // exige reconciliação humana explícita antes de transferir para outro operador.
  if (recipientStatus === RecipientDispatchStatus.WHATSAPP_OPENED) {
    const validReason =
      typeof reconciliation?.reason === "string"
        ? reconciliation.reason.trim()
        : "";
    if (!reconciliation?.confirmedReconciliation || validReason.length < 10) {
      const err: any = new Error(
        "RECIPIENT_REQUIRES_HUMAN_RECONCILIATION: O WhatsApp deste cliente foi aberto por outro operador e a reserva expirou. Confirme a reconciliação humana informando o motivo (mín. 10 caracteres) para assumir o destinatário."
      );
      err.status = 409;
      err.code = "RECIPIENT_REQUIRES_HUMAN_RECONCILIATION";
      err.lease = {
        operatorUserId: leaseHolderId,
        operatorName: payload.leaseOperatorName || "Outro operador",
        expiresAt: leaseExpiresAtStr || null,
        isExpired: true,
      };
      throw err;
    }

    return {
      transferEntry: {
        previousOperatorUserId: leaseHolderId,
        previousOperatorName: payload.leaseOperatorName || "Operador anterior",
        newOperatorUserId: currentOperatorUserId,
        newOperatorName: currentOperatorName,
        reason: validReason.slice(0, 300),
        transferredAt: now.toISOString(),
        previousLeaseExpiresAt: leaseExpiresAtStr || null,
      },
    };
  }

  return { transferEntry: null };
}

/**
 * Prepara uma campanha de contato manual (Reativação ou Fila Assistida da Base de Clientes)
 * com validação set-oriented nas 4 fontes canônicas e idempotência estrita via requestKey.
 */
export async function prepareManualReactivationCampaign(
  prisma: ManualCampaignDb,
  input: PrepareManualCampaignInput
): Promise<PrepareManualCampaignResult> {
  if (!input.requestKey || typeof input.requestKey !== "string" || !input.requestKey.trim()) {
    throw new Error("INVALID_REQUEST_KEY: requestKey is required for idempotency.");
  }

  const selectedIds = Array.from(new Set(input.selectedCustomerIds || [])).filter(Boolean);
  if (selectedIds.length === 0) {
    throw new Error("EMPTY_SELECTION: At least one customer must be selected.");
  }

  if (selectedIds.length > 50) {
    throw new Error("BATCH_LIMIT_EXCEEDED: Maximum of 50 candidates can be prepared at once.");
  }

  const template = WHATSAPP_TEMPLATES.find((t) => t.key === input.templateKey);
  if (!template) {
    throw new Error(`INVALID_TEMPLATE: Unknown template key '${input.templateKey}'.`);
  }

  await acquireCampaignAdvisoryLock(prisma, input.barbershopId);

  // 1. Checa idempotência de preparação por requestKey
  const existingCampaign = await prisma.reactivationCampaign.findFirst({
    where: {
      barbershopId: input.barbershopId,
      targetSegment: {
        path: ["requestKey"],
        equals: input.requestKey,
      },
    },
    include: {
      recipients: {
        include: {
          customer: { select: { id: true, name: true, phone: true } },
        },
      },
    },
  });

  if (existingCampaign) {
    const existingSegment = existingCampaign.targetSegment as any;
    const existingIds = (existingSegment?.selectedCustomerIds || []) as string[];
    const existingTemplate = existingSegment?.templateKey;

    const idsMatch =
      existingIds.length === selectedIds.length &&
      selectedIds.every((id) => existingIds.includes(id));

    if (!idsMatch || existingTemplate !== input.templateKey) {
      const err: any = new Error(
        "REQUEST_KEY_CONFLICT: A campaign already exists for this requestKey with different payload parameters."
      );
      err.code = "CONFLICT";
      err.status = 409;
      throw err;
    }

    // Replay idempotente da campanha existente
    return {
      campaign: existingCampaign,
      accepted: existingCampaign.recipients.map((r: any, idx: number) => ({
        recipientId: r.id,
        customerId: r.customerId,
        customerName: r.customerNameSnapshot,
        customerPhone: r.customerPhoneSnapshot,
        dispatchStatus: r.dispatchStatus,
        previewMessage: (r.payloadSnapshot as any)?.previewMessage || "",
        timingState: r.timingStateSnapshot,
        score: r.scoreSnapshot,
        queueIndex: (r.payloadSnapshot as any)?.queueIndex ?? idx,
      })),
      rejected: (existingSegment?.rejected || []) as any[],
      isExisting: true,
    };
  }

  // 2. Fetch Barbershop details (Name and Slug for booking URL)
  const barbershop = await prisma.barbershop.findUnique({
    where: { id: input.barbershopId },
    select: { id: true, name: true, slug: true },
  });
  if (!barbershop) {
    throw new Error("BARBERSHOP_NOT_FOUND: Barbershop not found.");
  }

  const bookingUrl = barbershop.slug
    ? `${input.baseUrl || ""}/${barbershop.slug}/agendar`
    : "";

  const now = new Date();
  const cooldownCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const campaignOrigin: ManualCampaignOrigin =
    input.origin === "CLIENTS_BASE_ASSISTED_QUEUE"
      ? "CLIENTS_BASE_ASSISTED_QUEUE"
      : "SMART_CRM_REACTIVATION";

  // B04: Se for Fila Assistida da Base, impede atomicamente duas filas simultaneamente ativas no mesmo tenant
  if (campaignOrigin === "CLIENTS_BASE_ASSISTED_QUEUE") {
    const existingActiveQueue = await prisma.reactivationCampaign.findFirst({
      where: {
        barbershopId: input.barbershopId,
        status: {
          in: [CampaignStatus.READY, CampaignStatus.IN_PROGRESS],
        },
        targetSegment: {
          path: ["origin"],
          equals: "CLIENTS_BASE_ASSISTED_QUEUE",
        },
        recipients: {
          some: {
            dispatchStatus: {
              in: [
                RecipientDispatchStatus.READY,
                RecipientDispatchStatus.WHATSAPP_OPENED,
              ],
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (existingActiveQueue) {
      const err: any = new Error(
        `ACTIVE_QUEUE_ALREADY_EXISTS: Já existe uma fila assistida ativa ('${existingActiveQueue.name}') para esta barbearia. Retome ou conclua a fila atual antes de iniciar uma nova.`
      );
      err.status = 409;
      err.code = "ACTIVE_QUEUE_ALREADY_EXISTS";
      err.activeCampaignId = existingActiveQueue.id;
      throw err;
    }
  }

  // 3. Set-oriented fetch of customer data across all 4 canonical tenant sources (R-02)
  const [customers, consents, blocksByUser, upcomingAppointments, recentLogs] =
    await Promise.all([
      prisma.user.findMany({
        where: {
          id: { in: selectedIds },
          OR: [
            { customerBarbershopLinks: { some: { barbershopId: input.barbershopId } } },
            { appointments: { some: { barbershopId: input.barbershopId } } },
            // G3.1 / BUG-G3-01: relação real User.comandas (Comanda.customerId -> User.id)
            { comandas: { some: { barbershopId: input.barbershopId } } },
            { clubSubscriptions: { some: { barbershopId: input.barbershopId } } },
          ],
        },
        select: { id: true, name: true, phone: true },
      }),
      prisma.customerMarketingConsent.findMany({
        where: {
          barbershopId: input.barbershopId,
          customerId: { in: selectedIds },
          channel: DEFAULT_CRM_CHANNEL,
          purpose: DEFAULT_CRM_PURPOSE,
        },
      }),
      prisma.barbershopBlockedCustomer.findMany({
        where: {
          barbershopId: input.barbershopId,
          userId: { in: selectedIds },
          active: true,
        },
      }),
      prisma.appointment.findMany({
        where: {
          barbershopId: input.barbershopId,
          customerId: { in: selectedIds },
          dateTime: { gte: now },
          status: { in: ["CONFIRMED", "PENDING"] },
        },
        select: { customerId: true },
      }),
      prisma.customerContactLog.findMany({
        where: {
          barbershopId: input.barbershopId,
          customerId: { in: selectedIds },
          contactedAt: { gte: cooldownCutoff },
        },
        select: { customerId: true },
      }),
    ]);

  // Additional phone-based block lookup (R-04)
  const allPhoneVariants = Array.from(
    new Set(
      (customers || []).flatMap((c: any) => phoneBlockVariants(c.phone))
    )
  ).filter(Boolean) as string[];

  let blocksByPhone: any[] = [];
  if (
    allPhoneVariants.length > 0 &&
    typeof prisma.barbershopBlockedCustomer?.findMany === "function"
  ) {
    blocksByPhone =
      (await prisma.barbershopBlockedCustomer.findMany({
        where: {
          barbershopId: input.barbershopId,
          phoneNormalized: { in: allPhoneVariants },
          active: true,
        },
      })) || [];
  }

  // S-03 / B06: Check if any candidate was already skipped in the same working round
  const skippedInSameRoundSet = new Set<string>();
  if (Array.isArray(input.excludeCustomerIds)) {
    for (const id of input.excludeCustomerIds) {
      if (id) skippedInSameRoundSet.add(id);
    }
  }
  if (
    input.workRoundId &&
    typeof prisma.reactivationCampaignRecipient?.findMany === "function"
  ) {
    const priorRoundSkipped = await prisma.reactivationCampaignRecipient.findMany({
      where: {
        barbershopId: input.barbershopId,
        customerId: { in: selectedIds },
        dispatchStatus: RecipientDispatchStatus.EXCLUDED,
        failureReason: "SKIPPED_BY_USER",
        campaign: {
          targetSegment: {
            path: ["workRoundId"],
            equals: input.workRoundId,
          },
        },
      },
      select: { customerId: true },
    });
    for (const row of priorRoundSkipped || []) {
      skippedInSameRoundSet.add(row.customerId);
    }
  }

  const customerMap = new Map((customers || []).map((c: any) => [c.id, c]));
  const consentMap = new Map((consents || []).map((c: any) => [c.customerId, c.status]));
  const blockUserSet = new Set((blocksByUser || []).map((b: any) => b.userId).filter(Boolean));
  const blockedPhoneSet = new Set(
    [...(blocksByUser || []), ...(blocksByPhone || [])]
      .map((b: any) => b.phoneNormalized)
      .filter(Boolean)
  );
  const upcomingSet = new Set((upcomingAppointments || []).map((a: any) => a.customerId));
  const cooldownSet = new Set((recentLogs || []).map((l: any) => l.customerId));

  const acceptedCandidates: Array<{
    customer: { id: string; name: string; phone: string };
    validPhone: string;
    previewMessage: string;
    queueIndex: number;
  }> = [];

  const rejectedCandidates: Array<{
    customerId: string;
    customerName: string;
    reasonCode: string;
    reasonDetail: string;
  }> = [];

  for (const custId of selectedIds) {
    const cust: any = customerMap.get(custId);
    if (!cust) {
      rejectedCandidates.push({
        customerId: custId,
        customerName: "Cliente não encontrado",
        reasonCode: "CUSTOMER_NOT_FOUND",
        reasonDetail: "Cliente não encontrado ou não vinculado a esta barbearia.",
      });
      continue;
    }

    if (skippedInSameRoundSet.has(custId)) {
      rejectedCandidates.push({
        customerId: custId,
        customerName: cust.name,
        reasonCode: "SKIPPED_IN_CURRENT_ROUND",
        reasonDetail: "Cliente já foi pulado anteriormente nesta mesma rodada de trabalho.",
      });
      continue;
    }

    const consentStatus = consentMap.get(custId);
    if (consentStatus !== "OPTED_IN") {
      rejectedCandidates.push({
        customerId: custId,
        customerName: cust.name,
        reasonCode: consentStatus === "OPTED_OUT" ? "CONSENT_OPTED_OUT" : "CONSENT_UNKNOWN",
        reasonDetail:
          consentStatus === "OPTED_OUT"
            ? "Cliente optou por não receber mensagens de marketing."
            : "Consentimento de marketing não registrado para WhatsApp.",
      });
      continue;
    }

    const isValidPhone = validateBrazilianMobilePhone(cust.phone);
    const normalizedPhone = normalizeBrazilianMobilePhone(cust.phone);
    if (!isValidPhone || !normalizedPhone) {
      rejectedCandidates.push({
        customerId: custId,
        customerName: cust.name,
        reasonCode: "INVALID_PHONE",
        reasonDetail: `Telefone celular inválido: ${cust.phone || "vazio"}`,
      });
      continue;
    }

    const customerPhoneVariants = phoneBlockVariants(cust.phone);
    const isBlockedByPhone = customerPhoneVariants.some((v) => blockedPhoneSet.has(v));
    if (blockUserSet.has(custId) || isBlockedByPhone) {
      rejectedCandidates.push({
        customerId: custId,
        customerName: cust.name,
        reasonCode: "BLOCKED",
        reasonDetail: "Cliente está bloqueado nesta barbearia.",
      });
      continue;
    }

    if (upcomingSet.has(custId)) {
      rejectedCandidates.push({
        customerId: custId,
        customerName: cust.name,
        reasonCode: "UPCOMING_APPOINTMENT",
        reasonDetail: "Cliente já possui um agendamento futuro confirmado.",
      });
      continue;
    }

    if (cooldownSet.has(custId)) {
      rejectedCandidates.push({
        customerId: custId,
        customerName: cust.name,
        reasonCode: "RECENT_CONTACT",
        reasonDetail: "Cliente contatado nos últimos 14 dias (período de cooldown).",
      });
      continue;
    }

    const message = buildClientWhatsappMessage({
      template: input.templateKey,
      customerName: cust.name,
      barbershopName: barbershop.name,
      bookingUrl,
    });

    acceptedCandidates.push({
      customer: cust,
      validPhone: normalizedPhone,
      previewMessage: message,
      queueIndex: acceptedCandidates.length,
    });
  }

  // If 0 accepted candidates, return early without creating misleading campaign records
  if (acceptedCandidates.length === 0) {
    return {
      campaign: null,
      accepted: [],
      rejected: rejectedCandidates,
      isExisting: false,
    };
  }

  // 4. Create campaign and recipients inside transaction
  const defaultPrefix =
    campaignOrigin === "CLIENTS_BASE_ASSISTED_QUEUE"
      ? "Fila Assistida"
      : "Reativação Manual";
  const campaignName =
    input.name?.trim() || `${defaultPrefix} — ${getSaoPauloCivilDateString(now)}`;
  const effectiveUserId = input.userId || input.operatorUserId || "";
  const effectiveMemberId = input.memberId || input.operatorMemberId || null;

  const defaultTimingState =
    campaignOrigin === "CLIENTS_BASE_ASSISTED_QUEUE"
      ? CustomerTimingState.NO_HISTORY
      : CustomerTimingState.DUE;
  const defaultScoreSnapshot =
    campaignOrigin === "CLIENTS_BASE_ASSISTED_QUEUE" ? 0 : 50;

  const createdCampaign = await prisma.reactivationCampaign.create({
    data: {
      barbershop: { connect: { id: input.barbershopId } },
      name: campaignName,
      channel: DEFAULT_CRM_CHANNEL,
      status: CampaignStatus.READY,
      scoreVersion: "smart-crm-score-v1",
      recurrenceVersion: "smart-crm-recurrence-v1",
      attributionVersion: "smart-crm-attribution-v1",
      bookingAttributionWindowDays: 14,
      directReturnWindowDays: 30,
      cooldownDays: 14,
      targetSegment: {
        requestKey: input.requestKey,
        origin: campaignOrigin,
        sourceFilter: input.sourceFilter ?? null,
        workRoundId: input.workRoundId ?? null,
        selectedCustomerIds: selectedIds,
        templateKey: input.templateKey,
        rejected: rejectedCandidates,
        preparedAt: now.toISOString(),
      },
      createdByUser: { connect: { id: effectiveUserId } },
      ...(effectiveMemberId
        ? { createdByMember: { connect: { id: effectiveMemberId } } }
        : {}),
      totalRecipients: acceptedCandidates.length,
      recipients: {
        create: acceptedCandidates.map((cand) => ({
          barbershop: { connect: { id: input.barbershopId } },
          customer: { connect: { id: cand.customer.id } },
          customerNameSnapshot: cand.customer.name,
          customerPhoneSnapshot: cand.validPhone,
          timingStateSnapshot: defaultTimingState,
          scoreSnapshot: defaultScoreSnapshot,
          dispatchStatus: RecipientDispatchStatus.READY,
          payloadSnapshot: {
            queueIndex: cand.queueIndex,
            initialTemplateKey: input.templateKey,
            templateKey: input.templateKey,
            templateLabel: template.label,
            previewMessage: cand.previewMessage,
            isCustomEdited: false,
          },
        })),
      },
    },
    include: {
      recipients: true,
    },
  });

  const sortedRecipients = [...(createdCampaign.recipients || [])].sort(
    (a: any, b: any) =>
      ((a.payloadSnapshot as any)?.queueIndex ?? 0) -
      ((b.payloadSnapshot as any)?.queueIndex ?? 0)
  );

  return {
    campaign: {
      ...createdCampaign,
      recipients: sortedRecipients,
    },
    accepted: sortedRecipients.map((r: any, idx: number) => ({
      recipientId: r.id,
      customerId: r.customerId,
      customerName: r.customerNameSnapshot,
      customerPhone: r.customerPhoneSnapshot,
      dispatchStatus: r.dispatchStatus,
      previewMessage: (r.payloadSnapshot as any)?.previewMessage || "",
      timingState: r.timingStateSnapshot,
      score: r.scoreSnapshot,
      queueIndex: (r.payloadSnapshot as any)?.queueIndex ?? idx,
    })),
    rejected: rejectedCandidates,
    isExisting: false,
  };
}

/**
 * Revalida o estado ao vivo do destinatário antes da abertura ou reabertura do WhatsApp.
 * - Rejeita SENT_CONFIRMED com 409 ALREADY_SENT_CONFIRMED (R-01 / S-02).
 * - Executa revalidação ao vivo TANTO para READY quanto para WHATSAPP_OPENED (R-01).
 * - Protege contra concorrência entre operadores com lease de 5 min e reconciliação humana (S-01).
 * - Gera openPreparationId vinculado a destinatário, versão, telefone e texto (S-02).
 * - Persiste supressões ao vivo sem sofrer rollback transacional quando returnOutcomeOnStale=true (R-09).
 */
export async function revalidateAndOpenManualRecipient(
  prisma: ManualCampaignDb,
  input: RevalidateAndOpenRecipientInput
): Promise<RevalidateAndOpenRecipientResult> {
  // G21-02: Ordem estrita de locks hierárquicos: 1) Campanha -> 2) Destinatário
  await acquireCampaignOperationAdvisoryLock(
    prisma,
    input.barbershopId,
    input.campaignId
  );
  await acquireDispatchAdvisoryLock(
    prisma,
    input.barbershopId,
    input.recipientId
  );

  const recipient = await prisma.reactivationCampaignRecipient.findFirst({
    where: {
      id: input.recipientId,
      campaignId: input.campaignId,
      barbershopId: input.barbershopId,
    },
    include: {
      campaign: true,
      customer: true,
    },
  });

  if (!recipient) {
    const err: any = new Error(
      "RECIPIENT_NOT_FOUND: Recipient not found in tenant campaign."
    );
    err.status = 404;
    err.code = "RECIPIENT_NOT_FOUND";
    throw err;
  }

  // DEC-05: Permissão exclusiva WHATSAPP_ASSISTED_OPERATE (G22-01 / G23-01 / G23-02 / G24-04)
  const campaignOrigin = resolveCampaignOrigin(recipient.campaign);
  if (campaignOrigin === "CLIENTS_BASE_ASSISTED_QUEUE") {
    if (input.userRole && input.userRole !== "OWNER") {
      const allowed = await checkCrmQueuePermission(
        input.memberId ?? null,
        input.userRole,
        "WHATSAPP_ASSISTED_OPERATE",
        prisma
      );
      if (!allowed) {
        const err: any = new Error(
          "PERMISSION_DENIED: Permissão 'WHATSAPP_ASSISTED_OPERATE' necessária para operar a fila assistida."
        );
        err.status = 403;
        err.code = "PERMISSION_DENIED";
        throw err;
      }
    }
  } else {
    // Campanha legada de reativação: preserva contrato histórico (bloqueia BARBER)
    if (input.userRole === "BARBER") {
      const err: any = new Error(
        "FORBIDDEN: Barbeiros não possuem acesso a campanhas legadas de reativação."
      );
      err.status = 403;
      err.code = "FORBIDDEN";
      throw err;
    }
  }

  if (
    recipient.campaign?.status === CampaignStatus.CANCELLED ||
    recipient.campaign?.status === CampaignStatus.COMPLETED
  ) {
    const err: any = new Error(
      `CAMPAIGN_CLOSED: Cannot open recipient for a campaign in status ${recipient.campaign.status}.`
    );
    err.status = 409;
    err.code = "CAMPAIGN_CLOSED";
    throw err;
  }

  // R-01 / S-02: Bloqueia estritamente qualquer reabertura ou edição de destinatário já SENT_CONFIRMED
  if (recipient.dispatchStatus === RecipientDispatchStatus.SENT_CONFIRMED) {
    const err: any = new Error(
      "ALREADY_SENT_CONFIRMED: Este destinatário já teve o envio confirmado e não pode ser reaberto ou editado."
    );
    err.status = 409;
    err.code = "ALREADY_SENT_CONFIRMED";
    throw err;
  }

  const isReplayState =
    recipient.dispatchStatus === RecipientDispatchStatus.WHATSAPP_OPENED;

  if (!isReplayState) {
    assertValidDispatchTransition(
      recipient.dispatchStatus,
      RecipientDispatchStatus.WHATSAPP_OPENED
    );
  }

  const now = input.now || new Date();
  const effectiveUserId = input.userId || input.operatorUserId || "";
  const effectiveOperatorName = input.operatorName || "Operador";
  const payload = { ...((recipient.payloadSnapshot as Record<string, any>) || {}) };

  // S-01: Verifica reserva de operador e reconciliação humana
  const { transferEntry } = checkOperatorLeaseAndReconciliation({
    recipientStatus: recipient.dispatchStatus,
    payload,
    currentOperatorUserId: effectiveUserId,
    currentOperatorName: effectiveOperatorName,
    reconciliation: input.reconciliation,
    now,
  });

  // Validação de templateKey e messageText customizados (se enviados)
  let effectiveTemplateKey: string =
    payload.templateKey || "RETURN_REMINDER";
  let effectiveTemplateLabel: string =
    payload.templateLabel || "Lembrete de retorno";

  if (input.templateKey !== undefined) {
    const foundTemplate = WHATSAPP_TEMPLATES.find(
      (t) => t.key === input.templateKey
    );
    if (!foundTemplate) {
      const err: any = new Error(
        `INVALID_TEMPLATE: Unknown template key '${input.templateKey}'.`
      );
      err.status = 400;
      err.code = "INVALID_TEMPLATE";
      throw err;
    }
    effectiveTemplateKey = foundTemplate.key;
    effectiveTemplateLabel = foundTemplate.label;
  }

  let effectiveMessageText: string =
    payload.openedMessageText || payload.previewMessage || "";

  if (input.messageText !== undefined) {
    const trimmed =
      typeof input.messageText === "string" ? input.messageText.trim() : "";
    if (trimmed.length === 0 || trimmed.length > 2000) {
      const err: any = new Error(
        "INVALID_MESSAGE_TEXT: A mensagem deve conter entre 1 e 2000 caracteres."
      );
      err.status = 400;
      err.code = "INVALID_MESSAGE_TEXT";
      throw err;
    }
    effectiveMessageText = trimmed;
  }

  const cooldownCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const liveRawPhone =
    recipient.customer?.phone || recipient.customerPhoneSnapshot || "";
  const livePhoneVariants = phoneBlockVariants(liveRawPhone);

  // Revalidação ao vivo obrigatória (executada tanto para READY quanto para WHATSAPP_OPENED)
  const [consent, block, upcomingAppt, recentContact] = await Promise.all([
    prisma.customerMarketingConsent.findUnique({
      where: {
        barbershopId_customerId_channel_purpose: {
          barbershopId: input.barbershopId,
          customerId: recipient.customerId,
          channel: DEFAULT_CRM_CHANNEL,
          purpose: DEFAULT_CRM_PURPOSE,
        },
      },
    }),
    prisma.barbershopBlockedCustomer.findFirst({
      where: {
        barbershopId: input.barbershopId,
        active: true,
        OR: [
          { userId: recipient.customerId },
          ...(livePhoneVariants.length > 0
            ? [{ phoneNormalized: { in: livePhoneVariants } }]
            : []),
        ],
      },
    }),
    prisma.appointment.findFirst({
      where: {
        barbershopId: input.barbershopId,
        customerId: recipient.customerId,
        dateTime: { gte: now },
        status: { in: ["CONFIRMED", "PENDING"] },
      },
    }),
    prisma.customerContactLog.findFirst({
      where: {
        barbershopId: input.barbershopId,
        customerId: recipient.customerId,
        contactedAt: { gte: cooldownCutoff },
      },
    }),
  ]);

  const handleStaleSuppression = async (
    targetStatus: RecipientDispatchStatus,
    code: string,
    dispatchError: string,
    errorMessage: string
  ): Promise<RevalidateAndOpenRecipientResult> => {
    const updatedRecipient = await prisma.reactivationCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        dispatchStatus: targetStatus,
        failureReason: code,
        dispatchError,
      },
    });

    const lifecycle = await advanceCampaignLifecycleOnRecipientWrite(
      prisma,
      recipient.campaign,
      now
    );

    if (input.returnOutcomeOnStale) {
      return {
        ok: false,
        status: 400,
        code,
        message: errorMessage,
        whatsappUrl: "",
        recipient: updatedRecipient,
        isReplay: false,
        campaignStatus: lifecycle.campaignStatus,
        remainingPendingCount: lifecycle.remainingPendingCount,
      };
    }

    const err: any = new Error(errorMessage);
    err.status = 400;
    err.code = code;
    err.recipient = updatedRecipient;
    err.campaignStatus = lifecycle.campaignStatus;
    throw err;
  };

  if (!consent || consent.status !== "OPTED_IN") {
    return handleStaleSuppression(
      RecipientDispatchStatus.OPTED_OUT,
      "STALE_CONSENT",
      "Consentimento não é OPTED_IN no momento do disparo.",
      "STALE_CONSENT: Customer consent is no longer OPTED_IN."
    );
  }

  const isValidPhone = validateBrazilianMobilePhone(liveRawPhone);
  const normalizedPhone = normalizeBrazilianMobilePhone(liveRawPhone);
  if (!isValidPhone || !normalizedPhone) {
    return handleStaleSuppression(
      RecipientDispatchStatus.FAILED,
      "STALE_INVALID_PHONE",
      "Telefone do cliente inválido.",
      "STALE_INVALID_PHONE: Customer phone number is invalid."
    );
  }

  if (block) {
    return handleStaleSuppression(
      RecipientDispatchStatus.EXCLUDED,
      "STALE_BLOCKED",
      "Cliente foi bloqueado na barbearia.",
      "STALE_BLOCKED: Customer was blocked."
    );
  }

  if (upcomingAppt) {
    return handleStaleSuppression(
      RecipientDispatchStatus.EXCLUDED,
      "STALE_UPCOMING_APPOINTMENT",
      "Cliente agendou um horário recentemente.",
      "STALE_UPCOMING_APPOINTMENT: Customer has an upcoming appointment."
    );
  }

  if (recentContact) {
    return handleStaleSuppression(
      RecipientDispatchStatus.EXCLUDED,
      "STALE_RECENT_CONTACT",
      "Cliente contatado nos últimos 14 dias.",
      "STALE_RECENT_CONTACT: Customer was contacted within cooldown."
    );
  }

  // S-02: Gera openPreparationId vinculado ao destinatário, tentativa, telefone e texto
  const nextAttemptCount = (recipient.dispatchAttemptCount || 0) + 1;
  const openPreparationId = buildOpenPreparationId(
    recipient.id,
    nextAttemptCount,
    normalizedPhone,
    effectiveTemplateKey,
    effectiveMessageText
  );
  const isCustomEdited =
    effectiveMessageText.trim() !== (payload.previewMessage || "").trim() ||
    effectiveTemplateKey !== (payload.initialTemplateKey || payload.templateKey);

  const leaseExpiresAt = new Date(
    now.getTime() + RECIPIENT_OPEN_LEASE_TTL_MS
  ).toISOString();

  const existingTransfers = Array.isArray(payload.operatorTransfers)
    ? payload.operatorTransfers
    : [];

  const updatedPayloadSnapshot = {
    ...payload,
    templateKey: effectiveTemplateKey,
    templateLabel: effectiveTemplateLabel,
    openedMessageText: effectiveMessageText,
    openedPhoneNormalized: normalizedPhone,
    isCustomEdited,
    openPreparationId,
    openPreparationVersion: nextAttemptCount,
    lastOpenedAt: now.toISOString(),
    // G3.1 / BUG-G3-03: instante da PRIMEIRA abertura persistido no payloadSnapshot (sem coluna nova)
    whatsappOpenedAt:
      typeof payload.whatsappOpenedAt === "string" && payload.whatsappOpenedAt
        ? payload.whatsappOpenedAt
        : now.toISOString(),
    openedByUserId: effectiveUserId || null,
    leaseOperatorUserId: effectiveUserId || null,
    leaseOperatorName: effectiveOperatorName,
    leaseAcquiredAt: now.toISOString(),
    leaseExpiresAt,
    ...(transferEntry
      ? { operatorTransfers: [...existingTransfers, transferEntry] }
      : {}),
  };

  const updatedRecipient = await prisma.reactivationCampaignRecipient.update({
    where: { id: recipient.id },
    data: {
      dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
      customerPhoneSnapshot: normalizedPhone,
      dispatchAttemptCount: { increment: 1 },
      payloadSnapshot: updatedPayloadSnapshot,
    },
  });

  const lifecycle = await advanceCampaignLifecycleOnRecipientWrite(
    prisma,
    recipient.campaign,
    now
  );

  const whatsappUrl = generateWhatsAppLink(
    normalizedPhone,
    effectiveMessageText
  );

  return {
    ok: true,
    whatsappUrl: whatsappUrl || "",
    recipient: updatedRecipient,
    isReplay: isReplayState,
    openPreparationId,
    campaignStatus: lifecycle.campaignStatus,
    remainingPendingCount: lifecycle.remainingPendingCount,
  };
}

/**
 * Confirma o envio manual pelo operador e cria o CustomerContactLog idempotente.
 * - S-01: Respeita lease de operador e exige reconciliação humana se expirado por outro operador.
 * - S-02: Na fila assistida (CLIENTS_BASE_ASSISTED_QUEUE), exige openPreparationId válido e correspondente.
 * - S-05: Se a elegibilidade mudou após WHATSAPP_OPENED, preserva o registro histórico do contato real
 *         (SENT_CONFIRMED + CustomerContactLog + postOpenAudit), sem restaurar consentimento ou desbloquear.
 */
export async function confirmManualRecipientSend(
  prisma: ManualCampaignDb,
  input: ConfirmRecipientSendInput
): Promise<ConfirmRecipientSendResult> {
  // G21-02: Ordem estrita de locks hierárquicos: 1) Campanha -> 2) Destinatário
  await acquireCampaignOperationAdvisoryLock(
    prisma,
    input.barbershopId,
    input.campaignId
  );
  await acquireDispatchAdvisoryLock(
    prisma,
    input.barbershopId,
    input.recipientId
  );

  const recipient = await prisma.reactivationCampaignRecipient.findFirst({
    where: {
      id: input.recipientId,
      campaignId: input.campaignId,
      barbershopId: input.barbershopId,
    },
    include: {
      campaign: true,
      customerContactLog: true,
    },
  });

  if (!recipient) {
    const err: any = new Error(
      "RECIPIENT_NOT_FOUND: Recipient not found in tenant campaign."
    );
    err.status = 404;
    err.code = "RECIPIENT_NOT_FOUND";
    throw err;
  }

  // DEC-05: Permissão exclusiva WHATSAPP_ASSISTED_OPERATE (G22-01 / G23-01 / G23-02 / G24-04)
  const campaignOrigin = resolveCampaignOrigin(recipient.campaign);
  if (campaignOrigin === "CLIENTS_BASE_ASSISTED_QUEUE") {
    if (input.userRole && input.userRole !== "OWNER") {
      const allowed = await checkCrmQueuePermission(
        input.memberId ?? null,
        input.userRole,
        "WHATSAPP_ASSISTED_OPERATE",
        prisma
      );
      if (!allowed) {
        const err: any = new Error(
          "PERMISSION_DENIED: Permissão 'WHATSAPP_ASSISTED_OPERATE' necessária para operar a fila assistida."
        );
        err.status = 403;
        err.code = "PERMISSION_DENIED";
        throw err;
      }
    }
  } else {
    // Campanha legada de reativação: preserva contrato histórico (bloqueia BARBER)
    if (input.userRole === "BARBER") {
      const err: any = new Error(
        "FORBIDDEN: Barbeiros não possuem acesso a campanhas legadas de reativação."
      );
      err.status = 403;
      err.code = "FORBIDDEN";
      throw err;
    }
  }

  const payload = { ...((recipient.payloadSnapshot as Record<string, any>) || {}) };

  // Replay idempotente se já estiver SENT_CONFIRMED
  if (recipient.dispatchStatus === RecipientDispatchStatus.SENT_CONFIRMED) {
    if (
      input.openPreparationId &&
      payload.confirmedPreparationId &&
      input.openPreparationId !== payload.confirmedPreparationId
    ) {
      const err: any = new Error(
        "ALREADY_SENT_CONFIRMED: O envio deste destinatário já foi confirmado com outra preparação."
      );
      err.status = 409;
      err.code = "ALREADY_SENT_CONFIRMED";
      throw err;
    }

    const existingLog =
      recipient.customerContactLog ||
      (await prisma.customerContactLog.findUnique({
        where: { reactivationRecipientId: recipient.id },
      }));

    return {
      recipient,
      contactLog: existingLog,
      isExisting: true,
      campaignStatus: recipient.campaign?.status,
    };
  }

  if (recipient.campaign?.status === CampaignStatus.CANCELLED) {
    const err: any = new Error(
      "CAMPAIGN_CANCELLED: Não é possível confirmar envio de uma fila cancelada."
    );
    err.status = 409;
    err.code = "CAMPAIGN_CANCELLED";
    throw err;
  }

  // Validação estrita da transição WHATSAPP_OPENED -> SENT_CONFIRMED
  assertValidDispatchTransition(
    recipient.dispatchStatus,
    RecipientDispatchStatus.SENT_CONFIRMED
  );

  const now = input.now || new Date();
  const effectiveUserId = input.userId || input.operatorUserId || "";
  const effectiveOperatorName = input.operatorName || "Operador";

  // S-01: Verifica reserva de operador e reconciliação humana
  const { transferEntry } = checkOperatorLeaseAndReconciliation({
    recipientStatus: recipient.dispatchStatus,
    payload,
    currentOperatorUserId: effectiveUserId,
    currentOperatorName: effectiveOperatorName,
    reconciliation: input.reconciliation,
    now,
  });

  // S-02: Validação de openPreparationId
  const expectedPrepId = payload.openPreparationId as string | undefined;

  if (campaignOrigin === "CLIENTS_BASE_ASSISTED_QUEUE") {
    if (!input.openPreparationId || !input.openPreparationId.trim()) {
      const err: any = new Error(
        "OPEN_PREPARATION_ID_REQUIRED: O identificador openPreparationId é obrigatório para confirmar o envio na fila assistida."
      );
      err.status = 400;
      err.code = "OPEN_PREPARATION_ID_REQUIRED";
      throw err;
    }
    if (!expectedPrepId || input.openPreparationId.trim() !== expectedPrepId) {
      const err: any = new Error(
        "STALE_OPEN_PREPARATION: O identificador de preparação informado está obsoleto ou diverge da última mensagem aberta no WhatsApp."
      );
      err.status = 409;
      err.code = "STALE_OPEN_PREPARATION";
      throw err;
    }
  } else if (
    input.openPreparationId &&
    expectedPrepId &&
    input.openPreparationId.trim() !== expectedPrepId
  ) {
    const err: any = new Error(
      "STALE_OPEN_PREPARATION: O identificador de preparação informado está obsoleto."
    );
    err.status = 409;
    err.code = "STALE_OPEN_PREPARATION";
    throw err;
  }

  // S-05: Verifica se houve mudança superveniente de elegibilidade após a abertura no WhatsApp
  const detectedPostOpenChanges: string[] = [];
  let postOpenWarning: string | null = null;

  if (typeof prisma.customerMarketingConsent?.findUnique === "function") {
    const phoneVars = phoneBlockVariants(
      payload.openedPhoneNormalized || recipient.customerPhoneSnapshot
    );
    const openedAtDate =
      resolveRecipientWhatsappOpenedAt(recipient.payloadSnapshot) ??
      new Date(now.getTime() - 60_000);

    const [liveConsent, liveBlock, liveAppt, concurrentLog] = await Promise.all([
      prisma.customerMarketingConsent.findUnique({
        where: {
          barbershopId_customerId_channel_purpose: {
            barbershopId: input.barbershopId,
            customerId: recipient.customerId,
            channel: DEFAULT_CRM_CHANNEL,
            purpose: DEFAULT_CRM_PURPOSE,
          },
        },
      }),
      typeof prisma.barbershopBlockedCustomer?.findFirst === "function"
        ? prisma.barbershopBlockedCustomer.findFirst({
            where: {
              barbershopId: input.barbershopId,
              active: true,
              OR: [
                { userId: recipient.customerId },
                ...(phoneVars.length > 0
                  ? [{ phoneNormalized: { in: phoneVars } }]
                  : []),
              ],
            },
          })
        : Promise.resolve(null),
      typeof prisma.appointment?.findFirst === "function"
        ? prisma.appointment.findFirst({
            where: {
              barbershopId: input.barbershopId,
              customerId: recipient.customerId,
              dateTime: { gte: now },
              status: { in: ["CONFIRMED", "PENDING"] },
            },
          })
        : Promise.resolve(null),
      typeof prisma.customerContactLog?.findFirst === "function"
        ? prisma.customerContactLog.findFirst({
            where: {
              barbershopId: input.barbershopId,
              customerId: recipient.customerId,
              contactedAt: { gte: openedAtDate },
            },
          })
        : Promise.resolve(null),
    ]);

    if (!liveConsent || liveConsent.status !== "OPTED_IN") {
      detectedPostOpenChanges.push("CONSENT_CHANGED_AFTER_OPEN");
    }
    if (liveBlock) {
      detectedPostOpenChanges.push("BLOCKED_AFTER_OPEN");
    }
    if (liveAppt) {
      detectedPostOpenChanges.push("UPCOMING_APPOINTMENT_AFTER_OPEN");
    }
    if (concurrentLog) {
      detectedPostOpenChanges.push("CONCURRENT_CONTACT_LOG_AFTER_OPEN");
    }

    if (detectedPostOpenChanges.length > 0) {
      postOpenWarning = `Envio registrado no histórico com observação de auditoria (${detectedPostOpenChanges.join(
        ", "
      )}). Novos disparos permanecem bloqueados.`;
    }
  }

  const templateKey = payload.templateKey || "RETURN_REMINDER";
  const templateLabel = payload.templateLabel || "Lembrete de retorno";
  const confirmedMessageText =
    payload.openedMessageText || payload.previewMessage || "";
  const confirmedPhoneNormalized =
    payload.openedPhoneNormalized || recipient.customerPhoneSnapshot || "";
  const isCustomEdited = Boolean(payload.isCustomEdited);

  const existingTransfers = Array.isArray(payload.operatorTransfers)
    ? payload.operatorTransfers
    : [];

  const frozenPayloadSnapshot = {
    ...payload,
    confirmedMessageText,
    confirmedPhoneNormalized,
    confirmedPreparationId: expectedPrepId || input.openPreparationId || null,
    confirmedAt: now.toISOString(),
    confirmedByUserId: effectiveUserId || null,
    leaseExpiresAt: null,
    ...(transferEntry
      ? { operatorTransfers: [...existingTransfers, transferEntry] }
      : {}),
    ...(detectedPostOpenChanges.length > 0
      ? {
          postOpenAudit: {
            changedAfterOpen: true,
            detectedConditions: detectedPostOpenChanges,
            auditedAt: now.toISOString(),
          },
        }
      : {}),
  };

  // Executa transição e criação do log em transação
  const updatedRecipient = await prisma.reactivationCampaignRecipient.update({
    where: { id: recipient.id },
    data: {
      dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
      sentConfirmedAt: now,
      payloadSnapshot: frozenPayloadSnapshot,
    },
  });

  if (typeof prisma.reactivationCampaign?.update === "function") {
    await prisma.reactivationCampaign.update({
      where: { id: recipient.campaignId },
      data: {
        sentCount: { increment: 1 },
      },
    });
  }

  const lifecycle = await advanceCampaignLifecycleOnRecipientWrite(
    prisma,
    recipient.campaign,
    now
  );

  // S-02 / G1-C09: Minimização de dados na nota do CustomerContactLog
  const conciseNote = isCustomEdited
    ? `[Fila Assistida • Editada] ${confirmedMessageText.slice(0, 220)}`
    : `Disparo manual via WhatsApp (Campanha: ${
        recipient.campaign?.name || "Fila Assistida"
      })`;

  const logResult = await createReactivationContactLog(prisma, {
    barbershopId: input.barbershopId,
    customerId: recipient.customerId,
    recipientId: recipient.id,
    dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
    channel: DEFAULT_CRM_CHANNEL,
    templateKey,
    templateLabel,
    note: conciseNote.slice(0, 480),
    contactedAt: now,
    createdByUserId: effectiveUserId,
    createdByMemberId: input.memberId || input.operatorMemberId || null,
  });

  return {
    recipient: updatedRecipient,
    contactLog: logResult.contactLog,
    isExisting: logResult.isExisting,
    postOpenWarning,
    campaignStatus: lifecycle.campaignStatus,
    remainingPendingCount: lifecycle.remainingPendingCount,
  };
}

/**
 * Pula manualmente um destinatário na fila atual (DEC-04 = A / S-03).
 * - Transiciona READY | WHATSAPP_OPENED -> EXCLUDED com failureReason = "SKIPPED_BY_USER".
 * - NÃO cria CustomerContactLog, NÃO altera lastContactedAt e NÃO aplica cooldown de 14 dias.
 */
export async function skipManualRecipient(
  prisma: ManualCampaignDb,
  input: SkipRecipientInput
): Promise<SkipRecipientResult> {
  // G21-02: Ordem estrita de locks hierárquicos: 1) Campanha -> 2) Destinatário
  await acquireCampaignOperationAdvisoryLock(
    prisma,
    input.barbershopId,
    input.campaignId
  );
  await acquireDispatchAdvisoryLock(
    prisma,
    input.barbershopId,
    input.recipientId
  );

  const recipient = await prisma.reactivationCampaignRecipient.findFirst({
    where: {
      id: input.recipientId,
      campaignId: input.campaignId,
      barbershopId: input.barbershopId,
    },
    include: {
      campaign: true,
    },
  });

  if (!recipient) {
    const err: any = new Error(
      "RECIPIENT_NOT_FOUND: Recipient not found in tenant campaign."
    );
    err.status = 404;
    err.code = "RECIPIENT_NOT_FOUND";
    throw err;
  }

  // DEC-05: Permissão exclusiva WHATSAPP_ASSISTED_OPERATE (G22-01 / G23-01 / G23-02 / G24-04)
  const campaignOrigin = resolveCampaignOrigin(recipient.campaign);
  if (campaignOrigin === "CLIENTS_BASE_ASSISTED_QUEUE") {
    if (input.userRole && input.userRole !== "OWNER") {
      const allowed = await checkCrmQueuePermission(
        input.memberId ?? null,
        input.userRole,
        "WHATSAPP_ASSISTED_OPERATE",
        prisma
      );
      if (!allowed) {
        const err: any = new Error(
          "PERMISSION_DENIED: Permissão 'WHATSAPP_ASSISTED_OPERATE' necessária para operar a fila assistida."
        );
        err.status = 403;
        err.code = "PERMISSION_DENIED";
        throw err;
      }
    }
  } else {
    // Campanha legada de reativação: preserva contrato histórico (bloqueia BARBER)
    if (input.userRole === "BARBER") {
      const err: any = new Error(
        "FORBIDDEN: Barbeiros não possuem acesso a campanhas legadas de reativação."
      );
      err.status = 403;
      err.code = "FORBIDDEN";
      throw err;
    }
  }

  const now = input.now || new Date();

  if (
    recipient.dispatchStatus === RecipientDispatchStatus.EXCLUDED &&
    recipient.failureReason === "SKIPPED_BY_USER"
  ) {
    const lifecycle = await advanceCampaignLifecycleOnRecipientWrite(
      prisma,
      recipient.campaign,
      now
    );
    return {
      recipient,
      isReplay: true,
      campaignStatus: lifecycle.campaignStatus,
      remainingPendingCount: lifecycle.remainingPendingCount,
    };
  }

  if (recipient.dispatchStatus === RecipientDispatchStatus.SENT_CONFIRMED) {
    const err: any = new Error(
      "ALREADY_SENT_CONFIRMED: Destinatário já confirmado como enviado não pode ser pulado."
    );
    err.status = 409;
    err.code = "ALREADY_SENT_CONFIRMED";
    throw err;
  }

  assertValidDispatchTransition(
    recipient.dispatchStatus,
    RecipientDispatchStatus.EXCLUDED
  );

  const payload = { ...((recipient.payloadSnapshot as Record<string, any>) || {}) };

  const { transferEntry } = checkOperatorLeaseAndReconciliation({
    recipientStatus: recipient.dispatchStatus,
    payload,
    currentOperatorUserId: input.userId,
    currentOperatorName: input.operatorName || "Operador",
    reconciliation: input.reconciliation,
    now,
  });

  const existingTransfers = Array.isArray(payload.operatorTransfers)
    ? payload.operatorTransfers
    : [];

  const updatedRecipient = await prisma.reactivationCampaignRecipient.update({
    where: { id: recipient.id },
    data: {
      dispatchStatus: RecipientDispatchStatus.EXCLUDED,
      failureReason: "SKIPPED_BY_USER",
      dispatchError:
        input.reason?.trim().slice(0, 300) ||
        "Pulado manualmente pelo operador na fila assistida.",
      payloadSnapshot: {
        ...payload,
        skippedAt: now.toISOString(),
        skippedByUserId: input.userId,
        leaseExpiresAt: null,
        ...(transferEntry
          ? { operatorTransfers: [...existingTransfers, transferEntry] }
          : {}),
      },
    },
  });

  const lifecycle = await advanceCampaignLifecycleOnRecipientWrite(
    prisma,
    recipient.campaign,
    now
  );

  return {
    recipient: updatedRecipient,
    isReplay: false,
    campaignStatus: lifecycle.campaignStatus,
    remainingPendingCount: lifecycle.remainingPendingCount,
  };
}

/**
 * Cancela/encerra uma campanha ativa e move destinatários pendentes para EXCLUDED.
 */
export async function cancelManualCampaign(
  prisma: ManualCampaignDb,
  input: CancelManualCampaignInput
): Promise<CancelManualCampaignResult> {
  // G21-02: Adquire advisory lock na campanha antes da leitura e cancelamento
  await acquireCampaignOperationAdvisoryLock(
    prisma,
    input.barbershopId,
    input.campaignId
  );

  const campaign = await prisma.reactivationCampaign.findFirst({
    where: {
      id: input.campaignId,
      barbershopId: input.barbershopId,
    },
  });

  if (!campaign) {
    const err: any = new Error(
      "CAMPAIGN_NOT_FOUND: Campanha não encontrada nesta barbearia."
    );
    err.status = 404;
    err.code = "CAMPAIGN_NOT_FOUND";
    throw err;
  }

  // B08: Apenas filas assistidas da Base de Clientes podem ser canceladas por este fluxo
  const origin = resolveCampaignOrigin(campaign);
  if (origin !== "CLIENTS_BASE_ASSISTED_QUEUE") {
    const err: any = new Error(
      "INVALID_CAMPAIGN_ORIGIN: Apenas filas assistidas da Base de Clientes podem ser canceladas por este endpoint."
    );
    err.status = 400;
    err.code = "INVALID_CAMPAIGN_ORIGIN";
    throw err;
  }

  // DEC-05: Permissão exclusiva WHATSAPP_ASSISTED_OPERATE (G22-01 / G23-01 / G23-02 / G24-04)
  if (input.userRole && input.userRole !== "OWNER") {
    const allowed = await checkCrmQueuePermission(
      input.memberId ?? null,
      input.userRole,
      "WHATSAPP_ASSISTED_OPERATE",
      prisma
    );
    if (!allowed) {
      const err: any = new Error(
        "PERMISSION_DENIED: Permissão 'WHATSAPP_ASSISTED_OPERATE' necessária para cancelar a fila assistida."
      );
      err.status = 403;
      err.code = "PERMISSION_DENIED";
      throw err;
    }
  }

  if (campaign.status === CampaignStatus.CANCELLED) {
    return {
      campaign,
      cancelledRecipientsCount: 0,
      isReplay: true,
    };
  }

  if (campaign.status === CampaignStatus.COMPLETED) {
    const err: any = new Error(
      "INVALID_TRANSITION: Não é possível cancelar uma campanha que já foi concluída."
    );
    err.status = 400;
    err.code = "INVALID_TRANSITION";
    throw err;
  }

  assertValidCampaignTransition(campaign.status, CampaignStatus.CANCELLED);

  const now = input.now || new Date();

  const updateManyRes = await prisma.reactivationCampaignRecipient.updateMany({
    where: {
      campaignId: campaign.id,
      barbershopId: input.barbershopId,
      dispatchStatus: {
        in: [
          RecipientDispatchStatus.READY,
          RecipientDispatchStatus.WHATSAPP_OPENED,
        ],
      },
    },
    data: {
      dispatchStatus: RecipientDispatchStatus.EXCLUDED,
      failureReason: "CAMPAIGN_CANCELLED",
      dispatchError:
        input.reason?.trim().slice(0, 300) ||
        "Fila encerrada manualmente pelo operador.",
    },
  });

  const updatedCampaign = await prisma.reactivationCampaign.update({
    where: { id: campaign.id },
    data: {
      status: CampaignStatus.CANCELLED,
      cancelledAt: now,
    },
  });

  return {
    campaign: updatedCampaign,
    cancelledRecipientsCount: updateManyRes?.count ?? 0,
    isReplay: false,
  };
}

/**
 * Consulta estritamente read-only da campanha ativa da barbearia para retomada (G1-C05).
 * Nunca realiza mutações no banco de dados.
 */
export async function getActiveManualCampaign(
  prisma: ManualCampaignDb,
  options: {
    barbershopId: string;
    origin?: ManualCampaignOrigin;
    currentUserId?: string;
    now?: Date;
  }
) {
  const now = options.now || new Date();
  const targetOrigin = options.origin || "CLIENTS_BASE_ASSISTED_QUEUE";

  // B02: Filtra por barbershopId, status ativo, destinatários pendentes e origin sem corte arbitrário (take: 5)
  const activeCandidates = await prisma.reactivationCampaign.findMany({
    where: {
      barbershopId: options.barbershopId,
      status: {
        in: [CampaignStatus.READY, CampaignStatus.IN_PROGRESS],
      },
      recipients: {
        some: {
          dispatchStatus: {
            in: [
              RecipientDispatchStatus.READY,
              RecipientDispatchStatus.WHATSAPP_OPENED,
            ],
          },
        },
      },
      ...(targetOrigin === "CLIENTS_BASE_ASSISTED_QUEUE"
        ? {
            targetSegment: {
              path: ["origin"],
              equals: "CLIENTS_BASE_ASSISTED_QUEUE",
            },
          }
        : {
            NOT: {
              targetSegment: {
                path: ["origin"],
                equals: "CLIENTS_BASE_ASSISTED_QUEUE",
              },
            },
          }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      recipients: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });

  const campaign = (activeCandidates || []).find(
    (c: any) => resolveCampaignOrigin(c) === targetOrigin
  );

  if (!campaign) {
    return null;
  }

  const sortedRecipients = [...(campaign.recipients || [])].sort(
    (a: any, b: any) =>
      ((a.payloadSnapshot as any)?.queueIndex ?? 0) -
        ((b.payloadSnapshot as any)?.queueIndex ?? 0) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      String(a.id).localeCompare(String(b.id))
  );

  const formattedRecipients = sortedRecipients.map((r: any, idx: number) => {
    const payload = (r.payloadSnapshot as Record<string, any>) || {};
    const leaseExpiresMs = payload.leaseExpiresAt
      ? new Date(payload.leaseExpiresAt).getTime()
      : 0;
    const hasLease = Boolean(payload.leaseOperatorUserId && payload.leaseExpiresAt);
    const isLeaseExpired =
      hasLease && !Number.isNaN(leaseExpiresMs) && leaseExpiresMs <= now.getTime();
    const isLockedByOtherOperator =
      hasLease &&
      Boolean(options.currentUserId) &&
      payload.leaseOperatorUserId !== options.currentUserId &&
      !isLeaseExpired;
    const requiresHumanReconciliation =
      r.dispatchStatus === RecipientDispatchStatus.WHATSAPP_OPENED &&
      Boolean(payload.leaseOperatorUserId) &&
      Boolean(options.currentUserId) &&
      payload.leaseOperatorUserId !== options.currentUserId &&
      isLeaseExpired;

    const openedAt = resolveRecipientWhatsappOpenedAt(r.payloadSnapshot);
    return {
      recipientId: r.id,
      queueIndex: payload.queueIndex ?? idx,
      customerId: r.customerId,
      customerName: r.customerNameSnapshot,
      customerPhone: r.customerPhoneSnapshot,
      dispatchStatus: r.dispatchStatus,
      failureReason: r.failureReason,
      dispatchError: r.dispatchError,
      whatsappOpenedAt: openedAt ? openedAt.toISOString() : null,
      sentConfirmedAt: r.sentConfirmedAt
        ? new Date(r.sentConfirmedAt).toISOString()
        : null,
      templateKey: payload.templateKey || "RETURN_REMINDER",
      templateLabel: payload.templateLabel || "Lembrete de retorno",
      previewMessage: payload.previewMessage || "",
      openedMessageText: payload.openedMessageText || null,
      confirmedMessageText: payload.confirmedMessageText || null,
      isCustomEdited: Boolean(payload.isCustomEdited),
      openPreparationId: payload.openPreparationId || null,
      lease: payload.leaseOperatorUserId
        ? {
            operatorUserId: payload.leaseOperatorUserId,
            operatorName: payload.leaseOperatorName || "Operador",
            acquiredAt: payload.leaseAcquiredAt || null,
            expiresAt: payload.leaseExpiresAt || null,
            isExpired: isLeaseExpired,
            isLockedByOtherOperator,
            requiresHumanReconciliation,
          }
        : null,
    };
  });

  const pendingReady = formattedRecipients.filter(
    (r) => r.dispatchStatus === RecipientDispatchStatus.READY
  ).length;
  const pendingOpened = formattedRecipients.filter(
    (r) => r.dispatchStatus === RecipientDispatchStatus.WHATSAPP_OPENED
  ).length;
  const sentConfirmed = formattedRecipients.filter(
    (r) => r.dispatchStatus === RecipientDispatchStatus.SENT_CONFIRMED
  ).length;
  const skippedOrExcluded = formattedRecipients.filter(
    (r) =>
      r.dispatchStatus === RecipientDispatchStatus.EXCLUDED ||
      r.dispatchStatus === RecipientDispatchStatus.OPTED_OUT ||
      r.dispatchStatus === RecipientDispatchStatus.FAILED
  ).length;

  const segment = (campaign.targetSegment as Record<string, any>) || {};

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    origin: resolveCampaignOrigin(campaign),
    templateKey: segment.templateKey || "RETURN_REMINDER",
    sourceFilter: segment.sourceFilter || null,
    workRoundId: segment.workRoundId || null,
    createdAt: new Date(campaign.createdAt).toISOString(),
    startedAt: campaign.startedAt
      ? new Date(campaign.startedAt).toISOString()
      : null,
    progress: {
      totalRecipients: formattedRecipients.length,
      pendingReady,
      pendingOpened,
      remainingPendingCount: pendingReady + pendingOpened,
      sentConfirmed,
      skippedOrExcluded,
    },
    recipients: formattedRecipients,
  };
}
