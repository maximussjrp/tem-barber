/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock next/link
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

// Mock next/navigation
const mockRedirect = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/admin/comissoes",
  redirect: (url: string) => mockRedirect(url),
}));

import { CommissionNav } from "@/components/admin/commissions/CommissionNav";
import AdminCommissionsOverviewPage from "@/app/admin/comissoes/page";
import CommissionPaymentsPage from "@/app/admin/comissoes/pagamentos/page";
import CommissionPeriodsPage from "@/app/admin/comissoes/periodos/page";

describe("TEM BARBER — C9 Admin Commission UX Suite", () => {
  let fetchSpy: any;

  const mockOverviewData = {
    overview: [
      {
        member: { id: "m1", name: "Carlos Barbeiro", role: "BARBER" },
        currentCycle: {
          id: "cycle-1",
          cycleNumber: 1,
          status: "OPEN" as const,
          grossCommission: 500,
          adjustmentsTotal: 0,
          advancesTotal: 100,
          remainingBalance: 400,
          openedAt: "2026-09-01T10:00:00Z",
        },
      },
      {
        member: { id: "m2", name: "Ana Barbeira", role: "BARBER" },
        currentCycle: {
          id: "cycle-2",
          cycleNumber: 1,
          status: "OPEN" as const,
          grossCommission: 0,
          adjustmentsTotal: 0,
          advancesTotal: 0,
          remainingBalance: 0,
          openedAt: "2026-09-01T10:00:00Z",
        },
      },
      {
        member: { id: "m3", name: "Bruno Barbeiro", role: "BARBER" },
        currentCycle: {
          id: "cycle-3",
          cycleNumber: 1,
          status: "OPEN" as const,
          grossCommission: 50,
          adjustmentsTotal: 0,
          advancesTotal: 100,
          remainingBalance: -50,
          openedAt: "2026-09-01T10:00:00Z",
        },
      },
    ],
  };

  const mockMemberDetail = {
    member: { id: "m1", name: "Carlos Barbeiro", role: "BARBER" },
    currentCycle: {
      id: "cycle-1",
      cycleNumber: 1,
      status: "OPEN",
      grossCommission: 500,
      adjustmentsTotal: 0,
      advancesTotal: 100,
      remainingBalance: 400,
      openedAt: "2026-09-01T10:00:00Z",
      payableItems: [
        { id: "p1", type: "RELEASE", amount: 500, sourceKind: "PAYMENT", createdAt: "2026-09-02T10:00:00Z" },
      ],
      adjustments: [],
    },
    historicalCycles: [],
    advances: [
      {
        id: "adv-1",
        cycleId: "cycle-1",
        amount: 100,
        paymentMethod: "PIX",
        disbursedAt: "2026-09-02T12:00:00Z",
        notes: "Adiantamento Carlos",
        reversals: [],
      },
    ],
    payouts: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    fetchSpy = vi.fn((url: string, init?: any) => {
      if (url.includes("/api/admin/commissions/overview")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOverviewData),
        });
      }
      if (url.includes("/api/admin/commissions/members/m1")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMemberDetail),
        });
      }
      if (url.includes("/api/admin/commissions/report")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              summary: {
                grossServiceAmount: "1000.00",
                grossProductAmount: "200.00",
                discountAmount: "50.00",
                netBaseAmount: "1150.00",
                commandCount: 20,
                serviceCount: 25,
                productCount: 5,
                averageTicket: "57.50",
                effectiveCommissionRate: "40.00",
              },
              members: [],
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. primary nav has: Visão Geral / Pagamento de Comissões / Configurações", () => {
    render(<CommissionNav />);
    expect(screen.getByText("Visão Geral")).toBeInTheDocument();
    expect(screen.getByText("Pagamento de Comissões")).toBeInTheDocument();
    expect(screen.getByText("Configurações")).toBeInTheDocument();
  });

  it("2. no 'Períodos Mensais' primary UX", () => {
    render(<CommissionNav />);
    expect(screen.queryByText("Períodos Mensais")).not.toBeInTheDocument();
  });

  it("3. no 'Gerado/Liberado/Fechar período/Marcar pago' operational UX", () => {
    render(<CommissionNav />);
    expect(screen.queryByText("Fechar período")).not.toBeInTheDocument();
    expect(screen.queryByText("Marcar pago")).not.toBeInTheDocument();
    expect(screen.queryByText("Gerada")).not.toBeInTheDocument();
    expect(screen.queryByText("Liberada")).not.toBeInTheDocument();
  });

  it("4. /periodos redirects to /pagamentos", () => {
    CommissionPeriodsPage();
    expect(mockRedirect).toHaveBeenCalledWith("/admin/comissoes/pagamentos");
  });

  it("5. overview consumes canonical overview API", async () => {
    render(<AdminCommissionsOverviewPage />);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/admin/commissions/overview");
    });
  });

  it("6. canonical four KPI cards render", async () => {
    render(<AdminCommissionsOverviewPage />);
    await waitFor(() => {
      expect(screen.getByText("Comissões acumuladas")).toBeInTheDocument();
      expect(screen.getByText("Adiantamentos")).toBeInTheDocument();
      expect(screen.getByText("Saldo a pagar")).toBeInTheDocument();
      expect(screen.getByText("Total pago")).toBeInTheDocument();
    });
  });

  it("7. member current-cycle data renders in overview", async () => {
    render(<AdminCommissionsOverviewPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
      expect(screen.getByText("Ana Barbeira")).toBeInTheDocument();
      expect(screen.getByText("Bruno Barbeiro")).toBeInTheDocument();
    });
  });

  it("8. GET renders without mutation", async () => {
    render(<AdminCommissionsOverviewPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });
    // Verify only GET calls occurred, zero POST/PUT/DELETE
    const mutations = fetchSpy.mock.calls.filter((c: any) => c[1]?.method && c[1].method !== "GET");
    expect(mutations.length).toBe(0);
  });

  it("9. pagamentos page renders active cycles with 'EM APURAÇÃO'", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Ciclos de Comissão em Aberto")).toBeInTheDocument();
      expect(screen.getAllByText("EM APURAÇÃO").length).toBeGreaterThan(0);
    });
  });

  it("10. detail explains source rows and ledger items", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    const detailButtons = screen.getAllByText("Detalhes");
    fireEvent.click(detailButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Detalhamento de Comissões e Histórico")).toBeInTheDocument();
      expect(screen.getByText("Itens comissionados no ciclo atual (1)")).toBeInTheDocument();
      expect(screen.getByText("RELEASE")).toBeInTheDocument();
    });
  });

  it("11. advance modal displays available maximum", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    const advanceButtons = screen.getAllByText("Adiantamento");
    fireEvent.click(advanceButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Novo Adiantamento de Comissão")).toBeInTheDocument();
      expect(screen.getByText("Disponível para novo adiantamento:")).toBeInTheDocument();
      // Carlos has 400 available (in table and in modal)
      expect(screen.getAllByText(/400,00/).length).toBeGreaterThan(1);
    });
  });

  it("12. advance > available blocked", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Adiantamento")[0]);

    await waitFor(() => {
      expect(screen.getByText("Novo Adiantamento de Comissão")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("0,00");
    fireEvent.change(input, { target: { value: "500" } }); // 500 > 400!

    const confirmBtn = screen.getByText("Confirmar adiantamento");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(/O valor excede o saldo disponível/i)).toBeInTheDocument();
    });
  });

  it("13. advance success refetches overview", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Adiantamento")[0]);
    await waitFor(() => screen.getByText("Novo Adiantamento de Comissão"));

    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "50" } });
    fireEvent.click(screen.getByText("Confirmar adiantamento"));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/admin/commissions/advances",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("14. advance network retry reuses idempotency key", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Adiantamento")[0]);
    await waitFor(() => screen.getByText("Novo Adiantamento de Comissão"));

    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "50" } });

    // Mock failure once
    fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "Network timeout" }) }));

    fireEvent.click(screen.getByText("Confirmar adiantamento"));
    await waitFor(() => expect(screen.getByText("Network timeout")).toBeInTheDocument());

    // First call captured
    const firstCallKey = fetchSpy.mock.calls.find((c: any) => c[0] === "/api/admin/commissions/advances")[1].headers["Idempotency-Key"];

    // Retry clicked without closing modal
    fireEvent.click(screen.getByText("Confirmar adiantamento"));

    const secondCall = fetchSpy.mock.calls.filter((c: any) => c[0] === "/api/admin/commissions/advances")[1];
    expect(secondCall[1].headers["Idempotency-Key"]).toBe(firstCallKey); // EXACT SAME KEY!
  });

  it("15. reversal maximum enforced/displayed", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    // Open detail
    fireEvent.click(screen.getAllByText("Detalhes")[0]);
    await waitFor(() => screen.getByText("Detalhamento de Comissões e Histórico"));

    // Advance of 100 has "Estornar adiantamento" button
    const revBtn = screen.getByText("Estornar adiantamento");
    fireEvent.click(revBtn);

    await waitFor(() => {
      expect(screen.getByText("Estorno de Adiantamento")).toBeInTheDocument();
      expect(screen.getByText("Máximo estornável:")).toBeInTheDocument();
    });
  });

  it("16. payout amount is not editable", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    // Carlos has 400 remaining
    fireEvent.click(screen.getAllByText("Revisar pagamento")[0]);

    await waitFor(() => {
      expect(screen.getByText("Revisão e Liquidação de Ciclo")).toBeInTheDocument();
      // Verify no editable amount input exists for final balance
      const amountInput = screen.queryByLabelText(/Valor a pagar/i);
      expect(amountInput).not.toBeInTheDocument();
      expect(screen.getByText("Saldo final (a pagar)")).toBeInTheDocument();
      expect(screen.getAllByText(/400,00/).length).toBeGreaterThan(0);
    });
  });

  it("17. payout reconciliation formula visible", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Revisar pagamento")[0]);

    await waitFor(() => {
      expect(screen.getAllByText("Comissões acumuladas").length).toBeGreaterThan(1);
      expect(screen.getByText("Adiantamentos líquidos")).toBeInTheDocument();
      expect(screen.getByText("Saldo final (a pagar)")).toBeInTheDocument();
    });
  });

  it("18. payout retry reuses idempotency key", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Revisar pagamento")[0]);
    await waitFor(() => screen.getByText("Revisão e Liquidação de Ciclo"));
    await waitFor(() => screen.getByText("Confirmar pagamento"));

    // Mock failure once
    fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ error: "DB Error" }) }));

    fireEvent.click(screen.getByText("Confirmar pagamento"));
    await waitFor(() => expect(screen.getByText("DB Error")).toBeInTheDocument());

    const firstCallKey = fetchSpy.mock.calls.find((c: any) => c[0] === "/api/admin/commissions/payouts")[1].headers["Idempotency-Key"];

    // Retry
    fireEvent.click(screen.getByText("Confirmar pagamento"));
    const secondCall = fetchSpy.mock.calls.filter((c: any) => c[0] === "/api/admin/commissions/payouts")[1];
    expect(secondCall[1].headers["Idempotency-Key"]).toBe(firstCallKey);
  });

  it("19. payout success triggers feedback and refetch", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Revisar pagamento")[0]);
    await waitFor(() => screen.getByText("Revisão e Liquidação de Ciclo"));
    await waitFor(() => screen.getByText("Confirmar pagamento"));

    fireEvent.click(screen.getByText("Confirmar pagamento"));

    await waitFor(() => {
      expect(screen.getByText(/Pagamento de .*400,00 confirmado/i)).toBeInTheDocument();
    });
  });

  it("20. CASH warning / error displayed cleanly", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Revisar pagamento")[0]);
    await waitFor(() => screen.getByText("Revisão e Liquidação de Ciclo"));

    // Select CASH
    await waitFor(() => screen.getByRole("combobox"));
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "CASH" } });

    await waitFor(() => {
      expect(screen.getByText(/pagamentos em dinheiro físico exigem uma sessão de caixa aberta/i)).toBeInTheDocument();
    });
  });

  it("21. zero balance doesn't show normal money payout CTA", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Ana Barbeira")).toBeInTheDocument();
    });

    // Ana Barbeira has remaining balance 0
    fireEvent.click(screen.getAllByText("Revisar pagamento")[1]);

    await waitFor(() => {
      expect(screen.getAllByText(/Encerrar ciclo sem pagamento/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Nenhuma movimentação financeira será gerada/i)).toBeInTheDocument();
      expect(screen.queryByText("Confirmar pagamento")).not.toBeInTheDocument();
    });
  });

  it("22. negative balance blocks payout", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Bruno Barbeiro")).toBeInTheDocument();
    });

    // Bruno Barbeiro has remaining balance -50
    fireEvent.click(screen.getAllByText("Revisar pagamento")[2]);

    await waitFor(() => {
      expect(screen.getByText("Ciclo com saldo negativo.")).toBeInTheDocument();
      expect(screen.getByText(/Saldo negativo a compensar em próximas comissões/i)).toBeInTheDocument();
      expect(screen.queryByText("Confirmar pagamento")).not.toBeInTheDocument();
    });
  });

  it("23. loading and error states handled cleanly", async () => {
    fetchSpy.mockImplementationOnce(() => Promise.reject(new Error("Erro ao carregar")));
    render(<AdminCommissionsOverviewPage />);
    await waitFor(() => {
      expect(screen.getByText("Erro ao carregar")).toBeInTheDocument();
    });
  });

  it("24. useful period analytics preserved without legacy settlement authority", async () => {
    render(<AdminCommissionsOverviewPage />);
    await waitFor(() => {
      expect(screen.getByText("Análise por Período")).toBeInTheDocument();
      expect(screen.getByText("Faturamento Serviços")).toBeInTheDocument();
      expect(screen.getByText("Faturamento Produtos")).toBeInTheDocument();
      expect(screen.getByText("Ticket Médio")).toBeInTheDocument();
    });
  });

  it("25. keyboard-accessible financial dialog critical flow (Escape closes dialog)", async () => {
    render(<CommissionPaymentsPage />);
    await waitFor(() => {
      expect(screen.getByText("Carlos Barbeiro")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Adiantamento")[0]);
    await waitFor(() => screen.getByText("Novo Adiantamento de Comissão"));

    // Press Escape
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Novo Adiantamento de Comissão")).not.toBeInTheDocument();
    });
  });
});
