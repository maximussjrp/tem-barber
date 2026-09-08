import {
  Prisma,
  CustomerContactLog,
  RecipientDispatchStatus,
} from "@prisma/client";
import { DEFAULT_CRM_CHANNEL } from "./constants";

export interface CreateReactivationContactLogParams {
  barbershopId: string;
  customerId: string;
  recipientId: string;
  dispatchStatus?: RecipientDispatchStatus;
  channel?: string;
  templateKey: string;
  templateLabel: string;
  note?: string | null;
  contactedAt?: Date;
  createdByUserId: string;
  createdByMemberId?: string | null;
}

export interface CreateReactivationContactLogResult {
  contactLog: CustomerContactLog;
  isExisting: boolean;
}

/**
 * Cria ou recupera de forma idempotente um CustomerContactLog atrelado
 * a um destinatário de campanha de reativação (ReactivationCampaignRecipient).
 * Regra congelada: Contato de CRM SÓ PODE ser registrado após o status
 * atingir SENT_CONFIRMED. Chamadas em READY ou WHATSAPP_OPENED são proibidas.
 */
export async function createReactivationContactLog(
  tx: Prisma.TransactionClient,
  params: CreateReactivationContactLogParams
): Promise<CreateReactivationContactLogResult> {
  // Checa idempotência: se já existe log atrelado a este recipientId, retorna diretamente
  const existing = await tx.customerContactLog.findUnique({
    where: {
      reactivationRecipientId: params.recipientId,
    },
  });

  if (existing) {
    return {
      contactLog: existing,
      isExisting: true,
    };
  }

  // Validação estrita do status de disparo: apenas SENT_CONFIRMED pode originar CustomerContactLog
  let effectiveDispatchStatus = params.dispatchStatus;

  if (!effectiveDispatchStatus) {
    const recipient = await tx.reactivationCampaignRecipient.findUnique({
      where: { id: params.recipientId },
      select: { dispatchStatus: true },
    });
    if (!recipient) {
      throw new Error(`Reactivation campaign recipient not found: ${params.recipientId}`);
    }
    effectiveDispatchStatus = recipient.dispatchStatus;
  }

  if (effectiveDispatchStatus !== RecipientDispatchStatus.SENT_CONFIRMED) {
    throw new Error(
      `Cannot create CustomerContactLog for recipient in '${effectiveDispatchStatus}' status. Contact log is only allowed on SENT_CONFIRMED.`
    );
  }

  const contactLog = await tx.customerContactLog.create({
    data: {
      barbershop: { connect: { id: params.barbershopId } },
      customer: { connect: { id: params.customerId } },
      ...(params.recipientId ? { reactivationRecipient: { connect: { id: params.recipientId } } } : {}),
      channel: params.channel ?? DEFAULT_CRM_CHANNEL,
      templateKey: params.templateKey,
      templateLabel: params.templateLabel,
      note: params.note ?? null,
      contactedAt: params.contactedAt ?? new Date(),
      createdByUser: { connect: { id: params.createdByUserId } },
      ...(params.createdByMemberId ? { createdByMember: { connect: { id: params.createdByMemberId } } } : {}),
    },
  });

  return {
    contactLog,
    isExisting: false,
  };
}
