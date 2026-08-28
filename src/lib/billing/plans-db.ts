import type { PrismaClient } from "@prisma/client";
import type { BillingPlan } from "@/lib/billing/plans";

export type PrismaOrTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type PlanResolutionErrorCode =
  | "PLAN_CODE_NOT_FOUND"
  | "PLAN_CODE_INACTIVE"
  | "PLAN_CATALOG_DB_MISMATCH";

export class PlanResolutionError extends Error {
  constructor(
    public code: PlanResolutionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PlanResolutionError";
  }
}

/**
 * Resolve um plano no banco de dados exclusivamente pelo seu código único.
 * NÃO filtra por `isActive`. Adequado para auditoria e histórico de identidade.
 */
export async function getPlanByCode(
  db: PrismaOrTransactionClient,
  code: string
) {
  if (!code || typeof code !== "string") {
    return null;
  }
  return await db.plan.findFirst({
    where: { code },
  });
}

/**
 * Resolve um plano ATIVO no banco de dados pelo seu código único.
 * Diferencia explicitamente NOT_FOUND de INACTIVE.
 */
export async function getActivePlanByCode(
  db: PrismaOrTransactionClient,
  code: string
) {
  const plan = await getPlanByCode(db, code);
  if (!plan) {
    throw new PlanResolutionError(
      "PLAN_CODE_NOT_FOUND",
      `Plano com código "${code}" não foi encontrado no banco de dados.`
    );
  }
  if (!plan.isActive) {
    throw new PlanResolutionError(
      "PLAN_CODE_INACTIVE",
      `Plano com código "${code}" está inativo no banco de dados.`
    );
  }
  return plan;
}

/**
 * Valida a consistência comercial entre o plano no banco e o catálogo em código.
 * - Identidade (`code`): obrigatório coincidir.
 * - Preço (`value`/`price`): lança `PLAN_CATALOG_DB_MISMATCH` se divergente.
 * - Ciclo (`cycle`/`period`): lança `PLAN_CATALOG_DB_MISMATCH` se divergente.
 * - Nome (`name`): gera warning em log em caso de divergência de display, mas NÃO falha a operação.
 */
export function assertCommercialConsistency(
  catalogPlan: BillingPlan,
  dbPlan: { name: string; price: number | { toNumber(): number }; period: string }
): void {
  const dbPrice = typeof dbPlan.price === "number" ? dbPlan.price : Number(dbPlan.price);
  if (Math.abs(dbPrice - catalogPlan.value) > 0.001) {
    throw new PlanResolutionError(
      "PLAN_CATALOG_DB_MISMATCH",
      `Preço do plano no banco (R$ ${dbPrice}) difere do valor no catálogo (R$ ${catalogPlan.value}).`
    );
  }

  if (dbPlan.period !== catalogPlan.cycle) {
    throw new PlanResolutionError(
      "PLAN_CATALOG_DB_MISMATCH",
      `Ciclo do plano no banco (${dbPlan.period}) difere do ciclo no catálogo (${catalogPlan.cycle}).`
    );
  }

  if (dbPlan.name !== catalogPlan.name) {
    console.warn(
      `[plans-db] AVISO: Nome do plano no banco ("${dbPlan.name}") difere do catálogo ("${catalogPlan.name}"). Resolução mantida por código.`
    );
  }
}
