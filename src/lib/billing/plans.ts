/**
 * Catalogo interno de planos do Tem Barber para cobranca via Asaas.
 * Centraliza codigos, nomes e valores; nunca espalhar precos em rotas/UI.
 */

export interface BillingPlan {
  code: string;
  name: string;
  value: number;
  cycle: "MONTHLY";
  description: string;
  features: string[];
  active: boolean;
}

export const BILLING_PLANS_CATALOG = [
  {
    code: "pro_monthly",
    name: "Plano Tem Barber",
    value: 49.9,
    cycle: "MONTHLY",
    description: "Plano completo de gestao para sua barbearia.",
    features: [
      "Agenda online",
      "Fila online",
      "Comandas",
      "Gestao de clientes",
      "Produtos e estoque",
      "Caixa e financeiro",
      "Comissoes",
      "Clube de assinaturas",
      "Relatorios",
    ],
    active: true,
  },
] as const;

export type BillingPlanCode = (typeof BILLING_PLANS_CATALOG)[number]["code"];

export const ACTIVE_BILLING_PLAN_CODE: BillingPlanCode = "pro_monthly";

export const BILLING_PLANS: BillingPlan[] = BILLING_PLANS_CATALOG.map((p) => ({
  ...p,
  features: [...p.features],
}));

/**
 * Busca um plano ativo pelo codigo.
 */
export function getBillingPlanByCode(code: string): BillingPlan | null {
  return BILLING_PLANS.find((p) => p.code === code && p.active) ?? null;
}

/**
 * Lista todos os planos ativos.
 */
export function getActiveBillingPlans(): BillingPlan[] {
  return BILLING_PLANS.filter((p) => p.active);
}

export function getActiveBillingPlan(): BillingPlan {
  const plan = getBillingPlanByCode(ACTIVE_BILLING_PLAN_CODE);
  if (!plan) {
    throw new Error("Plano ativo de faturamento nao configurado.");
  }
  return plan;
}

/**
 * Tipos de cobranca permitidos no MVP.
 */
export const ALLOWED_BILLING_TYPES = ["PIX", "BOLETO"] as const;
export type AllowedBillingType = (typeof ALLOWED_BILLING_TYPES)[number];

export function isAllowedBillingType(value: string): value is AllowedBillingType {
  return (ALLOWED_BILLING_TYPES as readonly string[]).includes(value);
}
