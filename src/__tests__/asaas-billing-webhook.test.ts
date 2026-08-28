import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, fetchMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findUnique: vi.fn() },
    asaasBillingCustomer: { findUnique: vi.fn() },
    asaasBillingSubscription: { findUnique: vi.fn(), update: vi.fn() },
    asaasBillingPayment: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    asaasWebhookEvent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    plan: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    tenantSubscription: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn((cb: any) => cb(prismaMock)),
  },
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { POST as postWebhook } from "@/app/api/webhooks/asaas/billing/route";
import { processAsaasWebhookPayload, syncTenantSubscriptionAccessOnPayment } from "@/lib/asaas/webhooks";

describe("PR #27 — Webhook Asaas Billing", () => {
  const SECRET_WEBHOOK_TOKEN = "secret_webhook_token_12345";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", SECRET_WEBHOOK_TOKEN);
    globalThis.fetch = fetchMock;

    prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.asaasBillingPayment.findUnique.mockImplementation(async ({ where }: { where: { asaasPaymentId: string } }) => ({
      asaasPaymentId: where.asaasPaymentId,
      asaasSubscriptionId: "sub_asaas_1",
      barbershopId: "shop-1",
    }));
    prismaMock.asaasBillingSubscription.findUnique.mockImplementation(async ({ where }: { where: { asaasSubscriptionId: string } }) => {
      if (where.asaasSubscriptionId === "sub_asaas_default" || where.asaasSubscriptionId === "sub_asaas_1") {
        return {
          id: "sub-db-1",
          barbershopId: "shop-1",
          asaasSubscriptionId: where.asaasSubscriptionId,
          planCode: "pro_monthly",
          planName: "Plano Tem Barber",
          value: 49.9,
          status: "ACTIVE",
        };
      }
      return null;
    });
    prismaMock.plan.findUnique.mockImplementation(async ({ where }: { where: { code: string } }) => {
      if (where.code === "pro_monthly") {
        return {
          id: "plan-pro-id",
          code: "pro_monthly",
          name: "Plano Tem Barber",
          price: 49.9,
          period: "MONTHLY",
          isActive: true,
        };
      }
      return null;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeWebhookRequest(body: unknown, token?: string | null) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token !== null) {
      headers["asaas-access-token"] = token ?? SECRET_WEBHOOK_TOKEN;
    }

    return new NextRequest("http://localhost/api/webhooks/asaas/billing", {
      method: "POST",
      body: JSON.stringify(body),
      headers,
    });
  }

  // =============================================
  // 1. SEGURANÇA E AUTENTICAÇÃO DO TOKEN
  // =============================================
  describe("1. Autenticação por Token (asaas-access-token)", () => {
    it("retorna 401 se token estiver ausente no header", async () => {
      const req = makeWebhookRequest({ event: "PAYMENT_RECEIVED" }, null);
      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.error).toBe("UNAUTHORIZED");
      expect(JSON.stringify(data)).not.toContain(SECRET_WEBHOOK_TOKEN);
    });

    it("retorna 401 se token no header for inválido", async () => {
      const req = makeWebhookRequest({ event: "PAYMENT_RECEIVED" }, "token_errado");
      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.error).toBe("UNAUTHORIZED");
    });

    it("retorna 401 se ASAAS_WEBHOOK_TOKEN não estiver configurado no servidor", async () => {
      vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "");
      const req = makeWebhookRequest({ event: "PAYMENT_RECEIVED" });
      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(401);
      expect(data.error).toBe("WEBHOOK_TOKEN_NOT_CONFIGURED");
    });
  });

  // =============================================
  // 2. VALIDAÇÃO DE PAYLOAD
  // =============================================
  describe("2. Validação do Payload", () => {
    it("retorna 400 para JSON inválido / não-objeto", async () => {
      const req = new NextRequest("http://localhost/api/webhooks/asaas/billing", {
        method: "POST",
        body: "not-json-string",
        headers: { "Content-Type": "application/json", "asaas-access-token": SECRET_WEBHOOK_TOKEN },
      });

      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("INVALID_JSON");
    });
  });

  // =============================================
  // 3. IDEMPOTÊNCIA
  // =============================================
  describe("3. Idempotência", () => {
    it("processa primeiro TEST_WEBHOOK como ignored e grava um registro", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-test-1" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-test-1" });

      const req = makeWebhookRequest({
        id: "evt_test_ignored_1",
        event: "TEST_WEBHOOK",
        dateCreated: "2026-07-25T15:00:00.000Z",
      });

      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.ignored).toBe(true);
      expect(prismaMock.asaasWebhookEvent.create).toHaveBeenCalledOnce();
      expect(prismaMock.asaasWebhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            asaasEventId: "evt_test_ignored_1",
            event: "TEST_WEBHOOK",
            processingStatus: "PENDING",
          }),
        })
      );
      expect(prismaMock.asaasWebhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "wh-test-1" },
          data: expect.objectContaining({
            processingStatus: "IGNORED",
            processedAt: expect.any(Date),
          }),
        })
      );
    });

    it("retorna 200 duplicate: true se evento com asaasEventId já foi processado", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue({
        id: "evt-db-1",
        asaasEventId: "evt_asaas_100",
        processingStatus: "PROCESSED",
      });

      const req = makeWebhookRequest({
        id: "evt_asaas_100",
        event: "PAYMENT_RECEIVED",
        payment: { id: "pay_1" },
      });

      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.duplicate).toBe(true);
      expect(prismaMock.asaasWebhookEvent.create).not.toHaveBeenCalled();
    });

    it("retorna 200 duplicate: true se evento com asaasEventId já foi ignorado", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue({
        id: "evt-db-ignored",
        asaasEventId: "evt_test_ignored_1",
        processingStatus: "IGNORED",
      });

      const req = makeWebhookRequest({
        id: "evt_test_ignored_1",
        event: "TEST_WEBHOOK",
      });

      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ ok: true, duplicate: true, eventId: "evt_test_ignored_1" });
      expect(prismaMock.asaasWebhookEvent.create).not.toHaveBeenCalled();
      expect(prismaMock.asaasWebhookEvent.update).not.toHaveBeenCalled();
    });

    it("retorna duplicate: true para evento PENDING e evita processamento paralelo duplicado", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue({
        id: "evt-db-pending",
        asaasEventId: "evt_pending_1",
        processingStatus: "PENDING",
      });

      const req = makeWebhookRequest({
        id: "evt_pending_1",
        event: "TEST_WEBHOOK",
      });

      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ ok: true, duplicate: true, eventId: "evt_pending_1" });
      expect(prismaMock.asaasWebhookEvent.create).not.toHaveBeenCalled();
      expect(prismaMock.asaasWebhookEvent.update).not.toHaveBeenCalled();
    });

    it("reutiliza evento FAILED para retentativa controlada sem criar duplicação ilimitada", async () => {
      prismaMock.asaasWebhookEvent.findFirst
        .mockResolvedValueOnce({
          id: "evt-db-failed",
          asaasEventId: "evt_failed_1",
          processingStatus: "FAILED",
        })
        .mockResolvedValueOnce({ id: "evt-db-failed" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "evt-db-failed" });

      const req = makeWebhookRequest({
        id: "evt_failed_1",
        event: "TEST_WEBHOOK",
      });

      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.ignored).toBe(true);
      expect(prismaMock.asaasWebhookEvent.create).not.toHaveBeenCalled();
      expect(prismaMock.asaasWebhookEvent.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: "evt-db-failed" },
          data: expect.objectContaining({
            processingStatus: "PENDING",
            processingError: null,
            processedAt: null,
          }),
        })
      );
      expect(prismaMock.asaasWebhookEvent.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: "evt-db-failed" },
          data: expect.objectContaining({
            processingStatus: "IGNORED",
            processedAt: expect.any(Date),
          }),
        })
      );
    });

    it("processa evento sem asaasEventId sem afirmar idempotência impossível", async () => {
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-no-id" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-no-id" });

      const req = makeWebhookRequest({
        event: "TEST_WEBHOOK",
        dateCreated: "2026-07-25T15:00:00.000Z",
      });

      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.ignored).toBe(true);
      expect(data.duplicate).toBeUndefined();
      expect(prismaMock.asaasWebhookEvent.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.asaasWebhookEvent.create).toHaveBeenCalledOnce();
    });
  });

  // =============================================
  // 4. PROCESSAMENTO DE PAYMENT_EVENTS
  // =============================================
  describe("4. Processamento de Eventos PAYMENT_*", () => {
    it("processa PAYMENT_CREATED com sucesso", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-1" });
      prismaMock.asaasBillingPayment.upsert.mockResolvedValue({ id: "pay-db-1" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-1" });

      const req = makeWebhookRequest({
        id: "evt_created_1",
        event: "PAYMENT_CREATED",
        payment: {
          id: "pay_created_100",
          customer: "cus_1",
          value: 49.9,
          status: "PENDING",
          billingType: "PIX",
          externalReference: "tb_barbershop_shop-1",
        },
      });

      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledOnce();
    });

    it("processa PAYMENT_RECEIVED e atualiza AsaasBillingPayment para RECEIVED", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-2" });
      prismaMock.asaasBillingPayment.upsert.mockResolvedValue({ id: "pay-db-2" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_asaas_1",
        planCode: "pro_monthly",
        planName: "Plano Tem Barber",
      });

      const req = makeWebhookRequest({
        id: "evt_rec_1",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_rec_200",
          customer: "cus_1",
          subscription: "sub_asaas_1",
          value: 49.9,
          netValue: 145.0,
          status: "RECEIVED",
          billingType: "PIX",
          paymentDate: "2026-07-24",
          externalReference: "tb_sub_shop-1_pro_monthly",
        },
      });

      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);

      const upsertCall = prismaMock.asaasBillingPayment.upsert.mock.calls[0][0];
      expect(upsertCall.where.asaasPaymentId).toBe("pay_rec_200");
      expect(upsertCall.create.status).toBe("RECEIVED");

      // Atualizou status da subscription para ACTIVE
      expect(prismaMock.asaasBillingSubscription.update).toHaveBeenCalledWith({
        where: { id: "sub-db-1" },
        data: { status: "ACTIVE", billingType: "PIX" },
      });
    });

    it("processa PAYMENT_CONFIRMED mapeando status corretamente", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-3" });
      prismaMock.asaasBillingPayment.upsert.mockResolvedValue({ id: "pay-db-3" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-3" });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts-1",
        barbershopId: "shop-1",
        planId: "plan-pro-id",
        status: "ACTIVE",
      });

      const req = makeWebhookRequest({
        id: "evt_conf_1",
        event: "PAYMENT_CONFIRMED",
        payment: {
          id: "pay_conf_300",
          subscription: "sub_asaas_1",
          status: "CONFIRMED",
          externalReference: "tb_barbershop_shop-1",
        },
      });

      const res = await postWebhook(req);
      expect(res.status).toBe(200);
      const upsertCall = prismaMock.asaasBillingPayment.upsert.mock.calls[0][0];
      expect(upsertCall.create.status).toBe("CONFIRMED");
    });

    it("processa PAYMENT_OVERDUE mapeando status e atualizando subscription", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-4" });
      prismaMock.asaasBillingPayment.upsert.mockResolvedValue({ id: "pay-db-4" });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_asaas_1",
        planCode: "pro_monthly",
        status: "ACTIVE",
      });
      prismaMock.asaasBillingSubscription.update.mockResolvedValue({ id: "sub-db-1" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-4" });

      const req = makeWebhookRequest({
        id: "evt_overdue_1",
        event: "PAYMENT_OVERDUE",
        payment: {
          id: "pay_overdue_400",
          subscription: "sub_asaas_1",
          status: "OVERDUE",
          externalReference: "tb_barbershop_shop-1",
        },
      });

      const res = await postWebhook(req);
      expect(res.status).toBe(200);

      // Subscription vira OVERDUE
      expect(prismaMock.asaasBillingSubscription.update).toHaveBeenCalledWith({
        where: { id: "sub-db-1" },
        data: expect.objectContaining({ status: "OVERDUE" }),
      });
    });
  });

  // =============================================
  // 5. PROCESSAMENTO DE SUBSCRIPTION_EVENTS
  // =============================================
  describe("5. Processamento de Eventos SUBSCRIPTION_*", () => {
    it("processa SUBSCRIPTION_UPDATED e atualiza nextDueDate", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        status: "ACTIVE",
        nextDueDate: new Date("2026-07-01"),
      });
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-sub-1" });
      prismaMock.asaasBillingSubscription.update.mockResolvedValue({ id: "sub-db-1" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-sub-1" });

      const req = makeWebhookRequest({
        id: "evt_sub_upd_1",
        event: "SUBSCRIPTION_UPDATED",
        subscription: {
          id: "sub_asaas_1",
          status: "ACTIVE",
          nextDueDate: "2026-08-01",
          billingType: "PIX",
        },
      });

      const res = await postWebhook(req);
      expect(res.status).toBe(200);
      expect(prismaMock.asaasBillingSubscription.update).toHaveBeenCalledWith({
        where: { id: "sub-db-1" },
        data: expect.objectContaining({
          status: "ACTIVE",
          nextDueDate: new Date("2026-08-01"),
        }),
      });
    });
  });

  // =============================================
  // 6. EVENTOS DESCONHECIDOS & FALHAS DE LOCALIZAÇÃO
  // =============================================
  describe("6. Eventos Desconhecidos e Robustez", () => {
    it("evento desconhecido retorna 200 com { ok: true, ignored: true } sem quebrar", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-unk-1" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-unk-1" });

      const req = makeWebhookRequest({
        id: "evt_unknown_999",
        event: "NEW_FUTURE_ASAAS_EVENT_TYPES",
        randomData: { foo: "bar" },
      });

      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.ignored).toBe(true);
    });

    it("payment sem barbershop localizável é gravado e encerrado com sucesso sem quebrar a fila", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.barbershop.findUnique.mockResolvedValue(null);
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue(null);
      prismaMock.asaasBillingCustomer.findUnique.mockResolvedValue(null);
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-unmapped-1" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-unmapped-1" });

      const req = makeWebhookRequest({
        id: "evt_unmapped",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_unknown_barbershop",
          status: "RECEIVED",
        },
      });

      const res = await postWebhook(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      // AsaasBillingPayment.upsert NÃO é chamado pois não encontrou barbershop
      expect(prismaMock.asaasBillingPayment.upsert).not.toHaveBeenCalled();
    });
  });

  // =============================================
  // 7. SEGURANÇA E NÃO VAZAMENTO DE SEGREDOS
  // =============================================
  describe("7. Vazamento de Segredos", () => {
    it("ASAAS_WEBHOOK_TOKEN e ASAAS_API_KEY não aparecem no JSON de resposta", async () => {
      vi.stubEnv("ASAAS_API_KEY", "secret_api_key_value");

      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-sec-1" });
      prismaMock.asaasBillingPayment.upsert.mockResolvedValue({ id: "pay-sec-1" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-sec-1" });

      const req = makeWebhookRequest({
        id: "evt_sec_1",
        event: "PAYMENT_RECEIVED",
        payment: { id: "pay_1", externalReference: "tb_barbershop_shop-1" },
      });

      const res = await postWebhook(req);
      const data = await res.json();

      const responseString = JSON.stringify(data);
      expect(responseString).not.toContain(SECRET_WEBHOOK_TOKEN);
      expect(responseString).not.toContain("secret_api_key_value");
    });
  });

  // =============================================
  // 8. REGRESSÃO
  // =============================================
  describe("8. Regressão — sem efeitos colaterais", () => {
    it("não altera comanda/comissão/fila/inadimplência", async () => {
      const result = await processAsaasWebhookPayload({
        event: "PAYMENT_RECEIVED",
        payment: { id: "pay_reg_1", status: "RECEIVED" },
      });

      expect(result.ok).toBe(true);
    });
  });

  // =============================================
  // 9. D2B WEBHOOK PLAN-CODE RESOLUTION & FAIL-SAFE ENTITLEMENT
  // =============================================
  describe("9. D2B Webhook Plan-Code Resolution & Fail-Safe Entitlement", () => {
    it("1. pro_monthly payment resolves exact AsaasBillingSubscription and uses findUnique on plan.code", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_100",
        asaasSubscriptionId: "sub_pro_100",
        barbershopId: "shop-100",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-pro",
        barbershopId: "shop-100",
        asaasSubscriptionId: "sub_pro_100",
        planCode: "pro_monthly",
        planName: "Plano Tem Barber",
        value: 49.9,
      });
      prismaMock.plan.findUnique.mockResolvedValue({
        id: "plan-pro-id",
        code: "pro_monthly",
        name: "Plano Tem Barber",
        price: 49.9,
        period: "MONTHLY",
        isActive: true,
      });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts-100",
        barbershopId: "shop-100",
        planId: "plan-pro-id",
      });

      await syncTenantSubscriptionAccessOnPayment("shop-100", {
        id: "pay_100",
        subscription: "sub_pro_100",
        value: 49.9,
        dueDate: "2026-08-01",
      });

      expect(prismaMock.plan.findUnique).toHaveBeenCalledWith({ where: { code: "pro_monthly" } });
      expect(prismaMock.plan.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ts-100" },
          data: expect.objectContaining({
            status: "ACTIVE",
            planName: "Plano Tem Barber",
            monthlyPrice: 49.9,
          }),
        })
      );
    });

    it("2 & 3. Plan lookup uses findUnique and second active plan (founder_2026) does NOT interfere", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_101",
        asaasSubscriptionId: "sub_pro_101",
        barbershopId: "shop-101",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-pro",
        barbershopId: "shop-101",
        asaasSubscriptionId: "sub_pro_101",
        planCode: "pro_monthly",
        planName: "Plano Tem Barber",
        value: 49.9,
      });
      prismaMock.plan.findUnique.mockImplementation(async ({ where }: { where: { code: string } }) => {
        if (where.code === "pro_monthly") {
          return { id: "plan-pro-id", code: "pro_monthly", name: "Plano Tem Barber", price: 49.9, period: "MONTHLY", isActive: true };
        }
        if (where.code === "founder_2026") {
          return { id: "plan-founder-id", code: "founder_2026", name: "Plano Founder 2026", price: 39.9, period: "MONTHLY", isActive: true };
        }
        return null;
      });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts-101",
        barbershopId: "shop-101",
        planId: "plan-pro-id",
      });

      await syncTenantSubscriptionAccessOnPayment("shop-101", {
        id: "pay_101",
        subscription: "sub_pro_101",
      });

      expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            planName: "Plano Tem Barber",
          }),
        })
      );
    });

    it("4 & 16. Inactive historical Plan (isActive = false) resolves successfully for existing contract", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_102",
        asaasSubscriptionId: "sub_hist_102",
        barbershopId: "shop-102",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-historical",
        barbershopId: "shop-102",
        asaasSubscriptionId: "sub_hist_102",
        planCode: "founder_2026",
        planName: "Plano Founder 2026",
        value: 39.9,
      });
      prismaMock.plan.findUnique.mockResolvedValue({
        id: "plan-founder-id",
        code: "founder_2026",
        name: "Plano Founder 2026",
        price: 39.9,
        period: "MONTHLY",
        isActive: false, // INATIVO para novas vendas, mas válido para contrato legado!
      });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts-102",
        barbershopId: "shop-102",
        planId: "plan-founder-id",
      });

      await syncTenantSubscriptionAccessOnPayment("shop-102", {
        id: "pay_102",
        subscription: "sub_hist_102",
      });

      expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ts-102" },
          data: expect.objectContaining({
            status: "ACTIVE",
            planName: "Plano Founder 2026",
            monthlyPrice: 39.9,
          }),
        })
      );
    });

    it("5. Payment missing subscription ID throws PAYMENT_MISSING_SUBSCRIPTION_ID without access mutation", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_no_sub",
        asaasSubscriptionId: null,
        barbershopId: "shop-103",
      });

      await expect(
        syncTenantSubscriptionAccessOnPayment("shop-103", {
          id: "pay_no_sub",
        })
      ).rejects.toThrow("PAYMENT_MISSING_SUBSCRIPTION_ID");

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
      expect(prismaMock.tenantSubscription.create).not.toHaveBeenCalled();
    });

    it("6. Missing AsaasBillingSubscription in DB throws ASAAS_BILLING_SUBSCRIPTION_NOT_FOUND", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_104",
        asaasSubscriptionId: "sub_missing",
        barbershopId: "shop-104",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue(null);

      await expect(
        syncTenantSubscriptionAccessOnPayment("shop-104", {
          id: "pay_104",
          subscription: "sub_missing",
        })
      ).rejects.toThrow("ASAAS_BILLING_SUBSCRIPTION_NOT_FOUND");

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
      expect(prismaMock.tenantSubscription.create).not.toHaveBeenCalled();
    });

    it("7. Barbershop ID mismatch between billing subscription and payment throws BARBERSHOP_SUBSCRIPTION_MISMATCH", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_105",
        asaasSubscriptionId: "sub_105",
        barbershopId: "shop-105",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-other",
        barbershopId: "shop-OTHER",
        asaasSubscriptionId: "sub_105",
        planCode: "pro_monthly",
      });

      await expect(
        syncTenantSubscriptionAccessOnPayment("shop-105", {
          id: "pay_105",
          subscription: "sub_105",
        })
      ).rejects.toThrow("BARBERSHOP_SUBSCRIPTION_MISMATCH");

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
      expect(prismaMock.tenantSubscription.create).not.toHaveBeenCalled();
    });

    it("8. Blank planCode in billing subscription throws ASAAS_PLAN_CODE_MISSING", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_106",
        asaasSubscriptionId: "sub_106",
        barbershopId: "shop-106",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-blank",
        barbershopId: "shop-106",
        asaasSubscriptionId: "sub_106",
        planCode: "   ",
        planName: "Plano Tem Barber",
      });

      await expect(
        syncTenantSubscriptionAccessOnPayment("shop-106", {
          id: "pay_106",
          subscription: "sub_106",
        })
      ).rejects.toThrow("ASAAS_PLAN_CODE_MISSING");

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
    });

    it("9. Unknown planCode throws PLAN_CODE_NOT_FOUND", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_107",
        asaasSubscriptionId: "sub_107",
        barbershopId: "shop-107",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-unknown",
        barbershopId: "shop-107",
        asaasSubscriptionId: "sub_107",
        planCode: "unknown_code",
      });
      prismaMock.plan.findUnique.mockResolvedValue(null);

      await expect(
        syncTenantSubscriptionAccessOnPayment("shop-107", {
          id: "pay_107",
          subscription: "sub_107",
        })
      ).rejects.toThrow("PLAN_CODE_NOT_FOUND");

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
    });

    it("10 & 11. Existing TenantSubscription with DIFFERENT plan code throws TENANT_PLAN_CODE_MISMATCH without updating or switching plans", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_108",
        asaasSubscriptionId: "sub_108",
        barbershopId: "shop-108",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-pro",
        barbershopId: "shop-108",
        asaasSubscriptionId: "sub_108",
        planCode: "pro_monthly",
        planName: "Plano Tem Barber",
        value: 49.9,
      });
      prismaMock.plan.findUnique.mockResolvedValue({
        id: "plan-pro-id",
        code: "pro_monthly",
      });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts-108",
        barbershopId: "shop-108",
        planId: "plan-different-id", // ID de plano diferente!
      });

      await expect(
        syncTenantSubscriptionAccessOnPayment("shop-108", {
          id: "pay_108",
          subscription: "sub_108",
        })
      ).rejects.toThrow("TENANT_PLAN_CODE_MISMATCH");

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
      expect(prismaMock.tenantSubscription.create).not.toHaveBeenCalled();
    });

    it("12, 13 & 14. New TenantSubscription receives correct planId, planName and monthlyPrice from AsaasBillingSubscription contract", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_109",
        asaasSubscriptionId: "sub_109",
        barbershopId: "shop-109",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-new",
        barbershopId: "shop-109",
        asaasSubscriptionId: "sub_109",
        planCode: "pro_monthly",
        planName: "Plano Contratado Asaas",
        value: 49.9,
      });
      prismaMock.plan.findUnique.mockResolvedValue({
        id: "plan-pro-id",
        code: "pro_monthly",
        name: "Plano no Banco",
        price: 99.0, // Preço no banco difere do valor contratual Asaas
      });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue(null);

      await syncTenantSubscriptionAccessOnPayment("shop-109", {
        id: "pay_109",
        subscription: "sub_109",
      });

      expect(prismaMock.tenantSubscription.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          barbershopId: "shop-109",
          planId: "plan-pro-id",
          status: "ACTIVE",
          planName: "Plano Contratado Asaas",
          monthlyPrice: 49.9,
        }),
      });
    });

    it("15. payment.value differing from subscription.value (due to interest/fine/discount) does NOT alter TenantSubscription.monthlyPrice", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_110",
        asaasSubscriptionId: "sub_110",
        barbershopId: "shop-110",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-discount",
        barbershopId: "shop-110",
        asaasSubscriptionId: "sub_110",
        planCode: "pro_monthly",
        planName: "Plano Tem Barber",
        value: 49.9, // Valor mensalidade recorrente contratado
      });
      prismaMock.plan.findUnique.mockResolvedValue({
        id: "plan-pro-id",
        code: "pro_monthly",
      });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts-110",
        barbershopId: "shop-110",
        planId: "plan-pro-id",
      });

      await syncTenantSubscriptionAccessOnPayment("shop-110", {
        id: "pay_110",
        subscription: "sub_110",
        value: 54.9, // Pagamento com juros/multa
      });

      expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            monthlyPrice: 49.9, // Deve se manter o valor contratual 49.90, NÃO 54.90!
          }),
        })
      );
    });

    it("17. Idempotency: accessAppliedAt already set (updateMany count === 0) performs NO access mutation", async () => {
      prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 0 });

      await syncTenantSubscriptionAccessOnPayment("shop-111", {
        id: "pay_already_applied",
        subscription: "sub_111",
      });

      expect(prismaMock.asaasBillingSubscription.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
      expect(prismaMock.tenantSubscription.create).not.toHaveBeenCalled();
    });

    it("18. Failed identity validation rolls back accessAppliedAt claim in transaction and does not persist access", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_failed_claim",
        asaasSubscriptionId: "sub_missing",
        barbershopId: "shop-112",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue(null);

      let txExecuted = false;
      prismaMock.$transaction.mockImplementationOnce(async (cb: any) => {
        txExecuted = true;
        return cb(prismaMock);
      });

      await expect(
        syncTenantSubscriptionAccessOnPayment("shop-112", {
          id: "pay_failed_claim",
          subscription: "sub_missing",
        })
      ).rejects.toThrow("ASAAS_BILLING_SUBSCRIPTION_NOT_FOUND");

      expect(txExecuted).toBe(true);
      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
    });

    it("19 & 20. Zero runtime plan.create calls and ZERO remote Asaas fetch calls during webhook processing", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-clean" });
      prismaMock.asaasBillingPayment.upsert.mockResolvedValue({ id: "pay-clean" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-clean" });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts-1",
        barbershopId: "shop-1",
        planId: "plan-pro-id",
      });

      const req = makeWebhookRequest({
        id: "evt_clean_1",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_clean_1",
          subscription: "sub_asaas_default",
          status: "RECEIVED",
          externalReference: "tb_barbershop_shop-1",
        },
      });

      const res = await postWebhook(req);
      expect(res.status).toBe(200);

      expect(prismaMock.plan.create).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("21. AsaasBillingPayment update persists a newly supplied payment.subscription into asaasSubscriptionId", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValueOnce(null);
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-pers" });
      prismaMock.asaasBillingPayment.upsert.mockResolvedValue({ id: "pay-pers" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-pers" });

      const req = makeWebhookRequest({
        id: "evt_pers_1",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_pers_1",
          subscription: "sub_newly_supplied",
          status: "RECEIVED",
          externalReference: "tb_barbershop_shop-1",
        },
      });

      await postWebhook(req);

      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            asaasSubscriptionId: "sub_newly_supplied",
          }),
        })
      );
    });

    it("22. Fallback to persisted AsaasBillingPayment.asaasSubscriptionId works when sync input lacks raw subscription ID", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_persisted_id",
        asaasSubscriptionId: "sub_from_db_record",
        barbershopId: "shop-113",
      });
      prismaMock.asaasBillingSubscription.findUnique.mockResolvedValue({
        id: "sub-persisted-db",
        barbershopId: "shop-113",
        asaasSubscriptionId: "sub_from_db_record",
        planCode: "pro_monthly",
        planName: "Plano Tem Barber",
        value: 49.9,
      });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "ts-113",
        barbershopId: "shop-113",
        planId: "plan-pro-id",
      });

      await syncTenantSubscriptionAccessOnPayment("shop-113", {
        id: "pay_persisted_id",
        // Sem a propriedade `subscription` explícita
      });

      expect(prismaMock.asaasBillingSubscription.findUnique).toHaveBeenCalledWith({
        where: { asaasSubscriptionId: "sub_from_db_record" },
      });
      expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ts-113" },
        })
      );
    });

    it("23. CASE D: existing payment sub_A + incoming sub_B throws PAYMENT_SUBSCRIPTION_MISMATCH and sets FAILED without TenantSubscription mutation", async () => {
      prismaMock.asaasWebhookEvent.findFirst.mockResolvedValue(null);
      prismaMock.barbershop.findUnique.mockResolvedValue({ id: "shop-1" });
      prismaMock.asaasWebhookEvent.create.mockResolvedValue({ id: "wh-mismatch" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-mismatch" });

      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasSubscriptionId: "sub_A",
      });

      const req = makeWebhookRequest({
        id: "evt_mismatch_1",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_conflicting_sub",
          subscription: "sub_B",
          status: "RECEIVED",
          externalReference: "tb_barbershop_shop-1",
        },
      });

      const res = await postWebhook(req);
      expect(res.status).toBe(200);

      expect(prismaMock.asaasWebhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "wh-mismatch" },
          data: expect.objectContaining({
            processingStatus: "FAILED",
            processingError: "PAYMENT_SUBSCRIPTION_MISMATCH",
          }),
        })
      );

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
      expect(prismaMock.tenantSubscription.create).not.toHaveBeenCalled();
    });

    it("24. CASE E: raw candidate fields conflict (subscription sub_A vs asaasSubscriptionId sub_B) throws PAYMENT_SUBSCRIPTION_MISMATCH inside sync", async () => {
      prismaMock.asaasBillingPayment.findUnique.mockResolvedValue({
        asaasPaymentId: "pay_raw_conflict",
        asaasSubscriptionId: "sub_A",
        barbershopId: "shop-114",
      });

      await expect(
        syncTenantSubscriptionAccessOnPayment("shop-114", {
          id: "pay_raw_conflict",
          subscription: "sub_A",
          asaasSubscriptionId: "sub_B",
        })
      ).rejects.toThrow("PAYMENT_SUBSCRIPTION_MISMATCH");

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
      expect(prismaMock.tenantSubscription.create).not.toHaveBeenCalled();
    });
  });
});
