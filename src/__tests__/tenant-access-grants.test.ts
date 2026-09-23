import { describe, expect, it } from "vitest";
import {
  normalizeReason,
  computeGrantRequestHash,
  calculateGrantWindow,
  deriveTenantEffectiveAccess,
  AccessGrantInput,
} from "@/lib/billing/access-grants";
import { SubscriptionInput } from "@/lib/billing/subscription-access";
import { isSubscriptionActive } from "@/lib/subscription-utils";

type TestSubscriptionWithGrants = SubscriptionInput & {
  id?: string;
  barbershopId?: string;
  planId?: string;
  planName?: string;
  accessGrants?: AccessGrantInput[];
};

describe("Domain B — Tenant Access Grants Pure Logic (tenant-access-grants.test.ts)", () => {
  const now = new Date("2026-07-28T12:00:00.000-03:00");

  describe("1. normalizeReason & computeGrantRequestHash", () => {
    it("normalizeReason trims and collapses multiple whitespace characters", () => {
      expect(normalizeReason("  Parceria   comercial  2026  ")).toBe("Parceria comercial 2026");
      expect(normalizeReason("\n\tAjuste   emergencial\n")).toBe("Ajuste emergencial");
    });

    it("computeGrantRequestHash generates deterministic SHA-256 hex string", () => {
      const hash1 = computeGrantRequestHash({
        barbershopId: "shop-123",
        daysGranted: 15,
        normalizedReason: "Teste de cortesia",
        actorUserId: "user-admin",
      });
      const hash2 = computeGrantRequestHash({
        barbershopId: "shop-123",
        daysGranted: 15,
        normalizedReason: "Teste de cortesia",
        actorUserId: "user-admin",
      });
      const hashDiff = computeGrantRequestHash({
        barbershopId: "shop-123",
        daysGranted: 30,
        normalizedReason: "Teste de cortesia",
        actorUserId: "user-admin",
      });

      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hashDiff);
    });
  });

  describe("2. calculateGrantWindow (Stacking)", () => {
    it("anchors to now when no active subscription and no existing grants", () => {
      const { startsAt, endsAt } = calculateGrantWindow({
        subscription: null,
        existingGrants: [],
        daysGranted: 7,
        now,
      });

      expect(startsAt.getTime()).toBe(now.getTime());
      expect(endsAt.getTime()).toBe(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    });

    it("anchors to baseAccess.validUntil when active paid subscription exists in the future", () => {
      const validUntil = new Date("2026-08-15T12:00:00.000-03:00");
      const { startsAt, endsAt } = calculateGrantWindow({
        subscription: {
          status: "ACTIVE",
          currentPeriodStart: new Date("2026-07-15T12:00:00.000-03:00"),
          currentPeriodEnd: validUntil,
        },
        existingGrants: [],
        daysGranted: 14,
        now,
      });

      expect(startsAt.getTime()).toBe(validUntil.getTime());
      expect(endsAt.getTime()).toBe(validUntil.getTime() + 14 * 24 * 60 * 60 * 1000);
    });

    it("stacks after the latest active grant when existing grants are present", () => {
      const grant1End = new Date("2026-08-10T12:00:00.000-03:00");
      const grant2End = new Date("2026-08-20T12:00:00.000-03:00");

      const { startsAt, endsAt } = calculateGrantWindow({
        subscription: null,
        existingGrants: [
          { endsAt: grant1End, revokedAt: null },
          { endsAt: grant2End, revokedAt: null },
        ],
        daysGranted: 10,
        now,
      });

      expect(startsAt.getTime()).toBe(grant2End.getTime());
      expect(endsAt.getTime()).toBe(grant2End.getTime() + 10 * 24 * 60 * 60 * 1000);
    });

    it("ignores revoked grants when calculating anchor", () => {
      const revokedGrantEnd = new Date("2026-08-30T12:00:00.000-03:00");
      const activeGrantEnd = new Date("2026-08-05T12:00:00.000-03:00");

      const { startsAt, endsAt } = calculateGrantWindow({
        subscription: null,
        existingGrants: [
          { endsAt: revokedGrantEnd, revokedAt: new Date("2026-07-20T12:00:00.000-03:00") },
          { endsAt: activeGrantEnd, revokedAt: null },
        ],
        daysGranted: 5,
        now,
      });

      expect(startsAt.getTime()).toBe(activeGrantEnd.getTime());
      expect(endsAt.getTime()).toBe(activeGrantEnd.getTime() + 5 * 24 * 60 * 60 * 1000);
    });
  });

  describe("3. deriveTenantEffectiveAccess", () => {
    it("preserves PAID base access when subscription is active and grant is queued", () => {
      const sub = {
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-07-01T12:00:00.000-03:00"),
        currentPeriodEnd: new Date("2026-08-10T12:00:00.000-03:00"),
      };
      const grant = {
        id: "grant-1",
        barbershopId: "shop-1",
        startsAt: new Date("2026-08-10T12:00:00.000-03:00"),
        endsAt: new Date("2026-08-25T12:00:00.000-03:00"),
        daysGranted: 15,
        reason: "Bônus",
      };

      const res = deriveTenantEffectiveAccess(sub, [grant], { now });

      expect(res.accessAllowed).toBe(true);
      expect(res.accessType).toBe("PAID");
      expect(res.effectiveStatus).toBe("ACTIVE");
      expect(res.isComplimentary).toBe(false);
      expect(res.complimentary.active).toBe(false);
      expect(res.complimentary.queued).toBe(true);
      expect(res.complimentary.grantCount).toBe(1);
    });

    it("elevates expired subscription to COMPLIMENTARY when active grant exists", () => {
      const sub = {
        status: "EXPIRED",
        currentPeriodStart: new Date("2026-06-01T12:00:00.000-03:00"),
        currentPeriodEnd: new Date("2026-07-01T12:00:00.000-03:00"),
      };
      const grant = {
        id: "grant-2",
        barbershopId: "shop-1",
        startsAt: new Date("2026-07-20T12:00:00.000-03:00"),
        endsAt: new Date("2026-08-04T12:00:00.000-03:00"), // 7 dias restantes
        daysGranted: 15,
        reason: "Cortesia de suporte",
      };

      const res = deriveTenantEffectiveAccess(sub, [grant], { now });

      expect(res.accessAllowed).toBe(true);
      expect(res.accessType).toBe("COMPLIMENTARY");
      expect(res.effectiveStatus).toBe("COMPLIMENTARY");
      expect(res.isComplimentary).toBe(true);
      expect(res.complimentary.active).toBe(true);
      expect(res.complimentary.activeGrantId).toBe("grant-2");
      expect(res.remainingDays).toBe(7);
      expect(res.remainingLabel).toBe("Restam 7 dias de cortesia");
    });

    it("grants access to tenant with NO_SUBSCRIPTION when active grant exists", () => {
      const grant = {
        id: "grant-3",
        barbershopId: "shop-1",
        startsAt: new Date("2026-07-27T12:00:00.000-03:00"),
        endsAt: new Date("2026-07-29T12:00:00.000-03:00"), // 1 dia restante
        daysGranted: 2,
        reason: "Novo parceiro",
      };

      const res = deriveTenantEffectiveAccess(null, [grant], { now });

      expect(res.accessAllowed).toBe(true);
      expect(res.accessType).toBe("COMPLIMENTARY");
      expect(res.remainingDays).toBe(1);
      expect(res.remainingLabel).toBe("Restam 1 dia de cortesia");
    });

    it("blocks access when grant is expired", () => {
      const grant = {
        id: "grant-old",
        barbershopId: "shop-1",
        startsAt: new Date("2026-07-01T12:00:00.000-03:00"),
        endsAt: new Date("2026-07-15T12:00:00.000-03:00"),
        daysGranted: 14,
        reason: "Passado",
      };

      const res = deriveTenantEffectiveAccess(null, [grant], { now });

      expect(res.accessAllowed).toBe(false);
      expect(res.accessType).toBe("NONE");
      expect(res.complimentary.active).toBe(false);
      expect(res.complimentary.grantCount).toBe(0);
    });

    it("blocks access when grant is revoked", () => {
      const grant = {
        id: "grant-revoked",
        barbershopId: "shop-1",
        startsAt: new Date("2026-07-20T12:00:00.000-03:00"),
        endsAt: new Date("2026-08-20T12:00:00.000-03:00"),
        daysGranted: 31,
        reason: "Cancelado",
        revokedAt: new Date("2026-07-25T12:00:00.000-03:00"),
      };

      const res = deriveTenantEffectiveAccess(null, [grant], { now });

      expect(res.accessAllowed).toBe(false);
      expect(res.complimentary.active).toBe(false);
      expect(res.complimentary.grantCount).toBe(0);
    });

    it("chains continuous overlapping/contiguous grants into total coverageEndsAt", () => {
      const grant1 = {
        id: "grant-c1",
        barbershopId: "shop-1",
        startsAt: new Date("2026-07-20T12:00:00.000-03:00"),
        endsAt: new Date("2026-08-01T12:00:00.000-03:00"),
        daysGranted: 12,
        reason: "Lote 1",
      };
      const grant2 = {
        id: "grant-c2",
        barbershopId: "shop-1",
        startsAt: new Date("2026-08-01T12:00:00.000-03:00"),
        endsAt: new Date("2026-08-15T12:00:00.000-03:00"),
        daysGranted: 14,
        reason: "Lote 2",
      };

      const res = deriveTenantEffectiveAccess(null, [grant1, grant2], { now });

      expect(res.accessAllowed).toBe(true);
      expect(res.complimentary.coverageEndsAt?.toISOString()).toBe(new Date("2026-08-15T12:00:00.000-03:00").toISOString());
      expect(res.validUntil?.toISOString()).toBe(new Date("2026-08-15T12:00:00.000-03:00").toISOString());
    });

    it("does not cross gaps between disjoint future grants", () => {
      const grant1 = {
        id: "grant-g1",
        barbershopId: "shop-1",
        startsAt: new Date("2026-07-20T12:00:00.000-03:00"),
        endsAt: new Date("2026-08-01T12:00:00.000-03:00"),
        daysGranted: 12,
        reason: "Primeiro",
      };
      const grantGap = {
        id: "grant-gap",
        barbershopId: "shop-1",
        startsAt: new Date("2026-08-10T12:00:00.000-03:00"), // GAP de 9 dias
        endsAt: new Date("2026-08-20T12:00:00.000-03:00"),
        daysGranted: 10,
        reason: "Segundo com gap",
      };

      const res = deriveTenantEffectiveAccess(null, [grant1, grantGap], { now });

      expect(res.accessAllowed).toBe(true);
      // Cobertura contínua atual termina no grant 1
      expect(res.complimentary.coverageEndsAt?.toISOString()).toBe(new Date("2026-08-01T12:00:00.000-03:00").toISOString());
      expect(res.complimentary.latestEndsAt?.toISOString()).toBe(new Date("2026-08-20T12:00:00.000-03:00").toISOString());
    });
  });

  describe("4. isSubscriptionActive central integration", () => {
    it("returns true when tenant has complimentary grant even if subscription status is EXPIRED", () => {
      const sub: TestSubscriptionWithGrants = {
        id: "sub-expired",
        status: "EXPIRED",
        barbershopId: "shop-1",
        planId: "plan-1",
        planName: "Pro",
        trialEndsAt: new Date("2026-06-01T00:00:00.000Z"),
        currentPeriodStart: new Date("2026-06-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
        accessGrants: [
          {
            id: "grant-active",
            barbershopId: "shop-1",
            startsAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
            endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
            daysGranted: 8,
            reason: "Cortesia ativa",
            idempotencyKey: "k1",
            requestHash: "h1",
            createdByUserId: "u1",
            createdByEmail: null,
            revokedAt: null,
            revokedByUserId: null,
            revokedByEmail: null,
            revocationReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      expect(isSubscriptionActive(sub)).toBe(true);
    });

    it("returns false when tenant has no subscription and no grants", () => {
      expect(isSubscriptionActive(null)).toBe(false);
    });

    it("15. isSubscriptionActive retorna false quando SUSPENDED com grant futuro (CENTRAL_FUTURE_GRANT_GATE_TEST)", () => {
      const futureNow = new Date("2026-07-28T12:00:00.000Z");
      const sub: TestSubscriptionWithGrants = {
        id: "sub-suspended-future",
        status: "SUSPENDED",
        barbershopId: "shop-future",
        accessGrants: [
          {
            id: "grant-future",
            barbershopId: "shop-future",
            startsAt: new Date("2026-08-01T00:00:00.000Z"),
            endsAt: new Date("2026-08-15T00:00:00.000Z"),
            daysGranted: 14,
            reason: "Cortesia futura agendada",
            revokedAt: null,
          },
        ],
      };

      expect(isSubscriptionActive(sub, { now: futureNow })).toBe(false);
    });

    it("16. isSubscriptionActive retorna false quando SUSPENDED com grant revogado no período (CENTRAL_REVOKED_GRANT_GATE_TEST)", () => {
      const revokedNow = new Date("2026-07-28T12:00:00.000Z");
      const sub: TestSubscriptionWithGrants = {
        id: "sub-suspended-revoked",
        status: "SUSPENDED",
        barbershopId: "shop-revoked",
        accessGrants: [
          {
            id: "grant-revoked",
            barbershopId: "shop-revoked",
            startsAt: new Date("2026-07-20T00:00:00.000Z"),
            endsAt: new Date("2026-08-10T00:00:00.000Z"),
            daysGranted: 21,
            reason: "Cortesia cancelada",
            revokedAt: new Date("2026-07-25T00:00:00.000Z"),
          },
        ],
      };

      expect(isSubscriptionActive(sub, { now: revokedNow })).toBe(false);
    });

    it("17. Gate de agendamento público / availability não bloqueia barbearia SUSPENDED com cortesia ativa (PUBLIC_BOOKING_COURTESY_TEST)", () => {
      const subWithCourtesy: TestSubscriptionWithGrants = {
        id: "sub-suspended-active-courtesy",
        status: "SUSPENDED",
        barbershopId: "shop-courtesy",
        accessGrants: [
          {
            id: "grant-active-booking",
            barbershopId: "shop-courtesy",
            startsAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
            endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
            daysGranted: 8,
            reason: "Cortesia operacional",
            revokedAt: null,
          },
        ],
      };

      // O gate em /api/public/barbershop/[slug]/availability avalia !isSubscriptionActive(sub)
      // Se ativo, NÃO retorna 403 / SUBSCRIPTION_SUSPENDED
      const isBlocked = !isSubscriptionActive(subWithCourtesy);
      expect(isBlocked).toBe(false);
      expect(isSubscriptionActive(subWithCourtesy)).toBe(true);
    });

    it("18. Guard de membro não bloqueia nem redireciona para assinatura-suspensa quando SUSPENDED com cortesia ativa (MEMBER_COURTESY_TEST)", () => {
      const subWithCourtesy: TestSubscriptionWithGrants = {
        id: "sub-member-courtesy",
        status: "SUSPENDED",
        barbershopId: "shop-member",
        accessGrants: [
          {
            id: "grant-member-courtesy",
            barbershopId: "shop-member",
            startsAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
            endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
            daysGranted: 15,
            reason: "Cortesia membro",
            revokedAt: null,
          },
        ],
      };

      // O guard requireMember avalia: if (!isSubscriptionActive(subscription)) redirect("/assinatura-suspensa")
      const shouldRedirect = !isSubscriptionActive(subWithCourtesy);
      expect(shouldRedirect).toBe(false);
      expect(isSubscriptionActive(subWithCourtesy)).toBe(true);
    });

    it("19. Guard de admin não bloqueia nem redireciona para assinatura-suspensa quando SUSPENDED com cortesia ativa (ADMIN_COURTESY_TEST)", () => {
      const subWithCourtesy: TestSubscriptionWithGrants = {
        id: "sub-admin-courtesy",
        status: "SUSPENDED",
        barbershopId: "shop-admin",
        accessGrants: [
          {
            id: "grant-admin-courtesy",
            barbershopId: "shop-admin",
            startsAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
            endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
            daysGranted: 31,
            reason: "Cortesia admin",
            revokedAt: null,
          },
        ],
      };

      // O guard requireAdmin avalia: if (!isSubscriptionActive(subscription)) redirect("/assinatura-suspensa")
      const shouldRedirect = !isSubscriptionActive(subWithCourtesy);
      expect(shouldRedirect).toBe(false);
      expect(isSubscriptionActive(subWithCourtesy)).toBe(true);
    });
  });
});
