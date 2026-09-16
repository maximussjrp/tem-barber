import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { bootstrapFinancialPlan } from "@/lib/financial/default-plan";
import { createSettlement, reverseSettlement } from "@/lib/financial/settlements";
import {
  calculateTitleDerivedStatus,
  cancelTitle,
  createTitle,
  getTitleById,
  isValidISODateString,
  listTitles,
  updateTitle,
} from "@/lib/financial/titles";

describe("Financial Titles Domain & Logic Tests", () => {
  const barbershopId = "b1111111-1111-4111-a111-111111111111";
  const otherBarbershopId = "b2222222-2222-4222-a222-222222222222";
  const userId = "u1111111-1111-4111-a111-111111111111";

  let recCategoryId: string;
  let payCategoryId: string;
  let inactiveCategoryId: string;

  beforeEach(async () => {
    // Clear test records
    await prisma.financialTitleEvent.deleteMany({});
    await prisma.financialEntryAllocation.deleteMany({});
    await prisma.financialEntry.deleteMany({});
    await prisma.financialSettlementReversal.deleteMany({});
    await prisma.financialSettlement.deleteMany({});
    await prisma.financialTitle.deleteMany({});

    // Upsert test barbershops and user for FK constraints
    await prisma.barbershop.upsert({
      where: { id: barbershopId },
      create: {
        id: barbershopId,
        name: "Barbearia Teste",
        slug: `barbearia-teste-${barbershopId}`,
        phone: "11999999999",
        zipCode: "00000000",
        street: "Rua Teste",
        number: "123",
        neighborhood: "Bairro Teste",
        city: "Cidade Teste",
        state: "SP",
      },
      update: {},
    });

    await prisma.barbershop.upsert({
      where: { id: otherBarbershopId },
      create: {
        id: otherBarbershopId,
        name: "Outra Barbearia Teste",
        slug: `outra-barbearia-teste-${otherBarbershopId}`,
        phone: "11888888888",
        zipCode: "00000000",
        street: "Rua Outra",
        number: "456",
        neighborhood: "Bairro Outro",
        city: "Cidade Teste",
        state: "SP",
      },
      update: {},
    });

    await prisma.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        name: "Usuario Teste",
        phone: "5511999999999",
      },
      update: {},
    });

    // Ensure default plan categories are bootstrapped for test barbershops
    await bootstrapFinancialPlan(prisma, barbershopId);
    await bootstrapFinancialPlan(prisma, otherBarbershopId);

    // Fetch seed leaf categories
    const recCat = await prisma.financialCategory.findFirst({
      where: { barbershopId, classification: "REVENUE", isActive: true, parentCategoryId: { not: null } },
    });
    const payCat = await prisma.financialCategory.findFirst({
      where: { barbershopId, classification: "FIXED_EXPENSE", isActive: true, parentCategoryId: { not: null } },
    });

    if (!recCat || !payCat) {
      throw new Error("Required seed categories not found.");
    }

    recCategoryId = recCat.id;
    payCategoryId = payCat.id;

    const inactive = await prisma.financialCategory.create({
      data: {
        barbershopId,
        code: `INACT-${Math.random().toString(36).substring(2, 9)}`,
        name: "Inativa Teste",
        classification: "REVENUE",
        isActive: false,
      },
    });
    inactiveCategoryId = inactive.id;
  });

  describe("Date Validation & Status Derivation", () => {
    it("validates ISO civil dates correctly", () => {
      expect(isValidISODateString("2026-06-15")).toBe(true);
      expect(isValidISODateString("2026-02-30")).toBe(false);
      expect(isValidISODateString("2026-13-01")).toBe(false);
      expect(isValidISODateString("invalid")).toBe(false);
    });

    it("derives status with strict precedence rules", () => {
      // 1. CANCELLED
      const s1 = calculateTitleDerivedStatus({
        cancelledAt: new Date(),
        originalAmountCents: 10000,
        settledPrincipalCents: 5000,
        dueOnCivil: "2026-01-01",
        civilTodayCivil: "2026-06-01",
      });
      expect(s1.status).toBe("CANCELLED");

      // 2. PAID
      const s2 = calculateTitleDerivedStatus({
        cancelledAt: null,
        originalAmountCents: 10000,
        settledPrincipalCents: 10000,
        dueOnCivil: "2026-01-01",
        civilTodayCivil: "2026-06-01",
      });
      expect(s2.status).toBe("PAID");

      // 3. OVERDUE (partial + due ontem)
      const s3 = calculateTitleDerivedStatus({
        cancelledAt: null,
        originalAmountCents: 10000,
        settledPrincipalCents: 5000,
        dueOnCivil: "2026-05-31",
        civilTodayCivil: "2026-06-01",
      });
      expect(s3.status).toBe("OVERDUE");

      // 4. PARTIAL (partial + due amanhã)
      const s4 = calculateTitleDerivedStatus({
        cancelledAt: null,
        originalAmountCents: 10000,
        settledPrincipalCents: 5000,
        dueOnCivil: "2026-06-02",
        civilTodayCivil: "2026-06-01",
      });
      expect(s4.status).toBe("PARTIAL");

      // 5. OPEN (0 settled + due hoje -> nunca OVERDUE)
      const s5 = calculateTitleDerivedStatus({
        cancelledAt: null,
        originalAmountCents: 10000,
        settledPrincipalCents: 0,
        dueOnCivil: "2026-06-01",
        civilTodayCivil: "2026-06-01",
      });
      expect(s5.status).toBe("OPEN");
    });
  });

  describe("Title Creation & Validations", () => {
    it("creates a RECEIVABLE title and records CREATED event", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Aluguel da Cadeira",
        description: "Contrato mensal",
        originalAmount: "500.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      expect(title.id).toBeDefined();
      expect(title.kind).toBe("RECEIVABLE");
      expect(title.originalAmount.toFixed(2)).toBe("500.00");

      const events = await prisma.financialTitleEvent.findMany({
        where: { titleId: title.id },
      });
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("CREATED");
    });

    it("rejects invalid kind or missing title", async () => {
      await expect(
        createTitle(barbershopId, userId, {
          kind: "INVALID",
          categoryId: recCategoryId,
          title: "Teste",
          originalAmount: "100.00",
          issuedOn: "2026-06-01",
          dueOn: "2026-06-15",
        })
      ).rejects.toThrow("kind deve ser PAYABLE ou RECEIVABLE.");

      await expect(
        createTitle(barbershopId, userId, {
          kind: "RECEIVABLE",
          categoryId: recCategoryId,
          title: "   ",
          originalAmount: "100.00",
          issuedOn: "2026-06-01",
          dueOn: "2026-06-15",
        })
      ).rejects.toThrow("Título é obrigatório.");
    });

    it("rejects dueOn earlier than issuedOn", async () => {
      await expect(
        createTitle(barbershopId, userId, {
          kind: "RECEIVABLE",
          categoryId: recCategoryId,
          title: "Teste Data",
          originalAmount: "100.00",
          issuedOn: "2026-06-15",
          dueOn: "2026-06-01",
        })
      ).rejects.toThrow("Data de vencimento (dueOn) não pode ser anterior à data de emissão (issuedOn).");
    });

    it("rejects inactive category or classification mismatch", async () => {
      await expect(
        createTitle(barbershopId, userId, {
          kind: "RECEIVABLE",
          categoryId: inactiveCategoryId,
          title: "Teste Inativa",
          originalAmount: "100.00",
          issuedOn: "2026-06-01",
          dueOn: "2026-06-15",
        })
      ).rejects.toThrow("Categoria financeira não encontrada ou inativa.");

      await expect(
        createTitle(barbershopId, userId, {
          kind: "RECEIVABLE",
          categoryId: payCategoryId,
          title: "Mismatch",
          originalAmount: "100.00",
          issuedOn: "2026-06-01",
          dueOn: "2026-06-15",
        })
      ).rejects.toThrow("não permite categoria de classificação");
    });
  });

  describe("Title Mutation & Lock Matrix", () => {
    it("prevents changing kind (kind is immutable)", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Título Imutável",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      await expect(
        updateTitle(barbershopId, title.id, userId, { kind: "PAYABLE" })
      ).rejects.toThrow("O tipo do título (kind) é imutável.");
    });

    it("allows updating category, originalAmount, dates, title before settlement history", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Título Editável",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      const updated = await updateTitle(barbershopId, title.id, userId, {
        title: "Título Alterado",
        originalAmount: "200.00",
        dueOn: "2026-06-20",
      });

      expect(updated.title).toBe("Título Alterado");
      expect(updated.originalAmount.toFixed(2)).toBe("200.00");

      const events = await prisma.financialTitleEvent.findMany({
        where: { titleId: title.id, type: "UPDATED" },
      });
      expect(events.length).toBe(1);
    });

    it("locks category, originalAmount, issuedOn once settlement history exists", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Título Com Histórico",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      // Create settlement and then reverse it (history exists)
      const { result: settlement } = await createSettlement(
        barbershopId,
        title.id,
        userId,
        randomUUID(),
        { principalAmount: "50.00", method: "PIX" }
      );
      await reverseSettlement(
        barbershopId,
        settlement.id,
        userId,
        randomUUID(),
        { reason: "Estorno de teste" }
      );

      // Historical settlement exists => category and originalAmount are locked
      await expect(
        updateTitle(barbershopId, title.id, userId, { originalAmount: "150.00" })
      ).rejects.toThrow("Valor original não pode ser alterado após histórico de liquidações.");

      // But title and dueOn can still be updated
      const updated = await updateTitle(barbershopId, title.id, userId, {
        title: "Título Com Histórico Atualizado",
        dueOn: "2026-06-25",
      });
      expect(updated.title).toBe("Título Com Histórico Atualizado");
    });
  });

  describe("Cancellation Rules", () => {
    it("cancels title when no active settlements exist", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "A Cancelar",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      const cancelled = await cancelTitle(barbershopId, title.id, userId, "Cliente desistiu");
      expect(cancelled.cancelledAt).not.toBeNull();
      expect(cancelled.cancelReason).toBe("Cliente desistiu");

      const events = await prisma.financialTitleEvent.findMany({
        where: { titleId: title.id, type: "CANCELLED" },
      });
      expect(events.length).toBe(1);
    });

    it("blocks cancellation if active settlement exists", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Com Liquidação Ativa",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-15",
      });

      await createSettlement(
        barbershopId,
        title.id,
        userId,
        randomUUID(),
        { principalAmount: "50.00", method: "PIX" }
      );

      await expect(
        cancelTitle(barbershopId, title.id, userId, "Tentar cancelar")
      ).rejects.toThrow("Não é possível cancelar um título que possui liquidações ativas.");
    });
  });

  describe("Listing and GetById", () => {
    it("retrieves full title details with derived status and events", async () => {
      const title = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Detalhes do Título",
        originalAmount: "300.00",
        issuedOn: "2026-06-01",
        dueOn: "2029-06-15",
      });

      const details = await getTitleById(barbershopId, title.id);
      expect(details).not.toBeNull();
      expect(details!.id).toBe(title.id);
      expect(details!.derivedStatus).toBe("OPEN");
      expect(details!.events.length).toBe(1);
    });

    it("lists titles tenant-scoped with derived status filters and pagination", async () => {
      await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Título 1",
        originalAmount: "100.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-10",
      });

      await createTitle(barbershopId, userId, {
        kind: "PAYABLE",
        categoryId: payCategoryId,
        title: "Título 2",
        originalAmount: "200.00",
        issuedOn: "2026-06-01",
        dueOn: "2026-06-20",
      });

      const listAll = await listTitles(barbershopId, { page: 1, limit: 10, civilToday: "2026-06-05" });
      expect(listAll.total).toBe(2);

      const listPayable = await listTitles(barbershopId, { kind: "PAYABLE" });
      expect(listPayable.total).toBe(1);
      expect(listPayable.items[0].kind).toBe("PAYABLE");

      // Verify cross-tenant isolation
      const listOther = await listTitles(otherBarbershopId, {});
      expect(listOther.total).toBe(0);
    });

    it("orders listed titles strictly by due_on ASC, created_at DESC, and id ASC as tiebreakers", async () => {
      // 1. Same dueOn (2026-10-10), different createdAt to prove createdAt DESC
      const titleA = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Title A Older CreatedAt",
        originalAmount: "100.00",
        issuedOn: "2026-10-01",
        dueOn: "2026-10-10",
      });
      await prisma.financialTitle.update({
        where: { id: titleA.id },
        data: { createdAt: new Date("2026-10-01T10:00:00.000Z") },
      });

      const titleB = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Title B Newer CreatedAt",
        originalAmount: "100.00",
        issuedOn: "2026-10-01",
        dueOn: "2026-10-10",
      });
      await prisma.financialTitle.update({
        where: { id: titleB.id },
        data: { createdAt: new Date("2026-10-01T11:00:00.000Z") },
      });

      // 2. Same dueOn (2026-10-10) and same createdAt, different IDs to prove id ASC tiebreaker
      const fixedCreatedAt = new Date("2026-10-01T12:00:00.000Z");

      const titleC = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Title C",
        originalAmount: "100.00",
        issuedOn: "2026-10-01",
        dueOn: "2026-10-10",
      });

      const titleD = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Title D",
        originalAmount: "100.00",
        issuedOn: "2026-10-01",
        dueOn: "2026-10-10",
      });

      await prisma.financialTitle.update({
        where: { id: titleC.id },
        data: { createdAt: fixedCreatedAt },
      });
      await prisma.financialTitle.update({
        where: { id: titleD.id },
        data: { createdAt: fixedCreatedAt },
      });

      // 3. Earlier dueOn (2026-10-05) to prove dueOn ASC
      const titleE = await createTitle(barbershopId, userId, {
        kind: "RECEIVABLE",
        categoryId: recCategoryId,
        title: "Title E Earlier DueOn",
        originalAmount: "100.00",
        issuedOn: "2026-10-01",
        dueOn: "2026-10-05",
      });

      const result = await listTitles(barbershopId, { page: 1, limit: 10, civilToday: "2026-10-01" });
      const ids = result.items.map((item) => item.id);

      // 1. dueOn ASC: titleE (dueOn 2026-10-05) comes first
      expect(ids[0]).toBe(titleE.id);

      // 2. createdAt DESC: titleB (11:00) comes before titleA (10:00)
      const bIndex = ids.indexOf(titleB.id);
      const aIndex = ids.indexOf(titleA.id);
      expect(bIndex).toBeLessThan(aIndex);

      // 3. id ASC tiebreaker for identical dueOn (2026-10-10) and identical createdAt (12:00)
      const smallerId = [titleC.id, titleD.id].sort()[0];
      const largerId = [titleC.id, titleD.id].sort()[1];
      const smallerIndex = ids.indexOf(smallerId);
      const largerIndex = ids.indexOf(largerId);
      expect(smallerIndex).toBeLessThan(largerIndex);
      expect(smallerIndex).toBeLessThan(bIndex);
    });
  });
});
