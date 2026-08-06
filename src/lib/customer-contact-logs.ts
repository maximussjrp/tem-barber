import { Prisma } from "@prisma/client";

export const CONTACT_CHANNELS = ["WHATSAPP", "PHONE", "IN_PERSON", "EMAIL", "OTHER"] as const;
export const CONTACT_TEMPLATE_LABELS = {
  APPOINTMENT_INVITE: "Convite/agendamento",
  WEEK_OPEN: "Agenda da semana aberta",
  RETURN_REMINDER: "Lembrete de retorno",
  POST_SERVICE_FEEDBACK: "Pós-atendimento/feedback",
  CUSTOM: "Personalizado",
} as const;

export type ContactChannel = (typeof CONTACT_CHANNELS)[number];
export type ContactTemplateKey = keyof typeof CONTACT_TEMPLATE_LABELS;

type CustomerContactClient = Pick<
  Prisma.TransactionClient,
  "customerBarbershopLink" | "appointment" | "comanda" | "customerClubSubscription" | "customerContactLog"
>;

export type CreateCustomerContactLogInput = {
  channel?: unknown;
  templateKey?: unknown;
  note?: unknown;
  contactedAt?: unknown;
};

export type CustomerContactLogSession = {
  barbershopId: string;
  userId: string;
  memberId: string | null;
};

const MAX_NOTE_LENGTH = 500;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function isContactChannel(value: unknown): value is ContactChannel {
  return typeof value === "string" && CONTACT_CHANNELS.includes(value as ContactChannel);
}

export function isContactTemplateKey(value: unknown): value is ContactTemplateKey {
  return typeof value === "string" && value in CONTACT_TEMPLATE_LABELS;
}

export async function hasBarbershopCustomerAccess(
  client: CustomerContactClient,
  barbershopId: string,
  customerId: string
) {
  const [link, appointmentCount, comandaCount, clubCount] = await Promise.all([
    client.customerBarbershopLink.findUnique({
      where: { barbershopId_customerId: { barbershopId, customerId } },
      select: { id: true },
    }),
    client.appointment.count({ where: { customerId, barbershopId } }),
    client.comanda.count({ where: { customerId, barbershopId } }),
    client.customerClubSubscription.count({ where: { customerId, barbershopId } }),
  ]);

  return Boolean(link) || appointmentCount > 0 || comandaCount > 0 || clubCount > 0;
}

export async function listCustomerContactLogs(
  client: CustomerContactClient,
  barbershopId: string,
  customerId: string
) {
  const hasAccess = await hasBarbershopCustomerAccess(client, barbershopId, customerId);
  if (!hasAccess) return { error: "CUSTOMER_NOT_FOUND" as const };

  const logs = await client.customerContactLog.findMany({
    where: { barbershopId, customerId },
    orderBy: { contactedAt: "desc" },
    select: {
      id: true,
      channel: true,
      templateKey: true,
      templateLabel: true,
      note: true,
      contactedAt: true,
      createdAt: true,
      createdByUser: { select: { id: true, name: true } },
      createdByMember: { select: { id: true, user: { select: { name: true } } } },
    },
  });

  return { logs: logs.map(serializeCustomerContactLog) };
}

export async function createCustomerContactLog(
  client: CustomerContactClient,
  session: CustomerContactLogSession,
  customerId: string,
  input: CreateCustomerContactLogInput,
  now = new Date()
) {
  const hasAccess = await hasBarbershopCustomerAccess(client, session.barbershopId, customerId);
  if (!hasAccess) return { error: "CUSTOMER_NOT_FOUND" as const, status: 404 };

  if (!isContactChannel(input.channel)) {
    return { error: "INVALID_CHANNEL" as const, message: "Canal de contato invalido.", status: 400 };
  }

  if (!isContactTemplateKey(input.templateKey)) {
    return { error: "INVALID_TEMPLATE" as const, message: "Template de contato invalido.", status: 400 };
  }

  let note: string | null = null;
  if (input.note !== undefined && input.note !== null) {
    if (typeof input.note !== "string") {
      return { error: "INVALID_NOTE" as const, message: "Observacao invalida.", status: 400 };
    }
    note = input.note.trim() || null;
    if (note && note.length > MAX_NOTE_LENGTH) {
      return { error: "NOTE_TOO_LONG" as const, message: "Observacao deve ter no maximo 500 caracteres.", status: 400 };
    }
  }

  let contactedAt = now;
  if (input.contactedAt !== undefined && input.contactedAt !== null && input.contactedAt !== "") {
    if (typeof input.contactedAt !== "string") {
      return { error: "INVALID_CONTACTED_AT" as const, message: "Data de contato invalida.", status: 400 };
    }
    contactedAt = new Date(input.contactedAt);
    if (Number.isNaN(contactedAt.getTime())) {
      return { error: "INVALID_CONTACTED_AT" as const, message: "Data de contato invalida.", status: 400 };
    }
  }

  if (contactedAt.getTime() - now.getTime() > FUTURE_TOLERANCE_MS) {
    return { error: "CONTACTED_AT_IN_FUTURE" as const, message: "Data de contato nao pode estar no futuro.", status: 400 };
  }

  const created = await client.customerContactLog.create({
    data: {
      barbershopId: session.barbershopId,
      customerId,
      channel: input.channel,
      templateKey: input.templateKey,
      templateLabel: CONTACT_TEMPLATE_LABELS[input.templateKey],
      note,
      contactedAt,
      createdByUserId: session.userId,
      createdByMemberId: session.memberId,
    },
    select: {
      id: true,
      channel: true,
      templateKey: true,
      templateLabel: true,
      note: true,
      contactedAt: true,
      createdAt: true,
      createdByUser: { select: { id: true, name: true } },
      createdByMember: { select: { id: true, user: { select: { name: true } } } },
    },
  });

  return { log: serializeCustomerContactLog(created) };
}

function serializeCustomerContactLog(log: {
  id: string;
  channel: string;
  templateKey: string;
  templateLabel: string;
  note: string | null;
  contactedAt: Date;
  createdAt: Date;
  createdByUser: { id: string; name: string };
  createdByMember: { id: string; user: { name: string } } | null;
}) {
  return {
    id: log.id,
    channel: log.channel,
    templateKey: log.templateKey,
    templateLabel: log.templateLabel,
    note: log.note,
    contactedAt: log.contactedAt.toISOString(),
    createdAt: log.createdAt.toISOString(),
    createdBy: {
      userId: log.createdByUser.id,
      name: log.createdByUser.name,
      memberId: log.createdByMember?.id ?? null,
      memberName: log.createdByMember?.user.name ?? null,
    },
  };
}
