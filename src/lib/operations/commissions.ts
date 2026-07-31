import {
  CommissionConfigType,
  CommissionEntryStatus,
  CommissionPeriodStatus,
  ComandaItemStatus,
  ComandaItemType,
  Prisma,
  CommissionType,
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

export function nextCompetence(competence: string): string {
  const [year, month] = competence.split("-").map(Number);
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

export function buildCommissionScopeKey(input: {
  memberId?: string | null;
  serviceId?: string | null;
  categoryId?: string | null;
  productId?: string | null;
  isProductDefault?: boolean;
}) {
  if (input.memberId && input.serviceId) return `member:${input.memberId}:service:${input.serviceId}`;
  if (input.memberId && input.categoryId) return `member:${input.memberId}:category:${input.categoryId}`;
  if (input.memberId && input.productId) return `member:${input.memberId}:product:${input.productId}`;
  if (input.memberId && input.isProductDefault) return `member:${input.memberId}:product_default`;
  if (input.memberId) return `member:${input.memberId}:default`;
  if (input.serviceId) return `service:${input.serviceId}`;
  if (input.categoryId) return `category:${input.categoryId}`;
  if (input.productId) return `product:${input.productId}`;
  if (input.isProductDefault) return "product_default";
  return "barbershop:default";
}

export function validateCommissionConfig(input: {
  type: CommissionConfigType;
  value: string | number | Prisma.Decimal;
  memberId?: string | null;
  serviceId?: string | null;
  categoryId?: string | null;
  productId?: string | null;
}) {
  const value = nonNegativeCents(input.value, "Comissao");
  if (input.type === "PERCENTAGE" && value > 10000) {
    throw new CommissionError("INVALID_PERCENTAGE", "Percentual deve estar entre 0 e 100.", 422);
  }
  const scopes = [input.serviceId, input.categoryId, input.productId].filter(Boolean);
  if (scopes.length > 1) {
    throw new CommissionError("AMBIGUOUS_SCOPE", "Use apenas um escopo (servico, categoria ou produto).", 422);
  }
}

async function assertScopeBelongsToTenant(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  input: { memberId?: string | null; serviceId?: string | null; categoryId?: string | null; productId?: string | null }
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
  if (input.productId) {
    checks.push(tx.product.findFirstOrThrow({ where: { id: input.productId, barbershopId } }));
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
    productId?: string | null;
    isProductDefault?: boolean;
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
      productId: input.productId ?? null,
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

export type CommissionOrigin =
  | "MEMBER_SERVICE"
  | "MEMBER_CATEGORY"
  | "MEMBER_DEFAULT"
  | "SERVICE_CAREER_LEVEL"
  | "SERVICE_DEFAULT"
  | "CATEGORY_DEFAULT"
  | "MEMBER_PRODUCT"
  | "MEMBER_PRODUCT_DEFAULT"
  | "PRODUCT"
  | "PRODUCT_DEFAULT"
  | "CAREER_LEVEL_DEFAULT"
  | "BARBERSHOP_DEFAULT";

export interface ResolvedCommissionRule {
  id: string;
  configId: string | null;
  serviceCommissionRuleId?: string | null;
  careerLevelId?: string | null;
  origin: CommissionOrigin;
  type: CommissionConfigType;
  value: Prisma.Decimal;
  scopeKey?: string | null;
  memberId: string;
  serviceId?: string | null;
  productId?: string | null;
  configSnapshot: {
    id: string;
    configId: string | null;
    serviceCommissionRuleId?: string | null;
    careerLevelId?: string | null;
    origin: CommissionOrigin;
    scopeKey?: string | null;
    type: CommissionConfigType;
    value: string;
    memberId: string;
    serviceId?: string | null;
    productId?: string | null;
    createdAt: string;
  };
}

function buildResolvedRule(input: {
  id: string;
  configId?: string | null;
  serviceCommissionRuleId?: string | null;
  careerLevelId?: string | null;
  origin: CommissionOrigin;
  type: CommissionConfigType;
  value: Prisma.Decimal;
  scopeKey?: string | null;
  memberId: string;
  serviceId?: string | null;
  productId?: string | null;
  createdAt?: Date | null;
}): ResolvedCommissionRule {
  const createdAtIso = input.createdAt ? input.createdAt.toISOString() : new Date().toISOString();
  return {
    id: input.id,
    configId: input.configId ?? null,
    serviceCommissionRuleId: input.serviceCommissionRuleId ?? null,
    careerLevelId: input.careerLevelId ?? null,
    origin: input.origin,
    type: input.type,
    value: input.value,
    scopeKey: input.scopeKey ?? null,
    memberId: input.memberId,
    serviceId: input.serviceId ?? null,
    productId: input.productId ?? null,
    configSnapshot: {
      id: input.id,
      configId: input.configId ?? null,
      serviceCommissionRuleId: input.serviceCommissionRuleId ?? null,
      careerLevelId: input.careerLevelId ?? null,
      origin: input.origin,
      scopeKey: input.scopeKey ?? null,
      type: input.type,
      value: input.value.toString(),
      memberId: input.memberId,
      serviceId: input.serviceId ?? null,
      productId: input.productId ?? null,
      createdAt: createdAtIso,
    },
  };
}

export async function resolveCommissionConfig(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    memberId: string;
    serviceId?: string | null;
    productId?: string | null;
    itemType: ComandaItemType;
  }
): Promise<ResolvedCommissionRule | null> {
  if (input.itemType === ComandaItemType.SERVICE) {
    if (!input.serviceId) return null;
    const service = await tx.service.findFirst({
      where: { id: input.serviceId, barbershopId: input.barbershopId },
      select: { id: true, categoryId: true },
    });
    if (!service) return null;

    const member = await tx.barbershopMember.findFirst({
      where: { id: input.memberId, barbershopId: input.barbershopId },
      select: { id: true, careerLevelId: true },
    });
    if (!member) return null;

    const memberServiceKey = buildCommissionScopeKey({ memberId: input.memberId, serviceId: input.serviceId });
    const memberCategoryKey = buildCommissionScopeKey({ memberId: input.memberId, categoryId: service.categoryId });
    const memberDefaultKey = buildCommissionScopeKey({ memberId: input.memberId });
    const serviceDefaultKey = buildCommissionScopeKey({ serviceId: input.serviceId });
    const categoryDefaultKey = buildCommissionScopeKey({ categoryId: service.categoryId });
    const barbershopDefaultKey = buildCommissionScopeKey({});

    const configKeys = [
      memberServiceKey,
      memberCategoryKey,
      memberDefaultKey,
      serviceDefaultKey,
      categoryDefaultKey,
      barbershopDefaultKey,
    ];

    const configs = await tx.commissionConfig.findMany({
      where: { barbershopId: input.barbershopId, active: true, scopeKey: { in: configKeys } },
    });

    const getConfigByScope = (key: string) => configs.find((c) => c.scopeKey === key) ?? null;

    // 1. CommissionConfig membro + serviço
    const memberServiceConfig = getConfigByScope(memberServiceKey);
    if (memberServiceConfig) {
      return buildResolvedRule({
        id: memberServiceConfig.id,
        configId: memberServiceConfig.id,
        origin: "MEMBER_SERVICE",
        type: memberServiceConfig.type,
        value: memberServiceConfig.value,
        scopeKey: memberServiceConfig.scopeKey,
        memberId: input.memberId,
        serviceId: input.serviceId,
        createdAt: memberServiceConfig.createdAt,
      });
    }

    // 2. CommissionConfig membro + categoria
    const memberCategoryConfig = getConfigByScope(memberCategoryKey);
    if (memberCategoryConfig) {
      return buildResolvedRule({
        id: memberCategoryConfig.id,
        configId: memberCategoryConfig.id,
        origin: "MEMBER_CATEGORY",
        type: memberCategoryConfig.type,
        value: memberCategoryConfig.value,
        scopeKey: memberCategoryConfig.scopeKey,
        memberId: input.memberId,
        serviceId: input.serviceId,
        createdAt: memberCategoryConfig.createdAt,
      });
    }

    // 3. CommissionConfig membro default
    const memberDefaultConfig = getConfigByScope(memberDefaultKey);
    if (memberDefaultConfig) {
      return buildResolvedRule({
        id: memberDefaultConfig.id,
        configId: memberDefaultConfig.id,
        origin: "MEMBER_DEFAULT",
        type: memberDefaultConfig.type,
        value: memberDefaultConfig.value,
        scopeKey: memberDefaultConfig.scopeKey,
        memberId: input.memberId,
        serviceId: input.serviceId,
        createdAt: memberDefaultConfig.createdAt,
      });
    }

    // 4. ServiceCommissionRule (serviceId + careerLevelId)
    if (member.careerLevelId) {
      const careerLevel = await tx.careerLevel.findFirst({
        where: { id: member.careerLevelId, barbershopId: input.barbershopId, active: true },
      });
      if (careerLevel) {
        const matrixRule = await tx.serviceCommissionRule.findFirst({
          where: {
            barbershopId: input.barbershopId,
            serviceId: input.serviceId,
            careerLevelId: member.careerLevelId,
            active: true,
          },
        });
        if (matrixRule) {
          return buildResolvedRule({
            id: matrixRule.id,
            configId: null,
            serviceCommissionRuleId: matrixRule.id,
            careerLevelId: member.careerLevelId,
            origin: "SERVICE_CAREER_LEVEL",
            type: matrixRule.type,
            value: matrixRule.commissionRate,
            memberId: input.memberId,
            serviceId: input.serviceId,
            createdAt: matrixRule.createdAt,
          });
        }
      }
    }

    // 5. CommissionConfig serviço default
    const serviceDefaultConfig = getConfigByScope(serviceDefaultKey);
    if (serviceDefaultConfig) {
      return buildResolvedRule({
        id: serviceDefaultConfig.id,
        configId: serviceDefaultConfig.id,
        origin: "SERVICE_DEFAULT",
        type: serviceDefaultConfig.type,
        value: serviceDefaultConfig.value,
        scopeKey: serviceDefaultConfig.scopeKey,
        memberId: input.memberId,
        serviceId: input.serviceId,
        createdAt: serviceDefaultConfig.createdAt,
      });
    }

    // 6. CommissionConfig categoria default
    const categoryDefaultConfig = getConfigByScope(categoryDefaultKey);
    if (categoryDefaultConfig) {
      return buildResolvedRule({
        id: categoryDefaultConfig.id,
        configId: categoryDefaultConfig.id,
        origin: "CATEGORY_DEFAULT",
        type: categoryDefaultConfig.type,
        value: categoryDefaultConfig.value,
        scopeKey: categoryDefaultConfig.scopeKey,
        memberId: input.memberId,
        serviceId: input.serviceId,
        createdAt: categoryDefaultConfig.createdAt,
      });
    }

    // 8. CareerLevel.defaultCommissionRate
    if (member.careerLevelId) {
      const careerLevel = await tx.careerLevel.findFirst({
        where: { id: member.careerLevelId, barbershopId: input.barbershopId, active: true },
      });
      if (careerLevel && careerLevel.defaultCommissionRate !== null) {
        return buildResolvedRule({
          id: careerLevel.id,
          configId: null,
          careerLevelId: careerLevel.id,
          origin: "CAREER_LEVEL_DEFAULT",
          type: "PERCENTAGE",
          value: careerLevel.defaultCommissionRate,
          memberId: input.memberId,
          serviceId: input.serviceId,
          createdAt: careerLevel.createdAt,
        });
      }
    }

    // 9. CommissionConfig barbershop default
    const barbershopDefaultConfig = getConfigByScope(barbershopDefaultKey);
    if (barbershopDefaultConfig) {
      return buildResolvedRule({
        id: barbershopDefaultConfig.id,
        configId: barbershopDefaultConfig.id,
        origin: "BARBERSHOP_DEFAULT",
        type: barbershopDefaultConfig.type,
        value: barbershopDefaultConfig.value,
        scopeKey: barbershopDefaultConfig.scopeKey,
        memberId: input.memberId,
        serviceId: input.serviceId,
        createdAt: barbershopDefaultConfig.createdAt,
      });
    }

    return null;
  } else if (input.itemType === ComandaItemType.PRODUCT) {
    if (!input.productId) return null;
    const memberProductKey = buildCommissionScopeKey({ memberId: input.memberId, productId: input.productId });
    const memberProductDefaultKey = buildCommissionScopeKey({ memberId: input.memberId, isProductDefault: true });
    const productKey = buildCommissionScopeKey({ productId: input.productId });
    const productDefaultKey = buildCommissionScopeKey({ isProductDefault: true });
    const barbershopDefaultKey = buildCommissionScopeKey({});

    const priorityKeys = [
      memberProductKey,
      memberProductDefaultKey,
      productKey,
      productDefaultKey,
      barbershopDefaultKey,
    ];

    const configs = await tx.commissionConfig.findMany({
      where: { barbershopId: input.barbershopId, active: true, scopeKey: { in: priorityKeys } },
    });

    const getConfigByScope = (key: string) => configs.find((c) => c.scopeKey === key) ?? null;

    const originsMap: Record<string, CommissionOrigin> = {
      [memberProductKey]: "MEMBER_PRODUCT",
      [memberProductDefaultKey]: "MEMBER_PRODUCT_DEFAULT",
      [productKey]: "PRODUCT",
      [productDefaultKey]: "PRODUCT_DEFAULT",
      [barbershopDefaultKey]: "BARBERSHOP_DEFAULT",
    };

    for (const key of priorityKeys) {
      const config = getConfigByScope(key);
      if (config) {
        return buildResolvedRule({
          id: config.id,
          configId: config.id,
          origin: originsMap[key] ?? "BARBERSHOP_DEFAULT",
          type: config.type,
          value: config.value,
          scopeKey: config.scopeKey,
          memberId: input.memberId,
          productId: input.productId,
          createdAt: config.createdAt,
        });
      }
    }
  }

  return null;
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

export async function syncOpenCommissionPeriod(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  memberId: string,
  competence: string,
  recursive = true
) {
  const entries = await tx.commissionEntry.findMany({ where: { barbershopId, memberId, competence } });
  const generated = entries.reduce((sum, entry) => sum + toCents(entry.generatedAmount), 0);
  const released = entries.reduce((sum, entry) => sum + toCents(entry.releasedAmount), 0);
  const paid = entries.reduce((sum, entry) => sum + toCents(entry.paidAmount), 0);
  const reversed = entries.reduce((sum, entry) => sum + toCents(entry.reversedAmount), 0);

  const adjustments = await tx.commissionAdjustment.findMany({
    where: { barbershopId, memberId, competence, type: "PAID_ADJUSTMENT" },
  });
  const adjustmentSum = adjustments.reduce((sum, adj) => sum + toCents(adj.amount), 0);

  const balance = released - paid + adjustmentSum;
  const balanceAmount = Math.max(0, balance);

  const existing = await tx.commissionPeriod.findUnique({
    where: { barbershopId_memberId_competence: { barbershopId, memberId, competence } },
  });
  if (existing && existing.status !== "OPEN") return existing;

  const period = await tx.commissionPeriod.upsert({
    where: { barbershopId_memberId_competence: { barbershopId, memberId, competence } },
    create: {
      barbershopId,
      memberId,
      competence,
      generatedAmount: fromCents(generated),
      releasedAmount: fromCents(released),
      paidAmount: fromCents(paid),
      reversedAmount: fromCents(reversed),
      balanceAmount: fromCents(balanceAmount),
    },
    update: {
      generatedAmount: fromCents(generated),
      releasedAmount: fromCents(released),
      paidAmount: fromCents(paid),
      reversedAmount: fromCents(reversed),
      balanceAmount: fromCents(balanceAmount),
    },
  });

  const nextComp = nextCompetence(competence);
  if (balance < 0) {
    await tx.commissionAdjustment.upsert({
      where: {
        barbershopId_memberId_competence_rolloverFromCompetence: {
          barbershopId,
          memberId,
          competence: nextComp,
          rolloverFromCompetence: competence,
        },
      },
      create: {
        barbershopId,
        memberId,
        competence: nextComp,
        type: "PAID_ADJUSTMENT",
        amount: fromCents(balance),
        description: `Saldo devedor acumulado do periodo anterior (${competence})`,
        rolloverFromCompetence: competence,
      },
      update: {
        amount: fromCents(balance),
      },
    });
    if (recursive) {
      await syncOpenCommissionPeriod(tx, barbershopId, memberId, nextComp, false);
    }
  } else {
    const deleted = await tx.commissionAdjustment.deleteMany({
      where: {
        barbershopId,
        memberId,
        competence: nextComp,
        rolloverFromCompetence: competence,
      },
    });
    if (deleted.count > 0 && recursive) {
      await syncOpenCommissionPeriod(tx, barbershopId, memberId, nextComp, false);
    }
  }

  return period;
}

export async function generateCommissionsForComanda(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  comandaId: string
) {
  const comanda = await tx.comanda.findFirst({
    where: { id: comandaId, barbershopId },
    include: {
      items: {
        include: { clubBenefitUsage: true }
      }
    },
  });
  if (!comanda) throw new CommissionError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);

  const touchedMembers = new Set<string>();

  // 1. Identify all comissionable items and their executors and configurations
  const commissionableItems: {
    item: typeof comanda.items[0];
    executorId: string;
    config: ResolvedCommissionRule;
    basePriceCents: number;
    finalBaseAmountCents: number;
  }[] = [];

  for (const item of comanda.items) {
    if (
      item.status === ComandaItemStatus.CANCELLED ||
      (item.type !== ComandaItemType.SERVICE && item.type !== ComandaItemType.PRODUCT) ||
      toCents(item.total) <= 0
    ) {
      continue;
    }

    // Regra da comissão com clube:
    // Se o item tem ClubBenefitUsage e status for APPLIED:
    // - Se for INCLUDED_SERVICE: nunca gera CommissionEntry (retorno de pontos do clube).
    // - Se for de desconto (SERVICE_DISCOUNT ou PRODUCT_DISCOUNT): gera sobre a base líquida (preço original - desconto).
    let isIncludedService = false;
    let baseAmountCents = toCents(item.total);

    if (item.clubBenefitUsage && item.clubBenefitUsage.status === "APPLIED") {
      if (item.clubBenefitUsage.benefitType === "INCLUDED_SERVICE") {
        isIncludedService = true;
      } else {
        const disc = item.clubBenefitUsage.discountAmount ? toCents(item.clubBenefitUsage.discountAmount) : 0;
        baseAmountCents = Math.max(0, baseAmountCents - disc);
      }
    }

    if (isIncludedService || baseAmountCents <= 0) {
      // Ignora esse item para comissão tradicional
      continue;
    }

    let executorId: string | null = item.executorId;
    if (item.type === ComandaItemType.PRODUCT && !executorId) {
      if (comanda.appointmentId) {
        const appt = await tx.appointment.findUnique({
          where: { id: comanda.appointmentId },
          select: { memberId: true },
        });
        if (appt) {
          executorId = appt.memberId;
        }
      }
    }
    if (!executorId) continue;

    const config = await resolveCommissionConfig(tx, {
      barbershopId,
      memberId: executorId,
      serviceId: item.serviceId,
      productId: item.productId,
      itemType: item.type,
    });
    if (!config) continue;

    commissionableItems.push({
      item,
      executorId,
      config,
      basePriceCents: baseAmountCents,
      finalBaseAmountCents: baseAmountCents,
    });
  }

  // 2. Proportional partition of global comanda discounts
  const discountItems = comanda.items.filter(
    (item) => item.type === ComandaItemType.DISCOUNT && item.status !== ComandaItemStatus.CANCELLED
  );
  const globalDiscountCents = discountItems.reduce((sum, item) => sum + toCents(item.total), 0);

  if (globalDiscountCents > 0 && commissionableItems.length > 0) {
    const totalCommissionableCents = commissionableItems.reduce((sum, entry) => sum + entry.basePriceCents, 0);
    if (totalCommissionableCents > 0) {
      let distributedCents = 0;
      for (let i = 0; i < commissionableItems.length; i++) {
        const entry = commissionableItems[i];
        let itemDiscountCents = 0;
        if (i === commissionableItems.length - 1) {
          itemDiscountCents = globalDiscountCents - distributedCents;
        } else {
          itemDiscountCents = Math.round((entry.basePriceCents * globalDiscountCents) / totalCommissionableCents);
          distributedCents += itemDiscountCents;
        }
        entry.finalBaseAmountCents = Math.max(0, entry.basePriceCents - itemDiscountCents);
      }
    }
  }

  // 3. Upsert commission entries
  for (const entry of commissionableItems) {
    const { item, executorId, config, finalBaseAmountCents } = entry;

    const existing = await tx.commissionEntry.findUnique({ where: { comandaItemId: item.id } });
    if (existing) {
      if (existing.memberId !== executorId) {
        if (toCents(existing.paidAmount) > 0) {
          throw new CommissionError(
            "EXECUTOR_CHANGE_PAID",
            "Nao eh possivel alterar o executor de um item que ja teve comissao paga.",
            409
          );
        } else {
          await tx.commissionAdjustment.deleteMany({
            where: { entryId: existing.id },
          });

          const generatedAmount = calculateCommissionAmount(fromCents(finalBaseAmountCents), config.type, config.value);
          const competence = competenceFromDate(item.completedAt ?? comanda.closedAt ?? comanda.openedAt);

          await tx.commissionEntry.update({
            where: { id: existing.id },
            data: {
              memberId: executorId,
              configId: config.configId ?? null,
              configSnapshot: config.configSnapshot as unknown as Prisma.InputJsonValue,
              baseAmount: fromCents(finalBaseAmountCents),
              generatedAmount,
              releasedAmount: 0,
              reversedAmount: 0,
              status: "GENERATED",
              competence,
              type: item.type === ComandaItemType.PRODUCT ? CommissionType.PRODUCT : CommissionType.SERVICE,
            },
          });

          touchedMembers.add(existing.memberId);
          touchedMembers.add(executorId);
        }
      } else {
        const generatedAmount = calculateCommissionAmount(fromCents(finalBaseAmountCents), config.type, config.value);
        const competence = competenceFromDate(item.completedAt ?? comanda.closedAt ?? comanda.openedAt);

        await tx.commissionEntry.update({
          where: { id: existing.id },
          data: {
            configId: config.configId ?? null,
            configSnapshot: config.configSnapshot as unknown as Prisma.InputJsonValue,
            baseAmount: fromCents(finalBaseAmountCents),
            generatedAmount,
            competence,
            type: item.type === ComandaItemType.PRODUCT ? CommissionType.PRODUCT : CommissionType.SERVICE,
          },
        });
        touchedMembers.add(executorId);
      }
    } else {
      const generatedAmount = calculateCommissionAmount(fromCents(finalBaseAmountCents), config.type, config.value);
      const competence = competenceFromDate(item.completedAt ?? comanda.closedAt ?? comanda.openedAt);

      const created = await tx.commissionEntry.create({
        data: {
          barbershopId,
          comandaItemId: item.id,
          memberId: executorId,
          configId: config.configId ?? null,
          configSnapshot: config.configSnapshot as unknown as Prisma.InputJsonValue,
          baseAmount: fromCents(finalBaseAmountCents),
          generatedAmount,
          competence,
          type: item.type === ComandaItemType.PRODUCT ? CommissionType.PRODUCT : CommissionType.SERVICE,
        },
      });
      touchedMembers.add(created.memberId);
    }
  }

  // 4. Handle removed/cancelled items' existing commission entries
  const existingEntries = await tx.commissionEntry.findMany({
    where: { comandaItem: { comandaId } },
  });

  for (const existing of existingEntries) {
    const isStillCommissionable = commissionableItems.some((c) => c.item.id === existing.comandaItemId);
    if (!isStillCommissionable) {
      if (toCents(existing.paidAmount) > 0) {
        const toReverse = toCents(existing.releasedAmount);
        if (toReverse > 0) {
          await reverseCommissionEntry(tx, barbershopId, existing.id, toReverse, null, "Estorno por cancelamento de item");
        }
        touchedMembers.add(existing.memberId);
      } else {
        await tx.commissionAdjustment.deleteMany({ where: { entryId: existing.id } });
        await tx.commissionEntry.delete({ where: { id: existing.id } });
        touchedMembers.add(existing.memberId);
      }
    }
  }

  // 5. Synchronize open commission periods for all touched members
  for (const memberId of touchedMembers) {
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
  const comanda = await tx.comanda.findFirst({
    where: { id: comandaId, barbershopId },
    include: { items: { include: { commissionEntry: true } } },
  });
  if (!comanda) return;

  const isComandaCancelled = comanda.status === "CANCELLED";
  
  if (!isComandaCancelled) {
    await generateCommissionsForComanda(tx, barbershopId, comandaId);
  }

  // Re-fetch comanda to get up-to-date items and entries
  const updatedComanda = await tx.comanda.findFirstOrThrow({
    where: { id: comandaId, barbershopId },
    include: { items: { include: { commissionEntry: true } } },
  });

  const comandaTotalCents = toCents(updatedComanda.total);
  const netPaid = isComandaCancelled
    ? 0
    : Math.min(comandaTotalCents, await getNetPaidCents(tx, barbershopId, comandaId));

  const touched = new Set<string>();

  for (const item of updatedComanda.items) {
    const entry = item.commissionEntry;
    if (!entry) continue;
    
    const isItemCancelled = item.status === ComandaItemStatus.CANCELLED || isComandaCancelled;
    const generated = toCents(entry.generatedAmount);
    
    const targetReleased = isItemCancelled
      ? 0
      : comandaTotalCents <= 0
      ? 0
      : Math.min(generated, Math.round((generated * netPaid) / comandaTotalCents));

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
      await reverseCommissionEntry(tx, barbershopId, entry.id, Math.abs(delta), null, isComandaCancelled ? "Reversao por cancelamento de comanda" : "Reversao proporcional por estorno");
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
        competence: nextCompetence(entry.competence),
        description: `${description}. Ajuste negativo para proximo periodo.`,
        rolloverFromCompetence: entry.competence,
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
  input: { barbershopId: string; periodId: string; paidByMemberId: string; userId: string; role?: string }
) {
  const period = await tx.commissionPeriod.findFirst({
    where: { id: input.periodId, barbershopId: input.barbershopId },
  });
  if (!period) throw new CommissionError("PERIOD_NOT_FOUND", "Periodo nao encontrado.", 404);

  let isAllowedSelfPayment = input.role === "OWNER" || input.role === "SUPER_ADMIN";
  if (!isAllowedSelfPayment && input.paidByMemberId) {
    const paidByMember = await tx.barbershopMember.findUnique({
      where: { id: input.paidByMemberId },
      select: { role: true },
    });
    if (paidByMember?.role === "OWNER") {
      isAllowedSelfPayment = true;
    }
  }

  if (period.memberId === input.paidByMemberId && !isAllowedSelfPayment) {
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
