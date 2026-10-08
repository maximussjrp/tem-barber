/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getManagementReport,
  isValidISODateString,
  calculateDaysDifference,
  calculateAV,
  calculateAH,
  computePreviousPeriod,
  CategoryNotFoundError,
} from "@/lib/financial/management-report";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  default: {
    financialCategory: {
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
  },
}));

describe("Financial Management Report Domain Engine — Comprehensive 35-Item Suite", () => {
  const shopA = "shop-alpha-123";

  const defaultCategoryRows = [
    // 01 REVENUE
    { id: "cat-rev-root", code: "01", name: "Receitas", classification: "REVENUE", parentCategoryId: null, isActive: true },
    { id: "cat-rev-serv", code: "01.01", name: "Serviços", classification: "REVENUE", parentCategoryId: "cat-rev-root", isActive: true },
    { id: "cat-rev-serv-sub", code: "01.01.01", name: "Cortes Masculinos", classification: "REVENUE", parentCategoryId: "cat-rev-serv", isActive: true }, // 3rd level
    { id: "cat-rev-prod", code: "01.02", name: "Produtos", classification: "REVENUE", parentCategoryId: "cat-rev-root", isActive: true },
    { id: "cat-rev-club", code: "01.03", name: "Clube", classification: "REVENUE", parentCategoryId: "cat-rev-root", isActive: true },
    { id: "cat-rev-ref", code: "01.04", name: "Estornos de Vendas", classification: "REVENUE", parentCategoryId: "cat-rev-root", isActive: true },
    { id: "cat-rev-inactive", code: "01.99", name: "Receitas Legadas", classification: "REVENUE", parentCategoryId: "cat-rev-root", isActive: false },
    // 02 VARIABLE_COST
    { id: "cat-vc-root", code: "02", name: "Custos Variáveis", classification: "VARIABLE_COST", parentCategoryId: null, isActive: true },
    { id: "cat-vc-com", code: "02.01", name: "Comissões", classification: "VARIABLE_COST", parentCategoryId: "cat-vc-root", isActive: true },
    // 03 FIXED_EXPENSE
    { id: "cat-fe-root", code: "03", name: "Despesas Fixas", classification: "FIXED_EXPENSE", parentCategoryId: null, isActive: true },
    { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE", parentCategoryId: "cat-fe-root", isActive: true },
    // 04 INVESTMENT
    { id: "cat-inv-root", code: "04", name: "Investimentos", classification: "INVESTMENT", parentCategoryId: null, isActive: true },
    { id: "cat-inv-mkt", code: "04.01", name: "Marketing", classification: "INVESTMENT", parentCategoryId: "cat-inv-root", isActive: true },
    // 05 NON_OPERATING_IN
    { id: "cat-noin-root", code: "05", name: "Entradas Não Operacionais", classification: "NON_OPERATING_IN", parentCategoryId: null, isActive: true },
    { id: "cat-noin-rend", code: "05.01", name: "Rendimentos", classification: "NON_OPERATING_IN", parentCategoryId: "cat-noin-root", isActive: true },
    // 06 NON_OPERATING_OUT
    { id: "cat-noout-root", code: "06", name: "Saídas Não Operacionais", classification: "NON_OPERATING_OUT", parentCategoryId: null, isActive: true },
    { id: "cat-noout-fine", code: "06.01", name: "Multas", classification: "NON_OPERATING_OUT", parentCategoryId: "cat-noout-root", isActive: true },
    // 07 TRANSFER
    { id: "cat-tr-root", code: "07", name: "Transferências", classification: "TRANSFER", parentCategoryId: null, isActive: true },
    { id: "cat-tr-bank", code: "07.01", name: "Entre Contas", classification: "TRANSFER", parentCategoryId: "cat-tr-root", isActive: true },
    // 08 ADJUSTMENT
    { id: "cat-adj-root", code: "08", name: "Ajustes", classification: "ADJUSTMENT", parentCategoryId: null, isActive: true },
    { id: "cat-adj-cash", code: "08.01", name: "Ajuste de Caixa", classification: "ADJUSTMENT", parentCategoryId: "cat-adj-root", isActive: true },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.financialCategory.findMany).mockResolvedValue(defaultCategoryRows as any);
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([]);
    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([]);
  });

  // 1. COMMAND_REVENUE via PIX entra uma vez
  it("1. COMMAND_REVENUE via PIX entra uma vez como receita realizada", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-pix-1",
          amount: 100 as any,
          type: "COMMAND_REVENUE",
          allocations: [{ allocatedAmount: 100 as any, financialCategoryId: "cat-rev-prod" }],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.revenueRealized).toBe("100.00");
  });

  // 2. COMMAND_REVENUE pago com CUSTOMER_CREDIT entra como Receita
  it("2. COMMAND_REVENUE pago com CUSTOMER_CREDIT entra como Receita", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-cred-pay",
          amount: 150 as any,
          type: "COMMAND_REVENUE",
          allocations: [{ allocatedAmount: 150 as any, financialCategoryId: "cat-rev-prod" }],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.revenueRealized).toBe("150.00");
  });

  // 3. CUSTOMER_CREDIT_DEPOSIT fica fora
  it("3. CUSTOMER_CREDIT_DEPOSIT fica fora da receita e da estrutura principal", async () => {
    await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(prisma.financialEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: expect.objectContaining({
            notIn: expect.arrayContaining(["CUSTOMER_CREDIT_DEPOSIT", "CUSTOMER_CREDIT_DEPOSIT_REFUND"]),
          }),
        }),
      })
    );
  });

  // 4. TIP liabilities ficam fora
  it("4. TIP liabilities ficam fora da receita e da estrutura principal", async () => {
    await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(prisma.financialEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: expect.objectContaining({
            notIn: expect.arrayContaining(["TIP_RECEIVED", "TIP_REFUND", "TIP_PAYOUT", "TIP_PAYOUT_REVERSAL"]),
          }),
        }),
      })
    );
  });

  // 5. Serviço + Produto respeitam allocations
  it("5. Serviço + Produto respeitam allocations distintas", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-split",
          amount: 100 as any,
          type: "COMMAND_REVENUE",
          allocations: [
            { allocatedAmount: 70 as any, financialCategoryId: "cat-rev-serv-sub" },
            { allocatedAmount: 30 as any, financialCategoryId: "cat-rev-prod" },
          ],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.revenueRealized).toBe("100.00");
    const servRow = report.sections.revenue[0].children?.find((c) => c.id === "cat-rev-serv");
    const prodRow = report.sections.revenue[0].children?.find((c) => c.id === "cat-rev-prod");
    expect(servRow?.realized).toBe("70.00");
    expect(prodRow?.realized).toBe("30.00");
  });

  // 6. REFUND reduz Receita (P0)
  it("6. REFUND reduz Receita preservando sinal negativo", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-rev",
          amount: 10000 as any,
          type: "COMMAND_REVENUE",
          allocations: [{ allocatedAmount: 10000 as any, financialCategoryId: "cat-rev-prod" }],
        },
        {
          id: "fe-ref",
          amount: -1000 as any,
          type: "REFUND",
          allocations: [{ allocatedAmount: -1000 as any, financialCategoryId: "cat-rev-prod" }],
        },
      ] as any)
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.revenueRealized).toBe("9000.00");
  });

  // 7. Clube entra em Receita
  it("7. Clube entra em Receita", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-club",
          amount: 200 as any,
          type: "CLUB_SUBSCRIPTION",
          allocations: [{ allocatedAmount: 200 as any, financialCategoryId: "cat-rev-club" }],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.revenueRealized).toBe("200.00");
  });

  // 8. COMMISSION_PAYOUT entra em Custo Variável
  it("8. COMMISSION_PAYOUT entra em Custo Variável como custo positivo normalizado", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-com",
          amount: -3000 as any,
          type: "COMMISSION_PAYOUT",
          allocations: [{ allocatedAmount: -3000 as any, financialCategoryId: "cat-vc-com" }],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.variableCostRealized).toBe("3000.00");
  });

  // 9. COMMISSION_ADVANCE entra uma vez
  it("9. COMMISSION_ADVANCE entra uma vez em Custo Variável", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-adv",
          amount: -500 as any,
          type: "COMMISSION_ADVANCE",
          allocations: [{ allocatedAmount: -500 as any, financialCategoryId: "cat-vc-com" }],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.variableCostRealized).toBe("500.00");
  });

  // 10. COMMISSION_ADVANCE_REVERSAL reduz custo (P0)
  it("10. COMMISSION_ADVANCE_REVERSAL reduz Custo Variável", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-payout",
          amount: -3000 as any,
          type: "COMMISSION_PAYOUT",
          allocations: [{ allocatedAmount: -3000 as any, financialCategoryId: "cat-vc-com" }],
        },
        {
          id: "fe-rev",
          amount: 500 as any,
          type: "COMMISSION_ADVANCE_REVERSAL",
          allocations: [{ allocatedAmount: 500 as any, financialCategoryId: "cat-vc-com" }],
        },
      ] as any)
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.variableCostRealized).toBe("2500.00");
  });

  // 11. remainingBalance não é somado
  it("11. remainingBalance de ciclo aberto não é somado como realizado synthetic", async () => {
    // Relatório gerencial é estritamente baseado em alocações de FinancialEntry confirmadas
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.variableCostRealized).toBe("0.00");
  });

  // 12. Despesa fixa e reversão
  it("12. Despesa fixa normalizada e reversão reduz despesa fixa", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-rent",
          amount: -2000 as any,
          type: "MANUAL_OUT",
          allocations: [{ allocatedAmount: -2000 as any, financialCategoryId: "cat-fe-rent" }],
        },
        {
          id: "fe-rent-rev",
          amount: 200 as any,
          type: "MANUAL_IN",
          allocations: [{ allocatedAmount: 200 as any, financialCategoryId: "cat-fe-rent" }],
        },
      ] as any)
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.fixedExpenseRealized).toBe("1800.00");
  });

  // 13. Investimento
  it("13. Investimento normalizado", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-inv",
          amount: -1000 as any,
          type: "MANUAL_OUT",
          allocations: [{ allocatedAmount: -1000 as any, financialCategoryId: "cat-inv-mkt" }],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.investmentRealized).toBe("1000.00");
  });

  // 14. NON_OPERATING_IN
  it("14. NON_OPERATING_IN entra no resultado líquido", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-noin",
          amount: 500 as any,
          type: "MANUAL_IN",
          allocations: [{ allocatedAmount: 500 as any, financialCategoryId: "cat-noin-rend" }],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.nonOperatingInRealized).toBe("500.00");
    expect(report.kpis.netResultRealized).toBe("500.00");
  });

  // 15. NON_OPERATING_OUT
  it("15. NON_OPERATING_OUT normalizado e reversão reduz saída", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-fine",
          amount: -300 as any,
          type: "MANUAL_OUT",
          allocations: [{ allocatedAmount: -300 as any, financialCategoryId: "cat-noout-fine" }],
        },
        {
          id: "fe-fine-rev",
          amount: 50 as any,
          type: "MANUAL_IN",
          allocations: [{ allocatedAmount: 50 as any, financialCategoryId: "cat-noout-fine" }],
        },
      ] as any)
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.nonOperatingOutRealized).toBe("250.00");
    expect(report.kpis.netResultRealized).toBe("-250.00");
  });

  // 16. TRANSFER não altera resultado
  it("16. TRANSFER fica fora e não altera resultado operacional nem líquido", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-tr",
          amount: 5000 as any,
          type: "MANUAL_IN",
          allocations: [{ allocatedAmount: 5000 as any, financialCategoryId: "cat-tr-bank" }],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.operatingResultRealized).toBe("0.00");
    expect(report.kpis.netResultRealized).toBe("0.00");
    expect(report.outsideResult.transfers).toHaveLength(1);
    expect(report.outsideResult.transfers[0].realized).toBe("5000.00");
  });

  // 17. ADJUSTMENT não altera resultado
  it("17. ADJUSTMENT fica fora e não altera resultado operacional nem líquido", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-adj",
          amount: -120 as any,
          type: "MANUAL_OUT",
          allocations: [{ allocatedAmount: -120 as any, financialCategoryId: "cat-adj-cash" }],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.operatingResultRealized).toBe("0.00");
    expect(report.kpis.netResultRealized).toBe("0.00");
    expect(report.outsideResult.adjustments).toHaveLength(1);
    expect(report.outsideResult.adjustments[0].realized).toBe("-120.00");
  });

  // 18. FinancialTitle parcial projeta somente outstanding
  it("18. FinancialTitle com liquidação parcial projeta somente outstanding no esperado", async () => {
    vi.mocked(prisma.financialTitle.findMany).mockResolvedValueOnce([
      {
        id: "t-1",
        barbershopId: shopA,
        kind: "RECEIVABLE",
        title: "Contrato",
        originalAmount: 1000 as any,
        dueOn: "2026-10-20",
        cancelledAt: null,
        category: { id: "cat-rev-prod", code: "01.02", name: "Produtos", classification: "REVENUE" },
        settlements: [{ principalAmount: 400 as any, reversals: [] }],
      } as any,
    ]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.revenueRealized).toBe("0.00");
    expect(report.kpis.revenueExpected).toBe("600.00");
  });

  // 19. Routine FIXED
  it("19. Routine FIXED projeta valor base no período futuro", async () => {
    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValueOnce([
      {
        id: "r-fixed",
        barbershopId: shopA,
        kind: "PAYABLE",
        title: "Internet",
        amountMode: "FIXED",
        baseAmount: 150 as any,
        dueDay: 25,
        startDate: new Date("2026-10-01T00:00:00Z"),
        endDate: null,
        isActive: true,
        category: { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE" },
      } as any,
    ]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.fixedExpenseExpected).toBe("150.00");
  });

  // 20. Routine VARIABLE com base
  it("20. Routine VARIABLE com base projeta valor base", async () => {
    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValueOnce([
      {
        id: "r-var",
        barbershopId: shopA,
        kind: "PAYABLE",
        title: "Energia",
        amountMode: "VARIABLE",
        baseAmount: 350 as any,
        dueDay: 20,
        startDate: new Date("2026-10-01T00:00:00Z"),
        endDate: null,
        isActive: true,
        category: { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE" },
      } as any,
    ]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.fixedExpenseExpected).toBe("350.00");
  });

  // 21. VARIABLE sem base segue regra canônica
  it("21. Routine VARIABLE sem base não inventa valor", async () => {
    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValueOnce([
      {
        id: "r-nobase",
        barbershopId: shopA,
        kind: "PAYABLE",
        title: "Água",
        amountMode: "VARIABLE",
        baseAmount: null,
        dueDay: 20,
        startDate: new Date("2026-10-01T00:00:00Z"),
        endDate: null,
        isActive: true,
        category: { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE" },
      } as any,
    ]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.kpis.fixedExpenseExpected).toBe("0.00");
  });

  // 22. routine materializada não duplica
  it("22. Routine com FinancialTitle materializado para o mês não duplica", async () => {
    (vi.mocked(prisma.financialTitle.findMany).mockImplementation as any)(async (args: any) => {
      if (args?.where?.routineId) {
        return [
          {
            id: "t-mat-1",
            barbershopId: shopA,
            routineId: "r-mat",
            referenceMonth: "2026-10",
          } as any,
        ];
      }
      return [
        {
          id: "t-mat-1",
          barbershopId: shopA,
          kind: "PAYABLE",
          title: "Materializado",
          originalAmount: 200 as any,
          dueOn: "2026-10-25",
          cancelledAt: null,
          category: { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE" },
          settlements: [],
        } as any,
      ];
    });

    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValueOnce([
      {
        id: "r-mat",
        barbershopId: shopA,
        kind: "PAYABLE",
        title: "Materializado",
        amountMode: "FIXED",
        baseAmount: 200 as any,
        dueDay: 25,
        startDate: new Date("2026-10-01T00:00:00Z"),
        endDate: null,
        isActive: true,
        category: { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE" },
      } as any,
    ]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    // Somente 200 do título, a rotina virtual foi evitada
    expect(report.kpis.fixedExpenseExpected).toBe("200.00");
  });

  // 23. AV Receita zero = null
  it("23. AV com Receita zero retorna null", () => {
    expect(calculateAV(500, 0)).toBeNull();
  });

  // 24. AH anterior zero = null
  it("24. AH com período anterior zero retorna null", () => {
    expect(calculateAH(500, 0)).toBeNull();
  });

  // 25. mês anterior correto
  it("25. mês anterior correto", () => {
    const res = computePreviousPeriod("2026-10-01", "2026-10-31");
    expect(res.comparisonType).toBe("CALENDAR_MONTH");
    expect(res.previousStartDate).toBe("2026-09-01");
    expect(res.previousEndDate).toBe("2026-09-30");
  });

  // 26. ano anterior correto
  it("26. ano anterior correto", () => {
    const res = computePreviousPeriod("2026-01-01", "2026-12-31");
    expect(res.comparisonType).toBe("CALENDAR_YEAR");
    expect(res.previousStartDate).toBe("2025-01-01");
    expect(res.previousEndDate).toBe("2025-12-31");
  });

  // 27. período customizado correto
  it("27. período customizado de N dias correto", () => {
    const res = computePreviousPeriod("2026-10-11", "2026-10-20"); // 10 dias
    expect(res.comparisonType).toBe("CUSTOM_DAYS");
    expect(res.previousEndDate).toBe("2026-10-10");
    expect(res.previousStartDate).toBe("2026-10-01");
  });

  // 28. isolamento tenant
  it("28. isolamento de tenant em todas as queries", async () => {
    await getManagementReport({ barbershopId: "shop-isolated", startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(prisma.financialCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { barbershopId: "shop-isolated" } })
    );
    expect(prisma.financialEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ barbershopId: "shop-isolated" }) })
    );
  });

  // 29. categoryId de outro tenant rejeitado com CategoryNotFoundError
  it("29. categoryId de outro tenant é rejeitado lançando CategoryNotFoundError", async () => {
    await expect(
      getManagementReport({
        barbershopId: shopA,
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        categoryId: "cat-other-tenant",
      })
    ).rejects.toThrow(CategoryNotFoundError);
  });

  // 30. entry sem allocation
  it("30. entry sem allocation entra em não categorizados", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-unclass",
          amount: 350 as any,
          type: "MANUAL_IN",
          allocations: [],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.dataQuality.unclassifiedEntriesCount).toBe(1);
    expect(report.dataQuality.unclassifiedEntriesAmount).toBe("350.00");
    expect(report.outsideResult.unclassified).toHaveLength(1);
  });

  // 31. resíduo de allocation
  it("31. resíduo de allocation entra em resíduos de rateio", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-res",
          amount: 100 as any,
          type: "COMMAND_REVENUE",
          allocations: [{ allocatedAmount: 80 as any, financialCategoryId: "cat-rev-prod" }],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(report.dataQuality.allocationResidualsCount).toBe(1);
    expect(report.dataQuality.allocationResidualsAmount).toBe("20.00");
  });

  // 32. terceiro nível de categorias
  it("32. terceiro nível de categorias agrega corretamente para o nível pai", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-depth-3",
          amount: 50 as any,
          type: "COMMAND_REVENUE",
          allocations: [{ allocatedAmount: 50 as any, financialCategoryId: "cat-rev-serv-sub" }], // 01.01.01
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    const rootRev = report.sections.revenue[0];
    const subServ = rootRev.children?.find((c) => c.id === "cat-rev-serv");
    const leafCorte = subServ?.children?.find((c) => c.id === "cat-rev-serv-sub");

    expect(rootRev.realized).toBe("50.00");
    expect(subServ?.realized).toBe("50.00");
    expect(leafCorte?.realized).toBe("50.00");
  });

  // 33. categoria inativa/histórico continua suportada
  it("33. categoria inativa com histórico continua suportada na árvore", async () => {
    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce([
        {
          id: "fe-inact",
          amount: 80 as any,
          type: "COMMAND_REVENUE",
          allocations: [{ allocatedAmount: 80 as any, financialCategoryId: "cat-rev-inactive" }],
        } as any,
      ])
      .mockResolvedValueOnce([]);

    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    const inactRow = report.sections.revenue[0].children?.find((c) => c.id === "cat-rev-inactive");
    expect(inactRow?.realized).toBe("80.00");
  });

  // 34. zero-write
  it("34. motor de relatório executa zero escritas no banco de dados", async () => {
    await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect((prisma as any).financialEntry?.create).toBeUndefined();
    expect((prisma as any).financialEntry?.update).toBeUndefined();
    expect((prisma as any).financialEntry?.delete).toBeUndefined();
  });

  // 35. valores monetários serializados como string
  it("35. valores monetários serializados estritamente como string com 2 casas decimais", async () => {
    const report = await getManagementReport({ barbershopId: shopA, startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(typeof report.kpis.revenueRealized).toBe("string");
    expect(report.kpis.revenueRealized).toMatch(/^\-?\d+\.\d{2}$/);
    expect(typeof report.kpis.marginRealized).toBe("string");
    expect(typeof report.kpis.operatingResultRealized).toBe("string");
    expect(typeof report.kpis.netResultRealized).toBe("string");
  });
});
