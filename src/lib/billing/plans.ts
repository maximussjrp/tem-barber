/**
 * Catálogo interno de planos do Tem Barber para cobrança via Asaas.
 * Centraliza códigos, nomes e valores — nunca espalhar preços em rotas/UI.
 */

export interface BillingPlan {
  code: string;
  name: string;
  value: number; // em BRL, ex: 149.90
  cycle: "MONTHLY";
  description: string;
  features: string[];
  active: boolean;
}

export const BILLING_PLANS: BillingPlan[] = [
  {
    code: "pro_monthly",
    name: "Plano Pro",
    value: 149.9,
    cycle: "MONTHLY",
    description: "Plano completo para barbearias com até 5 profissionais.",
    features: [
      "Até 5 profissionais",
      "Agenda online",
      "Fila online",
      "Comandas",
      "Comissões",
      "Financeiro",
    ],
    active: true,
  },
  {
    code: "premium_monthly",
    name: "Plano Premium",
    value: 249.9,
    cycle: "MONTHLY",
    description: "Plano avançado para barbearias com profissionais ilimitados.",
    features: [
      "Profissionais ilimitados",
      "Agenda online",
      "Fila online",
      "Comandas",
      "Comissões",
      "Financeiro",
      "Clube de assinaturas",
      "Relatórios avançados",
    ],
    active: true,
  },
];

/**
 * Busca um plano ativo pelo código.
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

/**
 * Tipos de cobrança permitidos no MVP.
 */
export const ALLOWED_BILLING_TYPES = ["PIX", "BOLETO"] as const;
export type AllowedBillingType = (typeof ALLOWED_BILLING_TYPES)[number];

export function isAllowedBillingType(value: string): value is AllowedBillingType {
  return (ALLOWED_BILLING_TYPES as readonly string[]).includes(value);
}
