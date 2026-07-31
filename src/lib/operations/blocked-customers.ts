import prisma from "@/lib/prisma";
import { AppointmentStatus } from "@prisma/client";
import { normalizeBrazilPhone, sanitizePhoneForLog, getBrazilianPhoneVariants, onlyDigits } from "@/lib/phone-utils";

export class CustomerBlockError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "CustomerBlockError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Checks if a customer/phone is blocked in a barbershop.
 */
export async function isCustomerOrPhoneBlocked(params: {
  barbershopId: string;
  phone?: string | null;
  userId?: string | null;
}): Promise<boolean> {
  const { barbershopId, phone, userId } = params;

  if (!barbershopId || !prisma?.barbershopBlockedCustomer) return false;

  const phoneVariants = phone ? getBrazilianPhoneVariants(phone) : [];
  const rawDigits = phone ? onlyDigits(phone) : "";
  if (rawDigits && !phoneVariants.includes(rawDigits)) {
    phoneVariants.push(rawDigits);
  }

  const blocked = await prisma.barbershopBlockedCustomer.findFirst({
    where: {
      barbershopId,
      active: true,
      OR: [
        ...(userId ? [{ userId }] : []),
        ...(phoneVariants.length > 0 ? [{ phoneNormalized: { in: phoneVariants } }] : []),
      ],
    },
  });

  return Boolean(blocked);
}

/**
 * Blocks a customer or phone for a barbershop.
 */
export async function blockCustomer(params: {
  barbershopId: string;
  userId?: string | null;
  phone?: string | null;
  reason: string;
  executorUserId: string;
  executorMemberId?: string | null;
}) {
  const { barbershopId, userId, phone, reason, executorUserId, executorMemberId } = params;

  if (!reason || reason.trim().length < 5) {
    throw new CustomerBlockError("INVALID_REASON", "O motivo do bloqueio é obrigatório e deve ter no mínimo 5 caracteres.", 400);
  }

  const targetUserId = userId ?? null;
  let rawPhone = phone ?? "";
  let nameSnapshot: string | null = null;

  if (targetUserId) {
    const user = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (user) {
      if (!rawPhone) rawPhone = user.phone;
      nameSnapshot = user.name;
    }
  }

  const phoneNormalized = normalizeBrazilPhone(rawPhone) || onlyDigits(rawPhone);

  if (!phoneNormalized) {
    throw new CustomerBlockError("INVALID_PAYLOAD", "Informe um usuário ou telefone válido para realizar o bloqueio.", 400);
  }

  // Check for future active appointments to cancel safely
  const now = new Date();
  const futureActiveAppts = await prisma.appointment.findMany({
    where: {
      barbershopId,
      status: { in: ["PENDING", "CONFIRMED"] },
      dateTime: { gte: now },
      OR: [
        ...(targetUserId ? [{ customerId: targetUserId }] : []),
        { customer: { phone: { in: getBrazilianPhoneVariants(rawPhone) } } },
      ],
    },
    include: {
      comandas: true,
    },
  });

  // Check if any linked comanda is open
  const hasOpenComanda = futureActiveAppts.some((appt) =>
    appt.comandas.some((c) => ["OPEN", "IN_SERVICE"].includes(c.status))
  );

  if (hasOpenComanda) {
    throw new CustomerBlockError(
      "OPEN_COMANDA_EXISTS",
      "Não foi possível concluir o bloqueio automático: existe uma comanda aberta vinculada a um agendamento futuro deste cliente.",
      422
    );
  }

  // Cancel future active appointments
  for (const appt of futureActiveAppts) {
    await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        status: AppointmentStatus.CANCELLED,
        notes: appt.notes
          ? `${appt.notes}\n[CANCELAMENTO AUTOMÁTICO - BLOQUEIO DE CLIENTE]`
          : "[CANCELAMENTO AUTOMÁTICO - BLOQUEIO DE CLIENTE]",
      },
    });
  }

  // Upsert blocked customer record
  const existing = await prisma.barbershopBlockedCustomer.findUnique({
    where: {
      barbershopId_phoneNormalized: {
        barbershopId,
        phoneNormalized,
      },
    },
  });

  const block = await prisma.barbershopBlockedCustomer.upsert({
    where: {
      barbershopId_phoneNormalized: {
        barbershopId,
        phoneNormalized,
      },
    },
    create: {
      barbershopId,
      userId: targetUserId,
      phoneNormalized,
      nameSnapshot,
      reason: reason.trim(),
      active: true,
      blockedByUserId: executorUserId,
      blockedByMemberId: executorMemberId ?? null,
      blockedAt: now,
    },
    update: {
      userId: targetUserId ?? existing?.userId ?? null,
      nameSnapshot: nameSnapshot ?? existing?.nameSnapshot ?? null,
      reason: reason.trim(),
      active: true,
      blockedByUserId: executorUserId,
      blockedByMemberId: executorMemberId ?? null,
      blockedAt: now,
      unblockedByUserId: null,
      unblockedByMemberId: null,
      unblockedAt: null,
      unblockReason: null,
    },
  });

  return {
    block,
    cancelledFutureAppointmentsCount: futureActiveAppts.length,
  };
}

/**
 * Unblocks a customer for a barbershop.
 */
export async function unblockCustomer(params: {
  barbershopId: string;
  blockId: string;
  reason: string;
  executorUserId: string;
  executorMemberId?: string | null;
}) {
  const { barbershopId, blockId, reason, executorUserId, executorMemberId } = params;

  if (!reason || reason.trim().length < 5) {
    throw new CustomerBlockError("INVALID_REASON", "O motivo do desbloqueio é obrigatório e deve ter no mínimo 5 caracteres.", 400);
  }

  const existing = await prisma.barbershopBlockedCustomer.findFirst({
    where: {
      id: blockId,
      barbershopId,
    },
  });

  if (!existing) {
    throw new CustomerBlockError("BLOCK_NOT_FOUND", "Registro de bloqueio não encontrado.", 404);
  }

  const updated = await prisma.barbershopBlockedCustomer.update({
    where: { id: blockId },
    data: {
      active: false,
      unblockedByUserId: executorUserId,
      unblockedByMemberId: executorMemberId ?? null,
      unblockedAt: new Date(),
      unblockReason: reason.trim(),
    },
  });

  return updated;
}

/**
 * Lists blocked customers for a barbershop with sanitized phone numbers.
 */
export async function listBlockedCustomers(params: {
  barbershopId: string;
  page?: number;
  pageSize?: number;
  activeOnly?: boolean;
}) {
  const { barbershopId, page = 1, pageSize = 30, activeOnly = false } = params;

  const where = {
    barbershopId,
    ...(activeOnly ? { active: true } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.barbershopBlockedCustomer.count({ where }),
    prisma.barbershopBlockedCustomer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: {
          select: { id: true, name: true, phone: true },
        },
      },
    }),
  ]);

  const sanitizedItems = items.map((b) => ({
    id: b.id,
    barbershopId: b.barbershopId,
    userId: b.userId,
    nameSnapshot: b.nameSnapshot || b.user?.name || "Cliente sem nome",
    phoneSanitized: sanitizePhoneForLog(b.phoneNormalized),
    reason: b.reason,
    active: b.active,
    blockedAt: b.blockedAt,
    unblockedAt: b.unblockedAt,
    unblockReason: b.unblockReason,
  }));

  return {
    total,
    page,
    pageSize,
    blocks: sanitizedItems,
  };
}
