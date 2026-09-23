import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PlatformBillingManager from "@/components/billing/PlatformBillingManager";
import SubscriptionPaymentPanel from "@/components/billing/SubscriptionPaymentPanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const mockProfile = {
  personType: "INDIVIDUAL",
  legalName: "Barbearia Suspensa Teste",
  cpfCnpjMasked: "***.***.***-99",
  billingEmail: "financeiro@suspensa.com",
  billingPhone: "11999999999",
  completed: true,
  documentConfigured: true,
  canEditProfile: true,
};

const mockStatus = {
  integrationConfigured: true,
  environment: "sandbox",
  profileCompleted: true,
  documentConfigured: true,
  customerConfigured: true,
  hasSubscription: true,
  hasCurrentSubscription: true,
  subscription: {
    status: "OVERDUE",
    planCode: "pro_monthly",
    planName: "Plano Tem Barber",
    value: "49.90",
    cycle: "MONTHLY",
    billingType: "PIX",
  },
  accessStatus: "SUSPENDED",
  accessBadge: { label: "SUSPENSO", color: "bg-red-950/60 text-red-300 border-red-500/40" },
  paymentBadge: { label: "ATRASADO", color: "bg-red-950/60 text-red-300 border-red-500/40" },
  permissions: {
    canEditProfile: true,
    canSubscribe: false,
  },
};

describe("Billing Recovery UI Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/billing/profile")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockProfile),
        });
      }
      if (url.includes("/api/admin/billing/asaas/status")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockStatus),
        });
      }
      if (url.includes("/api/admin/billing/asaas/current-payment/pix")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              encodedImage: "iVBORw0KGgoAAAANSUhEUgAA...",
              payload: "00020126580014BR.GOV.BCB.PIX...",
              expirationDate: "2026-08-01 23:59:59",
            }),
        });
      }
      if (url.includes("/api/admin/billing/asaas/current-payment")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              exists: true,
              status: "OVERDUE",
              billingType: "PIX",
              value: "49.90",
              dueDate: "2026-07-20",
              canPay: true,
            }),
        });
      }
      return Promise.reject(new Error(`Unhandled fetch mock: ${url}`));
    });
  });

  it("PlatformBillingManager renderiza banner de suspensao e caminhos customizados", async () => {
    render(
      <PlatformBillingManager
        paymentPath="/assinatura-suspensa/pagamento"
        backPath="/assinatura-suspensa"
        isSuspendedArea={true}
      />
    );

    // Banner de suspensão deve estar presente
    expect(await screen.findByText("Acesso operacional suspenso")).toBeInTheDocument();
    expect(
      screen.getByText(/O acesso aos módulos operacionais \(agenda, clientes, comandas, financeiro\) está suspenso/i)
    ).toBeInTheDocument();

    // Botão voltar aponta para /assinatura-suspensa
    const backLink = screen.getByRole("link", { name: /← Voltar/i });
    expect(backLink).toHaveAttribute("href", "/assinatura-suspensa");

    // Link Ver cobrança aponta para /assinatura-suspensa/pagamento
    const paymentLink = await screen.findByRole("link", { name: /Ver cobrança/i });
    expect(paymentLink).toHaveAttribute("href", "/assinatura-suspensa/pagamento");
  });

  it("SubscriptionPaymentPanel renderiza link de retorno customizado e informacoes de cobranca", async () => {
    render(<SubscriptionPaymentPanel backPath="/assinatura-suspensa" />);

    // Link de voltar aponta para o backPath configurado
    const backLink = await screen.findByRole("link", { name: /Voltar para Plano e cobrança/i });
    expect(backLink).toHaveAttribute("href", "/assinatura-suspensa");

    // QR Code / PIX deve estar presente
    const pixLabels = await screen.findAllByText(/Pix Copia e Cola/i);
    expect(pixLabels.length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("00020126580014BR.GOV.BCB.PIX...")).toBeInTheDocument();
  });

  it("Exibe badge de ACESSO CORTESIA e secao de cobranca vencida simultaneamente (TENANT_COMPLIMENTARY_OVERDUE_UI_TEST)", async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/billing/profile")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockProfile),
        });
      }
      if (url.includes("/api/admin/billing/asaas/status")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ...mockStatus,
              accessStatus: "COMPLIMENTARY",
              accessAllowed: true,
              accessType: "COMPLIMENTARY",
              remainingLabel: "30 dias de cortesia",
              billingStatus: "OVERDUE",
              billingLabel: "Vencido",
              formattedBillingDueDate: "20/07/2026",
              recentPayments: [
                {
                  status: "OVERDUE",
                  billingType: "PIX",
                  value: "49.90",
                  dueDate: "2026-07-20",
                  paymentDate: null,
                  invoiceUrl: null,
                  bankSlipUrl: null,
                  isCurrentPayment: true,
                },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<PlatformBillingManager paymentPath="/admin/plano-cobranca/pagamento" />);

    expect(await screen.findByText("ACESSO CORTESIA")).toBeInTheDocument();
    expect(screen.getAllByText("Vencido").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Vencimento: 20\/07\/2026/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Ver cobrança/i }).length).toBeGreaterThanOrEqual(1);
  });

  it("Em area suspensa com cortesia ativa exibe Acesso liberado e nao bloqueia (SUSPENDED_AREA_ACTIVE_COURTESY_UI_TEST)", async () => {
    globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/billing/profile")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockProfile),
        });
      }
      if (url.includes("/api/admin/billing/asaas/status")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ...mockStatus,
              accessStatus: "COMPLIMENTARY",
              accessAllowed: true,
              accessType: "COMPLIMENTARY",
              billingStatus: "OVERDUE",
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(
      <PlatformBillingManager
        paymentPath="/assinatura-suspensa/pagamento"
        backPath="/assinatura-suspensa"
        isSuspendedArea={true}
      />
    );

    expect(await screen.findByText("Acesso liberado")).toBeInTheDocument();
    expect(screen.getByText(/Sua barbearia possui acesso cortesia ativo/i)).toBeInTheDocument();
    expect(screen.queryByText("Acesso operacional suspenso")).not.toBeInTheDocument();
  });
});
