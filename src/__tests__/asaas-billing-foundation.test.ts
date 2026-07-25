import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AsaasPaymentStatus, AsaasSubscriptionStatus } from "@prisma/client";

const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershopBillingProfile: { findUnique: vi.fn() },
    asaasBillingCustomer: { findFirst: vi.fn(), create: vi.fn() },
    asaasBillingSubscription: { findFirst: vi.fn(), create: vi.fn() },
    asaasBillingPayment: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    asaasWebhookEvent: { findFirst: vi.fn(), create: vi.fn() },
    tenantSubscription: { findFirst: vi.fn() },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import { asaasFetch, getAsaasConfig } from "@/lib/asaas/client";
import {
  buildAsaasCustomerExternalReference,
  buildAsaasSubscriptionExternalReference,
  mapAsaasPaymentStatus,
  mapAsaasSubscriptionStatus,
  parseBarbershopIdFromExternalReference,
  sanitizeAsaasPayloadForLog,
} from "@/lib/asaas/mappers";
import { GET as getBillingStatus } from "@/app/api/admin/billing/asaas/status/route";

describe("PR #25 - Asaas Billing Foundation Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("1. Cliente Server-Side Asaas (client.ts)", () => {
    it("retorna isConfigured false quando ASAAS_API_KEY não está presente", () => {
      vi.stubEnv("ASAAS_API_KEY", "");
      const config = getAsaasConfig();
      expect(config.isConfigured).toBe(false);
      expect(config.apiKey).toBeNull();
    });

    it("retorna ambiente sandbox por padrão", () => {
      vi.stubEnv("ASAAS_API_KEY", "test_key");
      vi.stubEnv("ASAAS_ENV", "sandbox");
      const config = getAsaasConfig();
      expect(config.isConfigured).toBe(true);
      expect(config.environment).toBe("sandbox");
      expect(config.baseUrl).toBe("https://sandbox.asaas.com/api/v3");
    });

    it("retorna ambiente production quando configurado", () => {
      vi.stubEnv("ASAAS_API_KEY", "prod_key");
      vi.stubEnv("ASAAS_ENV", "production");
      const config = getAsaasConfig();
      expect(config.environment).toBe("production");
      expect(config.baseUrl).toBe("https://www.asaas.com/api/v3");
    });

    it("asaasFetch lança AsaasApiError 500 se ASAAS_API_KEY estiver ausente", async () => {
      vi.stubEnv("ASAAS_API_KEY", "");
      await expect(asaasFetch("/customers")).rejects.toThrow("Integração Asaas não configurada");
    });

    it("asaasFetch realiza chamada HTTP autenticada com access_token no header", async () => {
      vi.stubEnv("ASAAS_API_KEY", "valid_secret_key");
      vi.stubEnv("ASAAS_ENV", "sandbox");

      const mockResponse = { id: "cus_12345", name: "Barbearia Teste" };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await asaasFetch("/customers/cus_12345");

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://sandbox.asaas.com/api/v3/customers/cus_12345",
        expect.objectContaining({
          headers: expect.objectContaining({
            access_token: "valid_secret_key",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("asaasFetch trata erro de API do Asaas e lança AsaasApiError", async () => {
      vi.stubEnv("ASAAS_API_KEY", "valid_secret_key");

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            errors: [{ code: "invalid_cpf", description: "CPF inválido" }],
          }),
      });

      await expect(asaasFetch("/customers")).rejects.toThrow("CPF inválido");
    });
  });

  describe("2. Mappers de Faturamento (mappers.ts)", () => {
    it("mapAsaasSubscriptionStatus mapeia status conhecidos e fallback UNKNOWN", () => {
      expect(mapAsaasSubscriptionStatus("ACTIVE")).toBe(AsaasSubscriptionStatus.ACTIVE);
      expect(mapAsaasSubscriptionStatus("INACTIVE")).toBe(AsaasSubscriptionStatus.INACTIVE);
      expect(mapAsaasSubscriptionStatus("EXPIRED")).toBe(AsaasSubscriptionStatus.EXPIRED);
      expect(mapAsaasSubscriptionStatus("OVERDUE")).toBe(AsaasSubscriptionStatus.OVERDUE);
      expect(mapAsaasSubscriptionStatus("CANCELED")).toBe(AsaasSubscriptionStatus.CANCELED);
      expect(mapAsaasSubscriptionStatus("INVALID_STATUS")).toBe(AsaasSubscriptionStatus.UNKNOWN);
      expect(mapAsaasSubscriptionStatus(null)).toBe(AsaasSubscriptionStatus.UNKNOWN);
    });

    it("mapAsaasPaymentStatus mapeia status de pagamento e fallback UNKNOWN", () => {
      expect(mapAsaasPaymentStatus("PENDING")).toBe(AsaasPaymentStatus.PENDING);
      expect(mapAsaasPaymentStatus("RECEIVED")).toBe(AsaasPaymentStatus.RECEIVED);
      expect(mapAsaasPaymentStatus("CONFIRMED")).toBe(AsaasPaymentStatus.CONFIRMED);
      expect(mapAsaasPaymentStatus("OVERDUE")).toBe(AsaasPaymentStatus.OVERDUE);
      expect(mapAsaasPaymentStatus("REFUNDED")).toBe(AsaasPaymentStatus.REFUNDED);
      expect(mapAsaasPaymentStatus("CANCELED")).toBe(AsaasPaymentStatus.CANCELED);
      expect(mapAsaasPaymentStatus("CHARGEBACK_DISPUTE")).toBe(AsaasPaymentStatus.CHARGEBACK);
      expect(mapAsaasPaymentStatus("DESCONHECIDO")).toBe(AsaasPaymentStatus.UNKNOWN);
    });

    it("geração e extração de externalReference é estável", () => {
      const barbershopId = "shop-abc-123";

      const customerRef = buildAsaasCustomerExternalReference(barbershopId);
      expect(customerRef).toBe("tb_barbershop_shop-abc-123");
      expect(parseBarbershopIdFromExternalReference(customerRef)).toBe(barbershopId);

      const subRef = buildAsaasSubscriptionExternalReference(barbershopId, "PRO_MONTHLY");
      expect(subRef).toBe("tb_sub_shop-abc-123_PRO_MONTHLY");
      expect(parseBarbershopIdFromExternalReference(subRef)).toBe(barbershopId);
    });

    it("sanitizeAsaasPayloadForLog oculta chaves sensíveis e mantém dados seguros", () => {
      const rawPayload = {
        id: "pay_123",
        value: 199.9,
        creditCardNumber: "4111111111111111",
        creditCardCcv: "123",
        access_token: "secret_token",
        customer: {
          name: "João",
          apiKey: "secret_api_key",
        },
      };

      const sanitized = sanitizeAsaasPayloadForLog(rawPayload);

      expect(sanitized.id).toBe("pay_123");
      expect(sanitized.value).toBe(199.9);
      expect(sanitized.creditCardNumber).toBe("[REDACTED]");
      expect(sanitized.creditCardCcv).toBe("[REDACTED]");
      expect(sanitized.access_token).toBe("[REDACTED]");
      expect((sanitized.customer as Record<string, unknown>).apiKey).toBe("[REDACTED]");
      expect((sanitized.customer as Record<string, unknown>).name).toBe("João");
    });
  });

  describe("3. API Admin de Readiness / Status (GET /api/admin/billing/asaas/status)", () => {
    it("retorna status de integração sem expor chaves quando OWNER acessa", async () => {
      vi.stubEnv("ASAAS_API_KEY", "secret_key_123");
      vi.stubEnv("ASAAS_ENV", "sandbox");
      vi.stubEnv("ASAAS_WEBHOOK_TOKEN", "wh_token_abc");

      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
      });

      prismaMock.barbershopBillingProfile.findUnique.mockResolvedValue({
        id: "profile-1",
        barbershopId: "shop-1",
        personType: "COMPANY",
        legalName: "Dom Brio Ltda",
        cpfCnpj: "11222333000181",
        billingEmail: "financeiro@test.com",
        billingPhone: "11999999999",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue({
        id: "cust-db-1",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_asaas_123",
        name: "Dom Brio",
        email: "dombrio@test.com",
        cpfCnpj: "12345678000199",
        externalReference: "tb_barbershop_shop-1",
        createdAt: new Date(),
      });

      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_asaas_999",
        planCode: "PRO",
        planName: "Plano Tem Barber",
        value: { toString: () => "49.90" },
        cycle: "MONTHLY",
        status: AsaasSubscriptionStatus.ACTIVE,
        nextDueDate: new Date("2026-08-01T00:00:00.000Z"),
        externalReference: "tb_sub_shop-1_PRO",
        createdAt: new Date(),
      });
      prismaMock.asaasBillingPayment.findMany.mockResolvedValue([]);
      prismaMock.tenantSubscription.findFirst.mockResolvedValue(null);

      const res = await getBillingStatus();
      const data = await res.json();
      const serialized = JSON.stringify(data);

      expect(res.status).toBe(200);
      expect(data.integrationConfigured).toBe(true);
      expect(data.environment).toBe("sandbox");
      expect(data.webhookTokenConfigured).toBe(true);
      expect(data.profileCompleted).toBe(true);
      expect(data.documentConfigured).toBe(true);
      expect(data.cpfCnpjMasked).toBe("**.***.***/****-81");
      expect(data.customerConfigured).toBe(true);
      expect(data.hasSubscription).toBe(true);
      expect(data.subscription.status).toBe("ACTIVE");
      expect(data.plan.value).toBe("49.90");

      // Garante que NENHUMA chave sensível vaza no payload
      expect(serialized).not.toContain("secret_key_123");
      expect(serialized).not.toContain("wh_token_abc");
      expect(serialized).not.toContain("11222333000181");
      expect(serialized).not.toContain("cus_asaas_123");
      expect(serialized).not.toContain("sub_asaas_999");
    });

    it("retorna integrationConfigured false quando ASAAS_API_KEY está ausente", async () => {
      vi.stubEnv("ASAAS_API_KEY", "");

      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "admin-1", barbershopId: "shop-1", role: "OWNER" },
      });

      prismaMock.barbershopBillingProfile.findUnique.mockResolvedValue(null);
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue(null);
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue(null);
      prismaMock.asaasBillingPayment.findMany.mockResolvedValue([]);
      prismaMock.tenantSubscription.findFirst.mockResolvedValue(null);

      const res = await getBillingStatus();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.integrationConfigured).toBe(false);
      expect(data.customerConfigured).toBe(false);
      expect(data.profileCompleted).toBe(false);
      expect(data.hasSubscription).toBe(false);
    });

    it("bloqueia acesso para papel BARBER com HTTP 403", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "barber-1", barbershopId: "shop-1", role: "BARBER" },
      });

      const res = await getBillingStatus();
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.error).toBe("FORBIDDEN");
    });
  });
});
