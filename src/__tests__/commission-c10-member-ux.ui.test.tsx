/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import MemberComissoesPage from "@/app/member/comissoes/page";

describe("TEM BARBER — C10 Member Commission UX Suite", () => {
  let fetchSpy: any;

  const mockMemberCommissionsData = {
    currentCycle: {
      id: "cycle-open-1",
      cycleNumber: 2,
      status: "OPEN" as const,
      accumulatedCommission: 450,
      netAdvances: 100,
      remainingPayable: 350,
      openedAt: "2026-09-01T10:00:00Z",
      payableItems: [
        {
          id: "p1",
          type: "RELEASE" as const,
          amount: 250,
          sourceKind: "PAYMENT",
          isHistoricalCorrection: false,
          createdAt: "2026-09-02T14:00:00Z",
          description: "Corte Degradê",
          customerName: "João da Silva",
          baseAmount: 500,
          rateLabel: "50%",
        },
        {
          id: "p2",
          type: "RELEASE" as const,
          amount: 200,
          sourceKind: "PAYMENT",
          isHistoricalCorrection: false,
          createdAt: "2026-09-02T16:00:00Z",
          description: "Barba Terapia",
          customerName: "Pedro Alves",
          baseAmount: 400,
          rateLabel: "50%",
        },
        {
          id: "p3",
          type: "REVERSAL" as const,
          amount: 50,
          sourceKind: "REFUND",
          isHistoricalCorrection: true,
          createdAt: "2026-09-03T11:00:00Z",
          description: "Estorno de comissão histórica",
          customerName: "Cliente Antigo",
          baseAmount: 100,
          rateLabel: "50%",
        },
      ],
      adjustments: [],
    },
    accumulatedCommission: 450,
    netAdvances: 100,
    remainingPayable: 350,
    paidTotal: 800,
    awaitingCustomerPayment: [
      {
        id: "awaiting-1",
        description: "Coloração Barba",
        customerName: "Marcos Lima",
        baseAmount: 120,
        estimatedCommission: 60,
        rateLabel: "50%",
        completedAt: "2026-09-03T15:00:00Z",
      },
    ],
    historicalCycles: [
      {
        id: "cycle-paid-1",
        cycleNumber: 1,
        status: "PAID",
        grossCommission: 1000,
        advancesTotal: 200,
        adjustmentsTotal: 0,
        finalPayoutAmount: 800,
        closedAt: "2026-08-31T20:00:00Z",
        paidAt: "2026-08-31T20:30:00Z",
      },
      {
        id: "cycle-paid-0",
        cycleNumber: 0,
        status: "PAID",
        grossCommission: 0,
        advancesTotal: 0,
        adjustmentsTotal: 0,
        finalPayoutAmount: 0,
        closedAt: "2026-07-31T20:00:00Z",
        paidAt: "2026-07-31T20:30:00Z",
      },
    ],
    advances: [
      {
        id: "adv-1",
        cycleId: "cycle-open-1",
        amount: 150,
        reversalsTotal: 50,
        netAmount: 100,
        paymentMethod: "PIX",
        disbursedAt: "2026-09-02T12:00:00Z",
        notes: "Vale semanal",
        reversals: [
          {
            id: "rev-1",
            amount: 50,
            returnedAt: "2026-09-02T18:00:00Z",
            reason: "Devolução parcial",
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    fetchSpy = vi.fn((url: string) => {
      if (url === "/api/member/commissions") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMemberCommissionsData),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. page consumes canonical /api/member/commissions", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/member/commissions");
    });
  });

  it("2. no arbitrary memberId sent", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map((c: any) => c[0]);
      calls.forEach((url: string) => {
        expect(url).not.toContain("memberId=");
      });
    });
  });

  it("3. GET causes no mutation", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Minhas comissões")).toBeInTheDocument();
    });
    const mutationCalls = fetchSpy.mock.calls.filter((c: any) => c[1]?.method && c[1].method !== "GET");
    expect(mutationCalls.length).toBe(0);
  });

  it("4. four canonical member KPIs render", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Comissões acumuladas")).toBeInTheDocument();
      expect(screen.getAllByText("Adiantamentos").length).toBeGreaterThan(0);
      expect(screen.getByText("Saldo a receber")).toBeInTheDocument();
      expect(screen.getByText("Total pago")).toBeInTheDocument();
    });
  });

  it("5. 'Saldo a receber' uses API remainingBalance", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      // remainingPayable is 350
      expect(screen.getByText(/350,00/)).toBeInTheDocument();
    });
  });

  it("6. 'Adiantamentos' uses net advance value", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      // netAdvances is 100
      expect(screen.getAllByText(/100,00/).length).toBeGreaterThan(0);
    });
  });

  it("7. old Gerada label absent", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Minhas comissões")).toBeInTheDocument();
    });
    expect(screen.queryByText("Gerada")).not.toBeInTheDocument();
    expect(screen.queryByText("Comissão Gerada")).not.toBeInTheDocument();
  });

  it("8. old Liberada label absent", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Minhas comissões")).toBeInTheDocument();
    });
    expect(screen.queryByText("Liberada")).not.toBeInTheDocument();
  });

  it("9. monthly competence selector removed as primary model", async () => {
    const { container } = render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Minhas comissões")).toBeInTheDocument();
    });
    const monthInputs = container.querySelectorAll("input[type='month']");
    expect(monthInputs.length).toBe(0);
  });

  it("10. EM APURAÇÃO displayed for current commission state", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("EM APURAÇÃO")).toBeInTheDocument();
    });
  });

  it("11. awaiting customer payment shown separately", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Aguardando pagamento do cliente")).toBeInTheDocument();
      expect(screen.getByText("Coloração Barba")).toBeInTheDocument();
      expect(screen.getByText("Marcos Lima")).toBeInTheDocument();
    });
  });

  it("12. awaiting amount excluded from saldo", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      // Saldo a receber must be 350, NOT 350 + 60 = 410
      expect(screen.getByText(/350,00/)).toBeInTheDocument();
      expect(screen.queryByText(/410,00/)).not.toBeInTheDocument();
    });
  });

  it("13. commission source detail human-readable", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Corte Degradê")).toBeInTheDocument();
      expect(screen.getByText("João da Silva")).toBeInTheDocument();
      expect(screen.getByText("Barba Terapia")).toBeInTheDocument();
      expect(screen.getByText("Pedro Alves")).toBeInTheDocument();
    });
  });

  it("14. raw RELEASE enum not visible", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Minhas comissões")).toBeInTheDocument();
    });
    // Should show "Comissão adicionada" instead of "RELEASE"
    expect(screen.getAllByText("Comissão adicionada").length).toBeGreaterThan(0);
    expect(screen.queryByText("RELEASE")).not.toBeInTheDocument();
  });

  it("15. raw REVERSAL enum not visible", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Minhas comissões")).toBeInTheDocument();
    });
    // Should show "Comissão ajustada" instead of "REVERSAL"
    expect(screen.getAllByText("Comissão ajustada").length).toBeGreaterThan(0);
    expect(screen.queryByText("REVERSAL")).not.toBeInTheDocument();
  });

  it("16. raw configSnapshot not exposed", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Minhas comissões")).toBeInTheDocument();
    });
    expect(screen.queryByText(/configSnapshot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/eventKey/i)).not.toBeInTheDocument();
  });

  it("17. advance history is read-only", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Vale semanal")).toBeInTheDocument();
      expect(screen.getByText("PIX")).toBeInTheDocument();
    });
  });

  it("18. no advance mutation button", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Minhas comissões")).toBeInTheDocument();
    });
    expect(screen.queryByText("Novo adiantamento")).not.toBeInTheDocument();
    expect(screen.queryByText("Estornar")).not.toBeInTheDocument();
    expect(screen.queryByText("Editar")).not.toBeInTheDocument();
    expect(screen.queryByText("Excluir")).not.toBeInTheDocument();
  });

  it("19. no payout mutation button", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Minhas comissões")).toBeInTheDocument();
    });
    expect(screen.queryByText("Pagar")).not.toBeInTheDocument();
    expect(screen.queryByText("Liquidar")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirmar pagamento")).not.toBeInTheDocument();
    expect(screen.queryByText("Fechar período")).not.toBeInTheDocument();
  });

  it("20. PAID history renders", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Histórico de pagamentos")).toBeInTheDocument();
      expect(screen.getByText("Ciclo #1")).toBeInTheDocument();
      expect(screen.getByText("PAGO")).toBeInTheDocument();
    });
  });

  it("21. historical paid amount remains immutable after later correction", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      // Historical payout remains exactly 800
      expect(screen.getAllByText(/800,00/).length).toBeGreaterThan(0);
    });
  });

  it("22. later correction appears in current activity", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Ajuste de ciclo anterior")).toBeInTheDocument();
      expect(screen.getAllByText(/-.*50,00/).length).toBeGreaterThan(0);
    });
  });

  it("23. zero-money close does not look like fake payment", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Ciclo #0")).toBeInTheDocument();
      expect(screen.getByText("Encerrado sem valor a pagar")).toBeInTheDocument();
    });
  });

  it("24. negative balance uses compensation language, not debt language", async () => {
    const negativeData = {
      ...mockMemberCommissionsData,
      remainingPayable: -120,
      currentCycle: {
        ...mockMemberCommissionsData.currentCycle,
        remainingPayable: -120,
      },
    };
    fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(negativeData) }));

    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Saldo a compensar em próximas comissões")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Você deve/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dívida/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Pagar à barbearia/i)).not.toBeInTheDocument();
  });

  it("25. loading state", () => {
    // Unresolved promise simulates ongoing loading
    fetchSpy.mockImplementationOnce(() => new Promise(() => {}));
    const { container } = render(<MemberComissoesPage />);
    const pulseElements = container.querySelectorAll(".animate-pulse");
    expect(pulseElements.length).toBeGreaterThan(0);
  });

  it("26. empty state", async () => {
    const emptyData = {
      ...mockMemberCommissionsData,
      currentCycle: {
        ...mockMemberCommissionsData.currentCycle,
        payableItems: [],
      },
      accumulatedCommission: 0,
      netAdvances: 0,
      remainingPayable: 0,
    };
    fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(emptyData) }));

    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Você ainda não possui comissões acumuladas neste ciclo.")).toBeInTheDocument();
    });
  });

  it("27. error state with retry option", async () => {
    fetchSpy.mockImplementationOnce(() => Promise.reject(new Error("Falha na conexão")));
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Falha na conexão")).toBeInTheDocument();
      expect(screen.getByText("Tentar novamente")).toBeInTheDocument();
    });
  });

  it("28. responsive 390 layout contract", async () => {
    const { container } = render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Minhas comissões")).toBeInTheDocument();
    });
    // Verify responsive grid classes are present
    const gridEl = container.querySelector(".grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-4");
    expect(gridEl).toBeInTheDocument();
  });

  it("29. keyboard/semantic accessibility", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Minhas comissões" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2, name: "Ciclo Atual" })).toBeInTheDocument();
    });
  });

  it("30. legacy member commission UI expectations cleanly eliminated", async () => {
    render(<MemberComissoesPage />);
    await waitFor(() => {
      expect(screen.getByText("Minhas comissões")).toBeInTheDocument();
    });
    // Check no legacy CommissionPeriod status exists
    expect(screen.queryByText("Pendente")).not.toBeInTheDocument();
    expect(screen.queryByText("Marcar pago")).not.toBeInTheDocument();
  });
});
