import { describe, expect, it } from "vitest";
import {
  deriveTenantSubscriptionAccess,
  deriveBillingStatus,
  calculateRemainingDays,
  parseAsaasDateOnly,
  formatBillingDatePtBr,
} from "@/lib/billing/subscription-access";

describe("Domain A — Core Subscription Access Pure Rules (subscription-access.ts)", () => {
  const now = new Date("2026-07-28T12:00:00.000-03:00");

  it("1. subscription null retorna NO_SUBSCRIPTION e bloqueia acesso", () => {
    const res = deriveTenantSubscriptionAccess(null, { now });
    expect(res.effectiveStatus).toBe("NO_SUBSCRIPTION");
    expect(res.accessAllowed).toBe(false);
    expect(res.accessType).toBe("NONE");
    expect(res.remainingDays).toBe(0);
    expect(res.remainingLabel).toBe("Sem assinatura");
  });

  it("2. TRIAL válido libera acesso e calcula dias restantes corretamente", () => {
    const sub = {
      status: "TRIAL",
      trialEndsAt: new Date("2026-08-04T12:00:00.000-03:00"), // 7 dias
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("TRIAL");
    expect(res.accessAllowed).toBe(true);
    expect(res.accessType).toBe("TRIAL");
    expect(res.remainingDays).toBe(7);
    expect(res.remainingLabel).toBe("Restam 7 dias do período de teste");
  });

  it("3. TRIAL vencido bloqueia acesso e altera effectiveStatus para EXPIRED", () => {
    const sub = {
      status: "TRIAL",
      trialEndsAt: new Date("2026-07-27T12:00:00.000-03:00"), // passado
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("EXPIRED");
    expect(res.accessAllowed).toBe(false);
    expect(res.remainingDays).toBe(0);
    expect(res.remainingLabel).toBe("Período encerrado");
  });

  it("4. TRIAL sem trialEndsAt bloqueia acesso (fail-closed)", () => {
    const sub = {
      status: "TRIAL",
      trialEndsAt: null,
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("EXPIRED");
    expect(res.accessAllowed).toBe(false);
    expect(res.synchronizationWarnings).toContain("TRIAL sem data trialEndsAt configurada.");
  });

  it("5. TRIAL com currentPeriodEnd futuro continua TRIAL (nunca vira ACTIVE)", () => {
    const sub = {
      status: "TRIAL",
      trialEndsAt: new Date("2026-08-02T12:00:00.000-03:00"),
      currentPeriodEnd: new Date("2026-08-28T12:00:00.000-03:00"), // legado
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("TRIAL");
    expect(res.accessType).toBe("TRIAL");
    expect(res.accessAllowed).toBe(true);
  });

  it("6. ACTIVE válido com datas corretas libera acesso PAID", () => {
    const sub = {
      status: "ACTIVE",
      currentPeriodStart: new Date("2026-07-01T12:00:00.000-03:00"),
      currentPeriodEnd: new Date("2026-08-11T12:00:00.000-03:00"), // 14 dias
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("ACTIVE");
    expect(res.accessAllowed).toBe(true);
    expect(res.accessType).toBe("PAID");
    expect(res.remainingDays).toBe(14);
    expect(res.remainingLabel).toBe("14 dias até a próxima renovação");
  });

  it("7. ACTIVE vencido altera effectiveStatus para EXPIRED e bloqueia acesso", () => {
    const sub = {
      status: "ACTIVE",
      currentPeriodStart: new Date("2026-06-01T12:00:00.000-03:00"),
      currentPeriodEnd: new Date("2026-07-01T12:00:00.000-03:00"),
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("EXPIRED");
    expect(res.accessAllowed).toBe(false);
    expect(res.remainingDays).toBe(0);
  });

  it("8. ACTIVE sem currentPeriodStart é tratado como inconsistente e bloqueia (fail-closed)", () => {
    const sub = {
      status: "ACTIVE",
      currentPeriodStart: null,
      currentPeriodEnd: new Date("2026-08-10T12:00:00.000-03:00"),
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.synchronizationWarnings).toContain("ACTIVE sem currentPeriodStart.");
  });

  it("9. ACTIVE sem currentPeriodEnd bloqueia acesso e retorna EXPIRED (fail-closed)", () => {
    const sub = {
      status: "ACTIVE",
      currentPeriodStart: new Date("2026-07-01T12:00:00.000-03:00"),
      currentPeriodEnd: null,
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("EXPIRED");
    expect(res.accessAllowed).toBe(false);
  });

  it("10. currentPeriodEnd anterior ou igual a currentPeriodStart retorna EXPIRED", () => {
    const sub = {
      status: "ACTIVE",
      currentPeriodStart: new Date("2026-08-01T12:00:00.000-03:00"),
      currentPeriodEnd: new Date("2026-07-01T12:00:00.000-03:00"),
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("EXPIRED");
    expect(res.accessAllowed).toBe(false);
  });

  it("11. PAST_DUE com gracePeriodEndsAt futuro altera status para GRACE_PERIOD e libera acesso", () => {
    const sub = {
      status: "PAST_DUE",
      gracePeriodEndsAt: new Date("2026-07-31T12:00:00.000-03:00"), // 3 dias
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("GRACE_PERIOD");
    expect(res.accessAllowed).toBe(true);
    expect(res.accessType).toBe("GRACE");
    expect(res.remainingDays).toBe(3);
    expect(res.remainingLabel).toBe("3 dias restantes da tolerância");
  });

  it("12. PAST_DUE sem gracePeriodEndsAt bloqueia acesso", () => {
    const sub = {
      status: "PAST_DUE",
      gracePeriodEndsAt: null,
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("PAST_DUE");
    expect(res.accessAllowed).toBe(false);
    expect(res.remainingDays).toBe(0);
    expect(res.remainingLabel).toBe("Acesso suspenso por atraso");
  });

  it("13. PAST_DUE com gracePeriodEndsAt vencido bloqueia acesso", () => {
    const sub = {
      status: "PAST_DUE",
      gracePeriodEndsAt: new Date("2026-07-25T12:00:00.000-03:00"),
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("PAST_DUE");
    expect(res.accessAllowed).toBe(false);
  });

  it("14. SUSPENDED sempre bloqueia acesso independentemente de datas", () => {
    const sub = {
      status: "SUSPENDED",
      trialEndsAt: new Date("2026-12-31T12:00:00.000-03:00"),
      currentPeriodEnd: new Date("2026-12-31T12:00:00.000-03:00"),
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("SUSPENDED");
    expect(res.accessAllowed).toBe(false);
    expect(res.remainingLabel).toBe("Acesso suspenso");
  });

  it("15. CANCELED sempre bloqueia acesso", () => {
    const sub = {
      status: "CANCELED",
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("CANCELED");
    expect(res.accessAllowed).toBe(false);
    expect(res.remainingLabel).toBe("Plano cancelado");
  });

  it("16. EXPIRED sempre bloqueia acesso", () => {
    const sub = {
      status: "EXPIRED",
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("EXPIRED");
    expect(res.accessAllowed).toBe(false);
  });

  it("17. Status desconhecido é tratado como fail-closed e gera warning", () => {
    const sub = {
      status: "UNKNOWN_STATUS",
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.effectiveStatus).toBe("EXPIRED");
    expect(res.accessAllowed).toBe(false);
    expect(res.synchronizationWarnings.length).toBeGreaterThan(0);
  });

  it("18. remainingDays nunca é negativo", () => {
    const res = calculateRemainingDays(new Date("2026-07-20T12:00:00.000-03:00"), now);
    expect(res).toBe(0);
  });

  it("19. Período restante na mesma data civil em São Paulo exibe 'Termina hoje' / 'Renova hoje' e remainingDays = 0", () => {
    const sub = {
      status: "TRIAL",
      trialEndsAt: new Date("2026-07-28T18:00:00.000-03:00"), // mesma data civil
    };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.remainingDays).toBe(0);
    expect(res.remainingLabel).toBe("Termina hoje");

    const subActive = {
      status: "ACTIVE",
      currentPeriodStart: new Date("2026-06-28T12:00:00.000-03:00"),
      currentPeriodEnd: new Date("2026-07-28T18:00:00.000-03:00"),
    };
    const resActive = deriveTenantSubscriptionAccess(subActive, { now });
    expect(resActive.remainingDays).toBe(0);
    expect(resActive.remainingLabel).toBe("Renova hoje");

    const subTomorrow = {
      status: "TRIAL",
      trialEndsAt: new Date("2026-07-29T18:00:00.000-03:00"), // próxima data civil
    };
    const resTomorrow = deriveTenantSubscriptionAccess(subTomorrow, { now });
    expect(resTomorrow.remainingDays).toBe(1);
    expect(resTomorrow.remainingLabel).toBe("Restam 1 dia do período de teste");
  });

  it("20. Preserva fuso horário de exibição em America/Sao_Paulo (DD/MM/AAAA)", () => {
    const date = parseAsaasDateOnly("2026-08-26");
    expect(date).not.toBeNull();
    const formatted = formatBillingDatePtBr(date);
    expect(formatted).toBe("26/08/2026");
  });

  it("21. YYYY-MM-DD não retrocede um dia ao ser parseado", () => {
    const date = parseAsaasDateOnly("2026-08-26");
    expect(date?.getDate()).toBe(26);
  });

  it("22. Teste imediatamente antes da expiração permanece válido", () => {
    const justBefore = new Date("2026-07-28T12:00:01.000-03:00");
    const sub = { status: "TRIAL", trialEndsAt: justBefore };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.accessAllowed).toBe(true);
  });

  it("23. Teste imediatamente após a expiração expira", () => {
    const justAfter = new Date("2026-07-28T11:59:59.000-03:00");
    const sub = { status: "TRIAL", trialEndsAt: justAfter };
    const res = deriveTenantSubscriptionAccess(sub, { now });
    expect(res.accessAllowed).toBe(false);
  });

  it("24. Situação financeira permanece independente da validade de acesso", () => {
    const payment = { status: "OVERDUE", dueDate: "2026-07-20" };
    const billing = deriveBillingStatus(payment);
    expect(billing.billingStatus).toBe("OVERDUE");
    expect(billing.canPay).toBe(true);

    const sub = {
      status: "TRIAL",
      trialEndsAt: new Date("2026-08-04T12:00:00.000-03:00"),
    };
    const access = deriveTenantSubscriptionAccess(sub, { now });
    expect(access.accessAllowed).toBe(true);
    expect(access.effectiveStatus).toBe("TRIAL");
  });

  it("25. Trial com cobrança pendente continua em trial válido", () => {
    const payment = { status: "PENDING", dueDate: "2026-07-29" };
    const billing = deriveBillingStatus(payment);
    const sub = {
      status: "TRIAL",
      trialEndsAt: new Date("2026-08-04T12:00:00.000-03:00"),
    };
    const access = deriveTenantSubscriptionAccess(sub, { now });

    expect(billing.billingStatus).toBe("PENDING");
    expect(access.effectiveStatus).toBe("TRIAL");
    expect(access.accessAllowed).toBe(true);
  });
});
