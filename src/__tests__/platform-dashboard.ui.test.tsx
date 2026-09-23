import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("4. Exibe o badge de Cortesia para barbearia com effectiveStatus COMPLIMENTARY (PLATFORM_COURTESY_BADGE_TEST)", () => {
    const shopsWithCourtesy: BarbershopItem[] = [
      ...initialBarbershops,
      {
        id: "shop-3",
        name: "Barbearia Gama Cortesia",
        slug: "barbearia-gama",
        createdAt: "2026-07-25T00:00:00.000Z",
        subscription: {
          id: "sub-3",
          status: "SUSPENDED",
          planId: "plan-1",
          planName: "Plano Tem Barber",
          monthlyPrice: 49.90,
          trialEndsAt: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          gracePeriodEndsAt: null,
          paymentMethod: null,
          lastPaymentAt: null,
          internalNotes: null,
          updatedBy: null,
          updatedAt: "2026-07-25T00:00:00.000Z",
        },
        subscriptionCount: 1,
        members: [{ role: "OWNER", user: { name: "Gama Owner", email: "gama@gama.com" } }],
        access: {
          rawStatus: "SUSPENDED",
          effectiveStatus: "COMPLIMENTARY",
          accessAllowed: true,
          accessType: "COMPLIMENTARY",
          validUntil: "2026-08-30T00:00:00.000Z",
          remainingDays: 15,
          remainingLabel: "Restam 15 dias de cortesia",
          isTrial: false,
          isPaid: false,
          isGracePeriod: false,
          isExpired: false,
          synchronizationWarnings: [],
        },
        billing: {
          billingStatus: "OVERDUE",
          billingDueDate: "2026-07-20T00:00:00.000Z",
          billingPaymentDate: null,
          billingValue: 49.90,
          canPay: true,
          billingLabel: "Atrasado",
          warnings: [],
        },
        isMrrConfirmed: false,
        confirmedRevenue: 0,
        synchronizationWarnings: [],
        formattedValidUntil: "30/08/2026",
        formattedLastPaymentAt: null,
      },
    ];

    render(<PlatformDashboard initialBarbershops={shopsWithCourtesy} plans={plans} />);
    const cortesiaBadges = screen.getAllByText("Cortesia");
    expect(cortesiaBadges.some((el) => el.tagName.toLowerCase() === "span")).toBe(true);
  });

  it("5. Exibe o formulário de concessão de cortesia no modal com campos dias, motivo e botão Conceder cortesia (PLATFORM_COURTESY_FORM_TEST)", () => {
    render(<PlatformDashboard initialBarbershops={initialBarbershops} plans={plans} />);
    const editarBtns = screen.getAllByRole("button", { name: /Editar/i });
    fireEvent.click(editarBtns[0]);

    expect(screen.getByText("Acesso Cortesia (SUPER_ADMIN)")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Ex: Cortesia comercial/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Conceder cortesia/i })).toBeInTheDocument();
  });

  it("6. Renderiza o histórico de grants com status ATIVA, AGENDADA, EXPIRADA e REVOGADA (PLATFORM_COURTESY_HISTORY_TEST)", () => {
    const now = Date.now();
    const shopsWithHistory: BarbershopItem[] = [
      {
        ...initialBarbershops[0],
        accessGrants: [
          {
            id: "grant-active",
            barbershopId: initialBarbershops[0].id,
            startsAt: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
            endsAt: new Date(now + 1000 * 60 * 60 * 24 * 7).toISOString(),
            daysGranted: 8,
            reason: "Cortesia Ativa de Teste",
            idempotencyKey: "k-active",
            requestHash: "h-active",
            createdByUserId: "admin-1",
            createdByEmail: "admin@platform.com",
            revokedAt: null,
            revokedByUserId: null,
            revokedByEmail: null,
            revocationReason: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "grant-scheduled",
            barbershopId: initialBarbershops[0].id,
            startsAt: new Date(now + 1000 * 60 * 60 * 24 * 10).toISOString(),
            endsAt: new Date(now + 1000 * 60 * 60 * 24 * 20).toISOString(),
            daysGranted: 10,
            reason: "Cortesia Agendada",
            idempotencyKey: "k-sched",
            requestHash: "h-sched",
            createdByUserId: "admin-1",
            createdByEmail: "admin@platform.com",
            revokedAt: null,
            revokedByUserId: null,
            revokedByEmail: null,
            revocationReason: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "grant-expired",
            barbershopId: initialBarbershops[0].id,
            startsAt: new Date(now - 1000 * 60 * 60 * 24 * 30).toISOString(),
            endsAt: new Date(now - 1000 * 60 * 60 * 24 * 10).toISOString(),
            daysGranted: 20,
            reason: "Cortesia Antiga Expirada",
            idempotencyKey: "k-exp",
            requestHash: "h-exp",
            createdByUserId: "admin-1",
            createdByEmail: "admin@platform.com",
            revokedAt: null,
            revokedByUserId: null,
            revokedByEmail: null,
            revocationReason: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "grant-revoked",
            barbershopId: initialBarbershops[0].id,
            startsAt: new Date(now - 1000 * 60 * 60 * 24 * 5).toISOString(),
            endsAt: new Date(now + 1000 * 60 * 60 * 24 * 5).toISOString(),
            daysGranted: 10,
            reason: "Cortesia Cancelada",
            idempotencyKey: "k-rev",
            requestHash: "h-rev",
            createdByUserId: "admin-1",
            createdByEmail: "admin@platform.com",
            revokedAt: new Date().toISOString(),
            revokedByUserId: "admin-1",
            revokedByEmail: "admin@platform.com",
            revocationReason: "Cancelamento comercial",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    ];

    render(<PlatformDashboard initialBarbershops={shopsWithHistory} plans={plans} />);
    const editarBtns = screen.getAllByRole("button", { name: /Editar/i });
    fireEvent.click(editarBtns[0]);

    expect(screen.getByText(/Histórico de Cortesias \(4\)/i)).toBeInTheDocument();
    expect(screen.getByText("Cortesia Ativa de Teste")).toBeInTheDocument();
    expect(screen.getByText("Cortesia Agendada")).toBeInTheDocument();
    expect(screen.getByText("Cortesia Antiga Expirada")).toBeInTheDocument();
    expect(screen.getByText("Cortesia Cancelada")).toBeInTheDocument();
    expect(screen.getByText("ATIVA")).toBeInTheDocument();
    expect(screen.getByText("AGENDADA")).toBeInTheDocument();
    expect(screen.getByText("EXPIRADA")).toBeInTheDocument();
    expect(screen.getByText("REVOGADA")).toBeInTheDocument();
  });

  it("7. Permite revogação de cortesia ativa exigindo motivo e chamando o endpoint dedicado (PLATFORM_COURTESY_REVOKE_TEST)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ grant: { id: "grant-active-1" }, alreadyRevoked: false }),
    });
    global.fetch = fetchMock;

    const now = Date.now();
    const shopsWithActiveGrant: BarbershopItem[] = [
      {
        ...initialBarbershops[0],
        accessGrants: [
          {
            id: "grant-active-1",
            barbershopId: initialBarbershops[0].id,
            startsAt: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
            endsAt: new Date(now + 1000 * 60 * 60 * 24 * 7).toISOString(),
            daysGranted: 8,
            reason: "Cortesia Para Revogar",
            idempotencyKey: "k-rev-target",
            requestHash: "h-rev-target",
            createdByUserId: "admin-1",
            createdByEmail: "admin@platform.com",
            revokedAt: null,
            revokedByUserId: null,
            revokedByEmail: null,
            revocationReason: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    ];

    render(<PlatformDashboard initialBarbershops={shopsWithActiveGrant} plans={plans} />);
    const editarBtns = screen.getAllByRole("button", { name: /Editar/i });
    fireEvent.click(editarBtns[0]);

    const revokeBtn = screen.getByRole("button", { name: /Revogar Cortesia/i });
    fireEvent.click(revokeBtn);

    const reasonInput = screen.getByPlaceholderText(/Informe por que está revogando.../i);
    expect(reasonInput).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: /Confirmar Revogação/i });
    expect(confirmBtn).toBeInTheDocument();

    fireEvent.change(reasonInput, { target: { value: "Fim do período acordado" } });
    fireEvent.click(confirmBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/platform-access-grants/grant-active-1/revoke",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "Fim do período acordado" }),
      })
    );
  });

  it("8. MRR Confirmado não inclui barbearia com acesso cortesia e pagamento atrasado (COURTESY_MRR_EXCLUSION_TEST)", () => {
    const shopsWithCourtesy: BarbershopItem[] = [
      ...initialBarbershops,
      {
        id: "shop-courtesy-mrr",
        name: "Barbearia Cortesia MRR Check",
        slug: "barbearia-courtesy-mrr",
        createdAt: "2026-07-25T00:00:00.000Z",
        subscription: {
          id: "sub-courtesy-mrr",
          status: "SUSPENDED",
          planId: "plan-1",
          planName: "Plano Tem Barber",
          monthlyPrice: 99.90,
          trialEndsAt: null,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          gracePeriodEndsAt: null,
          paymentMethod: null,
          lastPaymentAt: null,
          internalNotes: null,
          updatedBy: null,
          updatedAt: "2026-07-25T00:00:00.000Z",
        },
        subscriptionCount: 1,
        members: [{ role: "OWNER", user: { name: "Owner Courtesy", email: "courtesy@shop.com" } }],
        access: {
          rawStatus: "SUSPENDED",
          effectiveStatus: "COMPLIMENTARY",
          accessAllowed: true,
          accessType: "COMPLIMENTARY",
          validUntil: "2026-08-30T00:00:00.000Z",
          remainingDays: 15,
          remainingLabel: "Restam 15 dias de cortesia",
          isTrial: false,
          isPaid: false,
          isGracePeriod: false,
          isExpired: false,
          synchronizationWarnings: [],
        },
        billing: {
          billingStatus: "OVERDUE",
          billingDueDate: "2026-07-20T00:00:00.000Z",
          billingPaymentDate: null,
          billingValue: 99.90,
          canPay: true,
          billingLabel: "Atrasado",
          warnings: [],
        },
        isMrrConfirmed: false,
        confirmedRevenue: 0,
        synchronizationWarnings: [],
        formattedValidUntil: "30/08/2026",
        formattedLastPaymentAt: null,
      },
    ];

    render(<PlatformDashboard initialBarbershops={shopsWithCourtesy} plans={plans} />);
    const mrrCard = screen.getByText("MRR Confirmado").closest("div");
    expect(mrrCard).toHaveTextContent(/49,90/);
    expect(mrrCard).not.toHaveTextContent(/99,90/);
    expect(mrrCard).not.toHaveTextContent(/149,80/);
  });
});
