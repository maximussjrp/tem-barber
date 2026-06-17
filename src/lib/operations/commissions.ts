import {
  CommissionConfigType,
  CommissionEntryStatus,
  CommissionPeriodStatus,
  ComandaItemStatus,
  ComandaItemType,
  Prisma,
} from "@prisma/client";
import { fromCents, nonNegativeCents, toCents } from "./money";

export class CommissionError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export function competenceFromDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildCommissionScopeKey(input: {
  memberId?: string | null;
  serviceId?: string | null;
  categoryId?: string | null;
}) {
  if (input.memberId && input.serviceId) return `member:${input.memberId}:service:${input.serviceId}`;
  if (input.memberId && input.categoryId) return `member:${input.memberId}:category:${input.categoryId}`;
  if (input.memberId) return `member:${input.memberId}:default`;
  if (input.serviceId) return `service:${input.serviceId}`;
  if (input.categoryId) return `category:${input.categoryId}`;
  return "barbershop:default";
}

export function validateCommissionConfig(input: {
  type: CommissionConfigType;
  value: string | number | Prisma.Decimal;
  memberId?: string | null;
  serviceId?: string | null;
  categoryId?: string | null;
}) {
  const value = nonNegativeCents(input.value, "Comissao");
  if (input.type === "PERCENTAGE" && value > 10000) {
    throw new CommissionError("INVALID_PERCENTAGE", "Percentual deve estar entre 0 e 100.", 422);
  }
  if (input.serviceId && input.categoryId) {
    throw new CommissionError("AMBIGUOUS_SCOPE", "Use servico ou categoria, nao ambos.", 422);
  }
}

async function assertScopeBelongsToTenant(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  input: { memberId?: string | null; serviceId?: string | null; categoryId?: string | null }
) {
  const checks: Promise<unknown>[] = [];
  if (input.memberId) {
    checks.push(
      tx.barbershopMember.findFirstOrThrow({ where: { id: input.memberId, barbershopId } })
    );
  }
  if (input.serviceId) {
    checks.push(tx.service.findFirstOrThrow({ where: { id: input.serviceId, barbershopId } }));
  }
  if (input.categoryId) {
    checks.push(tx.category.findFirstOrThrow({ where: { id: input.categoryId, barbershopId } }));
  }
  try {
    await Promise.all(checks);
  } catch {
    throw new CommissionError("INVALID_SCOPE", "Configuracao pertence a outra barbearia ou nao existe.", 400);
  }
}

export async function upsertCommissionConfig(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    memberId?: string | null;
    serviceId?: string | null;
    categoryId?: string | null;
    type: CommissionConfigType;
    value: string | number | Prisma.Decimal;
    active?: boolean;
  }
) {
  validateCommissionConfig(input);
  await assertScopeBelongsToTenant(tx, input.barbershopId, input);
  const scopeKey = buildCommissionScopeKey(input);

  return tx.commissionConfig.upsert({
    where: { barbershopId_scopeKey: { barbershopId: input.barbershopId, scopeKey } },
    create: {
      barbershopId: input.barbershopId,
      memberId: input.memberId ?? null,
      serviceId: input.serviceId ?? null,
      categoryId: input.categoryId ?? null,
      scopeKey,
      type: input.type,
      value: input.value,
      active: input.active ?? true,
    },
    update: {
      type: input.type,
      value: input.value,
      active: input.active ?? true,
    },
  });
}

async function resolveCommissionConfig(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    memberId: string;
    serviceId: string;
  }
) {
  const service = await tx.service.findFirst({
    where: { id: input.serviceId, barbershopId: input.barbershopId },
    select: { id: true, categoryId: true },
  });
  if (!service) return null;

  const priority = [
    buildCommissionScopeKey({ memberId: input.memberId, serviceId: input.serviceId }),
    buildCommissionScopeKey({ memberId: input.memberId, categoryId: service.categoryId }),
    buildCommissionScopeKey({ memberId: input.memberId }),
    buildCommissionScopeKey({ serviceId: input.serviceId }),
    buildCommissionScopeKey({ categoryId: service.categoryId }),
    buildCommissionScopeKey({}),
  ];

  const configs = await tx.commissionConfig.findMany({
    where: { barbershopId: input.barbershopId, active: true, scopeKey: { in: priority } },
  });
  return priority.map((scopeKey) => configs.find((config) => config.scopeKey === scopeKey)).find(Boolean) ?? null;
}

function calculateCommissionAmount(
  baseAmount: Prisma.Decimal,
  type: CommissionConfigType,
  value: Prisma.Decimal
) {
  const base = toCents(baseAmount);
  if (type === "FIXED_VALUE") return fromCents(Math.min(toCents(value), base));
  return fromCents(Math.round((base * Number(value)) / 100));
}

function nextEntryStatus(input: {
  generated: number;
  released: number;
  paid: number;
  reversed: number;
}): CommissionEntryStatus {
  if (input.paid >= input.generated && input.generated > 0) return "PAID";
  if (input.reversed > 0 && input.released <= 0) return "REVERSED";
  if (input.released >= input.generated && input.generated > 0) return "RELEASED";
  if (input.released > 0) return "PARTIALLY_RELEASED";
  return "GENERATED";
}

async function syncOpenCommissionPeriod(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  memberId: string,
  competence: string
) {
  const entries = await tx.commissionEntry.findMany({ where: { barbershopId, memberId, competence } });
  const generated = entries.reduce((sum, entry) => sum + toCents(entry.generatedAmount), 0);
  const released = entries.reduce((sum, entry) => sum + toCents(entry.releasedAmount), 0);
  const paid = entries.reduce((sum, entry) => sum + toCents(entry.paidAmount), 0);
  const reversed = entries.reduce((sum, entry) => sum + toCents(entry.reversedAmount), 0);
  const balance = Math.max(0, released - paid);

  const existing = await tx.commissionPeriod.findUnique({
    where: { barbershopId_memberId_competence: { barbershopId, memberId, competence } },
  });
  if (existing && existing.status !== "OPEN") return existing;

  return tx.commissionPeriod.upsert({
    where: { barbershopId_memberId_competence: { barbershopId, memberId, competence } },
    create: {
      barbershopId,
      memberId,
      competence,
      generatedAmount: fromCents(generated),
      releasedAmount: fromCents(released),
      paidAmount: fromCents(paid),
      reversedAmount: fromCents(reversed),
      balanceAmount: fromCents(balance),
    },
    update: {
      generatedAmount: fromCents(generated),
      releasedAmount: fromCents(released),
      paidAmount: fromCents(paid),
      reversedAmount: fromCents(reversed),
      balanceAmount: fromCents(balance),
    },
  });
}

export async function generateCommissionsForComanda(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  comandaId: string
) {
  const comanda = await tx.comanda.findFirst({
    where: { id: comandaId, barbershopId },
    include: { items: true },
  });
  if (!comanda) throw new CommissionError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);

  const createdMembers = new Set<string>();
  for (const item of comanda.items) {
    if (
      item.type !== ComandaItemType.SERVICE ||
      item.status === ComandaItemStatus.CANCELLED ||
      item.status !== ComandaItemStatus.DONE ||
      !item.executorId ||
      !item.serviceId ||
      toCents(item.total) <= 0
    ) {
      continue;
    }

    const existing = await tx.commissionEntry.findUnique({ where: { comandaItemId: item.id } });
    if (existing) {
      createdMembers.add(existing.memberId);
      continue;
    }

    const config = await resolveCommissionConfig(tx, {
      barbershopId,
      memberId: item.executorId,
      serviceId: item.serviceId,
    });
    if (!config) continue;

    const generatedAmount = calculateCommissionAmount(item.total, config.type, config.value);
    const competence = competenceFromDate(item.completedAt ?? comanda.closedAt ?? comanda.openedAt);
    const entry = await tx.commissionEntry.create({
      data: {
        barbershopId,
        comandaItemId: item.id,
        memberId: item.executorId,
        configId: config.id,
        configSnapshot: {
          id: config.id,
          scopeKey: config.scopeKey,
          type: config.type,
          value: config.value.toString(),
          createdAt: config.createdAt.toISOString(),
        },
        baseAmount: item.total,
        generatedAmount,
        competence,
      },
    });
    createdMembers.add(entry.memberId);
  }

  for (const memberId of createdMembers) {
    const competences = await tx.commissionEntry.findMany({
      where: { barbershopId, memberId },
      distinct: ["competence"],
      select: { competence: true },
    });
    for (const row of competences) {
      await syncOpenCommissionPeriod(tx, barbershopId, memberId, row.competence);
    }
  }
}

async function getNetPaidCents(tx: Prisma.TransactionClient, barbershopId: string, comandaId: string) {
  const payments = await tx.payment.findMany({
    where: { barbershopId, comandaId, status: "CONFIRMED" },
  });
  return payments.reduce((sum, payment) => {
    return sum + Math.max(0, toCents(payment.amount) - toCents(payment.refundedAmount));
  }, 0);
}

export async function syncCommissionReleaseForComanda(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  comandaId: string,
  description = "Liberacao proporcional por pagamento"
) {
  await generateCommissionsForComanda(tx, barbershopId, comandaId);
  const comanda = await tx.comanda.findFirst({
    where: { id: comandaId, barbershopId },
    include: { items: { include: { commissionEntry: true } } },
  });
  if (!comanda || toCents(comanda.total) <= 0) return;

  const netPaid = Math.min(toCents(comanda.total), await getNetPaidCents(tx, barbershopId, comandaId));
  const touched = new Set<string>();

  for (const item of comanda.items) {
    const entry = item.commissionEntry;
    if (!entry) continue;
    const generated = toCents(entry.generatedAmount);
    const targetReleased = Math.min(generated, Math.round((generated * netPaid) / toCents(comanda.total)));
    const currentReleased = toCents(entry.releasedAmount);
    const delta = targetReleased - currentReleased;
    if (delta === 0) {
      touched.add(entry.memberId);
      continue;
    }

    if (delta > 0) {
      const released = currentReleased + delta;
      await tx.commissionAdjustment.create({
        data: {
          barbershopId,
          entryId: entry.id,
          memberId: entry.memberId,
          type: "RELEASE",
          amount: fromCents(delta),
          competence: entry.competence,
          description,
        },
      });
      await tx.commissionEntry.update({
        where: { id: entry.id },
        data: {
          releasedAmount: fromCents(released),
          status: nextEntryStatus({
            generated,
            released,
            paid: toCents(entry.paidAmount),
            reversed: toCents(entry.reversedAmount),
          }),
        },
      });
    } else {
      await reverseCommissionEntry(tx, barbershopId, entry.id, Math.abs(delta), null, "Reversao proporcional por estorno");
    }
    touched.add(entry.memberId);
  }

  for (const memberId of touched) {
    const entries = await tx.commissionEntry.findMany({
      where: { barbershopId, memberId, comandaItem: { comandaId } },
      select: { competence: true },
      distinct: ["competence"],
    });
    for (const entry of entries) {
      await syncOpenCommissionPeriod(tx, barbershopId, memberId, entry.competence);
    }
  }
}

export async function reverseCommissionEntry(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  entryId: string,
  cents: number,
  paymentId: string | null,
  description: string
) {
  const entry = await tx.commissionEntry.findFirst({
    where: { id: entryId, barbershopId },
  });
  if (!entry || cents <= 0) return;

  const alreadyPaid = toCents(entry.paidAmount) > 0 || entry.status === "PAID";
  if (alreadyPaid) {
    await tx.commissionAdjustment.create({
      data: {
        barbershopId,
        entryId: entry.id,
        memberId: entry.memberId,
        paymentId,
        type: "PAID_ADJUSTMENT",
        amount: fromCents(-cents),
        competence: competenceFromDate(new Date()),
        description: `${description}. Ajuste negativo para proximo periodo.`,
      },
    });
    return;
  }

  const reversible = Math.min(cents, toCents(entry.releasedAmount));
  const released = Math.max(0, toCents(entry.releasedAmount) - reversible);
  const reversed = toCents(entry.reversedAmount) + reversible;
  await tx.commissionAdjustment.create({
    data: {
      barbershopId,
      entryId: entry.id,
      memberId: entry.memberId,
      paymentId,
      type: "REVERSAL",
      amount: fromCents(-reversible),
      competence: entry.competence,
      description,
    },
  });
  await tx.commissionEntry.update({
    where: { id: entry.id },
    data: {
      releasedAmount: fromCents(released),
      reversedAmount: fromCents(reversed),
      status: nextEntryStatus({
        generated: toCents(entry.generatedAmount),
        released,
        paid: toCents(entry.paidAmount),
        reversed,
      }),
    },
  });
}

export async function closeCommissionPeriod(
  tx: Prisma.TransactionClient,
  input: { barbershopId: string; memberId: string; competence: string; userId: string }
) {
  const period = await syncOpenCommissionPeriod(tx, input.barbershopId, input.memberId, input.competence);
  if (period.status === "PAID") {
    throw new CommissionError("PERIOD_PAID", "Periodo pago nao pode ser fechado novamente.", 422);
  }
  if (period.status === "CLOSED") return period;
  return tx.commissionPeriod.update({
    where: { id: period.id },
    data: { status: "CLOSED", closedAt: new Date(), closedById: input.userId },
  });
}

export async function payCommissionPeriod(
  tx: Prisma.TransactionClient,
  input: { barbershopId: string; periodId: string; paidByMemberId: string; userId: string }
) {
  const period = await tx.commissionPeriod.findFirst({
    where: { id: input.periodId, barbershopId: input.barbershopId },
  });
  if (!period) throw new CommissionError("PERIOD_NOT_FOUND", "Periodo nao encontrado.", 404);
  if (period.memberId === input.paidByMemberId) {
    throw new CommissionError("SELF_PAYMENT_FORBIDDEN", "Profissional nao pode pagar a propria comissao.", 403);
  }
  if (period.status === CommissionPeriodStatus.PAID) return period;

  const entries = await tx.commissionEntry.findMany({
    where: {
      barbershopId: input.barbershopId,
      memberId: period.memberId,
      competence: period.competence,
      status: { notIn: ["PAID", "REVERSED"] },
    },
  });
  for (const entry of entries) {
    const payable = Math.max(0, toCents(entry.releasedAmount) - toCents(entry.paidAmount));
    if (payable <= 0) continue;
    await tx.commissionEntry.update({
      where: { id: entry.id },
      data: { paidAmount: fromCents(toCents(entry.paidAmount) + payable), status: "PAID" },
    });
  }
  await syncOpenCommissionPeriod(tx, input.barbershopId, period.memberId, period.competence);
  return tx.commissionPeriod.update({
    where: { id: period.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      paidById: input.userId,
      paidAmount: period.releasedAmount,
      balanceAmount: 0,
    },
  });
}
