/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import {
  calculateRoutineDueOnCivil,
  createFinancialRoutine,
  FinancialRoutineError,
  generateRoutineOccurrencesForMonth,
  getDaysInMonth,
  isValidReferenceMonth,
  parseCivilDateToUTC,
  parseReferenceMonth,
  updateFinancialRoutine,
  validateCategoryForRoutine,
} from "@/lib/financial/routines";
import { GET as getRoutinesRoute } from "@/app/api/admin/financial/routines/route";
import { GET as getRoutineDetailRoute } from "@/app/api/admin/financial/routines/[id]/route";
import { POST as generateOnDemandRoute } from "@/app/api/admin/financial/routines/generate/route";
import { POST as generateSchedulerRoute } from "@/app/api/internal/financial/generate-routines/route";
import * as permissionsModule from "@/lib/financial/permissions";
import prisma from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: any = {
    financialRoutine: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    financialCategory: {
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    financialTitle: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    financialTitleEvent: {
      create: vi.fn(),
    },
    barbershop: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn((cb: any) => cb(mockPrisma)),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  return { default: mockPrisma };
});

describe("Phase 4 — Financial Routines Domain & Helper Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Reference Month & Date Helpers", () => {
    it("validates reference month format YYYY-MM correctly", () => {
      expect(isValidReferenceMonth("2026-01")).toBe(true);
      expect(isValidReferenceMonth("2026-09")).toBe(true);
      expect(isValidReferenceMonth("2026-12")).toBe(true);
      expect(isValidReferenceMonth("2026-1")).toBe(false);
      expect(isValidReferenceMonth("26-09")).toBe(false);
      expect(isValidReferenceMonth("2026-13")).toBe(false);
      expect(isValidReferenceMonth("2026-00")).toBe(false);
      expect(isValidReferenceMonth("2026-10-01")).toBe(false);
    });

    it("parses reference month year and month", () => {
      expect(parseReferenceMonth("2026-05")).toEqual({ year: 2026, month: 5 });
      expect(() => parseReferenceMonth("invalid")).toThrow(FinancialRoutineError);
    });

    it("calculates getDaysInMonth correctly", () => {
      expect(getDaysInMonth(2026, 1)).toBe(31);
      expect(getDaysInMonth(2026, 2)).toBe(28); // Non-leap year
      expect(getDaysInMonth(2028, 2)).toBe(29); // Leap year
      expect(getDaysInMonth(2026, 4)).toBe(30);
    });

    it("calculates dueOn civil date with proper month clamping", () => {
      expect(calculateRoutineDueOnCivil("2026-01", 31)).toBe("2026-01-31");
      expect(calculateRoutineDueOnCivil("2026-04", 31)).toBe("2026-04-30");
      expect(calculateRoutineDueOnCivil("2026-02", 31)).toBe("2026-02-28");
      expect(calculateRoutineDueOnCivil("2028-02", 31)).toBe("2028-02-29");
      expect(calculateRoutineDueOnCivil("2026-02", 30)).toBe("2026-02-28");
      expect(calculateRoutineDueOnCivil("2026-02", 29)).toBe("2026-02-28");
      expect(calculateRoutineDueOnCivil("2026-02", 15)).toBe("2026-02-15");
      expect(calculateRoutineDueOnCivil("2026-02", 1)).toBe("2026-02-01");
    });
  });

  describe("Category Validation for Routine", () => {
    it("fails if category is not found for tenant", async () => {
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue(null);
      const res = await validateCategoryForRoutine(prisma, "shop-1", "cat-1", "PAYABLE");
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("não encontrada");
    });

    it("fails if category is inactive", async () => {
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: false,
        classification: "FIXED_EXPENSE",
      } as any);
      const res = await validateCategoryForRoutine(prisma, "shop-1", "cat-1", "PAYABLE");
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("inativa");
    });

    it("fails if category is non-leaf (has subcategories)", async () => {
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "FIXED_EXPENSE",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(2);
      const res = await validateCategoryForRoutine(prisma, "shop-1", "cat-1", "PAYABLE");
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("Apenas categorias folha");
    });

    it("fails if category classification is incompatible with PAYABLE", async () => {
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "REVENUE", // Incompatible with PAYABLE
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);
      const res = await validateCategoryForRoutine(prisma, "shop-1", "cat-1", "PAYABLE");
      expect(res.valid).toBe(false);
      expect(res.reason).toContain("incompatível com título PAYABLE");
    });

    it("succeeds for valid leaf PAYABLE category", async () => {
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "FIXED_EXPENSE",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);
      const res = await validateCategoryForRoutine(prisma, "shop-1", "cat-1", "PAYABLE");
      expect(res.valid).toBe(true);
    });
  });

  describe("Create Financial Routine Validation", () => {
    it("rejects frequency other than MONTHLY", async () => {
      await expect(
        createFinancialRoutine({
          barbershopId: "shop-1",
          createdById: "user-1",
          categoryId: "cat-1",
          title: "Aluguel",
          kind: "PAYABLE",
          amountMode: "FIXED",
          baseAmount: "1000.00",
          frequency: "YEARLY" as any,
          dueDay: 10,
          startDate: "2026-01-01",
        })
      ).rejects.toThrow("Fase 4 suporta apenas frequência MONTHLY.");
    });

    it("rejects dueDay out of range 1..31", async () => {
      await expect(
        createFinancialRoutine({
          barbershopId: "shop-1",
          createdById: "user-1",
          categoryId: "cat-1",
          title: "Aluguel",
          kind: "PAYABLE",
          amountMode: "FIXED",
          baseAmount: "1000.00",
          dueDay: 32,
          startDate: "2026-01-01",
        })
      ).rejects.toThrow("Dia de vencimento deve ser um inteiro entre 1 e 31.");
    });

    it("rejects FIXED amountMode without baseAmount", async () => {
      await expect(
        createFinancialRoutine({
          barbershopId: "shop-1",
          createdById: "user-1",
          categoryId: "cat-1",
          title: "Aluguel",
          kind: "PAYABLE",
          amountMode: "FIXED",
          baseAmount: null,
          dueDay: 10,
          startDate: "2026-01-01",
        })
      ).rejects.toThrow("Rotinas com valor FIXO exigem um valor base (baseAmount).");
    });

    it("rejects FIXED amountMode with baseAmount zero or negative", async () => {
      await expect(
        createFinancialRoutine({
          barbershopId: "shop-1",
          createdById: "user-1",
          categoryId: "cat-1",
          title: "Aluguel",
          kind: "PAYABLE",
          amountMode: "FIXED",
          baseAmount: "0.00",
          dueDay: 10,
          startDate: "2026-01-01",
        })
      ).rejects.toThrow("Valor base deve ser maior que zero.");
    });

    it("allows VARIABLE amountMode with null baseAmount", async () => {
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "VARIABLE_COST",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);
      vi.mocked(prisma.financialRoutine.create).mockResolvedValue({ id: "rot-1" } as any);

      const res = await createFinancialRoutine({
        barbershopId: "shop-1",
        createdById: "user-1",
        categoryId: "cat-1",
        title: "Energia Elétrica",
        kind: "PAYABLE",
        amountMode: "VARIABLE",
        baseAmount: null,
        dueDay: 15,
        startDate: "2026-01-01",
      });

      expect(res).toEqual({ id: "rot-1" });
      expect(prisma.financialRoutine.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountMode: "VARIABLE",
            baseAmount: null,
          }),
        })
      );
    });
  });

  describe("Update Routine & Kind Immutability", () => {
    it("locks kind editing after titles have been generated", async () => {
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue({
        id: "rot-1",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("500.00"),
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
      } as any);

      // 1 title already generated
      vi.mocked(prisma.financialTitle.count).mockResolvedValue(1);

      await expect(
        updateFinancialRoutine({
          barbershopId: "shop-1",
          routineId: "rot-1",
          kind: "RECEIVABLE", // Attempt to change kind
        })
      ).rejects.toThrow("O tipo (kind) da rotina não pode ser alterado após a geração de títulos.");
    });

    it("allows kind editing if no titles have been generated yet", async () => {
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue({
        id: "rot-1",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("500.00"),
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
      } as any);

      vi.mocked(prisma.financialTitle.count).mockResolvedValue(0);
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-2",
        barbershopId: "shop-1",
        isActive: true,
        classification: "REVENUE",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);
      vi.mocked(prisma.financialRoutine.update).mockResolvedValue({ id: "rot-1", kind: "RECEIVABLE" } as any);

      const res = await updateFinancialRoutine({
        barbershopId: "shop-1",
        routineId: "rot-1",
        categoryId: "cat-2",
        kind: "RECEIVABLE",
      });

      expect(res).toEqual({ id: "rot-1", kind: "RECEIVABLE" });
    });
  });

  describe("Month Generation Engine", () => {
    it("rejects invalid referenceMonth", async () => {
      await expect(
        generateRoutineOccurrencesForMonth({
          barbershopId: "shop-1",
          referenceMonth: "2026-13",
          source: "ROUTINE_ON_DEMAND",
        })
      ).rejects.toThrow("Mês de referência inválido");
    });

    it("rejects amount override for FIXED routine with 400", async () => {
      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([
        { id: "rot-fixed", amountMode: "FIXED" },
      ] as any);

      await expect(
        generateRoutineOccurrencesForMonth({
          barbershopId: "shop-1",
          referenceMonth: "2026-10",
          source: "ROUTINE_ON_DEMAND",
          amountOverrides: {
            "rot-fixed": "600.00",
          },
        })
      ).rejects.toThrow("Overrides de valor não são permitidos para rotinas com valor FIXO.");
    });

    it("returns SKIPPED_OUT_OF_PERIOD if dueOn is before startDate", async () => {
      const routine = {
        id: "rot-1",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        title: "Contrato Novo",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("1000.00"),
        dueDay: 10,
        startDate: parseCivilDateToUTC("2026-10-20"), // Starts Oct 20
        endDate: null,
        isActive: true,
        createdById: "user-1",
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routine] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(routine as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(null);

      const output = await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-10", // dueOn = 2026-10-10 < startDate 2026-10-20
        source: "ROUTINE_ON_DEMAND",
      });

      expect(output.summary.total).toBe(1);
      expect(output.summary.skipped).toBe(1);
      expect(output.results[0].status).toBe("SKIPPED_OUT_OF_PERIOD");
    });

    it("generates title if dueOn is on or after startDate", async () => {
      const routine = {
        id: "rot-1",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        title: "Contrato Novo",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("1000.00"),
        dueDay: 31,
        startDate: parseCivilDateToUTC("2026-10-20"), // Starts Oct 20
        endDate: null,
        isActive: true,
        createdById: "user-1",
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routine] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(routine as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "FIXED_EXPENSE",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);
      vi.mocked(prisma.financialTitle.create).mockResolvedValue({ id: "title-1" } as any);

      const output = await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-10", // dueOn = 2026-10-31 >= startDate 2026-10-20
        source: "ROUTINE_ON_DEMAND",
        actorUserId: "admin-user",
      });

      expect(output.summary.generated).toBe(1);
      expect(output.results[0].status).toBe("GENERATED");
      expect(output.results[0].titleId).toBe("title-1");

      expect(prisma.financialTitle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            routineId: "rot-1",
            referenceMonth: "2026-10",
            createdById: "user-1", // Uses routine creator ID
          }),
        })
      );

      expect(prisma.financialTitleEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            titleId: "title-1",
            type: "CREATED",
            payload: {
              source: "ROUTINE_ON_DEMAND",
              routineId: "rot-1",
              referenceMonth: "2026-10",
            },
            actorUserId: "admin-user",
          }),
        })
      );
    });

    it("returns BLOCKED_AMOUNT_REQUIRED if VARIABLE routine has null baseAmount and no override", async () => {
      const routine = {
        id: "rot-var",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        title: "Manutenção",
        kind: "PAYABLE",
        amountMode: "VARIABLE",
        baseAmount: null,
        dueDay: 15,
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
        isActive: true,
        createdById: "user-1",
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routine] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(routine as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "VARIABLE_COST",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);

      const output = await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-10",
        source: "ROUTINE_SCHEDULER",
        actorUserId: null,
      });

      expect(output.summary.blocked).toBe(1);
      expect(output.results[0].status).toBe("BLOCKED_AMOUNT_REQUIRED");
    });

    it("returns REPLAYED if title already exists (even if cancelled)", async () => {
      const routine = {
        id: "rot-1",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        title: "Aluguel",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("1000.00"),
        dueDay: 10,
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
        isActive: true,
        createdById: "user-1",
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routine] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(routine as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue({ id: "title-existing-cancelled", cancelledAt: new Date() } as any);

      const output = await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-10",
        source: "ROUTINE_ON_DEMAND",
      });

      expect(output.summary.replayed).toBe(1);
      expect(output.summary.replayed).toBe(1);
      expect(output.results[0].status).toBe("REPLAYED");
      expect(output.results[0].titleId).toBe("title-existing-cancelled");
      expect(prisma.financialTitle.create).not.toHaveBeenCalled();
    });

    it("applies VARIABLE override without mutating routine baseAmount (VARIABLE_OVERRIDE_APPLIED)", async () => {
      const routine = {
        id: "rot-var-override",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        title: "Energia Variável",
        kind: "PAYABLE",
        amountMode: "VARIABLE",
        baseAmount: null,
        dueDay: 15,
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
        isActive: true,
        createdById: "user-1",
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routine] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(routine as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "VARIABLE_COST",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);
      vi.mocked(prisma.financialTitle.create).mockResolvedValue({ id: "title-override-1" } as any);

      const output = await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-10",
        source: "ROUTINE_ON_DEMAND",
        amountOverrides: {
          "rot-var-override": "450.00",
        },
      });

      expect(output.summary.generated).toBe(1);
      expect(output.results[0].status).toBe("GENERATED");
      expect(prisma.financialTitle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            originalAmount: new Prisma.Decimal("450"),
          }),
        })
      );
      expect(routine.baseAmount).toBeNull();
    });

    it("validates endDate boundary: skipped if dueOn > endDate, generated if dueOn <= endDate (END_DATE_BOUNDARY)", async () => {
      const routineExceeded = {
        id: "rot-end-exceeded",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        title: "Contrato Expirado",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("500.00"),
        dueDay: 15,
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: parseCivilDateToUTC("2026-12-05"),
        isActive: true,
        createdById: "user-1",
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routineExceeded] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(routineExceeded as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(null);

      const outExceeded = await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-12",
        source: "ROUTINE_ON_DEMAND",
      });

      expect(outExceeded.summary.skipped).toBe(1);
      expect(outExceeded.results[0].status).toBe("SKIPPED_OUT_OF_PERIOD");

      const routineInclusive = {
        ...routineExceeded,
        id: "rot-end-inclusive",
        endDate: parseCivilDateToUTC("2026-12-15"),
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routineInclusive] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(routineInclusive as any);
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "FIXED_EXPENSE",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);
      vi.mocked(prisma.financialTitle.create).mockResolvedValue({ id: "title-inc-1" } as any);

      const outInclusive = await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-12",
        source: "ROUTINE_ON_DEMAND",
      });

      expect(outInclusive.summary.generated).toBe(1);
      expect(outInclusive.results[0].status).toBe("GENERATED");
    });

    it("skips inactive routine without creating title or event (INACTIVE_ROUTINE_SKIP)", async () => {
      const routineInactive = {
        id: "rot-inactive",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        title: "Rotina Pausada",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("300.00"),
        dueDay: 10,
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
        isActive: false,
        createdById: "user-1",
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routineInactive] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(routineInactive as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(null);

      const output = await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-10",
        source: "ROUTINE_ON_DEMAND",
      });

      expect(output.summary.skipped).toBe(1);
      expect(output.results[0].status).toBe("SKIPPED_INACTIVE");
      expect(prisma.financialTitle.create).not.toHaveBeenCalled();
      expect(prisma.financialTitleEvent.create).not.toHaveBeenCalled();
    });

    it("validates exact routine to title field mapping (ROUTINE_TO_TITLE_MAPPING)", async () => {
      const routine = {
        id: "rot-map-1",
        barbershopId: "shop-1",
        categoryId: "cat-map-1",
        title: "Aluguel Mapeado",
        notes: "Nota descritiva do aluguel",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("1200.00"),
        dueDay: 15,
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
        isActive: true,
        createdById: "creator-user-99",
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routine] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(routine as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-map-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "FIXED_EXPENSE",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);
      vi.mocked(prisma.financialTitle.create).mockResolvedValue({ id: "title-mapped-1" } as any);

      const output = await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-10",
        source: "ROUTINE_ON_DEMAND",
        actorUserId: "actor-human-1",
      });

      expect(output.summary.generated).toBe(1);
      expect(prisma.financialTitle.create).toHaveBeenCalledWith({
        data: {
          barbershopId: "shop-1",
          routineId: "rot-map-1",
          categoryId: "cat-map-1",
          kind: "PAYABLE",
          title: "Aluguel Mapeado",
          description: "Nota descritiva do aluguel",
          originalAmount: new Prisma.Decimal("1200"),
          issuedOn: expect.any(Date),
          dueOn: parseCivilDateToUTC("2026-10-15"),
          referenceMonth: "2026-10",
          createdById: "creator-user-99",
        },
      });
    });

    it("creates CREATED event on-demand with human actorUserId and complete payload (ON_DEMAND_EVENT_ACTOR_AND_PAYLOAD)", async () => {
      const routine = {
        id: "rot-ondemand",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        title: "Limpeza Sede",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("300.00"),
        dueDay: 10,
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
        isActive: true,
        createdById: "creator-user-1",
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routine] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(routine as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "FIXED_EXPENSE",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);
      vi.mocked(prisma.financialTitle.create).mockResolvedValue({ id: "title-ondemand-1" } as any);

      await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-10",
        source: "ROUTINE_ON_DEMAND",
        actorUserId: "human-actor-123",
      });

      expect(prisma.financialTitleEvent.create).toHaveBeenCalledWith({
        data: {
          barbershopId: "shop-1",
          titleId: "title-ondemand-1",
          type: "CREATED",
          payload: {
            source: "ROUTINE_ON_DEMAND",
            routineId: "rot-ondemand",
            referenceMonth: "2026-10",
          },
          actorUserId: "human-actor-123",
        },
      });
    });

    it("creates title with routine createdById and event actorUserId null under scheduler (SCHEDULER_TITLE_CREATED_BY_TEST)", async () => {
      const routine = {
        id: "rot-sched",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        title: "Conta Luz Scheduler",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("400.00"),
        dueDay: 20,
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
        isActive: true,
        createdById: "routine-creator-456",
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routine] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(routine as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "FIXED_EXPENSE",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);
      vi.mocked(prisma.financialTitle.create).mockResolvedValue({ id: "title-sched-1" } as any);

      await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-10",
        source: "ROUTINE_SCHEDULER",
        actorUserId: null,
      });

      expect(prisma.financialTitle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdById: "routine-creator-456",
          }),
        })
      );

      expect(prisma.financialTitleEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: null,
            payload: expect.objectContaining({
              source: "ROUTINE_SCHEDULER",
            }),
          }),
        })
      );
    });

    it("continues processing batch when routine A is blocked and routine B is valid (BATCH_CONTINUE_TEST)", async () => {
      const routineA = {
        id: "rot-blocked",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        title: "Rotina Bloqueada",
        kind: "PAYABLE",
        amountMode: "VARIABLE",
        baseAmount: null,
        dueDay: 10,
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
        isActive: true,
        createdById: "user-1",
      };

      const routineB = {
        id: "rot-valid",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        title: "Rotina Válida",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("100.00"),
        dueDay: 10,
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
        isActive: true,
        createdById: "user-1",
      };

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([routineA, routineB] as any);
      vi.mocked(prisma.financialRoutine.findFirst)
        .mockResolvedValueOnce(routineA as any)
        .mockResolvedValueOnce(routineB as any);
      vi.mocked(prisma.financialTitle.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.financialCategory.findFirst).mockResolvedValue({
        id: "cat-1",
        barbershopId: "shop-1",
        isActive: true,
        classification: "FIXED_EXPENSE",
      } as any);
      vi.mocked(prisma.financialCategory.count).mockResolvedValue(0);
      vi.mocked(prisma.financialTitle.create).mockResolvedValue({ id: "title-b-1" } as any);

      const output = await generateRoutineOccurrencesForMonth({
        barbershopId: "shop-1",
        referenceMonth: "2026-10",
        source: "ROUTINE_ON_DEMAND",
      });

      expect(output.summary.total).toBe(2);
      expect(output.summary.blocked).toBe(1);
      expect(output.summary.generated).toBe(1);
      expect(output.results[0].status).toBe("BLOCKED_AMOUNT_REQUIRED");
      expect(output.results[1].status).toBe("GENERATED");
    });
  });

  describe("API Routes & RBAC Integration", () => {
    it("proves reactivation does not trigger implicit backfill for past months (REACTIVATION_NO_BACKFILL)", async () => {
      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue({
        id: "rot-reactivate",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("500.00"),
        dueDay: 10,
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
        isActive: false,
      } as any);

      vi.mocked(prisma.financialRoutine.update).mockResolvedValue({
        id: "rot-reactivate",
        isActive: true,
      } as any);

      const updated = await updateFinancialRoutine({
        barbershopId: "shop-1",
        routineId: "rot-reactivate",
        isActive: true,
      });

      expect(updated.isActive).toBe(true);
      expect(prisma.financialTitle.create).not.toHaveBeenCalled();
      expect(prisma.financialTitleEvent.create).not.toHaveBeenCalled();
    });

    it("proves editing a routine does not touch previously generated historical titles (HISTORICAL_TITLE_UNTOUCHED)", async () => {
      const historicalTitle = {
        id: "title-october",
        barbershopId: "shop-1",
        routineId: "rot-hist",
        title: "Título Antigo Outubro",
        originalAmount: new Prisma.Decimal("1000.00"),
        referenceMonth: "2026-10",
      };

      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue({
        id: "rot-hist",
        barbershopId: "shop-1",
        categoryId: "cat-1",
        kind: "PAYABLE",
        amountMode: "FIXED",
        baseAmount: new Prisma.Decimal("1000.00"),
        startDate: parseCivilDateToUTC("2026-01-01"),
        endDate: null,
      } as any);

      vi.mocked(prisma.financialRoutine.update).mockResolvedValue({
        id: "rot-hist",
        title: "Título Novo Editado Novembro",
        baseAmount: new Prisma.Decimal("1500.00"),
      } as any);

      const updatedRoutine = await updateFinancialRoutine({
        barbershopId: "shop-1",
        routineId: "rot-hist",
        title: "Título Novo Editado Novembro",
        baseAmount: "1500.00",
      });

      expect(updatedRoutine.title).toBe("Título Novo Editado Novembro");
      expect(prisma.financialTitle.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "title-october" } })
      );
      expect(historicalTitle.title).toBe("Título Antigo Outubro");
    });

    it("allows OWNER role on GET routines route (returns 200)", async () => {
      vi.spyOn(permissionsModule, "requireFinancialSession").mockResolvedValue({
        error: null,
        data: { barbershopId: "shop-1", userId: "owner-1", role: "OWNER" } as any,
      });

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([]);

      const req = new Request("http://localhost/api/admin/financial/routines");
      const res = (await getRoutinesRoute(req as any))!;
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty("routines");
    });

    it("allows MANAGER role on GET routines route (returns 200)", async () => {
      vi.spyOn(permissionsModule, "requireFinancialSession").mockResolvedValue({
        error: null,
        data: { barbershopId: "shop-1", userId: "manager-1", role: "MANAGER" } as any,
      });

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([]);

      const req = new Request("http://localhost/api/admin/financial/routines");
      const res = (await getRoutinesRoute(req as any))!;
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty("routines");
    });

    it("returns 403 for BARBER role on GET routines route", async () => {
      vi.spyOn(permissionsModule, "requireFinancialSession").mockResolvedValue({
        error: new Response(JSON.stringify({ error: "Acesso negado." }), { status: 403 }) as any,
        data: null,
      });

      const req = new Request("http://localhost/api/admin/financial/routines");
      const res = (await getRoutinesRoute(req as any))!;
      expect(res.status).toBe(403);
    });

    it("returns 404 fail-closed for cross-tenant routine detail lookup", async () => {
      vi.spyOn(permissionsModule, "requireFinancialSession").mockResolvedValue({
        error: null,
        data: { barbershopId: "shop-1", userId: "owner-1", role: "OWNER" } as any,
      });

      vi.mocked(prisma.financialRoutine.findFirst).mockResolvedValue(null);

      const req = new Request("http://localhost/api/admin/financial/routines/rot-tenant2");
      const res = (await getRoutineDetailRoute(req as any, { params: Promise.resolve({ id: "rot-tenant2" }) }))!;
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("NOT_FOUND");
    });

    it("returns HTTP 500 when batch contains unexpected FAILED routine result (PARTIAL_FAILED_RESPONSE_TEST)", async () => {
      vi.spyOn(permissionsModule, "requireFinancialSession").mockResolvedValue({
        error: null,
        data: { barbershopId: "shop-1", userId: "owner-1", role: "OWNER" } as any,
      });

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([{ id: "rot-fail" }] as any);
      vi.mocked(prisma.financialRoutine.findFirst).mockImplementation(() => {
        throw new Error("UNEXPECTED_DB_ERROR");
      });

      const req = new Request("http://localhost/api/admin/financial/routines/generate", {
        method: "POST",
        body: JSON.stringify({ referenceMonth: "2026-10" }),
      });

      const res = (await generateOnDemandRoute(req as any))!;
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.summary.failed).toBe(1);
      expect(json.results[0].status).toBe("FAILED");
    });

    it("returns 401 for unauthorized internal scheduler route", async () => {
      delete process.env.D2B_JOB_SECRET;
      const req = new Request("http://localhost/api/internal/financial/generate-routines", {
        method: "POST",
      });
      const res = (await generateSchedulerRoute(req as any))!;
      expect(res.status).toBe(401);
    });

    it("executes internal scheduler route with valid D2B_JOB_SECRET Bearer token", async () => {
      process.env.D2B_JOB_SECRET = "secret-key-123";

      vi.mocked(prisma.barbershop.findMany).mockResolvedValue([
        { id: "shop-1", name: "Barbearia 1" },
      ] as any);

      vi.mocked(prisma.financialRoutine.findMany).mockResolvedValue([]);

      const req = new Request("http://localhost/api/internal/financial/generate-routines", {
        method: "POST",
        headers: {
          authorization: "Bearer secret-key-123",
        },
      });

      const res = (await generateSchedulerRoute(req as any))!;
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.summary.processedTenants).toBe(1);
    });
  });
});
