import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { toCents } from "@/lib/operations/money";
import {
  FINANCIAL_SYSTEM_KEYS,
  FinancialAllocationError,
  resolveSystemCategory,
  createSingleEntryAllocation,
  syncComandaRevenueAllocations,
  calculateComandaEconomicMix,
  validateFinancialEntryAllocationSum,
  ComandaEconomicMix,
} from "./allocations";

export interface ReconciliationIssue {
  financialEntryId: string;
  barbershopId: string;
  type: string;
  amountCents: number;
  issueCode:
    | "ELIGIBLE_NO_ALLOCATIONS"
    | "PARTIAL_ALLOCATION"
    | "SUM_MISMATCH"
    | "CROSS_TENANT_ALLOCATION"
    | "MISSING_SYSTEM_MAPPING"
    | "INVALID_OR_INACTIVE_CATEGORY"
    | "COMMAND_REVENUE_DRIFT"
    | "LOGICAL_DUPLICATE_ALLOCATION";
  description: string;
}

export interface TenantReconciliationResult {
  barbershopId: string;
  totalEntries: number;
  eligibleEntries: number;
  fullyAllocatedEntries: number;
  unallocatableByPolicyEntries: number;
  issues: ReconciliationIssue[];
}

export interface TenantBackfillResult {
  barbershopId: string;
  eligibleEntries: number;
  alreadyFullyAllocated: number;
  needsAllocation: number;
  unallocatableByPolicy: number;
  missingMapping: number;
  sumMismatch: number;
  crossTenantIssues: number;
  createdAllocationsCount: number;
  updatedAllocationsCount: number;
  errors: string[];
}

export interface OverallBackfillResult {
  dryRun: boolean;
  tenants: TenantBackfillResult[];
  totals: {
    eligibleEntries: number;
    alreadyFullyAllocated: number;
    needsAllocation: number;
    unallocatableByPolicy: number;
    missingMapping: number;
    sumMismatch: number;
    crossTenantIssues: number;
    createdAllocationsCount: number;
    updatedAllocationsCount: number;
  };
}

/**
 * Categorias de política excluídas explicitamente nesta fase:
 * MANUAL_IN/OUT sem FinancialTitle, gorjetas (TIP), depósito de créditos de cliente.
 */
export function isUnallocatableByPolicy(entry: {
  type: string;
  financialSettlementId?: string | null;
  financialSettlementReversalId?: string | null;
  clubSubscriptionPaymentId?: string | null;
  commissionPayoutId?: string | null;
  commissionAdvanceId?: string | null;
  commissionAdvanceReversalId?: string | null;
  tipEntryId?: string | null;
  tipRefundId?: string | null;
  tipPayoutId?: string | null;
  tipPayoutReversalId?: string | null;
  customerCreditEntryId?: string | null;
}): boolean {
  if (
    entry.tipEntryId ||
    entry.tipRefundId ||
    entry.tipPayoutId ||
    entry.tipPayoutReversalId
  ) {
    return true;
  }
  if (entry.customerCreditEntryId) {
    return true;
  }
  if (
    (entry.type === "MANUAL_IN" || entry.type === "MANUAL_OUT") &&
    !entry.financialSettlementId &&
    !entry.financialSettlementReversalId
  ) {
    return true;
  }
  return false;
}

/**
 * Resolve o mix econômico de uma comanda para fins de reconciliação e backfill histórico.
 * 1. Primeiro tenta o cálculo runtime padrão (calculateComandaEconomicMix).
 * 2. Se o mix padrão for zero (ex: comanda CANCELLED a posteriori), e o status da comanda
 *    for CANCELLED, reconstrói deterministicamente o snapshot dos itens ativos no momento do pagamento/entryDate.
 * 3. Se houver clubBenefitUsage ou benefício do clube nos itens relevantes, opera fail-closed (retorna mix zero).
 */
export async function resolveHistoricalComandaEconomicMix(
  tx: Prisma.TransactionClient | typeof prisma,
  barbershopId: string,
  comandaId: string,
  entryDate?: Date | null
): Promise<ComandaEconomicMix> {
  const currentMix = await calculateComandaEconomicMix(tx, barbershopId, comandaId);
  if (currentMix.totalRawNet > 0) {
    return currentMix;
  }

  // Fallback histórico estritamente para comanda CANCELLED
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

  if (!comanda || comanda.status !== "CANCELLED") {
    return { serviceRawNet: 0, productRawNet: 0, totalRawNet: 0 };
  }

  // Instante de referência para o snapshot histórico do pagamento
  const snapshotTime = entryDate || comanda.openedAt || new Date();

  // Filtrar itens ativos no momento do snapshot:
  // item.createdAt <= snapshotTime E (item.cancelledAt IS NULL OU item.cancelledAt > snapshotTime)
  const historicalItems = (comanda.items || []).filter((item) => {
    if (item.type !== "SERVICE" && item.type !== "PRODUCT") return false;
    const createdAtValid = new Date(item.createdAt) <= snapshotTime;
    const cancelledAfterSnapshot = !item.cancelledAt || new Date(item.cancelledAt) > snapshotTime;
    return createdAtValid && cancelledAfterSnapshot;
  });

  if (historicalItems.length === 0) {
    return { serviceRawNet: 0, productRawNet: 0, totalRawNet: 0 };
  }

  // Clube: FAIL-CLOSED. Se qualquer item do snapshot tiver clubBenefitUsage ou solicitação de benefício de clube,
  // não inferir heuristicamente. Retorna totalRawNet = 0 (unallocatable).
  for (const item of historicalItems) {
    if (item.clubBenefitUsage) {
      return { serviceRawNet: 0, productRawNet: 0, totalRawNet: 0 };
    }
    if (item.clubBenefitRequested) {
      return { serviceRawNet: 0, productRawNet: 0, totalRawNet: 0 };
    }
  }

  let serviceRawNet = 0;
  let productRawNet = 0;

  for (const item of historicalItems) {
    const itemCents = toCents(item.total);
    if (item.type === "SERVICE") {
      serviceRawNet += itemCents;
    } else if (item.type === "PRODUCT") {
      productRawNet += itemCents;
    }
  }

  return {
    serviceRawNet,
    productRawNet,
    totalRawNet: serviceRawNet + productRawNet,
  };
}

/**
 * Reconcilia as alocações financeiras de um tenant identificando inconsistências,
 * mappings ausentes, desvios no mix da comanda e somas divergentes.
 */
export async function reconcileTenantFinancialAllocations(
  tx: Prisma.TransactionClient | typeof prisma,
  barbershopId: string
): Promise<TenantReconciliationResult> {
  const entries = await tx.financialEntry.findMany({
    where: { barbershopId },
    include: {
      allocations: {
        include: {
          financialCategory: {
            include: {
              systemMappings: true,
            },
          },
        },
      },
      financialSettlement: {
        include: { title: true },
      },
      financialSettlementReversal: {
        include: { settlement: { include: { title: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const issues: ReconciliationIssue[] = [];
  let eligibleCount = 0;
  let fullyAllocatedCount = 0;
  let unallocatableCount = 0;

  for (const entry of entries) {
    const entryCents = toCents(entry.amount);

    if (isUnallocatableByPolicy(entry)) {
      unallocatableCount++;
      continue;
    }

    eligibleCount++;
    const allocations = entry.allocations || [];

    // 1. Cross-tenant check
    for (const alloc of allocations) {
      if (alloc.barbershopId !== barbershopId || alloc.financialCategory.barbershopId !== barbershopId) {
        issues.push({
          financialEntryId: entry.id,
          barbershopId,
          type: entry.type,
          amountCents: entryCents,
          issueCode: "CROSS_TENANT_ALLOCATION",
          description: `Allocation ${alloc.id} ou categoria associada pertence a outro tenant.`,
        });
      }
      if (!alloc.financialCategory.isActive) {
        issues.push({
          financialEntryId: entry.id,
          barbershopId,
          type: entry.type,
          amountCents: entryCents,
          issueCode: "INVALID_OR_INACTIVE_CATEGORY",
          description: `Categoria ${alloc.financialCategoryId} está inativa.`,
        });
      }
    }

    // 2. Duplicidade lógica
    const seenCatIds = new Set<string>();
    for (const alloc of allocations) {
      if (seenCatIds.has(alloc.financialCategoryId)) {
        issues.push({
          financialEntryId: entry.id,
          barbershopId,
          type: entry.type,
          amountCents: entryCents,
          issueCode: "LOGICAL_DUPLICATE_ALLOCATION",
          description: `Duplicidade de categoria ${alloc.financialCategoryId} no mesmo lançamento.`,
        });
      }
      seenCatIds.add(alloc.financialCategoryId);
    }

    // 3. Verificação de COMMAND_REVENUE mix & elegibilidade
    let commandRevenueMix: ComandaEconomicMix | null = null;
    if (entry.type === "COMMAND_REVENUE") {
      if (!entry.comandaId) {
        // Alinhado com o backfill: sem comandaId é inalocável por política
        unallocatableCount++;
        eligibleCount--;
        continue;
      }

      commandRevenueMix = await resolveHistoricalComandaEconomicMix(
        tx,
        barbershopId,
        entry.comandaId,
        entry.entryDate
      );
      if (commandRevenueMix.totalRawNet <= 0) {
        // Alinhado com o backfill: comanda sem receita econômica ativa/reconstruível é inalocável por política
        unallocatableCount++;
        eligibleCount--;
        continue;
      }
    }

    // 4. Ausência ou soma parcial
    if (allocations.length === 0) {
      issues.push({
        financialEntryId: entry.id,
        barbershopId,
        type: entry.type,
        amountCents: entryCents,
        issueCode: "ELIGIBLE_NO_ALLOCATIONS",
        description: `Lançamento elegível do tipo ${entry.type} não possui nenhuma allocation.`,
      });
      continue;
    }

    const sumAllocatedCents = allocations.reduce(
      (sum, a) => sum + toCents(a.allocatedAmount),
      0
    );

    if (sumAllocatedCents !== entryCents) {
      issues.push({
        financialEntryId: entry.id,
        barbershopId,
        type: entry.type,
        amountCents: entryCents,
        issueCode: "SUM_MISMATCH",
        description: `Soma das allocations (${sumAllocatedCents} centavos) difere do valor da entry (${entryCents} centavos).`,
      });
      continue;
    }

    // 5. Verificação de COMMAND_REVENUE mix drift
    if (entry.type === "COMMAND_REVENUE" && commandRevenueMix) {
      const mix = commandRevenueMix;
      let expectedServiceCents = 0;
      let expectedProductCents = 0;

      if (mix.productRawNet === 0) {
        expectedServiceCents = entryCents;
      } else if (mix.serviceRawNet === 0) {
        expectedProductCents = entryCents;
      } else {
        const sign = entryCents < 0 ? -1 : 1;
        const absEntryCents = Math.abs(entryCents);
        let absServiceCents = Math.round((absEntryCents * mix.serviceRawNet) / mix.totalRawNet);
        if (absEntryCents >= 2) {
          absServiceCents = Math.max(1, Math.min(absEntryCents - 1, absServiceCents));
        }
        expectedServiceCents = absServiceCents * sign;
        expectedProductCents = entryCents - expectedServiceCents;
      }

      const serviceAlloc = allocations.find((a) => a.financialCategory.systemMappings?.some((m) => m.systemKey === FINANCIAL_SYSTEM_KEYS.COMANDA_SERVICE_REVENUE));
      const productAlloc = allocations.find((a) => a.financialCategory.systemMappings?.some((m) => m.systemKey === FINANCIAL_SYSTEM_KEYS.COMANDA_PRODUCT_REVENUE));

      const actualServiceCents = serviceAlloc ? toCents(serviceAlloc.allocatedAmount) : 0;
      const actualProductCents = productAlloc ? toCents(productAlloc.allocatedAmount) : 0;

      if (expectedServiceCents !== actualServiceCents || expectedProductCents !== actualProductCents) {
        issues.push({
          financialEntryId: entry.id,
          barbershopId,
          type: entry.type,
          amountCents: entryCents,
          issueCode: "COMMAND_REVENUE_DRIFT",
          description: `Alocação da comanda diverge do mix atual faturado (Esperado: S=${expectedServiceCents}, P=${expectedProductCents}; Atual: S=${actualServiceCents}, P=${actualProductCents}).`,
        });
        continue;
      }
    }

    fullyAllocatedCount++;
  }

  return {
    barbershopId,
    totalEntries: entries.length,
    eligibleEntries: eligibleCount,
    fullyAllocatedEntries: fullyAllocatedCount,
    unallocatableByPolicyEntries: unallocatableCount,
    issues,
  };
}

/**
 * Executa o backfill de um tenant isolado.
 * Se dryRun = true, nenhuma alteração é persistida no banco.
 */
export async function backfillTenantFinancialAllocations(
  barbershopId: string,
  options: { dryRun?: boolean } = {}
): Promise<TenantBackfillResult> {
  const dryRun = options.dryRun ?? true;

  const result: TenantBackfillResult = {
    barbershopId,
    eligibleEntries: 0,
    alreadyFullyAllocated: 0,
    needsAllocation: 0,
    unallocatableByPolicy: 0,
    missingMapping: 0,
    sumMismatch: 0,
    crossTenantIssues: 0,
    createdAllocationsCount: 0,
    updatedAllocationsCount: 0,
    errors: [],
  };

  const executeInScope = async (tx: Prisma.TransactionClient) => {
    const entries = await tx.financialEntry.findMany({
      where: { barbershopId },
      include: {
        allocations: {
          include: { financialCategory: true },
        },
        financialSettlement: {
          include: { title: true },
        },
        financialSettlementReversal: {
          include: { settlement: { include: { title: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    for (const entry of entries) {
      const entryCents = toCents(entry.amount);

      if (isUnallocatableByPolicy(entry)) {
        result.unallocatableByPolicy++;
        continue;
      }

      result.eligibleEntries++;
      const currentAllocations = entry.allocations || [];
      const sumAllocatedCents = currentAllocations.reduce(
        (sum, a) => sum + toCents(a.allocatedAmount),
        0
      );

      // Check cross-tenant issues
      const hasCrossTenant = currentAllocations.some(
        (a) => a.barbershopId !== barbershopId || a.financialCategory.barbershopId !== barbershopId
      );
      if (hasCrossTenant) {
        result.crossTenantIssues++;
        result.errors.push(`Entry ${entry.id} possui allocation com tenant divergente.`);
        continue;
      }

      const isFullyAllocated = currentAllocations.length > 0 && sumAllocatedCents === entryCents;

      // Handle COMMAND_REVENUE
      if (entry.type === "COMMAND_REVENUE") {
        if (!entry.comandaId) {
          result.unallocatableByPolicy++;
          result.eligibleEntries--;
          continue;
        }

        const mix = await resolveHistoricalComandaEconomicMix(
          tx,
          barbershopId,
          entry.comandaId,
          entry.entryDate
        );
        if (mix.totalRawNet <= 0) {
          result.unallocatableByPolicy++;
          result.eligibleEntries--;
          continue;
        }

        // Verifica se precisa de backfill ou resync
        let needsSync = !isFullyAllocated;
        if (isFullyAllocated) {
          const serviceCat = mix.serviceRawNet > 0
            ? await resolveSystemCategory(tx, barbershopId, FINANCIAL_SYSTEM_KEYS.COMANDA_SERVICE_REVENUE).catch(() => null)
            : null;
          const productCat = mix.productRawNet > 0
            ? await resolveSystemCategory(tx, barbershopId, FINANCIAL_SYSTEM_KEYS.COMANDA_PRODUCT_REVENUE).catch(() => null)
            : null;

          if ((mix.serviceRawNet > 0 && !serviceCat) || (mix.productRawNet > 0 && !productCat)) {
            result.missingMapping++;
            continue;
          }

          let expectedServiceCents = 0;
          let expectedProductCents = 0;
          if (mix.productRawNet === 0) {
            expectedServiceCents = entryCents;
          } else if (mix.serviceRawNet === 0) {
            expectedProductCents = entryCents;
          } else {
            const sign = entryCents < 0 ? -1 : 1;
            const absEntryCents = Math.abs(entryCents);
            let absServiceCents = Math.round((absEntryCents * mix.serviceRawNet) / mix.totalRawNet);
            if (absEntryCents >= 2) {
              absServiceCents = Math.max(1, Math.min(absEntryCents - 1, absServiceCents));
            }
            expectedServiceCents = absServiceCents * sign;
            expectedProductCents = entryCents - expectedServiceCents;
          }

          const currS = serviceCat ? currentAllocations.find((a) => a.financialCategoryId === serviceCat.id) : null;
          const currP = productCat ? currentAllocations.find((a) => a.financialCategoryId === productCat.id) : null;

          const actualSCents = currS ? toCents(currS.allocatedAmount) : 0;
          const actualPCents = currP ? toCents(currP.allocatedAmount) : 0;

          if (actualSCents !== expectedServiceCents || actualPCents !== expectedProductCents) {
            needsSync = true;
          }
        }

        if (!needsSync) {
          result.alreadyFullyAllocated++;
          continue;
        }

        result.needsAllocation++;

        if (!dryRun) {
          try {
            await syncComandaRevenueAllocations(tx, barbershopId, entry.comandaId, mix);
            const afterVal = await validateFinancialEntryAllocationSum(tx, barbershopId, entry.id);
            if (afterVal.isValid) {
              if (currentAllocations.length === 0) {
                result.createdAllocationsCount += (mix.serviceRawNet > 0 ? 1 : 0) + (mix.productRawNet > 0 ? 1 : 0);
              } else {
                result.updatedAllocationsCount++;
              }
            }
          } catch (err: unknown) {
            if (err instanceof FinancialAllocationError && err.code === "FINANCIAL_SYSTEM_MAPPING_NOT_FOUND") {
              result.missingMapping++;
            } else {
              const msg = err instanceof Error ? err.message : String(err);
              result.errors.push(`Falha ao sincronizar comanda ${entry.comandaId}: ${msg}`);
            }
          }
        }
        continue;
      }

      // Handle simple single-source allocations
      if (isFullyAllocated) {
        result.alreadyFullyAllocated++;
        continue;
      }

      result.needsAllocation++;

      let targetCategoryId: string | null = null;
      let targetSystemKey: string | null = null;

      if (entry.financialSettlementId && entry.financialSettlement) {
        targetCategoryId = entry.financialSettlement.title.categoryId;
      } else if (entry.financialSettlementReversalId && entry.financialSettlementReversal) {
        targetCategoryId = entry.financialSettlementReversal.settlement.title.categoryId;
      } else if (entry.clubSubscriptionPaymentId) {
        targetSystemKey = FINANCIAL_SYSTEM_KEYS.CLUB_REVENUE;
      } else if (entry.commissionPayoutId) {
        targetSystemKey = FINANCIAL_SYSTEM_KEYS.COMMISSION_PAYOUT;
      } else if (entry.commissionAdvanceId) {
        targetSystemKey = FINANCIAL_SYSTEM_KEYS.COMMISSION_ADVANCE;
      } else if (entry.commissionAdvanceReversalId) {
        targetSystemKey = FINANCIAL_SYSTEM_KEYS.COMMISSION_ADVANCE_REVERSAL;
      } else if (entry.type === "REFUND") {
        targetSystemKey = FINANCIAL_SYSTEM_KEYS.REFUND;
      }

      if (!targetCategoryId && !targetSystemKey) {
        result.unallocatableByPolicy++;
        result.eligibleEntries--;
        result.needsAllocation--;
        continue;
      }

      if (!dryRun) {
        try {
          await createSingleEntryAllocation(tx, {
            barbershopId,
            financialEntryId: entry.id,
            categoryId: targetCategoryId || undefined,
            systemKey: targetSystemKey || undefined,
            amountCents: entryCents,
          });
          result.createdAllocationsCount++;
        } catch (err: unknown) {
          if (err instanceof FinancialAllocationError && err.code === "FINANCIAL_SYSTEM_MAPPING_NOT_FOUND") {
            result.missingMapping++;
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`Falha ao alocar entry ${entry.id}: ${msg}`);
          }
        }
      }
    }
  };

  if (dryRun) {
    // Read-only inside transaction
    await prisma.$transaction(async (tx) => {
      await executeInScope(tx);
    });
  } else {
    await prisma.$transaction(async (tx) => {
      await executeInScope(tx);
    });
  }

  return result;
}

/**
 * Executa o backfill de todos os tenants ou de um tenant específico.
 */
export async function runFinancialBackfill(options: {
  tenantId?: string;
  dryRun?: boolean;
} = {}): Promise<OverallBackfillResult> {
  const dryRun = options.dryRun ?? true;

  const barbershops = await prisma.barbershop.findMany({
    where: options.tenantId ? { id: options.tenantId } : undefined,
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  const overall: OverallBackfillResult = {
    dryRun,
    tenants: [],
    totals: {
      eligibleEntries: 0,
      alreadyFullyAllocated: 0,
      needsAllocation: 0,
      unallocatableByPolicy: 0,
      missingMapping: 0,
      sumMismatch: 0,
      crossTenantIssues: 0,
      createdAllocationsCount: 0,
      updatedAllocationsCount: 0,
    },
  };

  for (const shop of barbershops) {
    const tenantResult = await backfillTenantFinancialAllocations(shop.id, { dryRun });
    overall.tenants.push(tenantResult);

    overall.totals.eligibleEntries += tenantResult.eligibleEntries;
    overall.totals.alreadyFullyAllocated += tenantResult.alreadyFullyAllocated;
    overall.totals.needsAllocation += tenantResult.needsAllocation;
    overall.totals.unallocatableByPolicy += tenantResult.unallocatableByPolicy;
    overall.totals.missingMapping += tenantResult.missingMapping;
    overall.totals.sumMismatch += tenantResult.sumMismatch;
    overall.totals.crossTenantIssues += tenantResult.crossTenantIssues;
    overall.totals.createdAllocationsCount += tenantResult.createdAllocationsCount;
    overall.totals.updatedAllocationsCount += tenantResult.updatedAllocationsCount;
  }

  return overall;
}
