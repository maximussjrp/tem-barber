import { FinancialCategory, FinancialEntryAllocation, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { fromCents, toCents } from "@/lib/operations/money";

export class FinancialAllocationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "FinancialAllocationError";
    this.code = code;
    this.status = status;
  }
}

export const FINANCIAL_SYSTEM_KEYS = {
  COMANDA_SERVICE_REVENUE: "COMANDA_SERVICE_REVENUE",
  COMANDA_PRODUCT_REVENUE: "COMANDA_PRODUCT_REVENUE",
  CLUB_REVENUE: "CLUB_REVENUE",
  REFUND: "REFUND",
  COMMISSION_PAYOUT: "COMMISSION_PAYOUT",
  COMMISSION_ADVANCE: "COMMISSION_ADVANCE",
  COMMISSION_ADVANCE_REVERSAL: "COMMISSION_ADVANCE_REVERSAL",
  CLUB_BARBER_PAYOUT: "CLUB_BARBER_PAYOUT",
} as const;

export type FinancialSystemKey = (typeof FINANCIAL_SYSTEM_KEYS)[keyof typeof FINANCIAL_SYSTEM_KEYS];

export async function resolveSystemCategory(
  tx: Prisma.TransactionClient | typeof prisma,
  barbershopId: string,
  systemKey: string
): Promise<FinancialCategory> {
  if (!tx.financialCategorySystemMapping?.findUnique) {
    throw new FinancialAllocationError(
      "FINANCIAL_SYSTEM_MAPPING_NOT_FOUND",
      `Mapeamento do sistema '${systemKey}' não encontrado para a barbearia.`,
      400
    );
  }

  const mapping = await tx.financialCategorySystemMapping.findUnique({
    where: {
      barbershopId_systemKey: {
        barbershopId,
        systemKey,
      },
    },
    include: {
      category: true,
    },
  });

  if (!mapping || !mapping.category) {
    throw new FinancialAllocationError(
      "FINANCIAL_SYSTEM_MAPPING_NOT_FOUND",
      `Mapeamento do sistema '${systemKey}' não encontrado para a barbearia.`,
      400
    );
  }

  // Tenant Isolation check: ensure category belongs to same barbershopId
  if (mapping.barbershopId !== barbershopId || mapping.category.barbershopId !== barbershopId) {
    throw new FinancialAllocationError(
      "FINANCIAL_SYSTEM_CATEGORY_INVALID",
      `A categoria mapeada para o sistema '${systemKey}' pertence a outro tenant.`,
      403
    );
  }

  if (!mapping.category.isActive) {
    throw new FinancialAllocationError(
      "FINANCIAL_SYSTEM_CATEGORY_INVALID",
      `A categoria '${mapping.category.name}' associada ao mapeamento '${systemKey}' está inativa.`,
      400
    );
  }

  return mapping.category;
}

export async function validateCategoryTenant(
  tx: Prisma.TransactionClient | typeof prisma,
  barbershopId: string,
  categoryId: string
): Promise<FinancialCategory> {
  if (!tx.financialCategory?.findFirst) {
    throw new FinancialAllocationError(
      "FINANCIAL_SYSTEM_CATEGORY_INVALID",
      "Categoria financeira não encontrada ou pertence a outro tenant.",
      400
    );
  }

  const category = await tx.financialCategory.findFirst({
    where: {
      id: categoryId,
      barbershopId,
    },
  });

  if (!category) {
    throw new FinancialAllocationError(
      "FINANCIAL_SYSTEM_CATEGORY_INVALID",
      "Categoria financeira não encontrada ou pertence a outro tenant.",
      400
    );
  }

  if (!category.isActive) {
    throw new FinancialAllocationError(
      "FINANCIAL_SYSTEM_CATEGORY_INVALID",
      `A categoria '${category.name}' está inativa.`,
      400
    );
  }

  return category;
}

export interface CreateAllocationParams {
  barbershopId: string;
  financialEntryId: string;
  amountCents: number;
  categoryId?: string;
  systemKey?: string;
}

/**
 * Cria ou recupera uma allocation de 100% para um FinancialEntry.
 * Garante tenant isolation, validação da categoria/mapping e exatidão em centavos.
 */
export async function createSingleEntryAllocation(
  tx: Prisma.TransactionClient | typeof prisma,
  params: CreateAllocationParams
): Promise<FinancialEntryAllocation> {
  const { barbershopId, financialEntryId, amountCents } = params;

  let targetCategoryId: string;

  if (params.systemKey) {
    const category = await resolveSystemCategory(tx, barbershopId, params.systemKey);
    targetCategoryId = category.id;
  } else if (params.categoryId) {
    const category = await validateCategoryTenant(tx, barbershopId, params.categoryId);
    targetCategoryId = category.id;
  } else {
    throw new FinancialAllocationError(
      "FINANCIAL_ALLOCATION_INVALID",
      "categoryId ou systemKey é obrigatório para criar allocation.",
      400
    );
  }

  const allocatedAmount = fromCents(amountCents);

  // Check if financial entry exists and validate amount matching
  const entry = tx.financialEntry?.findFirst
    ? await tx.financialEntry.findFirst({
        where: { id: financialEntryId, barbershopId },
      })
    : null;

  if (entry) {
    const entryCents = toCents(entry.amount);
    if (entryCents !== amountCents) {
      throw new FinancialAllocationError(
        "FINANCIAL_ALLOCATION_MISMATCH",
        `O valor da allocation (${amountCents} centavos) difere do valor do FinancialEntry (${entryCents} centavos).`,
        400
      );
    }
  }

  // Idempotency / replay check
  const existing = tx.financialEntryAllocation?.findUnique
    ? await tx.financialEntryAllocation.findUnique({
        where: {
          barbershopId_financialEntryId_financialCategoryId: {
            barbershopId,
            financialEntryId,
            financialCategoryId: targetCategoryId,
          },
        },
      })
    : null;

  if (existing) {
    if (toCents(existing.allocatedAmount) !== amountCents) {
      throw new FinancialAllocationError(
        "FINANCIAL_ALLOCATION_MISMATCH",
        "Allocation existente possui valor diferente.",
        409
      );
    }
    return existing;
  }

  if (!tx.financialEntryAllocation?.create) {
    throw new FinancialAllocationError(
      "FINANCIAL_ALLOCATION_INVALID",
      "Transação não suporta a criação de allocation.",
      400
    );
  }

  return await tx.financialEntryAllocation.create({
    data: {
      barbershopId,
      financialEntryId,
      financialCategoryId: targetCategoryId,
      allocatedAmount,
    },
  });
}

/**
 * Valida que a soma das allocations de um FinancialEntry fecha exatamente com o valor do FinancialEntry em centavos.
 */
export async function validateFinancialEntryAllocationSum(
  tx: Prisma.TransactionClient | typeof prisma,
  barbershopId: string,
  financialEntryId: string
): Promise<{ isValid: boolean; entryCents: number; sumAllocatedCents: number }> {
  const entry = await tx.financialEntry.findFirst({
    where: { id: financialEntryId, barbershopId },
    include: { allocations: true },
  });

  if (!entry) {
    throw new FinancialAllocationError(
      "FINANCIAL_ENTRY_NOT_FOUND",
      "Lançamento financeiro não encontrado.",
      404
    );
  }

  const entryCents = toCents(entry.amount);
  const sumAllocatedCents = entry.allocations.reduce(
    (sum, alloc) => sum + toCents(alloc.allocatedAmount),
    0
  );

  const isValid = entryCents === sumAllocatedCents;

  if (!isValid) {
    throw new FinancialAllocationError(
      "FINANCIAL_ALLOCATION_MISMATCH",
      `A soma das allocations (${sumAllocatedCents} centavos) difere do valor da entry (${entryCents} centavos).`,
      400
    );
  }

  return { isValid, entryCents, sumAllocatedCents };
}

export interface ComandaEconomicMix {
  serviceRawNet: number;
  productRawNet: number;
  totalRawNet: number;
}

/**
 * Calcula o mix econômico líquido de serviços e produtos de uma comanda em centavos,
 * considerando descontos/acréscimos a nível de item e benefícios do Clube.
 */
export async function calculateComandaEconomicMix(
  tx: Prisma.TransactionClient | typeof prisma,
  barbershopId: string,
  comandaId: string
): Promise<ComandaEconomicMix> {
  const comanda = tx.comanda?.findFirst
    ? await tx.comanda.findFirst({
        where: { id: comandaId, barbershopId },
        include: {
          items: {
            include: { clubBenefitUsage: true },
          },
        },
      })
    : null;

  if (!comanda) {
    return { serviceRawNet: 0, productRawNet: 0, totalRawNet: 0 };
  }

  const regularItems = (comanda.items || []).filter(
    (item) => (item.type === "SERVICE" || item.type === "PRODUCT") && item.status !== "CANCELLED"
  );

  let balance: Awaited<ReturnType<typeof import("@/lib/operations/club").getClubBenefitsBalance>> | null = null;
  if (comanda.customerId) {
    const { getActiveCustomerClubSubscription, getClubBenefitsBalance } = await import(
      "@/lib/operations/club"
    );
    const clubEvalDate = comanda.openedAt || new Date();
    const activeSub = await getActiveCustomerClubSubscription({
      barbershopId: comanda.barbershopId,
      customerId: comanda.customerId,
      atDate: clubEvalDate,
      tx,
    });
    if (activeSub) {
      balance = await getClubBenefitsBalance({
        barbershopId: comanda.barbershopId,
        subscriptionId: activeSub.id,
        atDate: clubEvalDate,
        tx,
      });
    }
  }

  let serviceRawNet = 0;
  let productRawNet = 0;

  for (const item of regularItems) {
    let itemReduction = 0;
    const usage = item.clubBenefitUsage;
    if (usage && usage.status === "APPLIED") {
      const covered = usage.coveredAmount ? toCents(usage.coveredAmount) : 0;
      const discount = usage.discountAmount ? toCents(usage.discountAmount) : 0;
      itemReduction = covered + discount;
    } else if (item.clubBenefitRequested && item.requestedClubPlanBenefitId && balance) {
      const benefit = balance.benefits?.find((b) => b.id === item.requestedClubPlanBenefitId);
      if (benefit) {
        const isServiceMatch = item.type === "SERVICE" && benefit.serviceId === item.serviceId;
        const isProductMatch = item.type === "PRODUCT" && benefit.productId === item.productId;
        if (isServiceMatch || isProductMatch) {
          if (benefit.benefitType === "INCLUDED_SERVICE") {
            const canUse = benefit.isUnlimited || (benefit.availableQty && benefit.availableQty > 0);
            if (canUse) {
              itemReduction = toCents(item.total);
              if (!benefit.isUnlimited && benefit.availableQty) {
                benefit.availableQty--;
              }
            }
          } else {
            const pct = Number(benefit.discountPercent || 0);
            const original = toCents(item.total);
            itemReduction = Math.round((original * pct) / 100);
          }
        }
      }
    }

    const netItemCents = Math.max(0, toCents(item.total) - itemReduction);
    if (item.type === "SERVICE") {
      serviceRawNet += netItemCents;
    } else if (item.type === "PRODUCT") {
      productRawNet += netItemCents;
    }
  }

  return {
    serviceRawNet,
    productRawNet,
    totalRawNet: serviceRawNet + productRawNet,
  };
}

/**
 * Sincroniza e aloca deterministicamente todos os FinancialEntries (COMMAND_REVENUE)
 * de uma comanda entre COMANDA_SERVICE_REVENUE e COMANDA_PRODUCT_REVENUE.
 */
export async function syncComandaRevenueAllocations(
  tx: Prisma.TransactionClient | typeof prisma,
  barbershopId: string,
  comandaId: string,
  precalculatedNet?: { serviceRawNet: number; productRawNet: number }
): Promise<void> {
  if (!tx.financialEntry?.findMany) return;

  const entries = await tx.financialEntry.findMany({
    where: {
      comandaId,
      barbershopId,
      type: "COMMAND_REVENUE",
    },
  });

  if (!entries || entries.length === 0) return;

  let serviceRawNet = precalculatedNet?.serviceRawNet;
  let productRawNet = precalculatedNet?.productRawNet;

  if (serviceRawNet === undefined || productRawNet === undefined) {
    const mix = await calculateComandaEconomicMix(tx, barbershopId, comandaId);
    serviceRawNet = mix.serviceRawNet;
    productRawNet = mix.productRawNet;
  }

  const totalRawNet = serviceRawNet + productRawNet;

  let serviceCategory: FinancialCategory | null = null;
  let productCategory: FinancialCategory | null = null;

  if (serviceRawNet > 0) {
    serviceCategory = await resolveSystemCategory(
      tx,
      barbershopId,
      FINANCIAL_SYSTEM_KEYS.COMANDA_SERVICE_REVENUE
    );
  }

  if (productRawNet > 0) {
    productCategory = await resolveSystemCategory(
      tx,
      barbershopId,
      FINANCIAL_SYSTEM_KEYS.COMANDA_PRODUCT_REVENUE
    );
  }

  for (const entry of entries) {
    const entryCents = toCents(entry.amount);
    if (entryCents === 0) continue;

    let serviceCents = 0;
    let productCents = 0;

    if (totalRawNet > 0) {
      if (productRawNet === 0) {
        serviceCents = entryCents;
        productCents = 0;
      } else if (serviceRawNet === 0) {
        serviceCents = 0;
        productCents = entryCents;
      } else {
        const sign = entryCents < 0 ? -1 : 1;
        const absEntryCents = Math.abs(entryCents);
        let absServiceCents = Math.round((absEntryCents * serviceRawNet) / totalRawNet);
        if (absEntryCents >= 2) {
          absServiceCents = Math.max(1, Math.min(absEntryCents - 1, absServiceCents));
        }
        serviceCents = absServiceCents * sign;
        productCents = entryCents - serviceCents;
      }
    }

    const activeCategoryIds: string[] = [];

    // Service allocation
    if (serviceCents !== 0 && serviceCategory) {
      activeCategoryIds.push(serviceCategory.id);
      const existing = tx.financialEntryAllocation?.findUnique
        ? await tx.financialEntryAllocation.findUnique({
            where: {
              barbershopId_financialEntryId_financialCategoryId: {
                barbershopId,
                financialEntryId: entry.id,
                financialCategoryId: serviceCategory.id,
              },
            },
          })
        : null;

      if (existing) {
        if (toCents(existing.allocatedAmount) !== serviceCents) {
          if (tx.financialEntryAllocation?.update) {
            await tx.financialEntryAllocation.update({
              where: { id: existing.id },
              data: { allocatedAmount: fromCents(serviceCents) },
            });
          }
        }
      } else if (tx.financialEntryAllocation?.create) {
        await tx.financialEntryAllocation.create({
          data: {
            barbershopId,
            financialEntryId: entry.id,
            financialCategoryId: serviceCategory.id,
            allocatedAmount: fromCents(serviceCents),
          },
        });
      }
    }

    // Product allocation
    if (productCents !== 0 && productCategory) {
      activeCategoryIds.push(productCategory.id);
      const existing = tx.financialEntryAllocation?.findUnique
        ? await tx.financialEntryAllocation.findUnique({
            where: {
              barbershopId_financialEntryId_financialCategoryId: {
                barbershopId,
                financialEntryId: entry.id,
                financialCategoryId: productCategory.id,
              },
            },
          })
        : null;

      if (existing) {
        if (toCents(existing.allocatedAmount) !== productCents) {
          if (tx.financialEntryAllocation?.update) {
            await tx.financialEntryAllocation.update({
              where: { id: existing.id },
              data: { allocatedAmount: fromCents(productCents) },
            });
          }
        }
      } else if (tx.financialEntryAllocation?.create) {
        await tx.financialEntryAllocation.create({
          data: {
            barbershopId,
            financialEntryId: entry.id,
            financialCategoryId: productCategory.id,
            allocatedAmount: fromCents(productCents),
          },
        });
      }
    }

    // Remove obsolete allocations for this entry if category mix changed
    if (tx.financialEntryAllocation?.deleteMany) {
      await tx.financialEntryAllocation.deleteMany({
        where: {
          barbershopId,
          financialEntryId: entry.id,
          financialCategoryId: { notIn: activeCategoryIds },
        },
      });
    }
  }
}
