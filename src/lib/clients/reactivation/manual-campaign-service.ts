/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { generateWhatsAppLink } from "@/lib/whatsapp";
import {
  WHATSAPP_TEMPLATES,
  buildClientWhatsappMessage,
} from "@/lib/customer-whatsapp-templates";
import { assertValidDispatchTransition } from "./state-machines";
import { createReactivationContactLog } from "./campaign-contacts";
import { getSaoPauloCivilDateString } from "./canonical-visit-engine";
import { DEFAULT_CRM_CHANNEL, DEFAULT_CRM_PURPOSE } from "./constants";

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
  operatorUserId?: string;
  memberId?: string | null;
  operatorMemberId?: string | null;
  now?: Date;
}

export interface RevalidateAndOpenRecipientResult {
  whatsappUrl: string;
  recipient: any;
  isReplay: boolean;
}

export interface ConfirmRecipientSendInput {
  barbershopId: string;
  campaignId: string;
  recipientId: string;
  userId?: string;
  operatorUserId?: string;
  memberId?: string | null;
  operatorMemberId?: string | null;
  now?: Date;
}

export interface ConfirmRecipientSendResult {
  recipient: any;
  contactLog: any;
  isExisting: boolean;
}

/**
 * Prepara uma campanha de contato manual de reativação com validação
 * set-oriented e idempotência estrita via requestKey.
 */
export async function prepareManualReactivationCampaign(
  prisma: Prisma.TransactionClient | any,
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
      accepted: existingCampaign.recipients.map((r: any) => ({
        recipientId: r.id,
        customerId: r.customerId,
        customerName: r.customerNameSnapshot,
        customerPhone: r.customerPhoneSnapshot,
        dispatchStatus: r.dispatchStatus,
        previewMessage: (r.payloadSnapshot as any)?.previewMessage || "",
        timingState: r.timingStateSnapshot,
        score: r.scoreSnapshot,
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

  // 3. Set-oriented fetch of customer data, consent, blocks, upcoming appointments, contact logs
  const [customers, consents, blocks, upcomingAppointments, recentLogs] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { in: selectedIds },
        customerBarbershopLinks: { some: { barbershopId: input.barbershopId } },
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

  const customerMap = new Map(customers.map((c: any) => [c.id, c]));
  const consentMap = new Map(consents.map((c: any) => [c.customerId, c.status]));
  const blockSet = new Set(blocks.map((b: any) => b.userId));
  const upcomingSet = new Set(upcomingAppointments.map((a: any) => a.customerId));
  const cooldownSet = new Set(recentLogs.map((l: any) => l.customerId));

  const acceptedCandidates: Array<{
    customer: { id: string; name: string; phone: string };
    validPhone: string;
    previewMessage: string;
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

    if (blockSet.has(custId)) {
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
  const campaignName = input.name?.trim() || `Reativação Manual — ${getSaoPauloCivilDateString(now)}`;
  const effectiveUserId = input.userId || input.operatorUserId || "";
  const effectiveMemberId = input.memberId || input.operatorMemberId || null;

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
        selectedCustomerIds: selectedIds,
        templateKey: input.templateKey,
        rejected: rejectedCandidates,
        preparedAt: now.toISOString(),
      },
      createdByUser: { connect: { id: effectiveUserId } },
      ...(effectiveMemberId ? { createdByMember: { connect: { id: effectiveMemberId } } } : {}),
      totalRecipients: acceptedCandidates.length,
      recipients: {
        create: acceptedCandidates.map((cand) => ({
          barbershop: { connect: { id: input.barbershopId } },
          customer: { connect: { id: cand.customer.id } },
          customerNameSnapshot: cand.customer.name,
          customerPhoneSnapshot: cand.validPhone,
          timingStateSnapshot: CustomerTimingState.DUE,
          scoreSnapshot: 50,
          dispatchStatus: RecipientDispatchStatus.READY,
          payloadSnapshot: {
            templateKey: input.templateKey,
            templateLabel: template.label,
            previewMessage: cand.previewMessage,
          },
        })),
      },
    },
    include: {
      recipients: true,
    },
  });

  return {
    campaign: createdCampaign,
    accepted: createdCampaign.recipients.map((r: any) => ({
      recipientId: r.id,
      customerId: r.customerId,
      customerName: r.customerNameSnapshot,
      customerPhone: r.customerPhoneSnapshot,
      dispatchStatus: r.dispatchStatus,
      previewMessage: (r.payloadSnapshot as any)?.previewMessage || "",
      timingState: r.timingStateSnapshot,
      score: r.scoreSnapshot,
    })),
    rejected: rejectedCandidates,
    isExisting: false,
  };
}

/**
 * Revalida o estado ao vivo do destinatário antes da abertura do WhatsApp.
 * Bloqueia se o consentimento mudou para OPTED_OUT, se houve agendamento,
 * bloqueio ou contato recente.
 * Transita READY -> WHATSAPP_OPENED de forma estrita.
 * Gera wa.me seguro sem criar CustomerContactLog.
 */
export async function revalidateAndOpenManualRecipient(
  prisma: Prisma.TransactionClient | any,
  input: RevalidateAndOpenRecipientInput
): Promise<RevalidateAndOpenRecipientResult> {
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
    const err: any = new Error("RECIPIENT_NOT_FOUND: Recipient not found in tenant campaign.");
    err.status = 404;
    throw err;
  }

  const payload = (recipient.payloadSnapshot as any) || {};
  const previewMessage = payload.previewMessage || "";

  // 1. Replay idempotente seguro se já estiver em WHATSAPP_OPENED
  if (recipient.dispatchStatus === RecipientDispatchStatus.WHATSAPP_OPENED) {
    const whatsappUrl = generateWhatsAppLink(
      recipient.customerPhoneSnapshot,
      previewMessage
    );
    return {
      whatsappUrl: whatsappUrl || "",
      recipient,
      isReplay: true,
    };
  }

  // 2. Se já foi enviado/confirmado
  if (recipient.dispatchStatus === RecipientDispatchStatus.SENT_CONFIRMED) {
    const whatsappUrl = generateWhatsAppLink(
      recipient.customerPhoneSnapshot,
      previewMessage
    );
    return {
      whatsappUrl: whatsappUrl || "",
      recipient,
      isReplay: true,
    };
  }

  // 3. Validação estrita da máquina de estados
  assertValidDispatchTransition(
    recipient.dispatchStatus,
    RecipientDispatchStatus.WHATSAPP_OPENED
  );

  const now = input.now || new Date();
  const cooldownCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // 4. Stale-state live revalidation
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
        userId: recipient.customerId,
        active: true,
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

  if (!consent || consent.status !== "OPTED_IN") {
    await prisma.reactivationCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        dispatchStatus: RecipientDispatchStatus.OPTED_OUT,
        dispatchError: "Consentimento não é OPTED_IN no momento do disparo.",
      },
    });
    const err: any = new Error("STALE_CONSENT: Customer consent is no longer OPTED_IN.");
    err.status = 400;
    err.code = "STALE_CONSENT";
    throw err;
  }

  const isValidPhone = validateBrazilianMobilePhone(recipient.customerPhoneSnapshot);
  const normalizedPhone = normalizeBrazilianMobilePhone(recipient.customerPhoneSnapshot);
  if (!isValidPhone || !normalizedPhone) {
    await prisma.reactivationCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        dispatchStatus: RecipientDispatchStatus.FAILED,
        dispatchError: "Telefone do cliente inválido.",
      },
    });
    const err: any = new Error("STALE_INVALID_PHONE: Customer phone number is invalid.");
    err.status = 400;
    err.code = "STALE_INVALID_PHONE";
    throw err;
  }

  if (block) {
    await prisma.reactivationCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        dispatchStatus: RecipientDispatchStatus.EXCLUDED,
        dispatchError: "Cliente foi bloqueado na barbearia.",
      },
    });
    const err: any = new Error("STALE_BLOCKED: Customer was blocked.");
    err.status = 400;
    err.code = "STALE_BLOCKED";
    throw err;
  }

  if (upcomingAppt) {
    await prisma.reactivationCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        dispatchStatus: RecipientDispatchStatus.EXCLUDED,
        dispatchError: "Cliente agendou um horário recentemente.",
      },
    });
    const err: any = new Error("STALE_UPCOMING_APPOINTMENT: Customer has an upcoming appointment.");
    err.status = 400;
    err.code = "STALE_UPCOMING_APPOINTMENT";
    throw err;
  }

  if (recentContact) {
    await prisma.reactivationCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        dispatchStatus: RecipientDispatchStatus.EXCLUDED,
        dispatchError: "Cliente contatado nos últimos 14 dias.",
      },
    });
    const err: any = new Error("STALE_RECENT_CONTACT: Customer was contacted within cooldown.");
    err.status = 400;
    err.code = "STALE_RECENT_CONTACT";
    throw err;
  }

  // 5. Transita para WHATSAPP_OPENED
  const updatedRecipient = await prisma.reactivationCampaignRecipient.update({
    where: { id: recipient.id },
    data: {
      dispatchStatus: RecipientDispatchStatus.WHATSAPP_OPENED,
      dispatchAttemptCount: { increment: 1 },
    },
  });

  const whatsappUrl = generateWhatsAppLink(
    normalizedPhone,
    previewMessage
  );

  return {
    whatsappUrl: whatsappUrl || "",
    recipient: updatedRecipient,
    isReplay: false,
  };
}

/**
 * Confirma o envio manual pelo operador e cria o CustomerContactLog idempotente.
 */
export async function confirmManualRecipientSend(
  prisma: Prisma.TransactionClient | any,
  input: ConfirmRecipientSendInput
): Promise<ConfirmRecipientSendResult> {
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
    const err: any = new Error("RECIPIENT_NOT_FOUND: Recipient not found in tenant campaign.");
    err.status = 404;
    throw err;
  }

  // Replay idempotente se já estiver SENT_CONFIRMED
  if (recipient.dispatchStatus === RecipientDispatchStatus.SENT_CONFIRMED) {
    const existingLog = recipient.customerContactLog || (await prisma.customerContactLog.findUnique({
      where: { reactivationRecipientId: recipient.id },
    }));

    return {
      recipient,
      contactLog: existingLog,
      isExisting: true,
    };
  }

  // Validação da transição WHATSAPP_OPENED -> SENT_CONFIRMED
  assertValidDispatchTransition(
    recipient.dispatchStatus,
    RecipientDispatchStatus.SENT_CONFIRMED
  );

  const payload = (recipient.payloadSnapshot as any) || {};
  const templateKey = payload.templateKey || "RETURN_REMINDER";
  const templateLabel = payload.templateLabel || "Lembrete de retorno";
  const now = input.now || new Date();

  // Executa transição e criação do log em transação
  const updatedRecipient = await prisma.reactivationCampaignRecipient.update({
    where: { id: recipient.id },
    data: {
      dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
      sentConfirmedAt: now,
    },
  });

  await prisma.reactivationCampaign.update({
    where: { id: recipient.campaignId },
    data: {
      sentCount: { increment: 1 },
    },
  });

  const logResult = await createReactivationContactLog(prisma, {
    barbershopId: input.barbershopId,
    customerId: recipient.customerId,
    recipientId: recipient.id,
    dispatchStatus: RecipientDispatchStatus.SENT_CONFIRMED,
    channel: DEFAULT_CRM_CHANNEL,
    templateKey,
    templateLabel,
    note: `Disparo manual de reativação via WhatsApp (Campanha: ${recipient.campaign?.name || "Reativação"})`,
    contactedAt: now,
    createdByUserId: input.userId || input.operatorUserId || "",
    createdByMemberId: input.memberId || input.operatorMemberId || null,
  });

  return {
    recipient: updatedRecipient,
    contactLog: logResult.contactLog,
    isExisting: logResult.isExisting,
  };
}
