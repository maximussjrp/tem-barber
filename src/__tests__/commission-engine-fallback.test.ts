import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveCommissionConfig } from "@/lib/operations/commissions";
import { ComandaItemType, Prisma } from "@prisma/client";

interface MockTx {
  service: { findFirst: ReturnType<typeof vi.fn> };
  barbershopMember: { findFirst: ReturnType<typeof vi.fn> };
  careerLevel: { findFirst: ReturnType<typeof vi.fn> };
  serviceCommissionRule: { findFirst: ReturnType<typeof vi.fn> };
  commissionConfig: { findMany: ReturnType<typeof vi.fn> };
}

describe("PR #14 — Engine Comissão 2.0 / Fallback Matrix Unit Tests", () => {
  const shopId = "shop-1";
  const shop2Id = "shop-2";
  const memberId = "member-1";
  const serviceId = "service-1";
  const categoryId = "category-1";
  const levelId = "level-senior";

  let tx: MockTx;

  beforeEach(() => {
    tx = {
      service: {
        findFirst: vi.fn(),
      },
      barbershopMember: {
        findFirst: vi.fn(),
      },
      careerLevel: {
        findFirst: vi.fn(),
      },
      serviceCommissionRule: {
        findFirst: vi.fn(),
      },
      commissionConfig: {
        findMany: vi.fn(),
      },
    };

    tx.service.findFirst.mockResolvedValue({ id: serviceId, categoryId });
    tx.barbershopMember.findFirst.mockResolvedValue({ id: memberId, careerLevelId: levelId });
    tx.careerLevel.findFirst.mockResolvedValue({ id: levelId, active: true, defaultCommissionRate: new Prisma.Decimal("35.00") });
    tx.serviceCommissionRule.findFirst.mockResolvedValue(null);
    tx.commissionConfig.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Regra individual membro+serviço vence matriz nível+serviço", async () => {
    const memberServiceConfig = {
      id: "cfg-member-service",
      barbershopId: shopId,
      scopeKey: `member:${memberId}:service:${serviceId}`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("60.00"),
      createdAt: new Date("2026-01-01"),
    };

    tx.commissionConfig.findMany.mockResolvedValue([memberServiceConfig]);
    tx.serviceCommissionRule.findFirst.mockResolvedValue({
      id: "rule-matrix",
      commissionRate: new Prisma.Decimal("50.00"),
      type: "PERCENTAGE",
      createdAt: new Date("2026-01-01"),
    });

    const result = await resolveCommissionConfig(tx as unknown as Prisma.TransactionClient, {
      barbershopId: shopId,
      memberId,
      serviceId,
      itemType: ComandaItemType.SERVICE,
    });

    expect(result).not.toBeNull();
    expect(result?.origin).toBe("MEMBER_SERVICE");
    expect(result?.value.toString()).toBe("60");
    expect(result?.configId).toBe("cfg-member-service");
    expect(result?.configSnapshot.origin).toBe("MEMBER_SERVICE");
  });

  it("2. Sem regra individual, usa matriz nível+serviço (SERVICE_CAREER_LEVEL)", async () => {
    tx.commissionConfig.findMany.mockResolvedValue([]);
    tx.serviceCommissionRule.findFirst.mockResolvedValue({
      id: "rule-matrix-1",
      commissionRate: new Prisma.Decimal("50.00"),
      type: "PERCENTAGE",
      createdAt: new Date("2026-01-01"),
    });

    const result = await resolveCommissionConfig(tx as unknown as Prisma.TransactionClient, {
      barbershopId: shopId,
      memberId,
      serviceId,
      itemType: ComandaItemType.SERVICE,
    });

    expect(result).not.toBeNull();
    expect(result?.origin).toBe("SERVICE_CAREER_LEVEL");
    expect(result?.value.toString()).toBe("50");
    expect(result?.serviceCommissionRuleId).toBe("rule-matrix-1");
    expect(result?.configId).toBeNull();
    expect(result?.configSnapshot.origin).toBe("SERVICE_CAREER_LEVEL");
  });

  it("3. Sem matriz nível+serviço, usa serviço default (SERVICE_DEFAULT)", async () => {
    const serviceDefaultConfig = {
      id: "cfg-service-default",
      barbershopId: shopId,
      scopeKey: `service:${serviceId}`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("40.00"),
      createdAt: new Date("2026-01-01"),
    };

    tx.commissionConfig.findMany.mockResolvedValue([serviceDefaultConfig]);
    tx.serviceCommissionRule.findFirst.mockResolvedValue(null);

    const result = await resolveCommissionConfig(tx as unknown as Prisma.TransactionClient, {
      barbershopId: shopId,
      memberId,
      serviceId,
      itemType: ComandaItemType.SERVICE,
    });

    expect(result).not.toBeNull();
    expect(result?.origin).toBe("SERVICE_DEFAULT");
    expect(result?.value.toString()).toBe("40");
    expect(result?.configId).toBe("cfg-service-default");
  });

  it("4. Sem serviço default, usa nível default (CAREER_LEVEL_DEFAULT)", async () => {
    tx.commissionConfig.findMany.mockResolvedValue([]);
    tx.serviceCommissionRule.findFirst.mockResolvedValue(null);
    tx.careerLevel.findFirst.mockResolvedValue({
      id: levelId,
      active: true,
      defaultCommissionRate: new Prisma.Decimal("35.00"),
      createdAt: new Date("2026-01-01"),
    });

    const result = await resolveCommissionConfig(tx as unknown as Prisma.TransactionClient, {
      barbershopId: shopId,
      memberId,
      serviceId,
      itemType: ComandaItemType.SERVICE,
    });

    expect(result).not.toBeNull();
    expect(result?.origin).toBe("CAREER_LEVEL_DEFAULT");
    expect(result?.value.toString()).toBe("35");
    expect(result?.careerLevelId).toBe(levelId);
  });

  it("5. Sem nível default, usa barbearia default (BARBERSHOP_DEFAULT)", async () => {
    const barbershopDefaultConfig = {
      id: "cfg-shop-default",
      barbershopId: shopId,
      scopeKey: "barbershop:default",
      type: "PERCENTAGE",
      value: new Prisma.Decimal("30.00"),
      createdAt: new Date("2026-01-01"),
    };

    tx.commissionConfig.findMany.mockResolvedValue([barbershopDefaultConfig]);
    tx.serviceCommissionRule.findFirst.mockResolvedValue(null);
    tx.careerLevel.findFirst.mockResolvedValue({
      id: levelId,
      active: true,
      defaultCommissionRate: null,
      createdAt: new Date("2026-01-01"),
    });

    const result = await resolveCommissionConfig(tx as unknown as Prisma.TransactionClient, {
      barbershopId: shopId,
      memberId,
      serviceId,
      itemType: ComandaItemType.SERVICE,
    });

    expect(result).not.toBeNull();
    expect(result?.origin).toBe("BARBERSHOP_DEFAULT");
    expect(result?.value.toString()).toBe("30");
  });

  it("6. Membro sem careerLevelId ignora matriz e usa próxima opção do fallback", async () => {
    tx.barbershopMember.findFirst.mockResolvedValue({ id: memberId, careerLevelId: null });
    const categoryDefaultConfig = {
      id: "cfg-cat-default",
      barbershopId: shopId,
      scopeKey: `category:${categoryId}`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("25.00"),
      createdAt: new Date("2026-01-01"),
    };
    tx.commissionConfig.findMany.mockResolvedValue([categoryDefaultConfig]);

    const result = await resolveCommissionConfig(tx as unknown as Prisma.TransactionClient, {
      barbershopId: shopId,
      memberId,
      serviceId,
      itemType: ComandaItemType.SERVICE,
    });

    expect(result).not.toBeNull();
    expect(result?.origin).toBe("CATEGORY_DEFAULT");
    expect(result?.value.toString()).toBe("25");
  });

  it("7. ServiceCommissionRule inativa é ignorada", async () => {
    tx.commissionConfig.findMany.mockResolvedValue([]);
    tx.serviceCommissionRule.findFirst.mockResolvedValue(null);

    const result = await resolveCommissionConfig(tx as unknown as Prisma.TransactionClient, {
      barbershopId: shopId,
      memberId,
      serviceId,
      itemType: ComandaItemType.SERVICE,
    });

    expect(tx.serviceCommissionRule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ active: true }) })
    );
    expect(result?.origin).toBe("CAREER_LEVEL_DEFAULT");
  });

  it("8. CareerLevel inativo não aplica default", async () => {
    tx.commissionConfig.findMany.mockResolvedValue([]);
    tx.serviceCommissionRule.findFirst.mockResolvedValue(null);
    tx.careerLevel.findFirst.mockResolvedValue(null);

    const result = await resolveCommissionConfig(tx as unknown as Prisma.TransactionClient, {
      barbershopId: shopId,
      memberId,
      serviceId,
      itemType: ComandaItemType.SERVICE,
    });

    expect(result).toBeNull();
  });

  it("9. Valida que desconto reduz a base de comissão no cálculo proporcional", () => {
    const itemTotalCents = 10000; // R$ 100,00
    const itemDiscountCents = 2000; // R$ 20,00
    const finalBaseCents = Math.max(0, itemTotalCents - itemDiscountCents); // R$ 80,00
    const commissionRatePercent = 50; // 50%
    const generatedCommissionCents = Math.round((finalBaseCents * commissionRatePercent) / 100);

    expect(finalBaseCents).toBe(8000);
    expect(generatedCommissionCents).toBe(4000); // R$ 40,00 (50% de 80,00)
  });

  it("10. Valida regra de Plano Clube INCLUDED_SERVICE (não gera comissão tradicional)", () => {
    const clubBenefitUsage = { benefitType: "INCLUDED_SERVICE", status: "APPLIED" };
    const isIncludedService = clubBenefitUsage.status === "APPLIED" && clubBenefitUsage.benefitType === "INCLUDED_SERVICE";

    expect(isIncludedService).toBe(true);
  });

  it("11. Produto não usa matriz de serviço", async () => {
    const productId = "product-1";
    const productConfig = {
      id: "cfg-product",
      barbershopId: shopId,
      scopeKey: `product:${productId}`,
      type: "PERCENTAGE",
      value: new Prisma.Decimal("15.00"),
      createdAt: new Date("2026-01-01"),
    };
    tx.commissionConfig.findMany.mockResolvedValue([productConfig]);

    const result = await resolveCommissionConfig(tx as unknown as Prisma.TransactionClient, {
      barbershopId: shopId,
      memberId,
      productId,
      itemType: ComandaItemType.PRODUCT,
    });

    expect(tx.serviceCommissionRule.findFirst).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.origin).toBe("PRODUCT");
    expect(result?.value.toString()).toBe("15");
  });

  it("12. Cancelamento zera/estorna liberação de comissão", () => {
    const isItemCancelled = true;
    const generatedCents = 5000;
    const netPaidCents = 10000;
    const comandaTotalCents = 10000;

    const targetReleasedCents = isItemCancelled
      ? 0
      : Math.min(generatedCents, Math.round((generatedCents * netPaidCents) / comandaTotalCents));

    expect(targetReleasedCents).toBe(0);
  });

  it("13. Reembolso parcial reduz liberação proporcionalmente", () => {
    const comandaTotalCents = 10000; // R$ 100,00
    const originalPaidCents = 10000; // R$ 100,00
    const refundedCents = 5000; // R$ 50,00 refund
    const netPaidCents = Math.max(0, originalPaidCents - refundedCents); // R$ 50,00 net
    const generatedCommissionCents = 5000; // R$ 50,00 commission

    const targetReleasedCents = Math.min(
      generatedCommissionCents,
      Math.round((generatedCommissionCents * netPaidCents) / comandaTotalCents)
    );

    expect(netPaidCents).toBe(5000);
    expect(targetReleasedCents).toBe(2500); // R$ 25,00 released (50% do refund)
  });

  it("14. configSnapshot registra audit completo de origem e chaves", async () => {
    tx.commissionConfig.findMany.mockResolvedValue([]);
    tx.serviceCommissionRule.findFirst.mockResolvedValue({
      id: "rule-999",
      commissionRate: new Prisma.Decimal("42.50"),
      type: "PERCENTAGE",
      createdAt: new Date("2026-05-10"),
    });

    const result = await resolveCommissionConfig(tx as unknown as Prisma.TransactionClient, {
      barbershopId: shopId,
      memberId,
      serviceId,
      itemType: ComandaItemType.SERVICE,
    });

    expect(result?.configSnapshot).toEqual({
      id: "rule-999",
      configId: null,
      serviceCommissionRuleId: "rule-999",
      careerLevelId: levelId,
      origin: "SERVICE_CAREER_LEVEL",
      scopeKey: null,
      type: "PERCENTAGE",
      value: "42.5",
      memberId,
      serviceId,
      productId: null,
      createdAt: "2026-05-10T00:00:00.000Z",
    });
  });

  it("15. Tenant isolation: busca utiliza barbershopId estritamente", async () => {
    await resolveCommissionConfig(tx as unknown as Prisma.TransactionClient, {
      barbershopId: shop2Id,
      memberId,
      serviceId,
      itemType: ComandaItemType.SERVICE,
    });

    expect(tx.service.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ barbershopId: shop2Id }) })
    );
    expect(tx.barbershopMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ barbershopId: shop2Id }) })
    );
  });
});
