import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { prismaMock, getAdminSessionMock, fetchMock } = vi.hoisted(() => ({
  prismaMock: {
    asaasBillingCustomer: { findFirst: vi.fn(), create: vi.fn() },
    asaasBillingSubscription: { findFirst: vi.fn(), create: vi.fn() },
    barbershop: { findUniqueOrThrow: vi.fn() },
    barbershopMember: { findFirst: vi.fn() },
  },
  getAdminSessionMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

// Mock global fetch for Asaas API calls
const originalFetch = globalThis.fetch;

import { POST as postSubscription } from "@/app/api/admin/billing/asaas/subscription/route";
import { GET as getStatus } from "@/app/api/admin/billing/asaas/status/route";
import { ensureAsaasCustomerForBarbershop } from "@/lib/asaas/customers";
import { createAsaasSubscriptionForBarbershop, SubscriptionValidationError } from "@/lib/asaas/subscriptions";
import { getBillingPlanByCode, getActiveBillingPlans, isAllowedBillingType } from "@/lib/billing/plans";

describe("PR #26 — Criar Cliente + Assinatura Asaas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("ASAAS_API_KEY", "test_api_key_secret");
    vi.stubEnv("ASAAS_ENV", "sandbox");
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  // =============================================
  // BILLING PLANS CATALOG
  // =============================================
  describe("1. Catálogo de Planos", () => {
    it("retorna plano ativo pelo code", () => {
      const plan = getBillingPlanByCode("pro_monthly");
      expect(plan).not.toBeNull();
      expect(plan!.code).toBe("pro_monthly");
      expect(plan!.value).toBe(149.9);
      expect(plan!.cycle).toBe("MONTHLY");
    });

    it("retorna null para plano inexistente", () => {
      expect(getBillingPlanByCode("nonexistent")).toBeNull();
    });

    it("lista planos ativos", () => {
      const plans = getActiveBillingPlans();
      expect(plans.length).toBeGreaterThanOrEqual(2);
      expect(plans.every((p) => p.active)).toBe(true);
    });

    it("valida billingType permitido", () => {
      expect(isAllowedBillingType("PIX")).toBe(true);
      expect(isAllowedBillingType("BOLETO")).toBe(true);
      expect(isAllowedBillingType("CREDIT_CARD")).toBe(false);
      expect(isAllowedBillingType("INVALID")).toBe(false);
    });
  });

  // =============================================
  // CUSTOMER ASAAS
  // =============================================
  describe("2. Customer Asaas (ensureAsaasCustomerForBarbershop)", () => {
    it("reutiliza customer local quando já existe", async () => {
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue({
        id: "cust-db-1",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_existing_123",
        name: "Dom Brio",
        email: "owner@dombrio.com",
        cpfCnpj: "12345678901",
        phone: "11999999999",
        externalReference: "tb_barbershop_shop-1",
      });

      const result = await ensureAsaasCustomerForBarbershop("shop-1");

      expect(result.created).toBe(false);
      expect(result.asaasCustomerId).toBe("cus_existing_123");
      expect(fetchMock).not.toHaveBeenCalled(); // Não chamou Asaas
    });

    it("cria customer no Asaas quando não existe localmente", async () => {
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue(null);
      prismaMock.barbershop.findUniqueOrThrow.mockResolvedValue({
        id: "shop-1",
        name: "Barbearia Teste",
        phone: "11888888888",
      });
      prismaMock.barbershopMember.findFirst.mockResolvedValue({
        user: { name: "João Owner", email: "joao@test.com", cpf: "12345678901", phone: "11999999999" },
      });

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "cus_new_456",
            name: "Barbearia Teste",
            email: "joao@test.com",
            cpfCnpj: "12345678901",
            externalReference: "tb_barbershop_shop-1",
          }),
      });

      prismaMock.asaasBillingCustomer.create.mockResolvedValue({
        id: "cust-db-2",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_new_456",
        name: "Barbearia Teste",
        email: "joao@test.com",
        cpfCnpj: "12345678901",
        phone: "11999999999",
        externalReference: "tb_barbershop_shop-1",
      });

      const result = await ensureAsaasCustomerForBarbershop("shop-1");

      expect(result.created).toBe(true);
      expect(result.asaasCustomerId).toBe("cus_new_456");
      expect(fetchMock).toHaveBeenCalledOnce();

      // Verifica que access_token foi enviado mas ASAAS_API_KEY não aparece no body
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain("sandbox.asaas.com/api/v3/customers");
      expect(opts.headers.access_token).toBe("test_api_key_secret");
      const body = JSON.parse(opts.body);
      expect(body.name).toBe("Barbearia Teste");
      expect(body.externalReference).toBe("tb_barbershop_shop-1");
    });

    it("não expõe ASAAS_API_KEY no body da requisição de criação de customer", async () => {
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue(null);
      prismaMock.barbershop.findUniqueOrThrow.mockResolvedValue({
        id: "shop-1",
        name: "Teste",
        phone: "11888888888",
      });
      prismaMock.barbershopMember.findFirst.mockResolvedValue(null);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "cus_x", name: "Teste" }),
      });

      prismaMock.asaasBillingCustomer.create.mockResolvedValue({
        id: "db-x",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_x",
        name: "Teste",
        email: null,
        cpfCnpj: null,
        phone: "11888888888",
        externalReference: "tb_barbershop_shop-1",
      });

      await ensureAsaasCustomerForBarbershop("shop-1");

      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(JSON.stringify(body)).not.toContain("test_api_key_secret");
    });
  });

  // =============================================
  // SUBSCRIPTION ASAAS
  // =============================================
  describe("3. Subscription Asaas (createAsaasSubscriptionForBarbershop)", () => {
    it("cria subscription com customer correto", async () => {
      // Customer já existe
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue({
        id: "cust-db-1",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_existing",
        name: "Dom Brio",
        email: null,
        cpfCnpj: null,
        phone: null,
        externalReference: "tb_barbershop_shop-1",
      });

      // Sem subscription ativa
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue(null);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "sub_asaas_789",
            customer: "cus_existing",
            billingType: "PIX",
            value: 149.9,
            nextDueDate: "2026-07-26",
            cycle: "MONTHLY",
            status: "ACTIVE",
            externalReference: "tb_sub_shop-1_pro_monthly",
          }),
      });

      prismaMock.asaasBillingSubscription.create.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_asaas_789",
        asaasCustomerId: "cus_existing",
        planCode: "pro_monthly",
        planName: "Plano Pro",
        value: { toString: () => "149.9" },
        cycle: "MONTHLY",
        status: "ACTIVE",
        billingType: "PIX",
        nextDueDate: new Date("2026-07-26"),
        externalReference: "tb_sub_shop-1_pro_monthly",
      });

      const result = await createAsaasSubscriptionForBarbershop({
        barbershopId: "shop-1",
        planCode: "pro_monthly",
        billingType: "PIX",
      });

      expect(result.alreadyExisted).toBe(false);
      expect(result.subscription.asaasSubscriptionId).toBe("sub_asaas_789");
      expect(result.subscription.planCode).toBe("pro_monthly");
      expect(result.subscription.value).toBe("149.9");
      expect(result.subscription.billingType).toBe("PIX");
      expect(result.customer.asaasCustomerId).toBe("cus_existing");
    });

    it("não duplica assinatura se já existe ativa", async () => {
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue({
        id: "cust-db-1",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_existing",
        name: "Dom Brio",
        email: null,
        cpfCnpj: null,
        phone: null,
        externalReference: "tb_barbershop_shop-1",
      });

      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub-db-existing",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_asaas_existing",
        asaasCustomerId: "cus_existing",
        planCode: "pro_monthly",
        planName: "Plano Pro",
        value: { toString: () => "149.9" },
        cycle: "MONTHLY",
        status: "ACTIVE",
        billingType: "PIX",
        nextDueDate: new Date("2026-08-01"),
        externalReference: "tb_sub_shop-1_pro_monthly",
      });

      const result = await createAsaasSubscriptionForBarbershop({
        barbershopId: "shop-1",
        planCode: "pro_monthly",
        billingType: "PIX",
      });

      expect(result.alreadyExisted).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("lança erro para planCode inválido", async () => {
      await expect(
        createAsaasSubscriptionForBarbershop({
          barbershopId: "shop-1",
          planCode: "fake_plan",
          billingType: "PIX",
        })
      ).rejects.toThrow(SubscriptionValidationError);
    });

    it("lança erro para billingType inválido", async () => {
      await expect(
        createAsaasSubscriptionForBarbershop({
          barbershopId: "shop-1",
          planCode: "pro_monthly",
          billingType: "CREDIT_CARD",
        })
      ).rejects.toThrow(SubscriptionValidationError);
    });
  });

  // =============================================
  // ENDPOINT POST /api/admin/billing/asaas/subscription
  // =============================================
  describe("4. POST /api/admin/billing/asaas/subscription", () => {
    function makeRequest(body: Record<string, unknown>) {
      return new NextRequest("http://localhost/api/admin/billing/asaas/subscription", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
    }

    it("OWNER cria assinatura com sucesso", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });

      // Customer já existe
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue({
        id: "cust-1",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_123",
        name: "Shop",
        email: null,
        cpfCnpj: null,
        phone: null,
        externalReference: "tb_barbershop_shop-1",
      });

      // Sem subscription ativa
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue(null);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "sub_asaas_new",
            customer: "cus_123",
            billingType: "BOLETO",
            value: 149.9,
            nextDueDate: "2026-07-26",
            cycle: "MONTHLY",
            status: "ACTIVE",
          }),
      });

      prismaMock.asaasBillingSubscription.create.mockResolvedValue({
        id: "sub-db-new",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_asaas_new",
        asaasCustomerId: "cus_123",
        planCode: "pro_monthly",
        planName: "Plano Pro",
        value: { toString: () => "149.9" },
        cycle: "MONTHLY",
        status: "ACTIVE",
        billingType: "BOLETO",
        nextDueDate: new Date("2026-07-26"),
        externalReference: "tb_sub_shop-1_pro_monthly",
      });

      const res = await postSubscription(makeRequest({ planCode: "pro_monthly", billingType: "BOLETO" }));
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.subscription.planCode).toBe("pro_monthly");
      expect(data.alreadyExisted).toBe(false);
      expect(JSON.stringify(data)).not.toContain("test_api_key_secret");
    });

    it("BARBER é bloqueado com 403", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "barber-1", barbershopId: "shop-1", role: "BARBER", memberId: "m-2" },
      });

      const res = await postSubscription(makeRequest({ planCode: "pro_monthly", billingType: "PIX" }));
      expect(res.status).toBe(403);
    });

    it("MANAGER é bloqueado com 403 (OWNER-only)", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "mgr-1", barbershopId: "shop-1", role: "MANAGER", memberId: "m-3" },
      });

      const res = await postSubscription(makeRequest({ planCode: "pro_monthly", billingType: "PIX" }));
      expect(res.status).toBe(403);
    });

    it("planCode inválido retorna 400", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });

      const res = await postSubscription(makeRequest({ planCode: "invalid_plan", billingType: "PIX" }));
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("INVALID_PLAN");
    });

    it("billingType inválido retorna 400", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });

      const res = await postSubscription(makeRequest({ planCode: "pro_monthly", billingType: "CREDIT_CARD" }));
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("INVALID_BILLING_TYPE");
    });

    it("Asaas erro HTTP retorna erro seguro sem ASAAS_API_KEY", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });

      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue({
        id: "cust-1",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_123",
        name: "Shop",
        email: null,
        cpfCnpj: null,
        phone: null,
        externalReference: "tb_barbershop_shop-1",
      });
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue(null);

      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            errors: [{ code: "invalid_value", description: "Valor mínimo é R$ 5,00." }],
          }),
      });

      const res = await postSubscription(makeRequest({ planCode: "pro_monthly", billingType: "PIX" }));
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("ASAAS_ERROR");
      expect(JSON.stringify(data)).not.toContain("test_api_key_secret");
    });
  });

  // =============================================
  // STATUS API ATUALIZADO
  // =============================================
  describe("5. GET /api/admin/billing/asaas/status — atualizado", () => {
    it("retorna billingType na subscription quando existente", async () => {
      vi.stubEnv("ASAAS_API_KEY", "secret_key");
      vi.stubEnv("ASAAS_ENV", "sandbox");

      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER" },
      });

      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue({
        id: "cust-1",
        asaasCustomerId: "cus_123",
        name: "Shop",
        email: null,
        cpfCnpj: null,
        externalReference: "tb_barbershop_shop-1",
        createdAt: new Date(),
      });

      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub-1",
        asaasSubscriptionId: "sub_123",
        planCode: "pro_monthly",
        planName: "Plano Pro",
        value: { toString: () => "149.9" },
        cycle: "MONTHLY",
        status: "ACTIVE",
        billingType: "PIX",
        nextDueDate: new Date("2026-08-01"),
        externalReference: "tb_sub_shop-1_pro_monthly",
        createdAt: new Date(),
      });

      const res = await getStatus();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.subscription.billingType).toBe("PIX");
      expect(data.subscription.planCode).toBe("pro_monthly");
      expect(JSON.stringify(data)).not.toContain("secret_key");
    });
  });

  // =============================================
  // REGRESSÃO — NÃO ALTERA COMANDA/COMISSÃO/FILA
  // =============================================
  describe("6. Regressão — sem efeitos colaterais", () => {
    it("nenhuma comanda/comissão/fila é alterada pelo createAsaasSubscriptionForBarbershop", async () => {
      // Este teste verifica que o mock do prisma NÃO recebeu chamadas
      // para modelos de comanda, comissão ou fila
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue({
        id: "c1",
        barbershopId: "s1",
        asaasCustomerId: "cus_1",
        name: "X",
        email: null,
        cpfCnpj: null,
        phone: null,
        externalReference: "tb_barbershop_s1",
      });
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue(null);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "sub_1",
            customer: "cus_1",
            billingType: "PIX",
            value: 149.9,
            nextDueDate: "2026-07-26",
            cycle: "MONTHLY",
            status: "ACTIVE",
          }),
      });

      prismaMock.asaasBillingSubscription.create.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "s1",
        asaasSubscriptionId: "sub_1",
        asaasCustomerId: "cus_1",
        planCode: "pro_monthly",
        planName: "Plano Pro",
        value: { toString: () => "149.9" },
        cycle: "MONTHLY",
        status: "ACTIVE",
        billingType: "PIX",
        nextDueDate: new Date("2026-07-26"),
        externalReference: "tb_sub_s1_pro_monthly",
      });

      await createAsaasSubscriptionForBarbershop({
        barbershopId: "s1",
        planCode: "pro_monthly",
        billingType: "PIX",
      });

      // Verificar que apenas os mocks Asaas billing foram chamados
      expect(prismaMock.asaasBillingCustomer.findFirst).toHaveBeenCalled();
      expect(prismaMock.asaasBillingSubscription.findFirst).toHaveBeenCalled();
      expect(prismaMock.asaasBillingSubscription.create).toHaveBeenCalled();
    });
  });
});
