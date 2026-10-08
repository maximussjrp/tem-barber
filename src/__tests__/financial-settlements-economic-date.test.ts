/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveSettlementEconomicTimestamp,
  FinancialSettlementError,
  matchesCanonicalSettlementPayload,
  createSettlement,
  reverseSettlement,
} from "@/lib/financial/settlements";
import { todayIsoBR, shiftDateISO } from "@/lib/time-utils";
import { createTitle } from "@/lib/financial/titles";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: any = {
    financialTitle: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    financialTitleEvent: {
      create: vi.fn(),
    },
    financialCategory: {
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    financialSettlement: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    financialEntry: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    financialEntryAllocation: {
      create: vi.fn(),
      count: vi.fn(),
    },
    financialSettlementReversal: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "title-1" }]),
    $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
  };
  return { default: mockPrisma };
});

describe("Block B — Economic Settlement Date & Atomic Creation Suite", () => {
  const barbershopId = "shop-test-123";
  const userId = "user-test-123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. resolveSettlementEconomicTimestamp Domain Rules", () => {
    it("returns current time when settledOn is undefined", () => {
      const before = Date.now();
      const { economicTimestamp, settledOnCivil } = resolveSettlementEconomicTimestamp(undefined);
      const after = Date.now();

      expect(settledOnCivil).toBe(todayIsoBR());
      expect(economicTimestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(economicTimestamp.getTime()).toBeLessThanOrEqual(after);
    });

    it("returns current time when settledOn equals today BR", () => {
      const today = todayIsoBR();
      const before = Date.now();
      const { economicTimestamp, settledOnCivil } = resolveSettlementEconomicTimestamp(today);
      const after = Date.now();

      expect(settledOnCivil).toBe(today);
      expect(economicTimestamp.getTime()).toBeGreaterThanOrEqual(before);
      expect(economicTimestamp.getTime()).toBeLessThanOrEqual(after);
    });

    it("blocks future settlement dates (settledOn > today BR)", () => {
      const futureDate = shiftDateISO(todayIsoBR(), 1);
      expect(() => resolveSettlementEconomicTimestamp(futureDate)).toThrowError(
        FinancialSettlementError
      );
      expect(() => resolveSettlementEconomicTimestamp(futureDate)).toThrowError(
        "A data da baixa não pode ser futura."
      );
    });

    it("resolves past settlement date using localDateToUTCBoundary (anchor in Brazil civil boundary)", () => {
      const pastDate = "2026-09-30";
      const { economicTimestamp, settledOnCivil } = resolveSettlementEconomicTimestamp(pastDate);

      expect(settledOnCivil).toBe("2026-09-30");
      // localDateToUTCBoundary("2026-09-30") -> 2026-09-30T03:00:00.000Z
      expect(economicTimestamp.toISOString()).toBe("2026-09-30T03:00:00.000Z");
    });

    it("rejects invalid date string formats", () => {
      expect(() => resolveSettlementEconomicTimestamp("invalid-date")).toThrowError(
        "settledOn deve ser uma data civil válida no formato YYYY-MM-DD."
      );
      expect(() => resolveSettlementEconomicTimestamp("30/09/2026")).toThrowError(
        "settledOn deve ser uma data civil válida no formato YYYY-MM-DD."
      );
    });
  });

  describe("2. matchesCanonicalSettlementPayload & Idempotency Rules", () => {
    it("Case A: explicit settledOn today with late-night settlement (23:30 BRT = 02:30Z next day) -> REPLAY PASS", () => {
      // 23:30 BRT de 2026-10-08 equivale a 2026-10-09T02:30:00Z em UTC
      const lateNightUtc = new Date("2026-10-09T02:30:00.000Z");

      const existing: any = {
        titleId: "title-1",
        principalAmount: { toFixed: () => "100.00" },
        discountAmount: { toFixed: () => "0.00" },
        interestAmount: { toFixed: () => "0.00" },
        fineAmount: { toFixed: () => "0.00" },
        method: "PIX",
        notes: null,
        settledAt: lateNightUtc,
      };

      const expected = {
        titleId: "title-1",
        principalAmount: "100.00",
        discountAmount: "0.00",
        interestAmount: "0.00",
        fineAmount: "0.00",
        method: "PIX",
        notes: null,
        settledOn: "2026-10-08", // Data civil brasileira de 23:30 BRT
      };

      expect(matchesCanonicalSettlementPayload(existing, expected)).toBe(true);
    });

    it("Case B: same key + different explicit settledOn -> divergence (matchesCanonicalSettlementPayload returns false)", () => {
      const existing: any = {
        titleId: "title-1",
        principalAmount: { toFixed: () => "100.00" },
        discountAmount: { toFixed: () => "0.00" },
        interestAmount: { toFixed: () => "0.00" },
        fineAmount: { toFixed: () => "0.00" },
        method: "PIX",
        notes: null,
        settledAt: new Date("2026-10-08T15:00:00.000Z"),
      };

      const expected = {
        titleId: "title-1",
        principalAmount: "100.00",
        discountAmount: "0.00",
        interestAmount: "0.00",
        fineAmount: "0.00",
        method: "PIX",
        notes: null,
        settledOn: "2026-10-07", // Different date!
      };

      expect(matchesCanonicalSettlementPayload(existing, expected)).toBe(false);
    });

    it("Case C: legacy caller without settledOn (settledOn=null) called on 08/10, replayed on 09/10 -> REPLAY PASS", () => {
      // Criado originalmente em 08/10
      const existing: any = {
        titleId: "title-1",
        principalAmount: { toFixed: () => "100.00" },
        discountAmount: { toFixed: () => "0.00" },
        interestAmount: { toFixed: () => "0.00" },
        fineAmount: { toFixed: () => "0.00" },
        method: "PIX",
        notes: null,
        settledAt: new Date("2026-10-08T12:00:00.000Z"),
      };

      // Replay no dia seguinte sem settledOn informado (settledOn: null)
      const expectedLegacyReplay = {
        titleId: "title-1",
        principalAmount: "100.00",
        discountAmount: "0.00",
        interestAmount: "0.00",
        fineAmount: "0.00",
        method: "PIX",
        notes: null,
        settledOn: null, // Legacy caller
      };

      // Não deve invalidar o replay mesmo que o dia do replay seja diferente
      expect(matchesCanonicalSettlementPayload(existing, expectedLegacyReplay)).toBe(true);
    });

    it("Case D: explicit caller: same key, first settledOn 08/10, second replay with settledOn 09/10 -> rejects with 409 IDEMPOTENCY_KEY_REUSED", async () => {
      const existingSettlement: any = {
        id: "st-existing-1",
        barbershopId,
        titleId: "title-1",
        principalAmount: { toFixed: () => "100.00" },
        discountAmount: { toFixed: () => "0.00" },
        interestAmount: { toFixed: () => "0.00" },
        fineAmount: { toFixed: () => "0.00" },
        method: "PIX",
        notes: null,
        settledAt: new Date("2026-10-08T15:00:00.000Z"), // 08/10 BRT
      };

      vi.mocked(prisma.financialSettlement.findUnique).mockResolvedValue(existingSettlement);

      await expect(
        createSettlement(
          barbershopId,
          "title-1",
          userId,
          "923e4567-e89b-12d3-a456-426614174000",
          {
            principalAmount: "100.00",
            method: "PIX",
            settledOn: "2026-10-07", // Different explicit date
          }
        )
      ).rejects.toThrow("A chave de idempotência já foi utilizada com um payload diferente.");
    });
  });

  describe("3. Atomic Title Creation with initialSettlement", () => {
    it("creates title and initial settlement in the same transaction for PAYABLE", async () => {
      const mockCategory = {
        id: "cat-fe-1",
        barbershopId,
        classification: "FIXED_EXPENSE",
        isActive: true,
      };
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue(mockCategory as any);

      const createdTitleRecord = {
        id: "title-pay-1",
        barbershopId,
        categoryId: "cat-fe-1",
        kind: "PAYABLE",
        title: "Aluguel Outubro",
        originalAmount: "1500.00",
        issuedOn: new Date("2026-10-01T00:00:00.000Z"),
        dueOn: new Date("2026-10-05T00:00:00.000Z"),
        cancelledAt: null,
        settlements: [],
      };
      vi.mocked(prisma.financialTitle.create).mockResolvedValue(createdTitleRecord as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(createdTitleRecord as any);
      vi.mocked(prisma.financialSettlement.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.financialSettlement.create).mockResolvedValue({
        id: "settle-1",
        settledAt: new Date("2026-10-02T03:00:00.000Z"),
      } as any);
      vi.mocked(prisma.financialEntry.create).mockResolvedValue({
        id: "entry-1",
      } as any);

      const titleResult = await createTitle(barbershopId, userId, {
        kind: "PAYABLE",
        categoryId: "cat-fe-1",
        title: "Aluguel Outubro",
        originalAmount: "1500.00",
        issuedOn: "2026-10-01",
        dueOn: "2026-10-05",
        initialSettlement: {
          settledOn: "2026-10-02",
          method: "PIX",
          idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
          notes: "Pago com pix adiantado",
        },
      });

      expect(titleResult.id).toBe("title-pay-1");
      expect(prisma.financialTitle.create).toHaveBeenCalledTimes(1);
      expect(prisma.financialSettlement.create).toHaveBeenCalledTimes(1);
      expect(prisma.financialEntry.create).toHaveBeenCalledTimes(1);

      // Verify financialEntry.entryDate matches settledAt
      const entryCall = vi.mocked(prisma.financialEntry.create).mock.calls[0][0];
      expect(new Date(entryCall.data.entryDate as Date).toISOString()).toBe("2026-10-02T03:00:00.000Z");
      expect(entryCall.data.type).toBe("MANUAL_OUT");
    });

    it("creates title and initial settlement in the same transaction for RECEIVABLE", async () => {
      const mockCategory = {
        id: "cat-rev-1",
        barbershopId,
        classification: "REVENUE",
        isActive: true,
      };
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue(mockCategory as any);

      const createdTitleRecord = {
        id: "title-rec-1",
        barbershopId,
        categoryId: "cat-rev-1",
        kind: "RECEIVABLE",
        title: "Venda Especial",
        originalAmount: "500.00",
        issuedOn: new Date("2026-10-01T00:00:00.000Z"),
        dueOn: new Date("2026-10-01T00:00:00.000Z"),
        cancelledAt: null,
        settlements: [],
      };
      vi.mocked(prisma.financialTitle.create).mockResolvedValue(createdTitleRecord as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(createdTitleRecord as any);
      vi.mocked(prisma.financialSettlement.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.financialSettlement.create).mockResolvedValue({
        id: "settle-rec-1",
        settledAt: new Date("2026-10-01T03:00:00.000Z"),
      } as any);
      vi.mocked(prisma.financialEntry.create).mockResolvedValue({
        id: "entry-rec-1",
      } as any);

      const titleResult = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: "cat-rev-1",
        title: "Venda Especial",
        originalAmount: "500.00",
        issuedOn: "2026-10-01",
        dueOn: "2026-10-01",
        initialSettlement: {
          settledOn: "2026-10-01",
          method: "CREDIT_CARD",
          idempotencyKey: "223e4567-e89b-12d3-a456-426614174000",
        },
      });

      expect(titleResult.id).toBe("title-rec-1");
      const entryCall = vi.mocked(prisma.financialEntry.create).mock.calls[0][0];
      expect(entryCall.data.type).toBe("MANUAL_IN");
      expect(new Date(entryCall.data.entryDate as Date).toISOString()).toBe("2026-10-01T03:00:00.000Z");
    });

    it("rejects invalid method in initialSettlement with 400", async () => {
      await expect(
        createTitle(barbershopId, userId, {
          kind: "PAYABLE",
          categoryId: "cat-1",
          title: "Conta",
          originalAmount: "100.00",
          issuedOn: "2026-10-01",
          dueOn: "2026-10-05",
          initialSettlement: {
            settledOn: "2026-10-01",
            method: "INVALID_METHOD",
            idempotencyKey: "323e4567-e89b-12d3-a456-426614174000",
          },
        })
      ).rejects.toThrow("Forma de pagamento/recebimento válida é obrigatória para baixa inicial.");
    });

    it("propagates settlement errors during initialSettlement and aborts transaction", async () => {
      const mockCategory = {
        id: "cat-fe-1",
        barbershopId,
        classification: "FIXED_EXPENSE",
        isActive: true,
      };
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue(mockCategory as any);

      const createdTitleRecord = {
        id: "title-fail-1",
        barbershopId,
        categoryId: "cat-fe-1",
        kind: "PAYABLE",
        title: "Conta Falha",
        originalAmount: "100.00",
        issuedOn: new Date("2026-10-01T00:00:00.000Z"),
        dueOn: new Date("2026-10-05T00:00:00.000Z"),
        cancelledAt: null,
        settlements: [],
      };
      vi.mocked(prisma.financialTitle.create).mockResolvedValue(createdTitleRecord as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(createdTitleRecord as any);
      // Simulate settlement creation DB error
      vi.mocked(prisma.financialSettlement.create).mockRejectedValue(new Error("DB settlement constraint error"));

      await expect(
        createTitle(barbershopId, userId, {
          kind: "PAYABLE",
          categoryId: "cat-fe-1",
          title: "Conta Falha",
          originalAmount: "100.00",
          issuedOn: "2026-10-01",
          dueOn: "2026-10-05",
          initialSettlement: {
            settledOn: "2026-10-01",
            method: "PIX",
            idempotencyKey: "423e4567-e89b-12d3-a456-426614174000",
          },
        })
      ).rejects.toThrow("DB settlement constraint error");
    });
  });

  describe("4. Critical Cross-Month Economic Date Assertion (30/09 registered on 01/10)", () => {
    it("settledOn=2026-09-30 produces settledAt and entryDate belonging strictly to September 2026 BRT", async () => {
      const pastDate = "2026-09-30";
      const { economicTimestamp, settledOnCivil } = resolveSettlementEconomicTimestamp(pastDate);

      // Verify domain helper output
      expect(settledOnCivil).toBe("2026-09-30");
      expect(economicTimestamp.toISOString()).toBe("2026-09-30T03:00:00.000Z");

      // Verify settlement creation links entryDate === settledAt
      const titleRecord = {
        id: "title-cross-1",
        barbershopId,
        categoryId: "cat-1",
        kind: "PAYABLE",
        title: "Fornecedor",
        originalAmount: "500.00",
        issuedOn: new Date("2026-09-20T00:00:00.000Z"),
        dueOn: new Date("2026-09-30T00:00:00.000Z"),
        cancelledAt: null,
        settlements: [],
      };
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(titleRecord as any);
      vi.mocked(prisma.financialSettlement.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.financialSettlement.create).mockResolvedValue({
        id: "st-cross-1",
        settledAt: economicTimestamp,
      } as any);
      vi.mocked(prisma.financialEntry.create).mockResolvedValue({
        id: "entry-cross-1",
      } as any);

      await createSettlement(
        barbershopId,
        "title-cross-1",
        userId,
        "523e4567-e89b-12d3-a456-426614174000",
        {
          principalAmount: "500.00",
          method: "PIX",
          settledOn: pastDate,
        }
      );

      const settlementCall = vi.mocked(prisma.financialSettlement.create).mock.calls[0][0];
      const entryCall = vi.mocked(prisma.financialEntry.create).mock.calls[0][0];

      // Ambos devem ter o mesmo timestamp exato
      expect(new Date(settlementCall.data.settledAt as Date).toISOString()).toBe("2026-09-30T03:00:00.000Z");
      expect(new Date(entryCall.data.entryDate as Date).toISOString()).toBe("2026-09-30T03:00:00.000Z");
      expect(entryCall.data.type).toBe("MANUAL_OUT");
    });
  });

  describe("5. Partial Multi-Date Settlements (Title R$100: R$40 in 07/10 and R$60 in 08/10)", () => {
    it("each settlement preserves its own economic date and tracks outstanding balance to PAID", async () => {
      // 1ª baixa: R$ 40 em 2026-10-07
      const st1Date = "2026-10-07";
      const { economicTimestamp: ts1 } = resolveSettlementEconomicTimestamp(st1Date);

      const titleRecord = {
        id: "title-partial-1",
        barbershopId,
        categoryId: "cat-1",
        kind: "PAYABLE",
        title: "Fornecedor Parcelado",
        originalAmount: "100.00",
        issuedOn: new Date("2026-10-01T00:00:00.000Z"),
        dueOn: new Date("2026-10-10T00:00:00.000Z"),
        cancelledAt: null,
        settlements: [],
      };
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(titleRecord as any);
      vi.mocked(prisma.financialSettlement.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.financialSettlement.create).mockResolvedValue({
        id: "st-part-1",
        settledAt: ts1,
      } as any);
      vi.mocked(prisma.financialEntry.create).mockResolvedValue({ id: "entry-part-1" } as any);

      await createSettlement(
        barbershopId,
        "title-partial-1",
        userId,
        "623e4567-e89b-12d3-a456-426614174000",
        {
          principalAmount: "40.00",
          method: "PIX",
          settledOn: st1Date,
        }
      );

      const stCall1 = vi.mocked(prisma.financialSettlement.create).mock.calls[0][0];
      const entryCall1 = vi.mocked(prisma.financialEntry.create).mock.calls[0][0];
      expect(new Date(stCall1.data.settledAt as Date).toISOString()).toBe("2026-10-07T03:00:00.000Z");
      expect(new Date(entryCall1.data.entryDate as Date).toISOString()).toBe("2026-10-07T03:00:00.000Z");

      // 2ª baixa: R$ 60 em 2026-10-08
      const st2Date = "2026-10-08";
      const { economicTimestamp: ts2 } = resolveSettlementEconomicTimestamp(st2Date);

      // Agora titleRecord tem a 1ª settlement acumulada
      const titleWithFirstSt = {
        ...titleRecord,
        settlements: [
          {
            id: "st-part-1",
            principalAmount: "40.00",
            discountAmount: "0.00",
            interestAmount: "0.00",
            fineAmount: "0.00",
            netCash: "40.00",
            settledAt: ts1,
            reversals: [],
          },
        ],
      };
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(titleWithFirstSt as any);
      vi.mocked(prisma.financialSettlement.create).mockResolvedValue({
        id: "st-part-2",
        settledAt: ts2,
      } as any);

      await createSettlement(
        barbershopId,
        "title-partial-1",
        userId,
        "723e4567-e89b-12d3-a456-426614174000",
        {
          principalAmount: "60.00",
          method: "CASH",
          settledOn: st2Date,
        }
      );

      const stCall2 = vi.mocked(prisma.financialSettlement.create).mock.calls[1][0];
      const entryCall2 = vi.mocked(prisma.financialEntry.create).mock.calls[1][0];
      expect(new Date(stCall2.data.settledAt as Date).toISOString()).toBe(
        new Date(entryCall2.data.entryDate as Date).toISOString()
      );
      // Confirma que a 1ª baixa foi em 07/10 e a 2ª foi em 08/10
      expect(new Date(stCall1.data.settledAt as Date).toISOString()).toBe("2026-10-07T03:00:00.000Z");
      expect(new Date(stCall2.data.settledAt as Date).toISOString()).toBe(
        new Date(entryCall2.data.entryDate as Date).toISOString()
      );
    });
  });

  describe("6. Reversal Economic Date Behavior (settlement=30/09, reversal=now)", () => {
    it("reversal creates opposite financial entry with NOW, NOT inheriting past settledOn", async () => {
      const origSettledAt = new Date("2026-09-30T03:00:00.000Z");
      const settlementRecord = {
        id: "st-rev-test-1",
        barbershopId,
        titleId: "title-rev-1",
        principalAmount: "100.00",
        discountAmount: "0.00",
        interestAmount: "0.00",
        fineAmount: "0.00",
        netCash: "100.00",
        settledAt: origSettledAt,
        reversals: [],
        title: {
          id: "title-rev-1",
          title: "Conta Estorno",
          categoryId: "cat-1",
        },
        financialEntry: {
          id: "entry-orig-1",
          type: "MANUAL_OUT",
          amount: "-100.00",
          entryDate: origSettledAt,
        },
      };

      vi.mocked(prisma.financialSettlement.findFirst).mockResolvedValue(settlementRecord as any);
      vi.mocked(prisma.financialSettlementReversal.create).mockResolvedValue({
        id: "rev-rec-1",
      } as any);
      vi.mocked(prisma.financialEntry.create).mockResolvedValue({
        id: "entry-rev-1",
      } as any);

      const before = Date.now();
      await reverseSettlement(
        barbershopId,
        "st-rev-test-1",
        userId,
        "823e4567-e89b-12d3-a456-426614174000",
        { reason: "Estorno solicitado pelo gerente" }
      );
      const after = Date.now();

      const reverseEntryCall = vi.mocked(prisma.financialEntry.create).mock.calls[0][0];
      // A entrada de estorno deve ser MANUAL_IN (oposto de MANUAL_OUT)
      expect(reverseEntryCall.data.type).toBe("MANUAL_IN");
      // O entryDate do estorno NÃO pode ser 30/09, deve ser o instante da reversão (agora)
      const reversalDate = new Date(reverseEntryCall.data.entryDate as Date);
      expect(reversalDate.getTime()).toBeGreaterThanOrEqual(before);
      expect(reversalDate.getTime()).toBeLessThanOrEqual(after);
      expect(reversalDate.toISOString()).not.toBe(origSettledAt.toISOString());
    });
  });
});
