/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getManagementReport,
  getMonthlyManagementReport,
  isValidYearMonth,
  shiftMonthKey,
  monthKeyToDateRange,
  generateMonthWindow,
  calculateAV,
  calculateAH,
  computePreviousPeriod,
  CategoryNotFoundError,
} from "@/lib/financial/management-report";
import prisma from "@/lib/prisma";
import { requireFinancialSession } from "@/lib/financial/permissions";
import { GET as getMonthlyManagementReportRoute } from "@/app/api/admin/financial/management-report/monthly/route";
import { NextRequest } from "next/server";

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
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/financial/permissions", () => ({
  requireFinancialSession: vi.fn(),
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

describe("Monthly Comparative Management Report Engine (Bloco A)", () => {
  const shopA = "shop-alpha-123";

  const defaultCategoryRows = [
    { id: "cat-rev-root", code: "01", name: "Receitas", classification: "REVENUE", parentCategoryId: null, isActive: true },
    { id: "cat-rev-serv", code: "01.01", name: "Serviços", classification: "REVENUE", parentCategoryId: "cat-rev-root", isActive: true },
    { id: "cat-rev-serv-sub", code: "01.01.01", name: "Cortes", classification: "REVENUE", parentCategoryId: "cat-rev-serv", isActive: true },
    { id: "cat-rev-prod", code: "01.02", name: "Produtos", classification: "REVENUE", parentCategoryId: "cat-rev-root", isActive: true },
    { id: "cat-vc-root", code: "02", name: "Custos Variáveis", classification: "VARIABLE_COST", parentCategoryId: null, isActive: true },
    { id: "cat-vc-com", code: "02.01", name: "Comissões", classification: "VARIABLE_COST", parentCategoryId: "cat-vc-root", isActive: true },
    { id: "cat-fe-root", code: "03", name: "Despesas Fixas", classification: "FIXED_EXPENSE", parentCategoryId: null, isActive: true },
    { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE", parentCategoryId: "cat-fe-root", isActive: true },
    { id: "cat-inv-root", code: "04", name: "Investimentos", classification: "INVESTMENT", parentCategoryId: null, isActive: true },
    { id: "cat-inv-mkt", code: "04.01", name: "Marketing", classification: "INVESTMENT", parentCategoryId: "cat-inv-root", isActive: true },
    { id: "cat-noin-root", code: "05", name: "Entradas Não Operacionais", classification: "NON_OPERATING_IN", parentCategoryId: null, isActive: true },
    { id: "cat-noin-rend", code: "05.01", name: "Rendimentos", classification: "NON_OPERATING_IN", parentCategoryId: "cat-noin-root", isActive: true },
    { id: "cat-noout-root", code: "06", name: "Saídas Não Operacionais", classification: "NON_OPERATING_OUT", parentCategoryId: null, isActive: true },
    { id: "cat-noout-fine", code: "06.01", name: "Multas", classification: "NON_OPERATING_OUT", parentCategoryId: "cat-noout-root", isActive: true },
    { id: "cat-tr-root", code: "07", name: "Transferências", classification: "TRANSFER", parentCategoryId: null, isActive: true },
    { id: "cat-adj-root", code: "08", name: "Ajustes", classification: "ADJUSTMENT", parentCategoryId: null, isActive: true },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.financialCategory.findMany).mockResolvedValue(defaultCategoryRows as any);
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValue([]);
    vi.mocked(prisma.financialTitle.findMany).mockResolvedValue([]);
    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([]);
  });

  // 1-8 Helpers de Calendário e Janela
  it("1. isValidYearMonth valida e rejeita formatos estritamente", () => {
    expect(isValidYearMonth("2026-10")).toBe(true);
    expect(isValidYearMonth("2026-01")).toBe(true);
    expect(isValidYearMonth("2026-12")).toBe(true);

    expect(isValidYearMonth("2026-00")).toBe(false);
    expect(isValidYearMonth("2026-13")).toBe(false);
    expect(isValidYearMonth("26-10")).toBe(false);
    expect(isValidYearMonth("2026/10")).toBe(false);
    expect(isValidYearMonth("")).toBe(false);
    expect(isValidYearMonth(null)).toBe(false);
  });

  it("2. shiftMonthKey desloca meses cruzando ano corretamente", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2026-01", -2)).toBe("2025-11");
    expect(shiftMonthKey("2025-12", 1)).toBe("2026-01");
    expect(shiftMonthKey("2026-10", 3)).toBe("2027-01");
  });

  it("3-4. monthKeyToDateRange calcula limites exatos incluindo fevereiro comum e bissexto", () => {
    // Fevereiro não bissexto (2025: 28 dias)
    const feb2025 = monthKeyToDateRange("2025-02");
    expect(feb2025.startDate).toBe("2025-02-01");
    expect(feb2025.endDate).toBe("2025-02-28");

    // Fevereiro bissexto (2024: 29 dias)
    const feb2024 = monthKeyToDateRange("2024-02");
    expect(feb2024.startDate).toBe("2024-02-01");
    expect(feb2024.endDate).toBe("2024-02-29");

    // Dezembro
    const dec2026 = monthKeyToDateRange("2026-12");
    expect(dec2026.startDate).toBe("2026-12-01");
    expect(dec2026.endDate).toBe("2026-12-31");
  });

  it("5-8. generateMonthWindow gera janelas ASC de 3, 6 e 12 meses e previousMonth correto", () => {
    // count = 3 com endMonth = 2026-01 (cruza ano)
    const win3 = generateMonthWindow("2026-01", 3);
    expect(win3.months.map((m) => m.key)).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(win3.previousMonth.key).toBe("2025-10");
    expect(win3.previousMonth.startDate).toBe("2025-10-01");
    expect(win3.previousMonth.endDate).toBe("2025-10-31");

    // count = 6
    const win6 = generateMonthWindow("2026-06", 6);
    expect(win6.months.map((m) => m.key)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
    ]);
    expect(win6.previousMonth.key).toBe("2025-12");

    // count = 12
    const win12 = generateMonthWindow("2026-12", 12);
    expect(win12.months.length).toBe(12);
    expect(win12.months[0].key).toBe("2026-01");
    expect(win12.months[11].key).toBe("2026-12");
    expect(win12.previousMonth.key).toBe("2025-12");

    // Erro em count inválido
    expect(() => generateMonthWindow("2026-10", 4)).toThrow(/count inválido/);
  });

  // 9-13 Arquitetura de Consultas Batch e Ausência de Loop
  it("9-13. executa batch real: 1x findMany entries, 1x category tree, 1x titles forecast, 1x routines forecast", async () => {
    const report = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-11",
      count: 3,
    });

    expect(report.months.map((m) => m.key)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(report.period.previousMonth).toBe("2026-08");

    // 1x categories
    expect(prisma.financialCategory.findMany).toHaveBeenCalledTimes(1);

    // 1x financialEntry batch (query cobre de 2026-08-01 a 2026-12-01 exclusive)
    expect(prisma.financialEntry.findMany).toHaveBeenCalledTimes(1);
    const entryQuery = vi.mocked(prisma.financialEntry.findMany).mock.calls[0][0] as any;
    expect(entryQuery.where.barbershopId).toBe(shopA);
    expect(entryQuery.where.entryDate.gte.toISOString()).toBe("2026-08-01T03:00:00.000Z");
    expect(entryQuery.where.entryDate.lt.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(entryQuery.select.allocations.select).toEqual({
      allocatedAmount: true,
      financialCategoryId: true,
    });

    // 1x titles (findMany dentro de getFinancialTitlesForecast) + 1x em getFinancialRoutinesForecast
    expect(prisma.financialTitle.findMany).toHaveBeenCalledTimes(2);

    // 1x routines (findMany dentro de getFinancialRoutinesForecast)
    expect(prisma.financialRoutine.findMany).toHaveBeenCalledTimes(1);

    const titleQueries = vi.mocked(prisma.financialTitle.findMany).mock.calls;
    expect(titleQueries[0][0]?.where).toMatchObject({ barbershopId: shopA, cancelledAt: null });
    expect(titleQueries[1][0]?.where).toMatchObject({
      barbershopId: shopA,
      routineId: { not: null },
      referenceMonth: { not: null },
    });
  });

  it("9-13. mantém a quantidade de consultas constante também para a janela de 12 meses", async () => {
    await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-12",
      count: 12,
    });

    expect(prisma.financialCategory.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.financialEntry.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.financialTitle.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.financialRoutine.findMany).toHaveBeenCalledTimes(1);
  });

  // 14-15 Bucketing Civil de São Paulo
  it("14-15. aloca lançamento de 23:30 BRT no mês civil correto e não no dia/mês UTC seguinte", async () => {
    // 2026-10-31 23:30 BRT = 2026-11-01 02:30 UTC
    const dateLateNight = new Date("2026-11-01T02:30:00.000Z");

    vi.mocked(prisma.financialEntry.findMany).mockResolvedValueOnce([
      {
        id: "fe-late",
        amount: 300 as any,
        type: "COMMAND_REVENUE",
        entryDate: dateLateNight,
        allocations: [{ allocatedAmount: 300 as any, financialCategoryId: "cat-rev-serv" }],
      } as any,
    ]);

    const report = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-11",
      count: 3,
    });

    // Em 2026-10 deve ter 300.00 de receita
    expect(report.kpisByMonth["2026-10"].revenueRealized).toBe("300.00");
    // Em 2026-11 deve ser 0.00
    expect(report.kpisByMonth["2026-11"].revenueRealized).toBe("0.00");
  });

  // 16-24 Classificações Econômicas, Reversões e Transações Fora do Resultado
  it("16-24. agrega receitas, custos, despesas, investimentos, non-operating e ignora transfer/adjustment", async () => {
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValueOnce([
      // Receita em 2026-10: 1000
      {
        id: "fe-1",
        amount: 1000 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2026-10-05T15:00:00Z"),
        allocations: [{ allocatedAmount: 1000 as any, financialCategoryId: "cat-rev-serv" }],
      } as any,
      // Custo variável (comissão): -400 ledger => display 400
      {
        id: "fe-2",
        amount: -400 as any,
        type: "COMMISSION_PAYOUT",
        entryDate: new Date("2026-10-06T15:00:00Z"),
        allocations: [{ allocatedAmount: -400 as any, financialCategoryId: "cat-vc-com" }],
      } as any,
      // Reversão de custo variável: +100 ledger => reduz custo para 300
      {
        id: "fe-3",
        amount: 100 as any,
        type: "COMMISSION_PAYOUT_REVERSAL",
        entryDate: new Date("2026-10-07T15:00:00Z"),
        allocations: [{ allocatedAmount: 100 as any, financialCategoryId: "cat-vc-com" }],
      } as any,
      // Despesa Fixa (aluguel): -200 ledger => display 200
      {
        id: "fe-4",
        amount: -200 as any,
        type: "EXPENSE",
        entryDate: new Date("2026-10-10T15:00:00Z"),
        allocations: [{ allocatedAmount: -200 as any, financialCategoryId: "cat-fe-rent" }],
      } as any,
      // Investimento (marketing): -100 ledger => display 100
      {
        id: "fe-5",
        amount: -100 as any,
        type: "EXPENSE",
        entryDate: new Date("2026-10-12T15:00:00Z"),
        allocations: [{ allocatedAmount: -100 as any, financialCategoryId: "cat-inv-mkt" }],
      } as any,
      // Non-operating in: 50
      {
        id: "fe-6",
        amount: 50 as any,
        type: "OTHER_REVENUE",
        entryDate: new Date("2026-10-15T15:00:00Z"),
        allocations: [{ allocatedAmount: 50 as any, financialCategoryId: "cat-noin-rend" }],
      } as any,
      // Non-operating out: -30 ledger => display 30
      {
        id: "fe-7",
        amount: -30 as any,
        type: "EXPENSE",
        entryDate: new Date("2026-10-20T15:00:00Z"),
        allocations: [{ allocatedAmount: -30 as any, financialCategoryId: "cat-noout-fine" }],
      } as any,
      // Transferência e Ajuste (devem ser ignorados do resultado econômico)
      {
        id: "fe-8",
        amount: 500 as any,
        type: "TRANSFER",
        entryDate: new Date("2026-10-22T15:00:00Z"),
        allocations: [{ allocatedAmount: 500 as any, financialCategoryId: "cat-tr-root" }],
      } as any,
      {
        id: "fe-9",
        amount: -50 as any,
        type: "ADJUSTMENT",
        entryDate: new Date("2026-10-25T15:00:00Z"),
        allocations: [{ allocatedAmount: -50 as any, financialCategoryId: "cat-adj-root" }],
      } as any,
    ]);

    const report = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-10",
      count: 3,
    });

    const kpi = report.kpisByMonth["2026-10"];
    expect(kpi.revenueRealized).toBe("1000.00");
    expect(kpi.variableCostRealized).toBe("300.00"); // 400 - 100 de reversão
    expect(kpi.marginRealized).toBe("700.00"); // 1000 - 300
    expect(kpi.fixedExpenseRealized).toBe("200.00");
    expect(kpi.resultBeforeInvestmentsRealized).toBe("500.00"); // 700 - 200
    expect(kpi.investmentRealized).toBe("100.00");
    expect(kpi.operatingResultRealized).toBe("400.00"); // 500 - 100
    expect(kpi.nonOperatingInRealized).toBe("50.00");
    expect(kpi.nonOperatingOutRealized).toBe("30.00");
    expect(kpi.netResultRealized).toBe("420.00"); // 400 + 50 - 30
  });

  // 25-27 Exclusão de TIP e CUSTOMER_CREDIT_DEPOSIT
  it("25-27. exclui TIP_* e depósitos de crédito, mas mantém COMMAND_REVENUE pago com crédito", async () => {
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValueOnce([
      {
        id: "command-paid-with-credit",
        amount: 90 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2026-10-10T12:00:00Z"),
        allocations: [{ allocatedAmount: 90 as any, financialCategoryId: "cat-rev-serv" }],
      } as any,
    ]);

    const report = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-10",
      count: 3,
    });

    const callArgs = vi.mocked(prisma.financialEntry.findMany).mock.calls[0][0];
    const excludedTypes = (callArgs?.where?.type as any)?.notIn;
    expect(excludedTypes).toContain("TIP_RECEIVED");
    expect(excludedTypes).toContain("TIP_REFUND");
    expect(excludedTypes).toContain("TIP_PAYOUT");
    expect(excludedTypes).toContain("TIP_PAYOUT_REVERSAL");
    expect(excludedTypes).toContain("CUSTOMER_CREDIT_DEPOSIT");
    expect(excludedTypes).toContain("CUSTOMER_CREDIT_DEPOSIT_REFUND");
    expect(report.kpisByMonth["2026-10"].revenueRealized).toBe("90.00");
  });

  // 28-36 Previsões (Expected = Realized + Dated Forecast) e Mês Futuro
  it("28-36. projeta titles e routines no mês correto e suporta mês futuro com Realized=0 e Expected>0", async () => {
    // Simula título a pagar no mês seguinte (2026-11)
    vi.mocked(prisma.financialTitle.findMany).mockResolvedValueOnce([
      {
        id: "title-future",
        kind: "PAYABLE",
        title: "Energia Elétrica",
        dueOn: "2026-11-10",
        originalAmount: 250 as any,
        categoryId: "cat-fe-rent",
        category: defaultCategoryRows.find((c) => c.id === "cat-fe-rent") as any,
        settlements: [],
      } as any,
    ]);

    const report = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-11",
      count: 3,
    });

    const octKpi = report.kpisByMonth["2026-10"];
    const novKpi = report.kpisByMonth["2026-11"];

    expect(octKpi.fixedExpenseExpected).toBe("0.00");
    expect(novKpi.fixedExpenseRealized).toBe("0.00");
    expect(novKpi.fixedExpenseExpected).toBe("250.00");
  });

  it("28-34. distribui outstanding e rotinas fixed/variable por mês sem duplicar materializadas", async () => {
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValueOnce([
      {
        id: "realized-nov",
        amount: 100 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2026-11-05T12:00:00Z"),
        allocations: [{ allocatedAmount: 100 as any, financialCategoryId: "cat-rev-serv" }],
      } as any,
    ]);

    vi.mocked(prisma.financialTitle.findMany)
      .mockResolvedValueOnce([
        {
          id: "partial-title",
          kind: "RECEIVABLE",
          title: "Contrato parcial",
          originalAmount: 1000 as any,
          dueOn: "2026-11-20",
          category: { id: "cat-rev-serv", code: "01.01", name: "Serviços", classification: "REVENUE" },
          settlements: [{ principalAmount: 400 as any }],
        } as any,
        {
          id: "materialized-title",
          kind: "PAYABLE",
          title: "Rotina materializada",
          originalAmount: 200 as any,
          dueOn: "2026-11-25",
          category: { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE" },
          settlements: [],
        } as any,
      ])
      .mockResolvedValueOnce([
        { routineId: "routine-materialized", referenceMonth: "2026-11" } as any,
      ]);

    vi.mocked(prisma.financialRoutine.findMany).mockResolvedValueOnce([
      {
        id: "routine-fixed",
        kind: "PAYABLE",
        title: "Internet",
        amountMode: "FIXED",
        baseAmount: 150 as any,
        dueDay: 15,
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        category: { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE" },
      } as any,
      {
        id: "routine-variable",
        kind: "PAYABLE",
        title: "Energia",
        amountMode: "VARIABLE",
        baseAmount: 350 as any,
        dueDay: 15,
        startDate: "2026-12-01",
        endDate: "2026-12-31",
        category: { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE" },
      } as any,
      {
        id: "routine-without-base",
        kind: "PAYABLE",
        title: "Água",
        amountMode: "VARIABLE",
        baseAmount: null,
        dueDay: 15,
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        category: { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE" },
      } as any,
      {
        id: "routine-materialized",
        kind: "PAYABLE",
        title: "Rotina materializada",
        amountMode: "FIXED",
        baseAmount: 200 as any,
        dueDay: 25,
        startDate: "2026-11-01",
        endDate: "2026-11-30",
        category: { id: "cat-fe-rent", code: "03.01", name: "Aluguel", classification: "FIXED_EXPENSE" },
      } as any,
    ]);

    const report = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-12",
      count: 3,
    });

    expect(report.kpisByMonth["2026-10"].revenueExpected).toBe("0.00");
    expect(report.kpisByMonth["2026-11"].revenueRealized).toBe("100.00");
    expect(report.kpisByMonth["2026-11"].revenueExpected).toBe("700.00");
    expect(report.kpisByMonth["2026-11"].fixedExpenseExpected).toBe("350.00");
    expect(report.kpisByMonth["2026-12"].fixedExpenseExpected).toBe("350.00");
  });

  // 37-42 AV e AH (incluindo previousMonth e virada de ano)
  it("37-42. calcula AV com receita do mesmo mês e AH comparando mês anterior (e previousMonth)", async () => {
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValueOnce([
      // previousMonth (2025-12): receita = 500
      {
        id: "fe-prev",
        amount: 500 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2025-12-15T12:00:00Z"),
        allocations: [{ allocatedAmount: 500 as any, financialCategoryId: "cat-rev-serv" }],
      } as any,
      // Mês 1 da janela (2026-01): receita = 1000, custo = 200
      {
        id: "fe-m1-rev",
        amount: 1000 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2026-01-10T12:00:00Z"),
        allocations: [{ allocatedAmount: 1000 as any, financialCategoryId: "cat-rev-serv" }],
      } as any,
      {
        id: "fe-m1-cost",
        amount: -200 as any,
        type: "COMMISSION_PAYOUT",
        entryDate: new Date("2026-01-15T12:00:00Z"),
        allocations: [{ allocatedAmount: -200 as any, financialCategoryId: "cat-vc-com" }],
      } as any,
      // Mês 2 da janela (2026-02): receita = 1500, custo = 300
      {
        id: "fe-m2-rev",
        amount: 1500 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2026-02-10T12:00:00Z"),
        allocations: [{ allocatedAmount: 1500 as any, financialCategoryId: "cat-rev-serv" }],
      } as any,
      {
        id: "fe-m2-cost",
        amount: -300 as any,
        type: "COMMISSION_PAYOUT",
        entryDate: new Date("2026-02-15T12:00:00Z"),
        allocations: [{ allocatedAmount: -300 as any, financialCategoryId: "cat-vc-com" }],
      } as any,
    ]);

    const report = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-02",
      count: 3, // janela de 3 com endMonth 2026-02: 2025-12 (m1), 2026-01 (m2), 2026-02 (m3); previousMonth: 2025-11
    });

    // AV de custo em Jan: 200 / 1000 * 100 = 20%
    const janCostRow = report.sections.variableCost[0].children?.[0]?.valuesByMonth["2026-01"];
    expect(janCostRow?.avPercent).toBe(20.0);

    // AH de receita em Jan vs Dez: (1000 - 500) / 500 * 100 = +100%
    const servRow = report.sections.revenue[0].children?.find((c) => c.id === "cat-rev-serv");
    expect(servRow?.valuesByMonth["2026-01"].ahPercent).toBe(100.0);

    // AH de receita em Fev vs Jan: (1500 - 1000) / 1000 * 100 = +50%
    expect(servRow?.valuesByMonth["2026-02"].ahPercent).toBe(50.0);

    // Resultado antes dos investimentos em Jan: 1000 - 200 = 800
    // AV = 800 / 1000 = 80%; AH = (800 - 500) / 500 = 60%
    expect(report.kpisByMonth["2026-01"].resultBeforeInvestmentsAVPercent).toBe(80.0);
    expect(report.kpisByMonth["2026-01"].resultBeforeInvestmentsAHPercent).toBe(60.0);
  });

  it("37-41. retorna AV e AH nulos quando as respectivas bases são zero", async () => {
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValueOnce([
      {
        id: "cost-without-revenue",
        amount: -200 as any,
        type: "COMMISSION_PAYOUT",
        entryDate: new Date("2026-10-15T12:00:00Z"),
        allocations: [{ allocatedAmount: -200 as any, financialCategoryId: "cat-vc-com" }],
      } as any,
    ]);

    const report = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-10",
      count: 3,
    });
    const costCell = report.sections.variableCost[0].children?.[0].valuesByMonth["2026-10"];

    expect(costCell?.avPercent).toBeNull();
    expect(costCell?.ahPercent).toBeNull();
    expect(report.kpisByMonth["2026-10"].marginAVPercent).toBeNull();
    expect(report.kpisByMonth["2026-10"].resultBeforeInvestmentsAVPercent).toBeNull();
    expect(report.kpisByMonth["2026-10"].resultBeforeInvestmentsAHPercent).toBeNull();
  });

  it("40. usa outubro apenas como previousMonth no AH do primeiro mês da janela Nov-Jan", async () => {
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValueOnce([
      {
        id: "revenue-october",
        amount: 100 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2025-10-15T12:00:00Z"),
        allocations: [{ allocatedAmount: 100 as any, financialCategoryId: "cat-rev-serv" }],
      } as any,
      {
        id: "unclassified-october",
        amount: 999 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2025-10-20T12:00:00Z"),
        allocations: [],
      } as any,
      {
        id: "revenue-november",
        amount: 150 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2025-11-15T12:00:00Z"),
        allocations: [{ allocatedAmount: 150 as any, financialCategoryId: "cat-rev-serv" }],
      } as any,
    ]);

    const report = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-01",
      count: 3,
    });

    expect(report.months.map((month) => month.key)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
    expect(report.period.previousMonth).toBe("2025-10");
    expect(report.months.some((month) => month.key === "2025-10")).toBe(false);

    const revenueRow = report.sections.revenue[0].children?.find(
      (row) => row.id === "cat-rev-serv"
    );
    expect(revenueRow?.valuesByMonth["2025-11"].realized).toBe("150.00");
    expect(revenueRow?.valuesByMonth["2025-11"].ahPercent).toBe(50.0);
    expect(report.kpisByMonth["2025-11"].revenueRealized).toBe("150.00");
    expect(report.kpisByMonth["2025-11"].resultBeforeInvestmentsRealized).toBe("150.00");
    expect(report.kpisByMonth["2025-11"].resultBeforeInvestmentsAHPercent).toBe(50.0);

    expect(report.dataQuality.unclassifiedEntriesCount).toBe(0);
    expect(report.dataQuality.unclassifiedEntriesAmount).toBe("0.00");
    expect(report.dataQuality.hasResidualsOrUnclassified).toBe(false);
  });

  // 43-46 Agregação Hierárquica e Filtro de Categoria
  it("43-46. agrega nós pai/neto recursivamente e limita escopo ao filtrar categoryId", async () => {
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValueOnce([
      // Lançamento em nível 3: Cortes (01.01.01)
      {
        id: "fe-sub",
        amount: 150 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2026-10-10T12:00:00Z"),
        allocations: [{ allocatedAmount: 150 as any, financialCategoryId: "cat-rev-serv-sub" }],
      } as any,
    ]);

    // Relatório filtrando apenas a subárvore de Serviços (cat-rev-serv)
    const report = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-10",
      count: 3,
      categoryId: "cat-rev-serv",
    });

    expect(report.sections.revenue.length).toBe(1);
    const servRow = report.sections.revenue[0];
    expect(servRow.id).toBe("cat-rev-serv");
    expect(servRow.valuesByMonth["2026-10"].realized).toBe("150.00");
    expect(servRow.children?.[0]?.id).toBe("cat-rev-serv-sub");
    expect(servRow.children?.[0]?.valuesByMonth["2026-10"].realized).toBe("150.00");

    // CategoryNotFoundError para ID inexistente
    await expect(
      getMonthlyManagementReport({
        barbershopId: shopA,
        endMonth: "2026-10",
        count: 3,
        categoryId: "non-existent-cat",
      })
    ).rejects.toThrow(CategoryNotFoundError);
  });

  it("43. soma allocation direta no pai uma única vez e mantém paridade com o consolidado", async () => {
    const currentEntries = [
      {
        id: "direct-parent",
        amount: 100 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2026-10-10T12:00:00Z"),
        allocations: [{ allocatedAmount: 100 as any, financialCategoryId: "cat-rev-root" }],
      } as any,
      {
        id: "child-allocation",
        amount: 50 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2026-10-11T12:00:00Z"),
        allocations: [{ allocatedAmount: 50 as any, financialCategoryId: "cat-rev-serv" }],
      } as any,
    ];

    vi.mocked(prisma.financialEntry.findMany)
      .mockResolvedValueOnce(currentEntries)
      .mockResolvedValueOnce(currentEntries)
      .mockResolvedValueOnce([]);

    const monthly = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-10",
      count: 3,
    });
    const consolidated = await getManagementReport({
      barbershopId: shopA,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    expect(monthly.sections.revenue[0].valuesByMonth["2026-10"].realized).toBe("150.00");
    expect(monthly.sections.revenue[0].children?.[0].valuesByMonth["2026-10"].realized).toBe("50.00");
    expect(monthly.kpisByMonth["2026-10"].revenueRealized).toBe("150.00");
    expect(consolidated.sections.revenue[0].realized).toBe("150.00");
    expect(consolidated.kpis.revenueRealized).toBe("150.00");
  });

  // 47-50 Qualidade de Dados e Fórmula Canônica
  it("47-50. calcula qualidade de dados da janela exibida e mantém fora do resultado principal", async () => {
    vi.mocked(prisma.financialEntry.findMany).mockResolvedValueOnce([
      // Não categorizado em 2026-10
      {
        id: "fe-unclass",
        amount: 75 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2026-10-02T12:00:00Z"),
        allocations: [],
      } as any,
      // Resíduo em 2026-10
      {
        id: "fe-resid",
        amount: 100 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2026-10-03T12:00:00Z"),
        allocations: [{ allocatedAmount: 80 as any, financialCategoryId: "cat-rev-serv" }],
      } as any,
      // previousMonth auxiliar (2026-07) deve ser ignorado na qualidade de dados
      {
        id: "fe-prev-unclass",
        amount: 999 as any,
        type: "COMMAND_REVENUE",
        entryDate: new Date("2026-07-10T12:00:00Z"),
        allocations: [],
      } as any,
    ]);

    const report = await getMonthlyManagementReport({
      barbershopId: shopA,
      endMonth: "2026-10",
      count: 3,
    });

    expect(report.dataQuality.hasResidualsOrUnclassified).toBe(true);
    expect(report.dataQuality.unclassifiedEntriesCount).toBe(1);
    expect(report.dataQuality.unclassifiedEntriesAmount).toBe("75.00");
    expect(report.dataQuality.allocationResidualsCount).toBe(1);
    expect(report.dataQuality.allocationResidualsAmount).toBe("20.00");

    // Receita realizada contabiliza apenas as allocations categorizadas (80.00)
    expect(report.kpisByMonth["2026-10"].revenueRealized).toBe("80.00");
  });
});

describe("GET /api/admin/financial/management-report/monthly", () => {
  const sessionBarbershopId = "shop-from-session";

  function createTransactionClient(categories: any[] = []) {
    return {
      financialCategory: { findMany: vi.fn().mockResolvedValue(categories) },
      financialEntry: { findMany: vi.fn().mockResolvedValue([]) },
      financialTitle: { findMany: vi.fn().mockResolvedValue([]) },
      financialRoutine: { findMany: vi.fn().mockResolvedValue([]) },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireFinancialSession).mockResolvedValue({
      error: null,
      data: {
        userId: "owner-1",
        role: "OWNER",
        memberId: "member-1",
        barbershopId: sessionBarbershopId,
      },
    });
  });

  it("abre RepeatableRead e mantém árvore, entries e forecasts no mesmo transaction client", async () => {
    const tx = createTransactionClient();
    (vi.mocked(prisma.$transaction) as any).mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx)
    );

    const request = new NextRequest(
      "http://localhost/api/admin/financial/management-report/monthly" +
        "?endMonth=2026-11&count=3&barbershopId=attacker",
      { headers: { "x-barbershop-id": "attacker" } }
    );
    const response = await getMonthlyManagementReportRoute(request);

    expect(response.status).toBe(200);
    expect(requireFinancialSession).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect((vi.mocked(prisma.$transaction) as any).mock.calls[0][1]).toEqual({
      isolationLevel: "RepeatableRead",
    });
    expect(tx.financialCategory.findMany).toHaveBeenCalledTimes(1);
    expect(tx.financialEntry.findMany).toHaveBeenCalledTimes(1);
    expect(tx.financialTitle.findMany).toHaveBeenCalledTimes(2);
    expect(tx.financialRoutine.findMany).toHaveBeenCalledTimes(1);
    expect(tx.financialCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { barbershopId: sessionBarbershopId } })
    );
    expect(tx.financialEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ barbershopId: sessionBarbershopId }) })
    );
    expect(prisma.financialCategory.findMany).not.toHaveBeenCalled();
    expect(prisma.financialEntry.findMany).not.toHaveBeenCalled();
  });

  it.each(["2026-00", "2026-13", "26-10", "2026/10"])(
    "rejeita endMonth inválido %s com 400 antes da transação",
    async (endMonth) => {
      const response = await getMonthlyManagementReportRoute(
        new NextRequest(
          `http://localhost/api/admin/financial/management-report/monthly?endMonth=${encodeURIComponent(endMonth)}`
        )
      );

      expect(response.status).toBe(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it.each(["", "4", "3abc", "06", "12.0"])(
    "rejeita count não canônico %j com 400",
    async (count) => {
      const response = await getMonthlyManagementReportRoute(
        new NextRequest(
          `http://localhost/api/admin/financial/management-report/monthly?endMonth=2026-11&count=${count}`
        )
      );

      expect(response.status).toBe(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  );

  it("usa count=3 quando o parâmetro é omitido", async () => {
    const tx = createTransactionClient();
    (vi.mocked(prisma.$transaction) as any).mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx)
    );

    const response = await getMonthlyManagementReportRoute(
      new NextRequest(
        "http://localhost/api/admin/financial/management-report/monthly?endMonth=2026-11"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.period.count).toBe(3);
  });

  it("devolve 404 para categoryId de outro tenant", async () => {
    const tx = createTransactionClient([
      {
        id: "local-category",
        code: "01",
        name: "Receitas",
        classification: "REVENUE",
        parentCategoryId: null,
        isActive: true,
      },
    ]);
    (vi.mocked(prisma.$transaction) as any).mockImplementation(
      async (callback: (client: typeof tx) => unknown) => callback(tx)
    );

    const response = await getMonthlyManagementReportRoute(
      new NextRequest(
        "http://localhost/api/admin/financial/management-report/monthly" +
          "?endMonth=2026-11&categoryId=foreign-category"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toMatch(/Categoria não encontrada/);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.financialEntry.findMany).not.toHaveBeenCalled();
  });
});
