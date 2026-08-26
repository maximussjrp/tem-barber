import { describe, expect, it } from "vitest";
import { ComandaItemStatus, ComandaItemType, Prisma } from "@prisma/client";
import { isCommissionEligibleItem } from "@/lib/operations/commissions";

const total = new Prisma.Decimal("35.00");

describe("commission eligibility safety", () => {
  it("excludes SERVICE PENDING", () => {
    expect(isCommissionEligibleItem({
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.PENDING,
      completedAt: null,
      total,
    })).toBe(false);
  });

  it("requires completedAt for SERVICE DONE", () => {
    expect(isCommissionEligibleItem({
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: null,
      total,
    })).toBe(false);
    expect(isCommissionEligibleItem({
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.DONE,
      completedAt: new Date("2026-08-25T12:00:00.000Z"),
      total,
    })).toBe(true);
  });

  it("excludes PRODUCT PENDING and preserves PRODUCT DONE", () => {
    expect(isCommissionEligibleItem({
      type: ComandaItemType.PRODUCT,
      status: ComandaItemStatus.PENDING,
      completedAt: null,
      total,
    })).toBe(false);
    expect(isCommissionEligibleItem({
      type: ComandaItemType.PRODUCT,
      status: ComandaItemStatus.DONE,
      completedAt: null,
      total,
    })).toBe(true);
  });

  it("excludes cancelled and zero-value items", () => {
    expect(isCommissionEligibleItem({
      type: ComandaItemType.SERVICE,
      status: ComandaItemStatus.CANCELLED,
      completedAt: new Date(),
      total,
    })).toBe(false);
    expect(isCommissionEligibleItem({
      type: ComandaItemType.PRODUCT,
      status: ComandaItemStatus.DONE,
      completedAt: null,
      total: new Prisma.Decimal("0.00"),
    })).toBe(false);
  });
});