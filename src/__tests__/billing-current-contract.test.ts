import { describe, expect, it } from "vitest";
import { AsaasSubscriptionStatus } from "@prisma/client";
import {
  isBillableSubscription,
  selectCurrentBillableAsaasSubscription,
  selectCurrentPaymentForContract,
} from "@/lib/billing/current-contract";

describe("Canonical Asaas Contract Selection (Pure)", () => {
  describe("isBillableSubscription", () => {
    it("identifica ACTIVE sem canceledAt como billable", () => {
      expect(isBillableSubscription({ status: "ACTIVE", canceledAt: null })).toBe(true);
    });

    it("identifica OVERDUE sem canceledAt como billable", () => {
      expect(isBillableSubscription({ status: "OVERDUE", canceledAt: null })).toBe(true);
    });

    it("rejeita assinatura com canceledAt preenchido", () => {
      expect(isBillableSubscription({ status: "ACTIVE", canceledAt: new Date() })).toBe(false);
    });

    it("rejeita status não billable como INACTIVE, SUSPENDED ou UNKNOWN", () => {
      expect(isBillableSubscription({ status: "INACTIVE", canceledAt: null })).toBe(false);
      expect(isBillableSubscription({ status: "SUSPENDED", canceledAt: null })).toBe(false);
      expect(isBillableSubscription({ status: "UNKNOWN", canceledAt: null })).toBe(false);
    });

    it("trata nulo ou indefinido com segurança", () => {
      expect(isBillableSubscription(null)).toBe(false);
      expect(isBillableSubscription(undefined)).toBe(false);
    });
  });

  describe("selectCurrentBillableAsaasSubscription", () => {
    it("retorna NONE quando lista de registros é vazia", () => {
      const result = selectCurrentBillableAsaasSubscription([]);
      expect(result.status).toBe("NONE");
      expect(result.subscription).toBeNull();
      expect(result.isReconciliationRequired).toBe(false);
    });

    it("retorna NONE quando nenhum contrato é billable", () => {
      const subs = [
        {
          id: "s-1",
          barbershopId: "shop-1",
          asaasSubscriptionId: "sub_1",
          status: AsaasSubscriptionStatus.INACTIVE,
          canceledAt: null,
        },
        {
          id: "s-2",
          barbershopId: "shop-1",
          asaasSubscriptionId: "sub_2",
          status: AsaasSubscriptionStatus.ACTIVE,
          canceledAt: new Date("2026-02-01"),
        },
      ];
      const result = selectCurrentBillableAsaasSubscription(subs);
      expect(result.status).toBe("NONE");
      expect(result.subscription).toBeNull();
      expect(result.isReconciliationRequired).toBe(false);
    });

    it("retorna FOUND quando há exatamente um contrato ACTIVE", () => {
      const subs = [
        {
          id: "s-1",
          barbershopId: "shop-1",
          asaasSubscriptionId: "sub_active",
          status: AsaasSubscriptionStatus.ACTIVE,
          canceledAt: null,
          createdAt: new Date("2026-03-01"),
        },
        {
          id: "s-old",
          barbershopId: "shop-1",
          asaasSubscriptionId: "sub_cancelled",
          status: AsaasSubscriptionStatus.INACTIVE,
          canceledAt: new Date("2026-01-01"),
          createdAt: new Date("2026-01-01"),
        },
      ];
      const result = selectCurrentBillableAsaasSubscription(subs);
      expect(result.status).toBe("FOUND");
      if (result.status === "FOUND") {
        expect(result.subscription.asaasSubscriptionId).toBe("sub_active");
        expect(result.isReconciliationRequired).toBe(false);
      }
    });

    it("retorna FOUND quando há exatamente um contrato OVERDUE", () => {
      const subs = [
        {
          id: "s-1",
          barbershopId: "shop-1",
          asaasSubscriptionId: "sub_overdue",
          status: AsaasSubscriptionStatus.OVERDUE,
          canceledAt: null,
          createdAt: new Date("2026-03-01"),
        },
      ];
      const result = selectCurrentBillableAsaasSubscription(subs);
      expect(result.status).toBe("FOUND");
      if (result.status === "FOUND") {
        expect(result.subscription.asaasSubscriptionId).toBe("sub_overdue");
      }
    });

    it("retorna RECONCILIATION_REQUIRED quando há mais de um contrato billable", () => {
      const subs = [
        {
          id: "s-1",
          barbershopId: "shop-1",
          asaasSubscriptionId: "sub_active_1",
          status: AsaasSubscriptionStatus.ACTIVE,
          canceledAt: null,
          createdAt: new Date("2026-03-01"),
        },
        {
          id: "s-2",
          barbershopId: "shop-1",
          asaasSubscriptionId: "sub_active_2",
          status: AsaasSubscriptionStatus.ACTIVE,
          canceledAt: null,
          createdAt: new Date("2026-04-01"),
        },
      ];
      const result = selectCurrentBillableAsaasSubscription(subs);
      expect(result.status).toBe("RECONCILIATION_REQUIRED");
      if (result.status === "RECONCILIATION_REQUIRED") {
        expect(result.isReconciliationRequired).toBe(true);
        expect(result.count).toBe(2);
        expect(result.errorCode).toBe("BILLING_SUBSCRIPTION_RECONCILIATION_REQUIRED");
        expect(result.subscriptions).toHaveLength(2);
      }
    });
  });
});

describe("Current Payment For Contract Selection (Pure)", () => {
  const contract = {
    barbershopId: "shop-1",
    asaasSubscriptionId: "sub_target",
  };

  it("retorna null quando array de pagamentos é vazio", () => {
    const result = selectCurrentPaymentForContract([], contract);
    expect(result).toBeNull();
  });

  it("retorna null se currentContract for nulo", () => {
    const payments = [
      {
        id: "p1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_target",
        dueDate: new Date("2026-08-01"),
      },
    ];
    expect(selectCurrentPaymentForContract(payments, null)).toBeNull();
  });

  it("ignora pagamentos pertencentes a outro contrato ou outro tenant", () => {
    const payments = [
      {
        id: "p-other-sub",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_OTHER",
        asaasPaymentId: "pay_other_sub",
        dueDate: new Date("2026-08-01"),
      },
      {
        id: "p-other-shop",
        barbershopId: "shop-OTHER",
        asaasSubscriptionId: "sub_target",
        asaasPaymentId: "pay_other_shop",
        dueDate: new Date("2026-08-01"),
      },
    ];
    const result = selectCurrentPaymentForContract(payments, contract);
    expect(result).toBeNull();
  });

  it("seleciona a cobrança com dueDate mais recente (dueDate DESC)", () => {
    const payments = [
      {
        id: "p-older",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_target",
        asaasPaymentId: "pay_older",
        dueDate: new Date("2026-07-01"),
        createdAt: new Date("2026-06-01"),
      },
      {
        id: "p-newer",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_target",
        asaasPaymentId: "pay_newer",
        dueDate: new Date("2026-08-01"),
        createdAt: new Date("2026-07-01"),
      },
    ];
    const result = selectCurrentPaymentForContract(payments, contract);
    expect(result).not.toBeNull();
    expect(result?.asaasPaymentId).toBe("pay_newer");
  });

  it("desempata por createdAt DESC quando dueDate é idêntico", () => {
    const payments = [
      {
        id: "p-first",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_target",
        asaasPaymentId: "pay_first",
        dueDate: new Date("2026-08-01"),
        createdAt: new Date("2026-07-01T10:00:00Z"),
      },
      {
        id: "p-second",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_target",
        asaasPaymentId: "pay_second",
        dueDate: new Date("2026-08-01"),
        createdAt: new Date("2026-07-01T12:00:00Z"),
      },
    ];
    const result = selectCurrentPaymentForContract(payments, contract);
    expect(result).not.toBeNull();
    expect(result?.asaasPaymentId).toBe("pay_second");
  });
});
