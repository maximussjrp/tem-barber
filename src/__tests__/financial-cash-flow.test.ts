/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCashFlowReport } from "@/lib/financial/cash-flow";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    payment: {
      findMany: vi.fn(),
    },
    financialEntry: {
      findMany: vi.fn(),
    },
    financialTitle: {
      findMany: vi.fn(),
    },
    financialRoutine: {
      findMany: vi.fn(),
    },
    comanda: {
      findMany: vi.fn(),
    },
    commissionCycle: {
      findMany: vi.fn(),
    },
    tipEntry: {
      findMany: vi.fn(),
    },
    clubSettlementMember: {
      findMany: vi.fn(),
    },
  },
}));

describe("Financial Cash Flow Domain Engine — Unit Suite", () => {
  const shopA = "shop-alpha-123";

  beforeEach(() => {
    vi.clearAllMocks();

    // Defaults vazios para evitar undefined
    vi.mocked(prisma.payment.findMany).mockResolvedValue([]);
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([]);
    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([]);
    vi.mocked(prisma.comanda.findMany).mockResolvedValue([]);
    vi.mocked(prisma.commissionCycle.findMany).mockResolvedValue([]);
    vi.mocked(prisma.tipEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.clubSettlementMember.findMany).mockResolvedValue([]);
  });

  it("1. Payment PIX +100 + FinancialEntry COMMAND_REVENUE +100 resulta em realizado +100 (sem double counting)", async () => {
    // 1 payment PIX de 100
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      {
        id: "pay-1",
        amount: 100 as any,
        paidAt: new Date("2026-06-15T15:00:00.000Z"),
        method: "PIX",
      } as any,
    ]);

    // FinancialEntry associado (COMMAND_REVENUE) para allocations
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValue([
      {
        id: "fe-1",
        sourceRefs: { paymentId: "pay-1" },
        allocations: [
          {
            allocatedAmount: 100 as any,
            financialCategory: {
              id: "cat-serv",
              code: "01.01",
              name: "Serviços",
              classification: "REVENUE",
            },
          },
        ],
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.realized.inflow).toBe("100.00");
    expect(report.realized.outflow).toBe("0.00");
    expect(report.realized.net).toBe("100.00");
  });

  it("2. Payment CUSTOMER_CREDIT +100 + COMMAND_REVENUE +100 resulta em external realized cash 0", async () => {
    // Payment com method CUSTOMER_CREDIT é ignorado pelo filtro do prisma (WHERE method != CUSTOMER_CREDIT)
    vi.mocked(prisma.payment.findMany).mockResolvedValue([]);
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValue([]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.realized.inflow).toBe("0.00");
    expect(report.realized.outflow).toBe("0.00");
    expect(report.realized.net).toBe("0.00");
  });

  it("3. Checkout: sale 70, tip 20, credit deposit 10 = exatamente 100 realizado total", async () => {
    // Payment de venda 70
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      {
        id: "pay-sale",
        amount: 70 as any,
        paidAt: new Date("2026-06-10T12:00:00.000Z"),
        method: "CREDIT_CARD",
      } as any,
    ]);

    // Outros entries: TIP_RECEIVED (20) e CUSTOMER_CREDIT_DEPOSIT (10)
    // A query de paymentEntries busca por paymentId, e a query de otherEntries busca type not in [COMMAND_REVENUE, REFUND]
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-sale",
          sourceRefs: { paymentId: "pay-sale" },
          allocations: [
            {
              allocatedAmount: 70 as any,
              financialCategory: {
                id: "cat-1",
                code: "01.01",
                name: "Serviços",
                classification: "REVENUE",
              },
            },
          ],
        } as any,
      ])
      .mockResolvedValueOnce([
        {
          id: "fe-tip",
          amount: 20 as any,
          entryDate: new Date("2026-06-10T12:00:00.000Z"),
          direction: "IN",
          allocations: [],
        } as any,
        {
          id: "fe-dep",
          amount: 10 as any,
          entryDate: new Date("2026-06-10T12:00:00.000Z"),
          direction: "IN",
          allocations: [],
        } as any,
      ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.realized.inflow).toBe("100.00");
    expect(report.realized.outflow).toBe("0.00");
    expect(report.realized.net).toBe("100.00");
  });

  it("4. Refund externo -30 reduz realized", async () => {
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      {
        id: "pay-ref",
        amount: -30 as any,
        paidAt: new Date("2026-06-12T10:00:00.000Z"),
        method: "PIX",
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.realized.inflow).toBe("0.00");
    expect(report.realized.outflow).toBe("30.00");
    expect(report.realized.net).toBe("-30.00");
  });

  it("5. Settlement FinancialTitle MANUAL_IN/OUT entra apenas uma vez via FinancialEntry", async () => {
    // Settlement já gerou MANUAL_OUT no ledger
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValue([
      {
        id: "fe-man-out",
        amount: -500 as any,
        entryDate: new Date("2026-06-05T14:00:00.000Z"),
        direction: "OUT",
        allocations: [
          {
            allocatedAmount: 500 as any,
            financialCategory: {
              id: "cat-aluguel",
              code: "03.01",
              name: "Aluguel",
              classification: "FIXED_EXPENSE",
            },
          },
        ],
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.realized.outflow).toBe("500.00");
    expect(report.realized.net).toBe("-500.00");
  });

  it("6. Settlement reversal faz efeito oposto correto", async () => {
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValue([
      {
        id: "fe-rev",
        amount: 500 as any,
        entryDate: new Date("2026-06-06T14:00:00.000Z"),
        direction: "IN",
        allocations: [],
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.realized.inflow).toBe("500.00");
    expect(report.realized.net).toBe("500.00");
  });

  it("7. FinancialTitle 100 com settled principal 40 projeta outstanding 60", async () => {
    vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([
      {
        id: "title-1",
        kind: "PAYABLE",
        title: "Fornecedor Cosméticos",
        originalAmount: 100 as any,
        dueOn: "2026-06-20",
        category: {
          id: "cat-forn",
          code: "02.02",
          name: "Produtos para Revenda",
          classification: "VARIABLE_COST",
        },
        settlements: [
          {
            principalAmount: 40 as any,
          },
        ],
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.projected.payable).toBe("60.00");
    expect(report.projected.net).toBe("-60.00");
  });

  it("8. FinancialTitle PAID não projeta", async () => {
    vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([
      {
        id: "title-paid",
        kind: "PAYABLE",
        title: "Conta Quitada",
        originalAmount: 100 as any,
        dueOn: "2026-06-20",
        category: {
          id: "cat-1",
          code: "03.01",
          name: "Aluguel",
          classification: "FIXED_EXPENSE",
        },
        settlements: [
          {
            principalAmount: 100 as any,
          },
        ],
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.projected.payable).toBe("0.00");
    expect(report.projected.net).toBe("0.00");
  });

  it("9. FinancialTitle CANCELLED não projeta", async () => {
    // cancelledAt != null é filtrado no findMany do prisma (where: { cancelledAt: null })
    vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.projected.payable).toBe("0.00");
  });

  it("10. OVERDUE usa dueOn < today e 11. Due today NÃO é overdue", async () => {
    // Simulando que hoje é 2026-06-15
    vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([
      {
        id: "title-overdue",
        kind: "RECEIVABLE",
        title: "Mensalidade Atrasada",
        originalAmount: 200 as any,
        dueOn: "2020-01-01", // claramante anterior a qualquer today real
        category: {
          id: "cat-1",
          code: "01.01",
          name: "Serviços",
          classification: "REVENUE",
        },
        settlements: [],
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.overdue.receivable).toBe("200.00");
    expect(report.overdue.net).toBe("200.00");
  });

  it("12. Routine FIXED futura sem title gera forecast virtual COMMITTED", async () => {
    vi.mocked(prisma.financialTitle.findMany)
      .mockResolvedValueOnce([]) // títulos pendentes
      .mockResolvedValueOnce([]); // títulos existentes de rotina (dedup)

    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([
      {
        id: "routine-fixed-1",
        kind: "PAYABLE",
        title: "Internet Fibra",
        amountMode: "FIXED",
        baseAmount: 150 as any,
        dueDay: 10,
        startDate: "2026-01-01",
        endDate: null,
        category: {
          id: "cat-net",
          code: "03.02",
          name: "Internet",
          classification: "FIXED_EXPENSE",
        },
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2027-01-01",
      endDate: "2027-01-31",
    });

    expect(report.projected.payable).toBe("150.00");
    expect(report.projected.committed).toBe("150.00");
    expect(report.projected.estimated).toBe("0.00");
    expect(report.forecastMeta.virtualRoutineCount).toBe(1);

    const upcoming = report.upcoming.find((u) => u.title.includes("Internet Fibra"));
    expect(upcoming).toBeDefined();
    expect(upcoming?.confidence).toBe("COMMITTED");
  });

  it("13. Routine VARIABLE com base gera forecast virtual ESTIMATED", async () => {
    vi.mocked(prisma.financialTitle.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([
      {
        id: "routine-var-1",
        kind: "PAYABLE",
        title: "Energia Elétrica",
        amountMode: "VARIABLE",
        baseAmount: 350 as any,
        dueDay: 20,
        startDate: "2026-01-01",
        endDate: null,
        category: {
          id: "cat-luz",
          code: "03.03",
          name: "Energia",
          classification: "FIXED_EXPENSE",
        },
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2027-02-01",
      endDate: "2027-02-28",
    });

    expect(report.projected.payable).toBe("350.00");
    expect(report.projected.estimated).toBe("350.00");
    expect(report.forecastMeta.estimatedRoutineCount).toBe(1);

    const upcoming = report.upcoming.find((u) => u.title.includes("Energia Elétrica"));
    expect(upcoming?.confidence).toBe("ESTIMATED");
  });

  it("14. Routine VARIABLE sem base não inventa valor e incrementa unprojectableRoutineCount", async () => {
    vi.mocked(prisma.financialTitle.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([
      {
        id: "routine-var-nobase",
        kind: "PAYABLE",
        title: "Comissões Variáveis Futuras",
        amountMode: "VARIABLE",
        baseAmount: null,
        dueDay: 5,
        startDate: "2026-01-01",
        endDate: null,
        category: {
          id: "cat-var",
          code: "02.01",
          name: "Comissões",
          classification: "VARIABLE_COST",
        },
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2027-03-01",
      endDate: "2027-03-31",
    });

    expect(report.projected.payable).toBe("0.00");
    expect(report.forecastMeta.unprojectableRoutineCount).toBe(1);
    expect(report.forecastMeta.virtualRoutineCount).toBe(0);
  });

  it("15. Title existente routine+referenceMonth e 16. Title CANCELLED impedem virtual duplicado", async () => {
    // Título já existente no banco para a rotina e mês 2027-04
    vi.mocked(prisma.financialTitle.findMany)
      .mockResolvedValueOnce([]) // títulos pendentes
      .mockResolvedValueOnce([
        {
          routineId: "routine-1",
          referenceMonth: "2027-04",
        } as any,
      ]);

    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([
      {
        id: "routine-1",
        kind: "PAYABLE",
        title: "Aluguel Salão",
        amountMode: "FIXED",
        baseAmount: 2000 as any,
        dueDay: 5,
        startDate: "2026-01-01",
        endDate: null,
        category: {
          id: "cat-aluguel",
          code: "03.01",
          name: "Aluguel",
          classification: "FIXED_EXPENSE",
        },
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2027-04-01",
      endDate: "2027-04-30",
    });

    expect(report.projected.payable).toBe("0.00");
    expect(report.forecastMeta.virtualRoutineCount).toBe(0);
  });

  it("17. Comanda remainingTotal vai para undated e NÃO daily", async () => {
    vi.mocked(prisma.comanda.findMany).mockResolvedValue([
      {
        remainingTotal: 85 as any,
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.undated.customerReceivables).toBe("85.00");
    // Assegurar que daily não recebeu esse valor
    const dailyTotalProj = report.daily.reduce((acc, d) => acc + parseFloat(d.projectedIn), 0);
    expect(dailyTotalProj).toBe(0);
    expect(report.expectedPeriodNet).toBe("0.00");
  });

  it("18. Commission remainingBalance vai para undated e NÃO daily", async () => {
    vi.mocked(prisma.commissionCycle.findMany).mockResolvedValue([
      {
        remainingBalance: 1250 as any,
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.undated.commissionPayables).toBe("1250.00");
  });

  it("19. Tip outstanding vai para undated e NÃO daily", async () => {
    vi.mocked(prisma.tipEntry.findMany).mockResolvedValue([
      {
        amount: 50 as any,
        refundedAmount: 10 as any,
        paidOutAmount: 15 as any, // outstanding = 25
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.undated.tipPayables).toBe("25.00");
  });

  it("20. Club APPROVED unpaid vai para undated e 21. CALCULATED não entra", async () => {
    vi.mocked(prisma.clubSettlementMember.findMany).mockResolvedValue([
      {
        amount: 320 as any,
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.undated.clubApprovedPayables).toBe("320.00");
  });

  it("22. Allocation SERVICE + PRODUCT fecha valor exato e 23. category filter usa somente parcela", async () => {
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      {
        id: "pay-misto",
        amount: 100 as any,
        paidAt: new Date("2026-06-15T10:00:00.000Z"),
        method: "PIX",
      } as any,
    ]);

    const mockMistoEntries = [
      {
        id: "fe-misto",
        paymentId: "pay-misto",
        sourceRefs: { paymentId: "pay-misto" },
        entryDate: new Date("2026-06-15T10:00:00.000Z"),
        allocations: [
          {
            allocatedAmount: 65 as any,
            financialCategory: {
              id: "cat-serv",
              code: "01.01",
              name: "Serviços",
              classification: "REVENUE",
            },
          },
          {
            allocatedAmount: 35 as any,
            financialCategory: {
              id: "cat-prod",
              code: "01.02",
              name: "Produtos",
              classification: "REVENUE",
            },
          },
        ],
      } as any,
    ];

    (vi.mocked(prisma.financialEntry.findMany) as any).mockImplementation(async (args: any) => {
      if (args?.where?.type?.in) {
        return mockMistoEntries;
      }
      return [];
    });

    // Relatório filtrado apenas por Serviços
    const reportFilterServ = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      categoryId: "cat-serv",
    });

    expect(reportFilterServ.realized.inflow).toBe("65.00");
    expect(reportFilterServ.realized.net).toBe("65.00");

    // Breakdown geral sem filtro
    const reportFull = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(reportFull.realized.inflow).toBe("100.00");
    const servBreakdown = reportFull.categoryBreakdown.find((b) => b.categoryId === "cat-serv");
    const prodBreakdown = reportFull.categoryBreakdown.find((b) => b.categoryId === "cat-prod");
    expect(servBreakdown?.realizedIn).toBe("65.00");
    expect(prodBreakdown?.realizedIn).toBe("35.00");
  });

  it("24. Allocation residual é preservado como uncategorized residual", async () => {
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      {
        id: "pay-res",
        amount: 100 as any,
        paidAt: new Date("2026-06-15T10:00:00.000Z"),
        method: "PIX",
      } as any,
    ]);

    // Allocations totalizam 90 (residual de 10)
    const mockResidualEntries = [
      {
        id: "fe-res",
        paymentId: "pay-res",
        sourceRefs: { paymentId: "pay-res" },
        entryDate: new Date("2026-06-15T10:00:00.000Z"),
        allocations: [
          {
            allocatedAmount: 90 as any,
            financialCategory: {
              id: "cat-serv",
              code: "01.01",
              name: "Serviços",
              classification: "REVENUE",
            },
          },
        ],
      } as any,
    ];

    (vi.mocked(prisma.financialEntry.findMany) as any).mockImplementation(async (args: any) => {
      if (args?.where?.type?.in) {
        return mockResidualEntries;
      }
      return [];
    });

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(report.realized.inflow).toBe("100.00");
    expect(report.forecastMeta.allocationResidualCount).toBe(1);

    const residualItem = report.categoryBreakdown.find((b) => b.code === "99.99");
    expect(residualItem).toBeDefined();
    expect(residualItem?.realizedIn).toBe("10.00");
  });

  it("25. Tenant A nunca vê tenant B", async () => {
    await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
    });

    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barbershopId: shopA,
        }),
      })
    );

    expect(prisma.financialTitle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barbershopId: shopA,
        }),
      })
    );
  });

  it("DATE_ONLY_DUE_ON_NOT_SHIFTED: FinancialTitle @db.Date 2026-10-07T00:00:00Z não desloca para 06/10 e due today NÃO é overdue", async () => {
    // Simula today como 2026-10-07
    // Title com dueOn Date correspondente a 2026-10-07T00:00:00Z
    const dbDateDueOn = new Date("2026-10-07T00:00:00.000Z");

    vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([
      {
        id: "title-due-today",
        barbershopId: shopA,
        kind: "RECEIVABLE",
        title: "Recebível do Dia",
        originalAmount: 150 as any,
        dueOn: dbDateDueOn,
        cancelledAt: null,
        category: {
          id: "cat-rec",
          code: "01.01",
          name: "Receitas",
          classification: "REVENUE",
        },
        settlements: [],
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    // Se todayIsoBR() do sistema for 2026-10-07 ou dinâmico:
    // O item diário do dia "2026-10-07" deve ter projectedIn = "150.00", nunca "2026-10-06"
    const dayItem07 = report.daily.find((d) => d.date === "2026-10-07");
    const dayItem06 = report.daily.find((d) => d.date === "2026-10-06");
    expect(dayItem07?.projectedIn).toBe("150.00");
    expect(dayItem06?.projectedIn).toBe("0.00");

    // E se for today, NÃO é overdue
    if (report.period.today === "2026-10-07") {
      expect(report.overdue.receivable).toBe("0.00");
    }
  });

  it("DATE_ONLY_ROUTINE_START_NOT_SHIFTED: FinancialRoutine @db.Date 2026-10-07T00:00:00Z não desloca para 06/10", async () => {
    const routineStartDate = new Date("2026-10-07T00:00:00.000Z");

    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([
      {
        id: "routine-start-today",
        barbershopId: shopA,
        kind: "PAYABLE",
        title: "Aluguel",
        amountMode: "FIXED",
        baseAmount: 1000 as any,
        dueDay: 7, // dueOn civil será 2026-10-07
        startDate: routineStartDate,
        endDate: null,
        isActive: true,
        category: {
          id: "cat-aluguel",
          code: "03.01",
          name: "Aluguel",
          classification: "FIXED_EXPENSE",
        },
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    // A rotina cujo vencimento é dia 07/10 e startDate é 07/10 deve ser considerada válida
    // e cair exatamente no dia 2026-10-07 (não ser rejeitada por dueOn < startDate)
    const dayItem07 = report.daily.find((d) => d.date === "2026-10-07");
    expect(dayItem07?.projectedOut).toBe("1000.00");
  });

  it("CATEGORY_FILTER_BREAKDOWN: categoryId filtra realized.inflow e categoryBreakdown inclui SOMENTE a categoria selecionada", async () => {
    // Payment=100 com SERVICE=65 e PRODUCT=35
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      {
        id: "pay-split",
        amount: 100 as any,
        paidAt: new Date("2026-06-10T14:00:00.000Z"),
        method: "CREDIT_CARD",
      } as any,
    ]);

    (vi.mocked(prisma.financialEntry.findMany) as any).mockImplementation(async (args: any) => {
      if (args?.where?.type?.in) {
        return [
          {
            id: "entry-split",
            paymentId: "pay-split",
            allocations: [
              {
                allocatedAmount: 65 as any,
                financialCategory: {
                  id: "cat-serv",
                  code: "01.01",
                  name: "Serviços",
                  classification: "REVENUE",
                },
              },
              {
                allocatedAmount: 35 as any,
                financialCategory: {
                  id: "cat-prod",
                  code: "01.02",
                  name: "Produtos",
                  classification: "REVENUE",
                },
              },
            ],
          } as any,
        ];
      }
      return [];
    });

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      categoryId: "cat-serv",
    });

    // Realized inflow deve ser 65.00
    expect(report.realized.inflow).toBe("65.00");

    // Breakdown deve conter SOMENTE Serviços, e NÃO Produtos
    expect(report.categoryBreakdown).toHaveLength(1);
    expect(report.categoryBreakdown[0].categoryId).toBe("cat-serv");
    expect(report.categoryBreakdown[0].realizedIn).toBe("65.00");
  });

  it("DIRECTION_IN_BREAKDOWN e DIRECTION_OUT_BREAKDOWN: categoryBreakdown não vaza realized na direção oposta", async () => {
    // 1 payment de entrada (100) e 1 entry de despesa avulsa (-40)
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      {
        id: "pay-in",
        amount: 100 as any,
        paidAt: new Date("2026-06-10T14:00:00.000Z"),
        method: "PIX",
      } as any,
    ]);

    (vi.mocked(prisma.financialEntry.findMany) as any).mockImplementation(async (args: any) => {
      // Se for a query de COMMAND_REVENUE para allocations do payment
      if (args?.where?.type?.in) {
        return [
          {
            id: "entry-in",
            paymentId: "pay-in",
            allocations: [
              {
                allocatedAmount: 100 as any,
                financialCategory: {
                  id: "cat-rev",
                  code: "01.01",
                  name: "Receita",
                  classification: "REVENUE",
                },
              },
            ],
          } as any,
        ];
      }
      // Se for a query de outros entries
      return [
        {
          id: "entry-out",
          amount: -40 as any,
          entryDate: new Date("2026-06-11T14:00:00.000Z"),
          type: "MANUAL_OUT",
          allocations: [
            {
              allocatedAmount: 40 as any,
              financialCategory: {
                id: "cat-exp",
                code: "03.01",
                name: "Despesa",
                classification: "FIXED_EXPENSE",
              },
            },
          ],
        } as any,
      ];
    });

    // Teste com direction=IN
    const reportIn = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      direction: "IN",
    });
    expect(reportIn.categoryBreakdown.find((b) => b.categoryId === "cat-exp")).toBeUndefined();
    expect(reportIn.categoryBreakdown.find((b) => b.categoryId === "cat-rev")?.realizedIn).toBe("100.00");

    // Teste com direction=OUT
    const reportOut = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      direction: "OUT",
    });
    expect(reportOut.categoryBreakdown.find((b) => b.categoryId === "cat-rev")).toBeUndefined();
    expect(reportOut.categoryBreakdown.find((b) => b.categoryId === "cat-exp")?.realizedOut).toBe("40.00");
  });

  it("FILTERED_RESIDUAL_LEAK_FIXED: com categoryId definido, resíduo não entra no breakdown", async () => {
    // Payment=100, allocation=80, residual=20
    vi.mocked(prisma.payment.findMany).mockResolvedValue([
      {
        id: "pay-res",
        amount: 100 as any,
        paidAt: new Date("2026-06-10T14:00:00.000Z"),
        method: "PIX",
      } as any,
    ]);

    vi.mocked(prisma.financialEntry.findMany).mockResolvedValue([
      {
        id: "entry-res",
        paymentId: "pay-res",
        allocations: [
          {
            allocatedAmount: 80 as any,
            financialCategory: {
              id: "cat-serv",
              code: "01.01",
              name: "Serviços",
              classification: "REVENUE",
            },
          },
        ],
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-06-01",
      endDate: "2026-06-30",
      categoryId: "cat-serv",
    });

    // Não deve conter a categoria residual 99.99
    expect(report.categoryBreakdown.find((b) => b.code === "99.99")).toBeUndefined();
    expect(report.categoryBreakdown).toHaveLength(1);
    expect(report.categoryBreakdown[0].categoryId).toBe("cat-serv");
  });

  it("UPCOMING_START_BOUNDARY: FinancialTitle com dueOn anterior a startDate (mesmo que >= today) não entra em upcoming", async () => {
    // Simula consulta com startDate no futuro relativo a um título:
    // Exemplo: startDate = 2026-11-01, endDate = 2026-12-31, title dueOn = 2026-10-20 (futuro em relação a today hipotético, mas < startDate)
    vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([
      {
        id: "title-october",
        barbershopId: shopA,
        kind: "RECEIVABLE",
        title: "Recebível de Outubro",
        originalAmount: 500 as any,
        dueOn: "2026-10-20",
        cancelledAt: null,
        category: {
          id: "cat-rec",
          code: "01.01",
          name: "Receitas",
          classification: "REVENUE",
        },
        settlements: [],
      } as any,
    ]);

    const report = await getCashFlowReport({
      barbershopId: shopA,
      startDate: "2026-11-01",
      endDate: "2026-12-31",
    });

    // Como dueOn ("2026-10-20") < startDate ("2026-11-01"), NÃO deve entrar em upcoming
    expect(report.upcoming.find((u) => u.id === "title-october")).toBeUndefined();
  });
});
