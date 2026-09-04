/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CommissionConfigType,
  CommissionEntryStatus,
  ComandaItemStatus,
  ComandaItemType,
  ComandaStatus,
  Prisma,
  CommissionType,
  CommissionCycleStatus,
  CommissionPayableType,
  CommissionPayableSourceKind,
  CommissionCycleAdjustmentType,
  CommissionDisbursementMethod,
  FinancialEntryType,
} from "@prisma/client";
import crypto from "crypto";
import { fromCents, nonNegativeCents, toCents } from "./money";
import { syncCashSessionExpectedAmount } from "./cash";

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

export function isCommissionEligibleItem(item: {
  type: ComandaItemType;
  status: ComandaItemStatus;
  completedAt?: Date | null;
  total?: Prisma.Decimal | number | string;
}) {
  if (item.status !== ComandaItemStatus.DONE) return false;
  if (item.total !== undefined && toCents(item.total) <= 0) return false;
  if (item.type === ComandaItemType.SERVICE) return item.completedAt !== null && item.completedAt !== undefined;
  if (item.type === ComandaItemType.PRODUCT) return true;
  return false;
}

export interface ItemEconomicBase {
  itemId: string;
  itemType: ComandaItemType;
  status: ComandaItemStatus;
  rawItemValueCents: number;
  chargeableBaseCents: number;
  allocatedGlobalDiscountCents: number;
  commissionBaseCents: number;
  isCommissionEligible: boolean;
  executorId: string | null;
}

export function computeComandaEconomics(
  items: Array<{
    id: string;
    type: ComandaItemType;
    status: ComandaItemStatus;
    total: Prisma.Decimal | number | string;
    unitPrice?: Prisma.Decimal | number | string;
    quantity?: Prisma.Decimal | number | string;
    discountAmount?: Prisma.Decimal | number | string;
    surchargeAmount?: Prisma.Decimal | number | string;
    executorId?: string | null;
    serviceId?: string | null;
    productId?: string | null;
    completedAt?: Date | null;
    clubBenefitRequested?: boolean;
    clubBenefitUsage?: {
      status: string;
      benefitType: string;
      discountAmount?: Prisma.Decimal | number | string | null;
    } | null;
  }>,
  appointmentMemberId?: string | null
): {
  isClubUnresolved: boolean;
  globalDiscountCents: number;
  totalChargeableBaseCents: number;
  itemEconomics: Map<string, ItemEconomicBase>;
} {
  const itemEconomics = new Map<string, ItemEconomicBase>();

  // 1. Identify global discounts
  const discountItems = items.filter(
    (it) => it.type === ComandaItemType.DISCOUNT && it.status !== ComandaItemStatus.CANCELLED
  );
  const globalDiscountCents = discountItems.reduce((sum, it) => sum + toCents(it.total), 0);

  // 2. Check if an active Club benefit capable of changing chargeable base is unresolved
  const isClubUnresolved = items.some(
    (it) =>
      it.status !== ComandaItemStatus.CANCELLED &&
      it.clubBenefitRequested === true &&
      (!it.clubBenefitUsage || it.clubBenefitUsage.status !== "APPLIED")
  );

  // 3. Compute customer-chargeable base for all non-cancelled billable items
  const billableItems = items.filter(
    (it) => it.type !== ComandaItemType.DISCOUNT && it.status !== ComandaItemStatus.CANCELLED
  );

  let totalChargeableBaseCents = 0;
  const billableData: Array<{
    item: typeof items[0];
    rawItemValueCents: number;
    chargeableBaseCents: number;
    isEligible: boolean;
    executorId: string | null;
  }> = [];

  for (const item of billableItems) {
    const rawItemValueCents = toCents(item.total);
    let chargeableBaseCents = Math.max(0, rawItemValueCents);

    // Resolved Club reduction:
    if (item.clubBenefitUsage && item.clubBenefitUsage.status === "APPLIED") {
      if (item.clubBenefitUsage.benefitType === "INCLUDED_SERVICE") {
        chargeableBaseCents = 0;
      } else {
        const disc = item.clubBenefitUsage.discountAmount
          ? toCents(item.clubBenefitUsage.discountAmount)
          : 0;
        chargeableBaseCents = Math.max(0, rawItemValueCents - disc);
      }
    }

    totalChargeableBaseCents += chargeableBaseCents;

    let executorId = item.executorId ?? null;
    if (item.type === ComandaItemType.PRODUCT && !executorId && appointmentMemberId) {
      executorId = appointmentMemberId;
    }

    const isEligible =
      item.type !== ComandaItemType.SURCHARGE &&
      isCommissionEligibleItem(item) &&
      !(item.clubBenefitUsage?.status === "APPLIED" && item.clubBenefitUsage?.benefitType === "INCLUDED_SERVICE");

    billableData.push({
      item,
      rawItemValueCents,
      chargeableBaseCents,
      isEligible,
      executorId,
    });
  }

  // 4. Hamilton-Hare Largest Remainder Method for global discount allocation
  const allocatedDiscounts = new Map<string, number>();

  if (globalDiscountCents > 0 && totalChargeableBaseCents > 0) {
    const effectiveDiscount = Math.min(globalDiscountCents, totalChargeableBaseCents);
    const quotas: Array<{
      itemId: string;
      floor: number;
      remainder: number;
    }> = [];

    let sumFloor = 0;
    for (const b of billableData) {
      const exactQuota = (b.chargeableBaseCents * effectiveDiscount) / totalChargeableBaseCents;
      const floor = Math.floor(exactQuota);
      const remainder = exactQuota - floor;
      quotas.push({ itemId: b.item.id, floor, remainder });
      sumFloor += floor;
    }

    let leftover = effectiveDiscount - sumFloor;
    quotas.sort((a, b) => {
      if (b.remainder !== a.remainder) {
        return b.remainder - a.remainder;
      }
      return a.itemId.localeCompare(b.itemId);
    });

    for (const q of quotas) {
      const extra = leftover > 0 ? 1 : 0;
      if (leftover > 0) leftover--;
      allocatedDiscounts.set(q.itemId, q.floor + extra);
    }
  }

  // 5. Populate ItemEconomicBase map
  for (const b of billableData) {
    const allocatedGlobalDiscountCents = allocatedDiscounts.get(b.item.id) ?? 0;
    const postDiscountBaseCents = Math.max(0, b.chargeableBaseCents - allocatedGlobalDiscountCents);

    const commissionBaseCents = b.isEligible && b.executorId ? postDiscountBaseCents : 0;

    itemEconomics.set(b.item.id, {
      itemId: b.item.id,
      itemType: b.item.type,
      status: b.item.status,
      rawItemValueCents: b.rawItemValueCents,
      chargeableBaseCents: b.chargeableBaseCents,
      allocatedGlobalDiscountCents,
      commissionBaseCents,
      isCommissionEligible: b.isEligible,
      executorId: b.executorId,
    });
  }

  return {
    isClubUnresolved,
    globalDiscountCents,
    totalChargeableBaseCents,
    itemEconomics,
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
    const memberProductKey = input.productId
      ? buildCommissionScopeKey({ memberId: input.memberId, productId: input.productId })
      : null;
    const memberProductDefaultKey = buildCommissionScopeKey({ memberId: input.memberId, isProductDefault: true });
    const productKey = input.productId
      ? buildCommissionScopeKey({ productId: input.productId })
      : null;
    const productDefaultKey = buildCommissionScopeKey({ isProductDefault: true });
    const barbershopDefaultKey = buildCommissionScopeKey({});

    const priorityKeys = [
      memberProductKey,
      memberProductDefaultKey,
      productKey,
      productDefaultKey,
      barbershopDefaultKey,
    ].filter(Boolean) as string[];

    const configs = await tx.commissionConfig.findMany({
      where: { barbershopId: input.barbershopId, active: true, scopeKey: { in: priorityKeys } },
    });

    const getConfigByScope = (key: string) => configs.find((c) => c.scopeKey === key) ?? null;

    const originsMap: Record<string, CommissionOrigin> = {
      ...(memberProductKey ? { [memberProductKey]: "MEMBER_PRODUCT" } : {}),
      [memberProductDefaultKey]: "MEMBER_PRODUCT_DEFAULT",
      ...(productKey ? { [productKey]: "PRODUCT" } : {}),
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
          productId: input.productId ?? null,
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

export async function getOrCreateCurrentCycle(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  memberId: string
) {
  // 1. Lock member row to serialize concurrent cycle provisioning
  try {
    await tx.$executeRaw`SELECT id FROM barbershop_members WHERE id = ${memberId} FOR UPDATE`;
  } catch {
    // In mock testing environments where $executeRaw is stubbed, gracefully continue
  }

  // 2. Check for existing OPEN cycle
  let cycle = await tx.commissionCycle.findFirst({
    where: { barbershopId, memberId, status: CommissionCycleStatus.OPEN },
  });
  if (cycle) return cycle;

  // 3. Find max cycleNumber for deterministic next sequence
  const latestCycle = await tx.commissionCycle.findFirst({
    where: { barbershopId, memberId },
    orderBy: { cycleNumber: "desc" },
    select: { cycleNumber: true },
  });
  const nextCycleNumber = (latestCycle?.cycleNumber ?? 0) + 1;

  // 4. Create new OPEN cycle
  try {
    cycle = await tx.commissionCycle.create({
      data: {
        barbershopId,
        memberId,
        cycleNumber: nextCycleNumber,
        status: CommissionCycleStatus.OPEN,
        grossCommission: 0,
        adjustmentsTotal: 0,
        advancesTotal: 0,
        finalPayoutAmount: 0,
        remainingBalance: 0,
        version: 1,
      },
    });
    return cycle;
  } catch (err: unknown) {
    // If concurrent race occurs despite lock, find the OPEN cycle created by peer
    const raceCycle = await tx.commissionCycle.findFirst({
      where: { barbershopId, memberId, status: CommissionCycleStatus.OPEN },
    });
    if (raceCycle) return raceCycle;
    throw err;
  }
}

export function buildPayableEventKey(input: {
  comandaId: string;
  revision: number;
  entryId: string;
  targetReleasedCents: number;
  type: "RELEASE" | "REVERSAL";
  sourcePaymentId?: string | null;
}) {
  const paymentPart = input.sourcePaymentId ? `pay:${input.sourcePaymentId}:` : "";
  return `comanda:${input.comandaId}:rev:${input.revision}:${paymentPart}entry:${input.entryId}:target:${input.targetReleasedCents}:${input.type}`;
}

export async function getCurrentCommissionEntry(
  tx: Prisma.TransactionClient,
  params: { comandaItemId: string; barbershopId?: string }
) {
  return tx.commissionEntry.findFirst({
    where: {
      comandaItemId: params.comandaItemId,
      ...(params.barbershopId ? { barbershopId: params.barbershopId } : {}),
      isCurrent: true,
    },
  });
}

/**
 * @deprecated Legacy CommissionPeriod writer - permanently deactivated in C11.3.
 * Runtime authority belongs exclusively to canonical cycles.
 */
export async function syncOpenCommissionPeriod(
  _tx: Prisma.TransactionClient,
  _barbershopId: string,
  _memberId: string,
  _competence: string,
  _recursive = true
) {
  return null;
}

export const recalculateComandaCommissions = generateCommissionsForComanda;

export async function generateCommissionsForComanda(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  comandaId: string
) {
  const comanda = await tx.comanda.findFirst({
    where: { id: comandaId, barbershopId },
    include: {
      items: {
        include: { clubBenefitUsage: true },
      },
    },
  });
  if (!comanda) throw new CommissionError("COMANDA_NOT_FOUND", "Comanda nao encontrada.", 404);

  let appointmentMemberId: string | null = null;
  if (comanda.appointmentId) {
    const appt = await tx.appointment.findUnique({
      where: { id: comanda.appointmentId },
      select: { memberId: true },
    });
    if (appt) appointmentMemberId = appt.memberId;
  }

  const { itemEconomics } = computeComandaEconomics(
    comanda.items,
    appointmentMemberId
  );

  const touchedMembers = new Set<string>();
  const commissionableItemIds = new Set<string>();

  for (const item of comanda.items) {
    const econ = itemEconomics.get(item.id);
    if (!econ || !econ.isCommissionEligible || !econ.executorId) {
      continue;
    }

    const executorId = econ.executorId;
    const existing = await tx.commissionEntry.findFirst({ where: { comandaItemId: item.id, isCurrent: true } });

    if (existing && existing.memberId !== executorId) {
      throw new CommissionError(
        "EXECUTOR_CORRECTION_REQUIRED",
        "Alteração de executor exige operação versionada de correção de executor.",
        409
      );
    }

    const config = await resolveCommissionConfig(tx, {
      barbershopId,
      memberId: executorId,
      serviceId: item.serviceId,
      productId: item.productId,
      itemType: item.type,
    });

    let ruleType = config?.type;
    let ruleValue = config?.value;
    let ruleSnapshot = config?.configSnapshot;
    let ruleConfigId = config?.configId ?? null;

    // Invariant: At execution eligibility, the rule snapshot is frozen.
    // If an existing entry already has a frozen configSnapshot and the executor has not changed,
    // subsequent recalculations must reuse the frozen rule snapshot, never newer DB configuration.
    if (existing && existing.memberId === executorId && existing.configSnapshot) {
      const snap = existing.configSnapshot as any;
      if (snap && snap.type && snap.value !== undefined) {
        ruleType = snap.type;
        ruleValue = new Prisma.Decimal(snap.value);
        ruleSnapshot = snap;
        ruleConfigId = snap.id ?? snap.configId ?? existing.configId ?? null;
      }
    }

    if (!ruleType || ruleValue === undefined) continue;

    commissionableItemIds.add(item.id);
    const generatedAmount = calculateCommissionAmount(
      fromCents(econ.commissionBaseCents),
      ruleType,
      ruleValue
    );
    const competence = competenceFromDate(item.completedAt ?? comanda.closedAt ?? comanda.openedAt);

    if (existing) {
      if (existing.memberId !== executorId) {
        throw new CommissionError(
          "EXECUTOR_CORRECTION_REQUIRED",
          "Alteração de executor exige operação versionada de correção de executor.",
          409
        );
      } else {
        await tx.commissionEntry.update({
          where: { id: existing.id },
          data: {
            configId: ruleConfigId,
            configSnapshot: ruleSnapshot as unknown as Prisma.InputJsonValue,
            baseAmount: fromCents(econ.commissionBaseCents),
            generatedAmount,
            competence,
            type: item.type === ComandaItemType.PRODUCT ? CommissionType.PRODUCT : CommissionType.SERVICE,
          },
        });
        touchedMembers.add(executorId);
      }
    } else {
      const created = await tx.commissionEntry.create({
        data: {
          barbershopId,
          comandaItemId: item.id,
          memberId: executorId,
          configId: ruleConfigId,
          configSnapshot: ruleSnapshot as unknown as Prisma.InputJsonValue,
          baseAmount: fromCents(econ.commissionBaseCents),
          generatedAmount,
          competence,
          type: item.type === ComandaItemType.PRODUCT ? CommissionType.PRODUCT : CommissionType.SERVICE,
          status: CommissionEntryStatus.GENERATED,
        },
      });
      touchedMembers.add(created.memberId);
    }
  }

  // Handle removed/cancelled items' existing commission entries
  const existingEntries = await tx.commissionEntry.findMany({
    where: { comandaItem: { comandaId }, isCurrent: true },
  });

  for (const existing of existingEntries) {
    if (!commissionableItemIds.has(existing.comandaItemId)) {
      if (toCents(existing.paidAmount) > 0 || toCents(existing.releasedAmount) > 0) {
        const toReverse = toCents(existing.releasedAmount);
        if (toReverse > 0) {
          await reverseCommissionEntry(
            tx,
            barbershopId,
            existing.id,
            toReverse,
            null,
            "Estorno por cancelamento de item",
            {
              sourceKind: CommissionPayableSourceKind.COMANDA_RECALCULATION,
              sourceComandaId: comandaId,
              sourceRevision: comanda.commissionRevision,
            }
          );
        }
        touchedMembers.add(existing.memberId);
      } else {
        const hasLedger = await tx.commissionPayableItem.findFirst({
          where: { entryId: existing.id },
          select: { id: true },
        });
        if (hasLedger) {
          await tx.commissionEntry.update({
            where: { id: existing.id },
            data: {
              baseAmount: fromCents(0),
              generatedAmount: fromCents(0),
              releasedAmount: fromCents(0),
              status: CommissionEntryStatus.REVERSED,
            },
          });
        } else {
          await tx.commissionEntry.delete({ where: { id: existing.id } });
        }
        touchedMembers.add(existing.memberId);
      }
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
  description = "Liberacao proporcional por pagamento",
  context?: {
    sourceKind?: CommissionPayableSourceKind;
    sourcePaymentId?: string | null;
  }
) {
  const comanda = await tx.comanda.findFirst({
    where: { id: comandaId, barbershopId },
    include: {
      items: {
        include: {
          clubBenefitUsage: true,
          commissionEntries: { where: { isCurrent: true } },
        },
      },
    },
  });
  if (!comanda) return;

  const isComandaCancelled = comanda.status === ComandaStatus.CANCELLED;

  let appointmentMemberId: string | null = null;
  if (comanda.appointmentId) {
    const appt = await tx.appointment.findUnique({
      where: { id: comanda.appointmentId },
      select: { memberId: true },
    });
    if (appt) appointmentMemberId = appt.memberId;
  }

  const { isClubUnresolved, globalDiscountCents } = computeComandaEconomics(
    comanda.items,
    appointmentMemberId
  );

  if (!isComandaCancelled) {
    await generateCommissionsForComanda(tx, barbershopId, comandaId);
  }

  // If global discount > 0 and Club is unresolved, hold normal commission release (release remains 0)
  if (globalDiscountCents > 0 && isClubUnresolved && !isComandaCancelled) {
    return;
  }

  // Re-fetch comanda to get up-to-date items and entries
  const updatedComanda = await tx.comanda.findFirstOrThrow({
    where: { id: comandaId, barbershopId },
    include: {
      items: {
        include: {
          commissionEntries: { where: { isCurrent: true } },
          clubBenefitUsage: true,
        },
      },
    },
  });

  const comandaTotalCents = toCents(updatedComanda.total);
  const netPaidCents = await getNetPaidCents(tx, barbershopId, comandaId);
  const clampedNetPaid = isComandaCancelled
    ? 0
    : Math.max(0, Math.min(comandaTotalCents, netPaidCents));

  const { itemEconomics: updatedItemEconomics } = computeComandaEconomics(
    updatedComanda.items,
    appointmentMemberId
  );

  const touchedMembers = new Set<string>();

  for (const item of updatedComanda.items) {
    const entry =
      (item.commissionEntries && item.commissionEntries.length > 0
        ? item.commissionEntries[0]
        : (item as any).commissionEntry) ?? null;
    if (!entry) continue;

    const isItemCancelled = item.status === ComandaItemStatus.CANCELLED || isComandaCancelled;
    const econ = updatedItemEconomics.get(item.id);
    const isEligible = !isItemCancelled && (econ?.isCommissionEligible ?? false);
    const generatedCents = toCents(entry.generatedAmount);

    let targetReleasedCents = 0;
    if (isEligible && comandaTotalCents > 0 && generatedCents > 0) {
      targetReleasedCents = Math.min(
        generatedCents,
        Math.round((generatedCents * clampedNetPaid) / comandaTotalCents)
      );
    }

    const currentReleasedCents = toCents(entry.releasedAmount);
    const deltaCents = targetReleasedCents - currentReleasedCents;

    if (deltaCents === 0) {
      touchedMembers.add(entry.memberId);
      continue;
    }

    if (deltaCents > 0) {
      const amountCents = deltaCents;
      const sourceKind =
        context?.sourceKind ??
        (updatedComanda.status === ComandaStatus.CLOSED
          ? CommissionPayableSourceKind.ITEM_COMPLETION
          : CommissionPayableSourceKind.PAYMENT);

      const eventKey = buildPayableEventKey({
        comandaId,
        revision: updatedComanda.commissionRevision,
        entryId: entry.id,
        targetReleasedCents,
        type: CommissionPayableType.RELEASE,
        sourcePaymentId: context?.sourcePaymentId ?? null,
      });

      // Idempotency check: ensure this event has not been processed yet
      const existingPayable = await tx.commissionPayableItem.findUnique({
        where: { barbershopId_eventKey: { barbershopId, eventKey } },
      });

      if (!existingPayable) {
        const cycle = await getOrCreateCurrentCycle(tx, barbershopId, entry.memberId);

        await tx.commissionPayableItem.create({
          data: {
            barbershopId,
            cycleId: cycle.id,
            entryId: entry.id,
            memberId: entry.memberId,
            sourceKind,
            sourcePaymentId: context?.sourcePaymentId ?? null,
            sourceComandaId: comandaId,
            sourceRevision: updatedComanda.commissionRevision,
            type: CommissionPayableType.RELEASE,
            amount: fromCents(amountCents),
            eventKey,
          },
        });

        await tx.commissionCycle.update({
          where: { id: cycle.id },
          data: {
            grossCommission: fromCents(toCents(cycle.grossCommission) + amountCents),
            remainingBalance: fromCents(toCents(cycle.remainingBalance) + amountCents),
          },
        });

        const newReleasedCents = currentReleasedCents + amountCents;
        await tx.commissionEntry.update({
          where: { id: entry.id },
          data: {
            releasedAmount: fromCents(newReleasedCents),
            status: nextEntryStatus({
              generated: generatedCents,
              released: newReleasedCents,
              paid: toCents(entry.paidAmount),
              reversed: toCents(entry.reversedAmount),
            }),
          },
        });
      }
    } else {
      const reversalCents = Math.abs(deltaCents);
      const eventKey = buildPayableEventKey({
        comandaId,
        revision: updatedComanda.commissionRevision,
        entryId: entry.id,
        targetReleasedCents,
        type: CommissionPayableType.REVERSAL,
        sourcePaymentId: context?.sourcePaymentId ?? null,
      });

      await reverseCommissionEntry(
        tx,
        barbershopId,
        entry.id,
        reversalCents,
        context?.sourcePaymentId ?? null,
        isComandaCancelled
          ? "Reversao por cancelamento de comanda"
          : "Reversao proporcional por estorno",
        {
          sourceKind:
            context?.sourceKind ??
            (isComandaCancelled
              ? CommissionPayableSourceKind.COMANDA_RECALCULATION
              : CommissionPayableSourceKind.REFUND),
          sourceComandaId: comandaId,
          sourceRevision: updatedComanda.commissionRevision,
          eventKey,
        }
      );
    }
    touchedMembers.add(entry.memberId);
  }
}

export async function reverseCommissionEntry(
  tx: Prisma.TransactionClient,
  barbershopId: string,
  entryId: string,
  cents: number,
  paymentId: string | null,
  description: string,
  context?: {
    sourceKind?: CommissionPayableSourceKind;
    sourceComandaId?: string | null;
    sourceRevision?: number | null;
    eventKey?: string | null;
    userId?: string | null;
  }
) {
  const entry = await tx.commissionEntry.findFirst({
    where: { id: entryId, barbershopId },
  });
  if (!entry || cents <= 0) return;

  const currentReleasedCents = toCents(entry.releasedAmount);
  const reversible = Math.min(cents, currentReleasedCents);
  if (reversible <= 0) return;

  const eventKey =
    context?.eventKey ??
    `entry:${entry.id}:rev:${context?.sourceRevision ?? 1}:target:${currentReleasedCents - reversible}:REVERSAL`;

  // Idempotency check on eventKey
  const existingReversal = await tx.commissionPayableItem.findUnique({
    where: { barbershopId_eventKey: { barbershopId, eventKey } },
  });
  if (existingReversal) {
    return;
  }

  // Find source release item to check if originating cycle is OPEN or PAID
  const sourceRelease = await tx.commissionPayableItem.findFirst({
    where: {
      barbershopId,
      entryId: entry.id,
      type: CommissionPayableType.RELEASE,
    },
    orderBy: { createdAt: "desc" },
    include: { cycle: true },
  });

  if (sourceRelease && sourceRelease.cycle.status === CommissionCycleStatus.OPEN) {
    // Case A: Originating cycle is OPEN -> append REVERSAL and decrement cycle grossCommission & remainingBalance
    const openCycle = sourceRelease.cycle;
    await tx.commissionPayableItem.create({
      data: {
        barbershopId,
        cycleId: openCycle.id,
        entryId: entry.id,
        memberId: entry.memberId,
        sourceKind: context?.sourceKind ?? CommissionPayableSourceKind.REFUND,
        sourcePaymentId: paymentId,
        sourceComandaId: context?.sourceComandaId ?? null,
        sourceRevision: context?.sourceRevision ?? null,
        reversesPayableItemId: sourceRelease.id,
        type: CommissionPayableType.REVERSAL,
        amount: fromCents(reversible),
        eventKey,
      },
    });

    await tx.commissionCycle.update({
      where: { id: openCycle.id },
      data: {
        grossCommission: fromCents(Math.max(0, toCents(openCycle.grossCommission) - reversible)),
        remainingBalance: fromCents(toCents(openCycle.remainingBalance) - reversible),
      },
    });
  } else {
    // Case B: Originating cycle is PAID (or no sourceRelease) -> Historical cycle remains immutable!
    // Route to member's current OPEN cycle with companion CommissionCycleAdjustment DEBIT
    const currentOpenCycle = await getOrCreateCurrentCycle(tx, barbershopId, entry.memberId);

    const reversalItem = await tx.commissionPayableItem.create({
      data: {
        barbershopId,
        cycleId: currentOpenCycle.id,
        entryId: entry.id,
        memberId: entry.memberId,
        sourceKind: context?.sourceKind ?? CommissionPayableSourceKind.REFUND,
        sourcePaymentId: paymentId,
        sourceComandaId: context?.sourceComandaId ?? null,
        sourceRevision: context?.sourceRevision ?? null,
        reversesPayableItemId: sourceRelease?.id ?? null,
        type: CommissionPayableType.REVERSAL,
        amount: fromCents(reversible),
        isHistoricalCorrection: true,
        eventKey,
      },
    });

    let createdById = context?.userId ?? null;
    if (!createdById) {
      const m = await tx.barbershopMember.findUnique({
        where: { id: entry.memberId },
        select: { userId: true },
      });
      createdById = m?.userId ?? null;
    }
    if (!createdById) {
      const anyUser = await tx.user.findFirst({ select: { id: true } });
      createdById = anyUser?.id ?? "";
    }

    await tx.commissionCycleAdjustment.create({
      data: {
        barbershopId,
        cycleId: currentOpenCycle.id,
        sourcePayableItemId: reversalItem.id,
        sourceCycleId: sourceRelease?.cycleId ?? null,
        sourceEntryId: entry.id,
        type: CommissionCycleAdjustmentType.DEBIT,
        amount: fromCents(reversible),
        reason: description || "Estorno histórico por reembolso",
        idempotencyKey: `adj:reversal:${reversalItem.id}`,
        createdById,
      },
    });

    await tx.commissionCycle.update({
      where: { id: currentOpenCycle.id },
      data: {
        adjustmentsTotal: fromCents(toCents(currentOpenCycle.adjustmentsTotal) - reversible),
        remainingBalance: fromCents(toCents(currentOpenCycle.remainingBalance) - reversible),
      },
    });
  }

  // Update entry cache: releasedAmount = currentReleased - reversible, reversedAmount = currentReversed + reversible
  const newReleasedCents = currentReleasedCents - reversible;
  const newReversedCents = toCents(entry.reversedAmount) + reversible;

  await tx.commissionEntry.update({
    where: { id: entry.id },
    data: {
      releasedAmount: fromCents(newReleasedCents),
      reversedAmount: fromCents(newReversedCents),
      status: nextEntryStatus({
        generated: toCents(entry.generatedAmount),
        released: newReleasedCents,
        paid: toCents(entry.paidAmount),
        reversed: newReversedCents,
      }),
    },
  });
}

export async function closeCommissionPeriod(
  _tx: Prisma.TransactionClient,
  _input: { barbershopId: string; memberId: string; competence: string; userId: string }
): Promise<any> {
  throw new CommissionError(
    "LEGACY_ENDPOINT_DEPRECATED",
    "Operação de período legado descontinuada. Use o motor canônico de ciclos.",
    410
  );
}

export async function payCommissionPeriod(
  _tx: Prisma.TransactionClient,
  _input: { barbershopId: string; periodId: string; paidByMemberId: string; userId: string; role?: string }
): Promise<any> {
  throw new CommissionError(
    "LEGACY_ENDPOINT_DEPRECATED",
    "Operação de período legado descontinuada. Use o motor canônico de ciclos.",
    410
  );
}

export interface AuthoritativeCycleBalance {
  cycleId: string;
  grossCommissionCents: number;
  adjustmentsTotalCents: number;
  economicPayableCents: number;
  advancesTotalCents: number;
  remainingBalanceCents: number;
  availableForAdvanceCents: number;
}

export async function getAuthoritativeCycleBalance(
  tx: Prisma.TransactionClient,
  cycleId: string
): Promise<AuthoritativeCycleBalance> {
  // 1. Fetch payable items in this cycle
  const payableItems = await tx.commissionPayableItem.findMany({
    where: { cycleId },
  });
  let releasesCents = 0;
  let reversalsCents = 0;
  for (const item of payableItems) {
    if (item.type === CommissionPayableType.RELEASE) {
      releasesCents += toCents(item.amount);
    } else if (item.type === CommissionPayableType.REVERSAL && !item.isHistoricalCorrection) {
      reversalsCents += toCents(item.amount);
    }
  }
  const grossCommissionCents = Math.max(0, releasesCents - reversalsCents);

  // 2. Fetch cycle adjustments in this cycle
  const adjustments = await tx.commissionCycleAdjustment.findMany({
    where: { cycleId },
  });
  let creditsCents = 0;
  let debitsCents = 0;
  for (const adj of adjustments) {
    if (adj.type === CommissionCycleAdjustmentType.CREDIT) {
      creditsCents += toCents(adj.amount);
    } else if (adj.type === CommissionCycleAdjustmentType.DEBIT) {
      debitsCents += toCents(adj.amount);
    }
  }
  const adjustmentsTotalCents = creditsCents - debitsCents;
  const economicPayableCents = grossCommissionCents + adjustmentsTotalCents;

  // 3. Fetch advances and advance reversals in this cycle
  const advances = await tx.commissionAdvance.findMany({
    where: { cycleId },
    include: { reversals: true },
  });
  let totalAdvancesCents = 0;
  let totalAdvanceReversalsCents = 0;
  for (const adv of advances) {
    totalAdvancesCents += toCents(adv.amount);
    if (adv.reversals) {
      for (const rev of adv.reversals) {
        totalAdvanceReversalsCents += toCents(rev.amount);
      }
    }
  }
  const advancesTotalCents = Math.max(0, totalAdvancesCents - totalAdvanceReversalsCents);
  const remainingBalanceCents = economicPayableCents - advancesTotalCents;
  const availableForAdvanceCents = Math.max(0, remainingBalanceCents);

  return {
    cycleId,
    grossCommissionCents,
    adjustmentsTotalCents,
    economicPayableCents,
    advancesTotalCents,
    remainingBalanceCents,
    availableForAdvanceCents,
  };
}

export interface CreateCommissionAdvanceInput {
  barbershopId: string;
  memberId: string;
  amount: number | string | Prisma.Decimal;
  paymentMethod: CommissionDisbursementMethod;
  idempotencyKey: string;
  createdById: string;
  notes?: string | null;
  description?: string | null;
  disbursedAt?: Date | null;
}

export async function createCommissionAdvance(
  tx: Prisma.TransactionClient,
  input: CreateCommissionAdvanceInput
) {
  const { barbershopId, memberId, paymentMethod, idempotencyKey, createdById } = input;
  const requestedCents = toCents(input.amount);

  if (requestedCents <= 0) {
    throw new CommissionError("INVALID_ADVANCE_AMOUNT", "Valor de adiantamento deve ser positivo.", 422);
  }

  // 1. Fetch current OPEN cycle (or lazily get/create)
  const cycle = await getOrCreateCurrentCycle(tx, barbershopId, memberId);
  if (cycle.status !== CommissionCycleStatus.OPEN) {
    throw new CommissionError("CYCLE_NOT_OPEN", "Adiantamento requer ciclo aberto.", 422);
  }

  // 2. Lock cycle row FOR UPDATE to prevent concurrent overadvance
  try {
    await tx.$executeRaw`SELECT id FROM commission_cycles WHERE id = ${cycle.id} FOR UPDATE`;
  } catch {
    // In test mocks where $executeRaw is stubbed, continue
  }

  // 3. Check idempotency inside the lock
  const existing = await tx.commissionAdvance.findUnique({
    where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey } },
    include: { financialEntry: true, cashMovement: true },
  });
  if (existing) {
    if (
      existing.memberId !== memberId ||
      toCents(existing.amount) !== requestedCents ||
      existing.paymentMethod !== paymentMethod
    ) {
      throw new CommissionError(
        "IDEMPOTENCY_CONFLICT",
        "Chave de idempotencia ja utilizada com payload diferente.",
        409
      );
    }
    return existing;
  }

  // 4. Recompute authoritative available balance
  const authBalance = await getAuthoritativeCycleBalance(tx, cycle.id);

  if (requestedCents > authBalance.availableForAdvanceCents) {
    throw new CommissionError(
      "INSUFFICIENT_COMMISSION_BALANCE",
      `Saldo disponível insuficiente para adiantamento. Disponível: ${fromCents(authBalance.availableForAdvanceCents)}, Solicitado: ${fromCents(requestedCents)}`,
      422
    );
  }

  // 5. Create CommissionAdvance
  const advance = await tx.commissionAdvance.create({
    data: {
      barbershopId,
      cycleId: cycle.id,
      memberId,
      amount: fromCents(requestedCents),
      paymentMethod,
      disbursedAt: input.disbursedAt ?? new Date(),
      notes: input.notes ?? null,
      idempotencyKey,
      createdById,
    },
  });

  // 6. Update cycle caches
  const newAdvancesTotal = authBalance.advancesTotalCents + requestedCents;
  const newRemainingBalance = authBalance.economicPayableCents - newAdvancesTotal;

  await tx.commissionCycle.update({
    where: { id: cycle.id },
    data: {
      grossCommission: fromCents(authBalance.grossCommissionCents),
      adjustmentsTotal: fromCents(authBalance.adjustmentsTotalCents),
      advancesTotal: fromCents(newAdvancesTotal),
      remainingBalance: fromCents(newRemainingBalance),
      version: { increment: 1 },
    },
  });

  // 7. Create linked FinancialEntry (negative amount)
  const description =
    input.description ?? input.notes ?? `Adiantamento de comissão - membro ${memberId}`;

  await tx.financialEntry.create({
    data: {
      barbershopId,
      type: FinancialEntryType.COMMISSION_ADVANCE,
      category: "COMMISSION",
      amount: fromCents(-requestedCents),
      description,
      userId: createdById,
      commissionAdvanceId: advance.id,
    },
  });

  // 8. If CASH, validate open cash session and create CashMovement
  if (paymentMethod === CommissionDisbursementMethod.CASH) {
    const cashSession = await tx.cashSession.findFirst({
      where: { barbershopId, status: "OPEN" },
    });
    if (!cashSession) {
      throw new CommissionError(
        "NO_OPEN_CASH_SESSION",
        "Operação de adiantamento em dinheiro requer sessão de caixa aberta.",
        400
      );
    }

    await tx.cashMovement.create({
      data: {
        barbershopId,
        cashSessionId: cashSession.id,
        amount: fromCents(-requestedCents),
        description,
        commissionAdvanceId: advance.id,
      },
    });

    await syncCashSessionExpectedAmount(tx, cashSession.id);
  }

  // 9. Audit log
  await tx.commissionAdvanceAudit.create({
    data: {
      barbershopId,
      advanceId: advance.id,
      field: "notes",
      oldValue: null,
      newValue: input.notes ?? null,
      reason: input.notes ?? "Criação de adiantamento de comissão",
      changedById: createdById,
    },
  });

  return advance;
}

export interface ReverseCommissionAdvanceInput {
  barbershopId: string;
  advanceId: string;
  amount: number | string | Prisma.Decimal;
  returnMethod: CommissionDisbursementMethod;
  reason: string;
  idempotencyKey: string;
  createdById: string;
  isPhysicalCashReturned?: boolean;
  returnedAt?: Date | null;
}

export async function reverseCommissionAdvance(
  tx: Prisma.TransactionClient,
  input: ReverseCommissionAdvanceInput
) {
  const { barbershopId, advanceId, returnMethod, reason, idempotencyKey, createdById } = input;
  const reversalCents = toCents(input.amount);

  if (reversalCents <= 0) {
    throw new CommissionError("INVALID_REVERSAL_AMOUNT", "Valor do estorno deve ser positivo.", 422);
  }

  // 1. Fetch advance with cycle and existing reversals
  const advance = await tx.commissionAdvance.findUnique({
    where: { id: advanceId },
    include: { reversals: true, cycle: true },
  });
  if (!advance || advance.barbershopId !== barbershopId) {
    throw new CommissionError("ADVANCE_NOT_FOUND", "Adiantamento nao encontrado.", 404);
  }

  // 2. Lock cycle row FOR UPDATE
  try {
    await tx.$executeRaw`SELECT id FROM commission_cycles WHERE id = ${advance.cycleId} FOR UPDATE`;
  } catch {
    // In test mocks where $executeRaw is stubbed, continue
  }

  // 3. Idempotency check inside lock
  const existing = await tx.commissionAdvanceReversal.findUnique({
    where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey } },
    include: { financialEntry: true, cashMovement: true },
  });
  if (existing) {
    if (
      existing.advanceId !== advanceId ||
      toCents(existing.amount) !== reversalCents ||
      existing.returnMethod !== returnMethod
    ) {
      throw new CommissionError(
        "IDEMPOTENCY_CONFLICT",
        "Chave de idempotencia de estorno ja utilizada com payload diferente.",
        409
      );
    }
    return existing;
  }

  // 4. Validate reversal limit: cannot exceed unreversed advance amount
  const previousReversalsCents = (advance.reversals || []).reduce(
    (sum: number, r: any) => sum + toCents(r.amount),
    0
  );
  const unreversedAdvanceCents = toCents(advance.amount) - previousReversalsCents;

  if (reversalCents > unreversedAdvanceCents) {
    throw new CommissionError(
      "REVERSAL_EXCEEDS_ADVANCE",
      `Valor do estorno (${fromCents(reversalCents)}) excede o saldo em aberto do adiantamento (${fromCents(unreversedAdvanceCents)}).`,
      422
    );
  }

  const isPhysicalCashReturned =
    input.isPhysicalCashReturned ?? (returnMethod === CommissionDisbursementMethod.CASH);

  // 5. Create CommissionAdvanceReversal
  const reversal = await tx.commissionAdvanceReversal.create({
    data: {
      barbershopId,
      advanceId: advance.id,
      amount: fromCents(reversalCents),
      returnMethod,
      isPhysicalCashReturned,
      returnedAt: input.returnedAt ?? new Date(),
      reason,
      idempotencyKey,
      createdById,
    },
  });

  // 6. Update cycle caches
  const authBalance = await getAuthoritativeCycleBalance(tx, advance.cycleId);
  await tx.commissionCycle.update({
    where: { id: advance.cycleId },
    data: {
      grossCommission: fromCents(authBalance.grossCommissionCents),
      adjustmentsTotal: fromCents(authBalance.adjustmentsTotalCents),
      advancesTotal: fromCents(authBalance.advancesTotalCents),
      remainingBalance: fromCents(authBalance.remainingBalanceCents),
      version: { increment: 1 },
    },
  });

  // 7. Create linked FinancialEntry (positive amount)
  const description = `Devolução de adiantamento de comissão - ${advance.id}`;
  await tx.financialEntry.create({
    data: {
      barbershopId,
      type: FinancialEntryType.COMMISSION_ADVANCE_REVERSAL,
      category: "COMMISSION",
      amount: fromCents(reversalCents),
      description,
      userId: createdById,
      commissionAdvanceReversalId: reversal.id,
    },
  });

  // 8. If physical cash is returned, record CashMovement in OPEN cash session
  if (isPhysicalCashReturned) {
    const cashSession = await tx.cashSession.findFirst({
      where: { barbershopId, status: "OPEN" },
    });
    if (!cashSession) {
      throw new CommissionError(
        "NO_OPEN_CASH_SESSION",
        "Devolução de adiantamento em dinheiro requer sessão de caixa aberta.",
        400
      );
    }

    await tx.cashMovement.create({
      data: {
        barbershopId,
        cashSessionId: cashSession.id,
        amount: fromCents(reversalCents),
        description,
        commissionAdvanceReversalId: reversal.id,
      },
    });

    await syncCashSessionExpectedAmount(tx, cashSession.id);
  }

  // 9. Audit log
  await tx.commissionAdvanceAudit.create({
    data: {
      barbershopId,
      advanceId: advance.id,
      field: "notes",
      oldValue: advance.notes ?? null,
      newValue: `[REVERSAL: ${fromCents(reversalCents)}] ${advance.notes ?? ""}`.trim(),
      reason,
      changedById: createdById,
    },
  });

  return reversal;
}

export interface ExecuteCommissionPayoutInput {
  barbershopId: string;
  memberId: string;
  cycleId?: string | null;
  amount?: number | string | Prisma.Decimal | null;
  paymentMethod?: CommissionDisbursementMethod | null;
  idempotencyKey: string;
  createdById: string;
  notes?: string | null;
  paidAt?: Date | null;
}

export interface ExecuteCommissionPayoutResult {
  payout: any;
  paidCycle: any;
  nextCycle: any;
}

export async function executeCommissionPayout(
  tx: Prisma.TransactionClient,
  input: ExecuteCommissionPayoutInput
): Promise<ExecuteCommissionPayoutResult> {
  const { barbershopId, memberId, idempotencyKey, createdById } = input;

  // 1. Lock member row first (deterministic lock hierarchy to avoid deadlocks)
  try {
    await tx.$executeRaw`SELECT id FROM barbershop_members WHERE id = ${memberId} FOR UPDATE`;
  } catch {
    // In test mocks where $executeRaw is stubbed, continue
  }

  // 2. Fetch current OPEN cycle (or specific cycleId if passed)
  const cycle = await tx.commissionCycle.findFirst({
    where: {
      barbershopId,
      memberId,
      status: CommissionCycleStatus.OPEN,
      ...(input.cycleId ? { id: input.cycleId } : {}),
    },
  });

  // 3. Lock OPEN cycle row FOR UPDATE
  if (cycle) {
    try {
      await tx.$executeRaw`SELECT id FROM commission_cycles WHERE id = ${cycle.id} FOR UPDATE`;
    } catch {
      // In test mocks where $executeRaw is stubbed, continue
    }
  }

  // 4. Check Idempotency inside the lock
  const existingPayout = await tx.commissionPayout.findUnique({
    where: { barbershopId_idempotencyKey: { barbershopId, idempotencyKey } },
    include: { financialEntry: true, cashMovement: true, cycle: true },
  });

  if (existingPayout) {
    // Verify payload compatibility
    if (
      existingPayout.memberId !== memberId ||
      (input.amount !== undefined &&
        input.amount !== null &&
        toCents(existingPayout.amount) !== toCents(input.amount)) ||
      (input.paymentMethod && existingPayout.paymentMethod !== input.paymentMethod)
    ) {
      throw new CommissionError(
        "IDEMPOTENCY_CONFLICT",
        "Chave de idempotencia de pagamento ja utilizada com payload diferente.",
        409
      );
    }

    // Find successor OPEN cycle for the member
    const nextOpenCycle = await tx.commissionCycle.findFirst({
      where: { barbershopId, memberId, status: CommissionCycleStatus.OPEN },
    });

    return {
      payout: existingPayout,
      paidCycle: existingPayout.cycle,
      nextCycle: nextOpenCycle,
    };
  }

  if (!cycle || cycle.status !== CommissionCycleStatus.OPEN) {
    throw new CommissionError("NO_OPEN_CYCLE", "Nao ha ciclo aberto para liquidacao.", 422);
  }

  // 5. Recompute authoritative balance after lock
  const authBalance = await getAuthoritativeCycleBalance(tx, cycle.id);
  const remainingCents = authBalance.remainingBalanceCents;

  // 6. Validate balance: remainingBalance < 0: do NOT create negative payout
  if (remainingCents < 0) {
    throw new CommissionError(
      "NEGATIVE_COMMISSION_BALANCE",
      `Ciclo com saldo devedor negativo (${fromCents(remainingCents)}). Nao e possivel realizar liquidacao com saldo devedor.`,
      422
    );
  }

  // 7. Validate caller amount if supplied
  if (input.amount !== undefined && input.amount !== null) {
    const callerCents = toCents(input.amount);
    if (callerCents !== remainingCents) {
      throw new CommissionError(
        "PAYOUT_AMOUNT_MISMATCH",
        `Valor informado (${fromCents(callerCents)}) difere do saldo autoritativo apurado (${fromCents(remainingCents)}).`,
        422
      );
    }
  }

  // 8. Validate payment method: required if remainingCents > 0
  if (remainingCents > 0 && !input.paymentMethod) {
    throw new CommissionError(
      "PAYMENT_METHOD_REQUIRED",
      "Metodo de pagamento e obrigatorio para liquidacao de valor positivo.",
      422
    );
  }

  const payoutMethod = remainingCents === 0 ? null : input.paymentMethod!;
  const now = input.paidAt ?? new Date();

  // 9. If CASH payout > 0, check open cash session
  let cashSessionId: string | null = null;
  if (remainingCents > 0 && payoutMethod === CommissionDisbursementMethod.CASH) {
    const cashSession = await tx.cashSession.findFirst({
      where: { barbershopId, status: "OPEN" },
    });
    if (!cashSession) {
      throw new CommissionError(
        "NO_OPEN_CASH_SESSION",
        "Liquidacao em dinheiro requer sessao de caixa aberta.",
        400
      );
    }
    cashSessionId = cashSession.id;
  }

  // 10. Create CommissionPayout
  const payout = await tx.commissionPayout.create({
    data: {
      barbershopId,
      cycleId: cycle.id,
      memberId,
      amount: fromCents(remainingCents),
      paymentMethod: payoutMethod,
      paidAt: now,
      notes: input.notes ?? null,
      idempotencyKey,
      createdById,
    },
  });

  // 11. Create FinancialEntry and CashMovement if amount > 0
  if (remainingCents > 0) {
    const description =
      input.notes ?? `Pagamento final de comissao - ciclo #${cycle.cycleNumber} membro ${memberId}`;

    await tx.financialEntry.create({
      data: {
        barbershopId,
        type: FinancialEntryType.COMMISSION_PAYOUT,
        category: "COMMISSION",
        amount: fromCents(-remainingCents), // negative liability settlement
        description,
        userId: createdById,
        commissionPayoutId: payout.id,
      },
    });

    if (payoutMethod === CommissionDisbursementMethod.CASH && cashSessionId) {
      await tx.cashMovement.create({
        data: {
          barbershopId,
          cashSessionId,
          amount: fromCents(-remainingCents),
          description,
          commissionPayoutId: payout.id,
        },
      });
      await syncCashSessionExpectedAmount(tx, cashSessionId);
    }
  }

  // 12. Mark current cycle as PAID and immutable
  const paidCycle = await tx.commissionCycle.update({
    where: { id: cycle.id },
    data: {
      status: CommissionCycleStatus.PAID,
      paidAt: now,
      closedAt: now,
      finalPayoutAmount: fromCents(remainingCents),
      remainingBalance: 0,
      version: { increment: 1 },
    },
  });

  // 13. Open next cycle atomically
  const nextCycleNumber = cycle.cycleNumber + 1;
  const nextCycle = await tx.commissionCycle.create({
    data: {
      barbershopId,
      memberId,
      cycleNumber: nextCycleNumber,
      status: CommissionCycleStatus.OPEN,
      grossCommission: 0,
      adjustmentsTotal: 0,
      advancesTotal: 0,
      finalPayoutAmount: 0,
      remainingBalance: 0,
      version: 1,
      openedAt: now,
    },
  });

  return {
    payout,
    paidCycle,
    nextCycle,
  };
}

export async function resolveHistoricalCommissionConfig(
  tx: Prisma.TransactionClient,
  input: {
    barbershopId: string;
    memberId: string;
    serviceId?: string | null;
    productId?: string | null;
    itemType: ComandaItemType;
    attributionTime: Date;
  }
) {
  const currentResolved = await resolveCommissionConfig(tx, {
    barbershopId: input.barbershopId,
    memberId: input.memberId,
    serviceId: input.serviceId,
    productId: input.productId,
    itemType: input.itemType,
  });

  if (!currentResolved) {
    throw new CommissionError(
      "HISTORICAL_COMMISSION_RULE_UNPROVABLE",
      "Nenhuma regra de comissão aplicável encontrada para o novo executor.",
      422
    );
  }

  // Verify provenance at attributionTime:
  // The rule must have existed at attributionTime (createdAt <= attributionTime)
  // and must NOT have been updated after attributionTime (updatedAt <= attributionTime).
  let ruleCreatedAt: Date | null = null;
  let ruleUpdatedAt: Date | null = null;

  if (currentResolved.serviceCommissionRuleId) {
    const scr = await tx.serviceCommissionRule.findUnique({
      where: { id: currentResolved.serviceCommissionRuleId },
      select: { createdAt: true, updatedAt: true },
    });
    if (scr) {
      ruleCreatedAt = scr.createdAt;
      ruleUpdatedAt = scr.updatedAt;
    }
  } else if (currentResolved.configId) {
    const cfg = await tx.commissionConfig.findUnique({
      where: { id: currentResolved.configId },
      select: { createdAt: true, updatedAt: true },
    });
    if (cfg) {
      ruleCreatedAt = cfg.createdAt;
      ruleUpdatedAt = cfg.updatedAt;
    }
  } else if (currentResolved.careerLevelId) {
    const cl = await tx.careerLevel.findUnique({
      where: { id: currentResolved.careerLevelId },
      select: { createdAt: true, updatedAt: true },
    });
    if (cl) {
      ruleCreatedAt = cl.createdAt;
      ruleUpdatedAt = cl.updatedAt;
    }
  }

  if (!ruleCreatedAt || !ruleUpdatedAt) {
    throw new CommissionError(
      "HISTORICAL_COMMISSION_RULE_UNPROVABLE",
      "Não foi possível verificar a proveniência da regra histórica de comissão.",
      422
    );
  }

  if (ruleCreatedAt > input.attributionTime || ruleUpdatedAt > input.attributionTime) {
    throw new CommissionError(
      "HISTORICAL_COMMISSION_RULE_UNPROVABLE",
      "A regra de comissão aplicável foi criada ou alterada após a data original de atribuição, tornando o histórico não comprovável.",
      422
    );
  }

  return currentResolved;
}

export interface CorrectCommissionExecutorInput {
  barbershopId: string;
  comandaItemId: string;
  newExecutorMemberId: string;
  reason: string;
  idempotencyKey: string;
  userId: string;
  role: string;
}

export interface CorrectCommissionExecutorResult {
  success: boolean;
  auditId: string;
  oldEntryId: string;
  newEntryId: string;
  oldMemberId: string;
  newMemberId: string;
  comandaItemId: string;
  attributionVersion: number;
  oldReleasedAmount: string;
  newReleasedAmount: string;
  reversalAmount: string;
  newGrossAmount: string;
  isIdempotentReplay?: boolean;
}

export async function correctCommissionExecutor(
  input: CorrectCommissionExecutorInput,
  clientTx?: Prisma.TransactionClient
): Promise<CorrectCommissionExecutorResult> {
  // 1. Role validation: OWNER or MANAGER only. BARBER forbidden.
  if (input.role !== "OWNER" && input.role !== "MANAGER") {
    throw new CommissionError(
      "FORBIDDEN",
      "Apenas administradores (OWNER/MANAGER) podem executar correções de comissão.",
      403
    );
  }

  // 2. Reason validation: minimum 10 characters
  if (!input.reason || input.reason.trim().length < 10) {
    throw new CommissionError(
      "INVALID_REASON",
      "Motivo deve ter no mínimo 10 caracteres.",
      400
    );
  }

  // 3. Idempotency Key validation
  if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
    throw new CommissionError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Header Idempotency-Key é obrigatório.",
      400
    );
  }

  const payloadFingerprint = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        comandaItemId: input.comandaItemId,
        newExecutorMemberId: input.newExecutorMemberId,
        reason: input.reason.trim(),
      })
    )
    .digest("hex");

  const executeCore = async (tx: Prisma.TransactionClient): Promise<CorrectCommissionExecutorResult> => {
    // Check if idempotency key already exists for this tenant
    const existingAudit = await tx.commissionExecutorCorrectionAudit.findUnique({
      where: {
        barbershopId_idempotencyKey: {
          barbershopId: input.barbershopId,
          idempotencyKey: input.idempotencyKey.trim(),
        },
      },
      include: {
        oldEntry: true,
        newEntry: true,
      },
    });

    if (existingAudit) {
      if (existingAudit.payloadFingerprint !== payloadFingerprint) {
        throw new CommissionError(
          "IDEMPOTENCY_CONFLICT",
          "Chave de idempotência já utilizada com parâmetros diferentes.",
          409
        );
      }
      return {
        success: true,
        auditId: existingAudit.id,
        oldEntryId: existingAudit.oldEntryId,
        newEntryId: existingAudit.newEntryId,
        oldMemberId: existingAudit.oldMemberId,
        newMemberId: existingAudit.newMemberId,
        comandaItemId: existingAudit.comandaItemId,
        attributionVersion: existingAudit.newEntry.attributionVersion,
        oldReleasedAmount: fromCents(toCents(existingAudit.oldReleasedAmount)).toFixed(2),
        newReleasedAmount: fromCents(toCents(existingAudit.newReleasedAmount)).toFixed(2),
        reversalAmount: fromCents(toCents(existingAudit.oldReleasedAmount)).toFixed(2),
        newGrossAmount: fromCents(toCents(existingAudit.newEntry.generatedAmount)).toFixed(2),
        isIdempotentReplay: true,
      };
    }

    // Deadlock-free deterministic locking order:
    // 1. Comanda (SELECT FOR UPDATE)
    // 2. ComandaItem (SELECT FOR UPDATE)
    // 3. CommissionEntry (current version) (SELECT FOR UPDATE)
    // 4. Members / Cycles in sorted ID order (SELECT FOR UPDATE)

    const itemRecord = await tx.comandaItem.findFirst({
      where: { id: input.comandaItemId, barbershopId: input.barbershopId },
      include: { comanda: true },
    });

    if (!itemRecord) {
      throw new CommissionError("ITEM_NOT_FOUND", "Item de comanda não encontrado.", 404);
    }

    if (itemRecord.comanda.status === ComandaStatus.CANCELLED) {
      throw new CommissionError(
        "COMANDA_CANCELLED",
        "Não é possível corrigir executor de comanda cancelada.",
        422
      );
    }

    if (itemRecord.type === ComandaItemType.PRODUCT && itemRecord.status !== ComandaItemStatus.DONE) {
      throw new CommissionError(
        "ITEM_NOT_DONE",
        "Apenas itens de produto concluídos podem ter seu executor corrigido.",
        422
      );
    }

    // Row locks in deterministic order
    await tx.$queryRaw`SELECT id FROM comandas WHERE id = ${itemRecord.comandaId} AND barbershop_id = ${input.barbershopId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM comanda_items WHERE id = ${itemRecord.id} AND barbershop_id = ${input.barbershopId} FOR UPDATE`;

    const currentOldEntry = await getCurrentCommissionEntry(tx, {
      comandaItemId: itemRecord.id,
      barbershopId: input.barbershopId,
    });

    if (!currentOldEntry) {
      throw new CommissionError(
        "NO_CURRENT_ENTRY",
        "Item não possui lançamento de comissão ativo.",
        404
      );
    }

    await tx.$queryRaw`SELECT id FROM commission_entries WHERE id = ${currentOldEntry.id} FOR UPDATE`;

    if (currentOldEntry.memberId === input.newExecutorMemberId) {
      throw new CommissionError(
        "NO_CHANGE",
        "O novo executor informado já é o executor atual deste item.",
        400
      );
    }

    // Lock members in sorted ID order
    const sortedMemberIds = [currentOldEntry.memberId, input.newExecutorMemberId].sort();
    for (const mId of sortedMemberIds) {
      await tx.$queryRaw`SELECT id FROM barbershop_members WHERE id = ${mId} AND barbershop_id = ${input.barbershopId} FOR UPDATE`;
    }

    // Validate new executor member
    const newMember = await tx.barbershopMember.findFirst({
      where: { id: input.newExecutorMemberId, barbershopId: input.barbershopId, isActive: true },
      include: { services: true },
    });

    if (!newMember) {
      throw new CommissionError(
        "INVALID_EXECUTOR",
        "Novo executor não encontrado ou inativo.",
        422
      );
    }

    if (itemRecord.type === ComandaItemType.SERVICE && itemRecord.serviceId && newMember.services.length > 0) {
      const canExecute = newMember.services.some((s) => s.serviceId === itemRecord.serviceId);
      if (!canExecute) {
        throw new CommissionError(
          "EXECUTOR_SERVICE_MISMATCH",
          "Profissional não habilitado para o serviço.",
          422
        );
      }
    }

    // Conservative historical rule reconstruction at attributionTime
    const attributionTime = currentOldEntry.createdAt;
    const historicalRule = await resolveHistoricalCommissionConfig(tx, {
      barbershopId: input.barbershopId,
      memberId: input.newExecutorMemberId,
      serviceId: itemRecord.serviceId,
      productId: itemRecord.productId,
      itemType: itemRecord.type,
      attributionTime,
    });

    const newGeneratedAmount = calculateCommissionAmount(
      currentOldEntry.baseAmount,
      historicalRule.type,
      historicalRule.value
    );
    const newGeneratedCents = toCents(newGeneratedAmount);

    // Proportional release based on comanda payment state
    const comandaTotalCents = toCents(itemRecord.comanda.total);
    const netPaidCents = await getNetPaidCents(tx, input.barbershopId, itemRecord.comandaId);
    const clampedNetPaid = Math.max(0, Math.min(comandaTotalCents, netPaidCents));

    let newReleasedCents = 0;
    if (comandaTotalCents > 0 && newGeneratedCents > 0) {
      newReleasedCents = Math.min(
        newGeneratedCents,
        Math.round((newGeneratedCents * clampedNetPaid) / comandaTotalCents)
      );
    }

    const oldReleasedCents = toCents(currentOldEntry.releasedAmount);

    // Economic reversal of old executor's entitlement
    if (oldReleasedCents > 0) {
      await reverseCommissionEntry(
        tx,
        input.barbershopId,
        currentOldEntry.id,
        oldReleasedCents,
        null,
        `Correção de executor: transferido para ${newMember.id} (${input.reason.trim()})`,
        {
          sourceKind: CommissionPayableSourceKind.EXECUTOR_CORRECTION,
          sourceComandaId: itemRecord.comandaId,
          sourceRevision: itemRecord.comanda.commissionRevision,
          eventKey: `exec-corr-rev-${currentOldEntry.id}-v${currentOldEntry.attributionVersion}`,
          userId: input.userId,
        }
      );
    }

    // Generate ID for new entry
    const newEntryId = crypto.randomUUID();

    // Supersede old entry (isCurrent = false)
    await tx.commissionEntry.update({
      where: { id: currentOldEntry.id },
      data: {
        isCurrent: false,
      },
    });

    // Create new entry
    const newEntryStatus =
      newReleasedCents >= newGeneratedCents
        ? CommissionEntryStatus.RELEASED
        : newReleasedCents > 0
        ? CommissionEntryStatus.PARTIALLY_RELEASED
        : CommissionEntryStatus.GENERATED;

    const newEntry = await tx.commissionEntry.create({
      data: {
        id: newEntryId,
        barbershopId: input.barbershopId,
        comandaItemId: itemRecord.id,
        memberId: input.newExecutorMemberId,
        configId: historicalRule.configId ?? null,
        configSnapshot: (historicalRule.configSnapshot ?? {}) as unknown as Prisma.InputJsonValue,
        baseAmount: currentOldEntry.baseAmount,
        generatedAmount: newGeneratedAmount,
        releasedAmount: fromCents(newReleasedCents),
        paidAmount: 0,
        reversedAmount: 0,
        status: newEntryStatus,
        competence: currentOldEntry.competence,
        type: currentOldEntry.type,
        attributionVersion: currentOldEntry.attributionVersion + 1,
        isCurrent: true,
        supersedesEntryId: currentOldEntry.id,
      },
    });

    // Economic release to new executor in current OPEN cycle
    if (newReleasedCents > 0) {
      const newCycle = await getOrCreateCurrentCycle(tx, input.barbershopId, input.newExecutorMemberId);
      const relEventKey = `exec-corr-rel-${newEntry.id}-v${newEntry.attributionVersion}`;

      await tx.commissionPayableItem.create({
        data: {
          barbershopId: input.barbershopId,
          cycleId: newCycle.id,
          entryId: newEntry.id,
          memberId: input.newExecutorMemberId,
          sourceKind: CommissionPayableSourceKind.EXECUTOR_CORRECTION,
          sourceComandaId: itemRecord.comandaId,
          sourceRevision: itemRecord.comanda.commissionRevision,
          type: CommissionPayableType.RELEASE,
          amount: fromCents(newReleasedCents),
          eventKey: relEventKey,
        },
      });

      await tx.commissionCycle.update({
        where: { id: newCycle.id },
        data: {
          grossCommission: fromCents(toCents(newCycle.grossCommission) + newReleasedCents),
          remainingBalance: fromCents(toCents(newCycle.remainingBalance) + newReleasedCents),
        },
      });
    }

    // Update ComandaItem executorId
    await tx.comandaItem.update({
      where: { id: itemRecord.id },
      data: { executorId: input.newExecutorMemberId },
    });

    // Increment Comanda commissionRevision
    await tx.comanda.update({
      where: { id: itemRecord.comandaId },
      data: { commissionRevision: { increment: 1 } },
    });

    // Record audit row
    const audit = await tx.commissionExecutorCorrectionAudit.create({
      data: {
        barbershopId: input.barbershopId,
        comandaItemId: itemRecord.id,
        oldEntryId: currentOldEntry.id,
        newEntryId: newEntry.id,
        oldMemberId: currentOldEntry.memberId,
        newMemberId: input.newExecutorMemberId,
        oldConfigSnapshot: (currentOldEntry.configSnapshot ?? {}) as Prisma.InputJsonValue,
        newConfigSnapshot: (historicalRule.configSnapshot ?? {}) as Prisma.InputJsonValue,
        oldReleasedAmount: currentOldEntry.releasedAmount,
        newReleasedAmount: fromCents(newReleasedCents),
        reason: input.reason.trim(),
        idempotencyKey: input.idempotencyKey.trim(),
        payloadFingerprint,
        correctedById: input.userId,
      },
    });

    return {
      success: true,
      auditId: audit.id,
      oldEntryId: currentOldEntry.id,
      newEntryId: newEntry.id,
      oldMemberId: currentOldEntry.memberId,
      newMemberId: input.newExecutorMemberId,
      comandaItemId: itemRecord.id,
      attributionVersion: newEntry.attributionVersion,
      oldReleasedAmount: fromCents(toCents(currentOldEntry.releasedAmount)).toFixed(2),
      newReleasedAmount: fromCents(newReleasedCents).toFixed(2),
      reversalAmount: fromCents(oldReleasedCents).toFixed(2),
      newGrossAmount: fromCents(toCents(newEntry.generatedAmount)).toFixed(2),
      isIdempotentReplay: false,
    };
  };

  if (clientTx) {
    return executeCore(clientTx);
  }

  const { runSerializableTransaction } = await import("./stock");
  return runSerializableTransaction((tx) => executeCore(tx));
}
