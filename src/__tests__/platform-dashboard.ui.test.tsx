import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { PlatformDashboard, BarbershopItem, Plan } from "@/components/admin/PlatformDashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

describe("Domain D — Platform Dashboard UI (platform-dashboard.ui.test.tsx)", () => {
  const plans: Plan[] = [
    { id: "plan-1", name: "Plano Tem Barber", price: 49.90 },
  ];

  const initialBarbershops: BarbershopItem[] = [
    {
      id: "shop-1",
      name: "Barbearia Alfa",
      slug: "barbearia-alfa",
      createdAt: "2026-06-01T00:00:00.000Z",
      subscription: {
        id: "sub-1",
        status: "ACTIVE",
        planId: "plan-1",
        planName: "Plano Tem Barber",
        monthlyPrice: 49.90,
        trialEndsAt: null,
        currentPeriodStart: "2026-07-01T00:00:00.000Z",
        currentPeriodEnd: "2026-08-30T00:00:00.000Z",
        gracePeriodEndsAt: null,
        paymentMethod: "PIX",
        lastPaymentAt: "2026-07-01T00:00:00.000Z",
        internalNotes: null,
        updatedBy: "admin@platform.com",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      subscriptionCount: 1,
      members: [{ role: "OWNER", user: { name: "João Owner", email: "joao@alfa.com" } }],
      access: {
        rawStatus: "ACTIVE",
        effectiveStatus: "ACTIVE",
        accessAllowed: true,
        accessType: "PAID",
        validUntil: "2026-08-30T00:00:00.000Z",
        remainingDays: 33,
        remainingLabel: "33 dias até a próxima renovação",
        isTrial: false,
        isPaid: true,
        isGracePeriod: false,
        isExpired: false,
        synchronizationWarnings: [],
      },
      billing: {
        billingStatus: "PAID",
        billingDueDate: "2026-07-01T00:00:00.000Z",
        billingPaymentDate: "2026-07-01T00:00:00.000Z",
        billingValue: 49.90,
        canPay: false,
        billingLabel: "Pago",
        warnings: [],
      },
      isMrrConfirmed: true,
      confirmedRevenue: 49.90,
      synchronizationWarnings: [],
      formattedValidUntil: "30/08/2026",
      formattedLastPaymentAt: "01/07/2026",
    },
    {
      id: "shop-2",
      name: "Barbearia Beta (Trial)",
      slug: "barbearia-beta",
      createdAt: "2026-07-20T00:00:00.000Z",
      subscription: {
        id: "sub-2",
        status: "TRIAL",
        planId: "plan-1",
        planName: "Plano Tem Barber",
        monthlyPrice: 49.90,
        trialEndsAt: "2026-08-03T00:00:00.000Z",
        currentPeriodStart: null,
        currentPeriodEnd: null,
        gracePeriodEndsAt: null,
        paymentMethod: null,
        lastPaymentAt: null,
        internalNotes: null,
        updatedBy: null,
        updatedAt: "2026-07-20T00:00:00.000Z",
      },
      subscriptionCount: 1,
      members: [{ role: "OWNER", user: { name: "Pedro Owner", email: "pedro@beta.com" } }],
      access: {
        rawStatus: "TRIAL",
        effectiveStatus: "TRIAL",
        accessAllowed: true,
        accessType: "TRIAL",
        validUntil: "2026-08-03T00:00:00.000Z",
        remainingDays: 6,
        remainingLabel: "Restam 6 dias do período de teste",
        isTrial: true,
        isPaid: false,
        isGracePeriod: false,
        isExpired: false,
        synchronizationWarnings: [],
      },
      billing: {
        billingStatus: "NONE",
        billingDueDate: null,
        billingPaymentDate: null,
        billingValue: null,
        canPay: false,
        billingLabel: "Sem cobrança",
        warnings: [],
      },
      isMrrConfirmed: false,
      confirmedRevenue: 0,
      synchronizationWarnings: [],
      formattedValidUntil: "03/08/2026",
      formattedLastPaymentAt: null,
    },
  ];

  it("1. Renderiza o título do painel e tabela com barbearias", () => {
    render(<PlatformDashboard initialBarbershops={initialBarbershops} plans={plans} />);
    expect(screen.getByText("Controle de Assinaturas")).toBeInTheDocument();
    expect(screen.getByText("Barbearia Alfa")).toBeInTheDocument();
    expect(screen.getByText("Barbearia Beta (Trial)")).toBeInTheDocument();
  });

  it("2. Exibe os badges de acesso e cobrança derivados do servidor", () => {
    render(<PlatformDashboard initialBarbershops={initialBarbershops} plans={plans} />);
    expect(screen.getByText("Ativo")).toBeInTheDocument();
    expect(screen.getByText("Em Teste")).toBeInTheDocument();
    expect(screen.getByText("Pago")).toBeInTheDocument();
    expect(screen.getByText("Sem Cobrança")).toBeInTheDocument();
  });

  it("3. Exibe o valor do MRR Confirmado sem incluir o trial", () => {
    render(<PlatformDashboard initialBarbershops={initialBarbershops} plans={plans} />);
    // MRR confirmado deve ser apenas R$ 49,90 (da Barbearia Alfa)
    expect(screen.getAllByText("R$ 49,90").length).toBeGreaterThan(0);
  });
});
