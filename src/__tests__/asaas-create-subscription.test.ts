import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { prismaMock, getAdminSessionMock, fetchMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershopBillingProfile: { findUnique: vi.fn(), upsert: vi.fn() },
    asaasBillingCustomer: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    asaasBillingSubscription: { findFirst: vi.fn(), create: vi.fn() },
    asaasBillingPayment: { findMany: vi.fn() },
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
const VALID_CPF = "52998224725";
const VALID_CNPJ = "11222333000181";
const BILLING_PROFILE = {
  id: "billing-profile-1",
  barbershopId: "shop-1",
  personType: "INDIVIDUAL",
  legalName: "Barbearia Teste Ltda",
  cpfCnpj: VALID_CPF,
  billingEmail: "financeiro@example.com",
  billingPhone: "11999999999",
  createdAt: new Date("2026-07-25T00:00:00.000Z"),
  updatedAt: new Date("2026-07-25T00:00:00.000Z"),
};

import { POST as postSubscription } from "@/app/api/admin/billing/asaas/subscription/route";
import { GET as getStatus } from "@/app/api/admin/billing/asaas/status/route";
import { GET as getProfile, PUT as putProfile } from "@/app/api/admin/billing/profile/route";
import { ensureAsaasCustomerForBarbershop } from "@/lib/asaas/customers";
import { createAsaasSubscriptionForBarbershop, SubscriptionValidationError } from "@/lib/asaas/subscriptions";
import { getBillingPlanByCode, getActiveBillingPlans, isAllowedBillingType } from "@/lib/billing/plans";
import { isValidCpf, isValidCnpj, maskCpfCnpj, normalizeCpfCnpj } from "@/lib/billing/documents";

describe("PR #26 — Criar Cliente + Assinatura Asaas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("ASAAS_API_KEY", "test_api_key_secret");
    vi.stubEnv("ASAAS_ENV", "sandbox");
    globalThis.fetch = fetchMock;
    prismaMock.barbershopBillingProfile.findUnique.mockResolvedValue(BILLING_PROFILE);
    prismaMock.asaasBillingPayment.findMany.mockResolvedValue([]);
    prismaMock.asaasBillingCustomer.update.mockResolvedValue({
      id: "cust-db-1",
      barbershopId: "shop-1",
      asaasCustomerId: "cus_existing",
      name: BILLING_PROFILE.legalName,
      email: BILLING_PROFILE.billingEmail,
      cpfCnpj: VALID_CPF,
      phone: BILLING_PROFILE.billingPhone,
      externalReference: "tb_barbershop_shop-1",
    });
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
      expect(plan!.name).toBe("Plano Tem Barber");
      expect(plan!.value).toBe(49.9);
      expect(plan!.cycle).toBe("MONTHLY");
    });

    it("nao permite contratar premium_monthly", () => {
      expect(getBillingPlanByCode("premium_monthly")).toBeNull();
    });

    it("retorna null para plano inexistente", () => {
      expect(getBillingPlanByCode("nonexistent")).toBeNull();
    });

    it("lista planos ativos", () => {
      const plans = getActiveBillingPlans();
      expect(plans).toHaveLength(1);
      expect(plans.every((p) => p.active)).toBe(true);
      expect(plans[0]).toMatchObject({
        code: "pro_monthly",
        value: 49.9,
        cycle: "MONTHLY",
      });
    });

    it("valida billingType permitido", () => {
      expect(isAllowedBillingType("PIX")).toBe(true);
      expect(isAllowedBillingType("BOLETO")).toBe(true);
      expect(isAllowedBillingType("CREDIT_CARD")).toBe(false);
      expect(isAllowedBillingType("INVALID")).toBe(false);
    });
  });

  describe("1.1 Documentos e Perfil de Faturamento", () => {
    function makeProfileRequest(body: Record<string, unknown>) {
      return new NextRequest("http://localhost/api/admin/billing/profile", {
        method: "PUT",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
    }

    it("normaliza, valida e mascara CPF/CNPJ", () => {
      expect(normalizeCpfCnpj("529.982.247-25")).toBe(VALID_CPF);
      expect(isValidCpf(VALID_CPF)).toBe(true);
      expect(isValidCpf("11111111111")).toBe(false);
      expect(isValidCpf("52998224724")).toBe(false);
      expect(isValidCnpj(VALID_CNPJ)).toBe(true);
      expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
      expect(isValidCnpj("11222333000180")).toBe(false);
      expect(maskCpfCnpj(VALID_CPF)).toBe("***.***.***-25");
      expect(maskCpfCnpj(VALID_CNPJ)).toBe("**.***.***/****-81");
    });

    it("OWNER e MANAGER leem perfil sem documento integral", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });
      prismaMock.barbershopBillingProfile.findUnique.mockResolvedValue(BILLING_PROFILE);

      const ownerRes = await getProfile();
      const ownerData = await ownerRes.json();

      expect(ownerRes.status).toBe(200);
      expect(ownerData.completed).toBe(true);
      expect(ownerData.cpfCnpjMasked).toBe("***.***.***-25");
      expect(JSON.stringify(ownerData)).not.toContain(VALID_CPF);

      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "manager-1", barbershopId: "shop-1", role: "MANAGER", memberId: "m-2" },
      });

      const managerRes = await getProfile();
      expect(managerRes.status).toBe(200);
    });

    it("BARBER nao le perfil", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: NextResponse.json({ error: "Acesso negado." }, { status: 403 }),
        data: null,
      });

      const res = await getProfile();
      expect(res.status).toBe(403);
    });

    it("OWNER salva perfil tenant-scoped por upsert", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });
      prismaMock.barbershopBillingProfile.findUnique.mockResolvedValue(null);
      prismaMock.barbershopBillingProfile.upsert.mockResolvedValue(BILLING_PROFILE);

      const res = await putProfile(
        makeProfileRequest({
          personType: "INDIVIDUAL",
          legalName: "Barbearia Teste Ltda",
          cpfCnpj: "529.982.247-25",
          billingEmail: "Financeiro@Example.com",
          billingPhone: "(11) 99999-9999",
          barbershopId: "other-tenant",
        })
      );
      const data = await res.json();
      const upsertArgs = prismaMock.barbershopBillingProfile.upsert.mock.calls[0][0];

      expect(res.status).toBe(200);
      expect(upsertArgs.where).toEqual({ barbershopId: "shop-1" });
      expect(upsertArgs.create.barbershopId).toBe("shop-1");
      expect(upsertArgs.create.cpfCnpj).toBe(VALID_CPF);
      expect(upsertArgs.create.billingEmail).toBe("financeiro@example.com");
      expect(upsertArgs.create.billingPhone).toBe("11999999999");
      expect(JSON.stringify(data)).not.toContain(VALID_CPF);
    });

    it("MANAGER nao salva perfil", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "manager-1", barbershopId: "shop-1", role: "MANAGER", memberId: "m-2" },
      });

      const res = await putProfile(
        makeProfileRequest({
          personType: "INDIVIDUAL",
          legalName: "Barbearia Teste Ltda",
          cpfCnpj: VALID_CPF,
          billingEmail: "financeiro@example.com",
        })
      );

      expect(res.status).toBe(403);
      expect(prismaMock.barbershopBillingProfile.upsert).not.toHaveBeenCalled();
    });

    it("COMPANY exige CNPJ valido", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });
      prismaMock.barbershopBillingProfile.findUnique.mockResolvedValue(null);

      const invalid = await putProfile(
        makeProfileRequest({
          personType: "COMPANY",
          legalName: "Barbearia Teste Ltda",
          cpfCnpj: VALID_CPF,
          billingEmail: "financeiro@example.com",
        })
      );
      expect(invalid.status).toBe(400);

      prismaMock.barbershopBillingProfile.upsert.mockResolvedValue({
        ...BILLING_PROFILE,
        personType: "COMPANY",
        cpfCnpj: VALID_CNPJ,
      });
      const valid = await putProfile(
        makeProfileRequest({
          personType: "COMPANY",
          legalName: "Barbearia Teste Ltda",
          cpfCnpj: VALID_CNPJ,
          billingEmail: "financeiro@example.com",
        })
      );
      expect(valid.status).toBe(200);
    });
  });

  // =============================================
  // CUSTOMER ASAAS
  // =============================================
  describe("2. Customer Asaas (ensureAsaasCustomerForBarbershop)", () => {
    it("bloqueia customer sem perfil de faturamento completo", async () => {
      prismaMock.barbershopBillingProfile.findUnique.mockResolvedValue(null);

      await expect(ensureAsaasCustomerForBarbershop("shop-1")).rejects.toMatchObject({
        code: "BILLING_PROFILE_INCOMPLETE",
      });
      expect(prismaMock.asaasBillingCustomer.create).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("atualiza customer local/remoto existente usando dados do perfil", async () => {
      prismaMock.barbershopBillingProfile.findUnique.mockResolvedValue(BILLING_PROFILE);
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
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "cus_existing_123" }),
      });
      prismaMock.asaasBillingCustomer.update.mockResolvedValue({
        id: "cust-db-1",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_existing_123",
        name: BILLING_PROFILE.legalName,
        email: BILLING_PROFILE.billingEmail,
        cpfCnpj: VALID_CPF,
        phone: BILLING_PROFILE.billingPhone,
        externalReference: "tb_barbershop_shop-1",
      });

      const result = await ensureAsaasCustomerForBarbershop("shop-1");
      const [url, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);

      expect(result.created).toBe(false);
      expect(result.asaasCustomerId).toBe("cus_existing_123");
      expect(url).toContain("sandbox.asaas.com/api/v3/customers/cus_existing_123");
      expect(opts.method).toBe("PUT");
      expect(body).toMatchObject({
        name: BILLING_PROFILE.legalName,
        cpfCnpj: VALID_CPF,
        email: BILLING_PROFILE.billingEmail,
        mobilePhone: BILLING_PROFILE.billingPhone,
        externalReference: "tb_barbershop_shop-1",
        notificationDisabled: true,
      });
      expect(prismaMock.asaasBillingCustomer.create).not.toHaveBeenCalled();
      expect(prismaMock.asaasBillingCustomer.update).toHaveBeenCalledOnce();
    });

    it("cria customer no Asaas quando nao existe localmente", async () => {
      prismaMock.barbershopBillingProfile.findUnique.mockResolvedValue(BILLING_PROFILE);
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue(null);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "cus_new_456",
            name: BILLING_PROFILE.legalName,
            email: BILLING_PROFILE.billingEmail,
            cpfCnpj: VALID_CPF,
            externalReference: "tb_barbershop_shop-1",
          }),
      });

      prismaMock.asaasBillingCustomer.create.mockResolvedValue({
        id: "cust-db-2",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_new_456",
        name: BILLING_PROFILE.legalName,
        email: BILLING_PROFILE.billingEmail,
        cpfCnpj: VALID_CPF,
        phone: BILLING_PROFILE.billingPhone,
        externalReference: "tb_barbershop_shop-1",
      });

      const result = await ensureAsaasCustomerForBarbershop("shop-1");

      expect(result.created).toBe(true);
      expect(result.asaasCustomerId).toBe("cus_new_456");
      expect(fetchMock).toHaveBeenCalledOnce();

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain("sandbox.asaas.com/api/v3/customers");
      expect(opts.headers.access_token).toBe("test_api_key_secret");
      const body = JSON.parse(opts.body);
      expect(body.name).toBe(BILLING_PROFILE.legalName);
      expect(body.cpfCnpj).toBe(VALID_CPF);
      expect(body.email).toBe(BILLING_PROFILE.billingEmail);
      expect(body.notificationDisabled).toBe(true);
      expect(body.externalReference).toBe("tb_barbershop_shop-1");
    });

    it("nao expoe ASAAS_API_KEY no body da requisicao de criacao de customer", async () => {
      prismaMock.barbershopBillingProfile.findUnique.mockResolvedValue(BILLING_PROFILE);
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue(null);

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: "cus_x", name: BILLING_PROFILE.legalName }),
      });

      prismaMock.asaasBillingCustomer.create.mockResolvedValue({
        id: "db-x",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_x",
        name: BILLING_PROFILE.legalName,
        email: BILLING_PROFILE.billingEmail,
        cpfCnpj: VALID_CPF,
        phone: BILLING_PROFILE.billingPhone,
        externalReference: "tb_barbershop_shop-1",
      });

      await ensureAsaasCustomerForBarbershop("shop-1");

      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(JSON.stringify(body)).not.toContain("test_api_key_secret");
    });
  });

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
            value: 49.9,
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
        planName: "Plano Tem Barber",
        value: { toString: () => "49.9" },
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
      expect(result.subscription.value).toBe("49.9");
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
        planName: "Plano Tem Barber",
        value: { toString: () => "49.9" },
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
      expect(prismaMock.asaasBillingSubscription.create).not.toHaveBeenCalled();
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
            value: 49.9,
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
        planName: "Plano Tem Barber",
        value: { toString: () => "49.9" },
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

    it("ignora value indevido enviado pelo navegador e usa valor oficial", async () => {
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
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: "sub_asaas_new",
            customer: "cus_123",
            billingType: "PIX",
            value: 49.9,
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
        planName: "Plano Tem Barber",
        value: { toString: () => "49.9" },
        cycle: "MONTHLY",
        status: "ACTIVE",
        billingType: "PIX",
        nextDueDate: new Date("2026-07-26"),
        externalReference: "tb_sub_shop-1_pro_monthly",
      });

      const res = await postSubscription(
        makeRequest({ planCode: "pro_monthly", billingType: "PIX", value: 1, cycle: "YEARLY" })
      );
      const [, options] = fetchMock.mock.calls.find(([url]) =>
        String(url).includes("/subscriptions")
      )!;
      const asaasBody = JSON.parse(options.body);

      expect(res.status).toBe(201);
      expect(asaasBody.value).toBe(49.9);
      expect(asaasBody.cycle).toBe("MONTHLY");
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

    it("premium_monthly retorna 400", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });

      const res = await postSubscription(makeRequest({ planCode: "premium_monthly", billingType: "PIX" }));
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("INVALID_PLAN");
      expect(fetchMock).not.toHaveBeenCalled();
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
        planName: "Plano Tem Barber",
        value: { toString: () => "49.9" },
        cycle: "MONTHLY",
        status: "ACTIVE",
        billingType: "PIX",
        nextDueDate: new Date("2026-08-01"),
        externalReference: "tb_sub_shop-1_pro_monthly",
        createdAt: new Date(),
      });

      const res = await getStatus();
      const data = await res.json();
      const serialized = JSON.stringify(data);

      expect(res.status).toBe(200);
      expect(data.profileCompleted).toBe(true);
      expect(data.documentConfigured).toBe(true);
      expect(data.cpfCnpjMasked).toBe("***.***.***-25");
      expect(data.customerConfigured).toBe(true);
      expect(data.plan).toMatchObject({
        code: "pro_monthly",
        name: "Plano Tem Barber",
        value: "49.90",
        cycle: "MONTHLY",
      });
      expect(data.billingTypes).toEqual(["PIX", "BOLETO"]);
      expect(data.subscription.billingType).toBe("PIX");
      expect(data.subscription.planCode).toBe("pro_monthly");
      expect(serialized).not.toContain("secret_key");
      expect(serialized).not.toContain(VALID_CPF);
      expect(serialized).not.toContain("cus_123");
      expect(serialized).not.toContain("sub_123");
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
            value: 49.9,
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
        planName: "Plano Tem Barber",
        value: { toString: () => "49.9" },
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
