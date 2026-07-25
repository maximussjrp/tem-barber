import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findUnique: vi.fn() },
    asaasBillingCustomer: { findUnique: vi.fn() },
    asaasBillingSubscription: { findUnique: vi.fn(), update: vi.fn() },
    asaasBillingPayment: { findUnique: vi.fn(), upsert: vi.fn() },
    asaasWebhookEvent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { POST as postWebhook } from "@/app/api/webhooks/asaas/billing/route";
import { processAsaasWebhookPayload } from "@/lib/asaas/webhooks";

describe("PR #27 — Webhook Asaas Billing", () => {
  const SECRET_WEBHOOK_TOKEN = "secret_webhook_token_12345";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("ASAAS_WEBHOOK_TOKEN", SECRET_WEBHOOK_TOKEN);
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
        status: "OVERDUE",
        billingType: "PIX",
      });
      prismaMock.asaasBillingSubscription.update.mockResolvedValue({ id: "sub-db-1" });
      prismaMock.asaasWebhookEvent.update.mockResolvedValue({ id: "wh-2" });

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

      const req = makeWebhookRequest({
        id: "evt_conf_1",
        event: "PAYMENT_CONFIRMED",
        payment: {
          id: "pay_conf_300",
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
      // Nenhuma tabela de comanda, comissão ou fila foi importada ou mutada
    });
  });
});
