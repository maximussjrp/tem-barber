import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { prismaMock, getAdminSessionMock, fetchMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershopBillingProfile: { findUnique: vi.fn(), upsert: vi.fn() },
    asaasBillingCustomer: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    asaasBillingSubscription: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    asaasBillingPayment: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    tenantSubscription: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    plan: { findUnique: vi.fn(), findFirst: vi.fn() },
    barbershop: { findUniqueOrThrow: vi.fn() },
    barbershopMember: { findFirst: vi.fn() },
    $transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(prismaMock)),
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
import { GET as getCurrentPayment, sanitizeBillingUrl } from "@/app/api/admin/billing/asaas/current-payment/route";
import { GET as getPixQrCode } from "@/app/api/admin/billing/asaas/current-payment/pix/route";
import { syncTenantSubscriptionAccessOnPayment, addCalendarMonths } from "@/lib/asaas/webhooks";
import { ensureAsaasCustomerForBarbershop, configureAsaasCustomerEmailNotifications } from "@/lib/asaas/customers";
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
    prismaMock.plan.findUnique.mockImplementation(async ({ where }: { where?: { code?: string } }) => {
      if (!where?.code || where.code === "pro_monthly") {
        return {
          id: "plan-db-1",
          code: "pro_monthly",
          name: "Plano Tem Barber",
          price: 49.9,
          period: "MONTHLY",
          isActive: true,
        };
      }
      return null;
    });
    prismaMock.plan.findFirst.mockImplementation(prismaMock.plan.findUnique as any);
    prismaMock.asaasBillingPayment.findUnique.mockImplementation(async ({ where }: { where: { asaasPaymentId: string } }) => ({
      asaasPaymentId: where.asaasPaymentId,
      asaasSubscriptionId: "sub_123",
      barbershopId: "shop-1",
    }));
    prismaMock.asaasBillingSubscription.findUnique.mockImplementation(async ({ where }: { where: { asaasSubscriptionId: string } }) => ({
      id: "sub-db-1",
      barbershopId: "shop-1",
      asaasSubscriptionId: where?.asaasSubscriptionId || "sub_123",
      planCode: "pro_monthly",
      planName: "Plano Tem Barber",
      value: 49.9,
      status: "ACTIVE",
    }));
    prismaMock.tenantSubscription.findUnique.mockImplementation(async ({ where }: { where?: { barbershopId?: string } }) => ({
      id: "sub-t1",
      barbershopId: where?.barbershopId || "shop-1",
      planId: "plan-db-1",
      status: "ACTIVE",
    }));
    prismaMock.asaasBillingPayment.findMany.mockResolvedValue([]);
    prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.tenantSubscription.update.mockResolvedValue({});
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
        notificationDisabled: false,
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
            data: [],
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

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain("sandbox.asaas.com/api/v3/customers");
      expect(opts.headers.access_token).toBe("test_api_key_secret");
      const body = JSON.parse(opts.body);
      expect(body.name).toBe(BILLING_PROFILE.legalName);
      expect(body.cpfCnpj).toBe(VALID_CPF);
      expect(body.email).toBe(BILLING_PROFILE.billingEmail);
      expect(body.notificationDisabled).toBe(false);
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

    it("NÃO chama NENHUMA API remota do Asaas (0 chamadas) se o plano estiver ausente no banco de dados local", async () => {
      prismaMock.plan.findUnique.mockResolvedValue(null);

      await expect(
        createAsaasSubscriptionForBarbershop({
          barbershopId: "shop-1",
          planCode: "pro_monthly",
          billingType: "PIX",
        })
      ).rejects.toThrow(SubscriptionValidationError);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("NÃO chama NENHUMA API remota do Asaas (0 chamadas) se o plano estiver inativo no banco de dados local", async () => {
      prismaMock.plan.findUnique.mockResolvedValue({
        id: "plan-db-1",
        code: "pro_monthly",
        name: "Plano Tem Barber",
        price: 49.9,
        period: "MONTHLY",
        isActive: false,
      });

      await expect(
        createAsaasSubscriptionForBarbershop({
          barbershopId: "shop-1",
          planCode: "pro_monthly",
          billingType: "PIX",
        })
      ).rejects.toThrow(SubscriptionValidationError);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("NÃO chama NENHUMA API remota do Asaas (0 chamadas) se houver divergência de código no banco em relação ao catálogo", async () => {
      prismaMock.plan.findUnique.mockResolvedValue({
        id: "plan-db-1",
        code: "founder_2026",
        name: "Plano Tem Barber",
        price: 49.9,
        period: "MONTHLY",
        isActive: true,
      });

      await expect(
        createAsaasSubscriptionForBarbershop({
          barbershopId: "shop-1",
          planCode: "pro_monthly",
          billingType: "PIX",
        })
      ).rejects.toThrow(SubscriptionValidationError);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("NÃO chama NENHUMA API remota do Asaas (0 chamadas) se o plano no banco estiver com código NULL", async () => {
      prismaMock.plan.findUnique.mockResolvedValue({
        id: "plan-db-1",
        code: null,
        name: "Plano Tem Barber",
        price: 49.9,
        period: "MONTHLY",
        isActive: true,
      });

      await expect(
        createAsaasSubscriptionForBarbershop({
          barbershopId: "shop-1",
          planCode: "pro_monthly",
          billingType: "PIX",
        })
      ).rejects.toThrow(SubscriptionValidationError);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("NÃO chama NENHUMA API remota do Asaas (0 chamadas) se houver divergência de preço no banco em relação ao catálogo", async () => {
      prismaMock.plan.findUnique.mockResolvedValue({
        id: "plan-db-1",
        code: "pro_monthly",
        name: "Plano Tem Barber",
        price: 99.9,
        period: "MONTHLY",
        isActive: true,
      });

      await expect(
        createAsaasSubscriptionForBarbershop({
          barbershopId: "shop-1",
          planCode: "pro_monthly",
          billingType: "PIX",
        })
      ).rejects.toThrow(SubscriptionValidationError);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("NÃO chama NENHUMA API remota do Asaas (0 chamadas) se houver divergência de período no banco em relação ao catálogo", async () => {
      prismaMock.plan.findUnique.mockResolvedValue({
        id: "plan-db-1",
        code: "pro_monthly",
        name: "Plano Tem Barber",
        price: 49.9,
        period: "YEARLY",
        isActive: true,
      });

      await expect(
        createAsaasSubscriptionForBarbershop({
          barbershopId: "shop-1",
          planCode: "pro_monthly",
          billingType: "PIX",
        })
      ).rejects.toThrow(SubscriptionValidationError);

      expect(fetchMock).not.toHaveBeenCalled();
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

  // =============================================
  // ÁREA DE PAGAMENTO E QR CODE PIX
  // =============================================
  describe("7. Área de Pagamento e Pix QR Code", () => {
    it("sanitiza URLs permitindo apenas HTTPS", () => {
      expect(sanitizeBillingUrl("https://www.asaas.com/i/12345")).toBe("https://www.asaas.com/i/12345");
      expect(sanitizeBillingUrl("http://insecure.com")).toBeNull();
      expect(sanitizeBillingUrl("javascript:alert(1)")).toBeNull();
      expect(sanitizeBillingUrl("data:text/html,bad")).toBeNull();
    });

    it("GET /current-payment retorna cobrança atual tenant-scoped para OWNER/MANAGER", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });

      prismaMock.asaasBillingPayment.findFirst.mockResolvedValue({
        id: "p1",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_123",
        status: "PENDING",
        billingType: "PIX",
        value: { toString: () => "49.90" },
        dueDate: new Date("2026-07-26"),
        paymentDate: null,
        invoiceUrl: "https://www.asaas.com/i/pay_123",
        bankSlipUrl: null,
      });

      const res = await getCurrentPayment();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.exists).toBe(true);
      expect(data.status).toBe("PENDING");
      expect(data.canPay).toBe(true);
      expect(data.invoiceUrl).toBe("https://www.asaas.com/i/pay_123");
    });

    it("GET /current-payment nega acesso para BARBER", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "barber-1", barbershopId: "shop-1", role: "BARBER", memberId: "m-1" },
      });

      const res = await getCurrentPayment();
      expect(res.status).toBe(403);
    });

    it("GET /current-payment/pix busca QR Code no Asaas server-side", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });

      prismaMock.asaasBillingPayment.findFirst.mockResolvedValue({
        id: "p1",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_123",
        status: "PENDING",
        billingType: "PIX",
      });

      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            encodedImage: "iVBORw0KGgo...",
            payload: "00020126580014BR.GOV.BCB.PIX...",
            expirationDate: "2027-07-26 23:59:59",
          }),
      });

      const res = await getPixQrCode();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.encodedImage).toBe("iVBORw0KGgo...");
      expect(data.payload).toBe("00020126580014BR.GOV.BCB.PIX...");
    });

    it("GET /current-payment/pix nega acesso para BARBER", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "barber-1", barbershopId: "shop-1", role: "BARBER", memberId: "m-1" },
      });

      const res = await getPixQrCode();
      expect(res.status).toBe(403);
    });

    it("syncTenantSubscriptionAccessOnPayment ativa TenantSubscription de forma idempotente", async () => {
      prismaMock.plan.findUnique.mockResolvedValue({ id: "plan-db-1", code: "pro_monthly", name: "Plano Bronze" });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "sub-tenant-1",
        barbershopId: "shop-1",
        planId: "plan-db-1",
        lastAccessPaymentId: null,
      });

      await syncTenantSubscriptionAccessOnPayment("shop-1", {
        id: "pay_123",
        billingType: "PIX",
        value: 49.9,
        paymentDate: "2026-07-25",
      });

      expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sub-tenant-1" },
          data: expect.objectContaining({
            status: "ACTIVE",
            planName: "Plano Tem Barber",
            lastAccessPaymentId: "pay_123",
          }),
        })
      );
    });
  });

  // =============================================
  // AUDITORIAS E COMPROVAÇÕES FINAIS (TASKS 1-4)
  // =============================================
  describe("8. Auditorias e Comprovações de Segurança e Idempotência", () => {
    it("Task 1: configureAsaasCustomerEmailNotifications gerencia regras de notificação via PUT individual e re-consulta", async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "not_1", enabled: true, scheduleOffset: 0 },
                { id: "not_2", enabled: false, scheduleOffset: 5 },
              ],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "not_1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ id: "not_2" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: [
                { id: "not_1", emailEnabledForCustomer: true, smsEnabledForCustomer: false },
                { id: "not_2", emailEnabledForCustomer: true, smsEnabledForCustomer: false },
              ],
            }),
        });

      const res = await configureAsaasCustomerEmailNotifications("cus_test_99");

      expect(res).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(4);

      // 1ª chamada: GET /v3/customers/cus_test_99/notifications sem body
      expect(fetchMock.mock.calls[0][0]).toContain("/customers/cus_test_99/notifications");
      expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();

      // 2ª e 3ª chamadas: PUT /v3/notifications/not_...
      expect(fetchMock.mock.calls[1][0]).toContain("/notifications/not_1");
      expect(fetchMock.mock.calls[1][1]?.method).toBe("PUT");
      const body1 = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
      expect(body1).toEqual({
        enabled: true,
        scheduleOffset: 0,
        emailEnabledForCustomer: true,
        smsEnabledForCustomer: false,
        whatsappEnabledForCustomer: false,
        phoneCallEnabledForCustomer: false,
        emailEnabledForProvider: false,
        smsEnabledForProvider: false,
      });

      expect(fetchMock.mock.calls[2][0]).toContain("/notifications/not_2");
      expect(fetchMock.mock.calls[2][1]?.method).toBe("PUT");
      const body2 = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
      expect(body2).toEqual({
        enabled: false,
        scheduleOffset: 5,
        emailEnabledForCustomer: true,
        smsEnabledForCustomer: false,
        whatsappEnabledForCustomer: false,
        phoneCallEnabledForCustomer: false,
        emailEnabledForProvider: false,
        smsEnabledForProvider: false,
      });

      // 4ª chamada: GET de verificação
      expect(fetchMock.mock.calls[3][0]).toContain("/customers/cus_test_99/notifications");
    });

    it("Task 2: GET /current-payment executa fallback de conciliação remoto sem criar cobrança nova", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });

      // Não há cobrança local
      prismaMock.asaasBillingPayment.findFirst.mockResolvedValueOnce(null);

      // Existe assinatura e cliente locais
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_remote_100",
      });
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue({
        id: "cust-db-1",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_remote_200",
      });

      // Simular chamada remota ao Asaas GET /subscriptions/sub_remote_100/payments (sem body)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: "pay_remote_777",
                customer: "cus_remote_200",
                subscription: "sub_remote_100",
                status: "PENDING",
                billingType: "PIX",
                value: 49.9,
                dueDate: "2026-08-10",
                invoiceUrl: "https://www.asaas.com/i/pay_remote_777",
              },
              {
                id: "pay_other_customer",
                customer: "cus_OTHER_CUSTOMER",
                subscription: "sub_remote_100",
                status: "PENDING",
                value: 999,
              },
            ],
          }),
      });

      prismaMock.asaasBillingPayment.upsert.mockResolvedValue({
        id: "payment-db-reconciled",
        barbershopId: "shop-1",
        asaasPaymentId: "pay_remote_777",
        status: "PENDING",
        billingType: "PIX",
        value: { toString: () => "49.90" },
        dueDate: new Date("2026-08-10"),
        paymentDate: null,
        invoiceUrl: "https://www.asaas.com/i/pay_remote_777",
        bankSlipUrl: null,
      });

      const res = await getCurrentPayment();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.exists).toBe(true);
      expect(data.status).toBe("PENDING");
      expect(data.invoiceUrl).toBe("https://www.asaas.com/i/pay_remote_777");

      // Comprovar chamada remota via GET sem body
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/subscriptions/sub_remote_100/payments"),
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();

      // Comprovar upsert local da cobrança reconciliada
      expect(prismaMock.asaasBillingPayment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { asaasPaymentId: "pay_remote_777" },
        })
      );
    });

    it("Task 2: GET /current-payment retorna exists false se lista remota for vazia", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER", memberId: "m-1" },
      });

      prismaMock.asaasBillingPayment.findFirst.mockResolvedValueOnce(null);
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue({
        id: "sub-db-1",
        barbershopId: "shop-1",
        asaasSubscriptionId: "sub_remote_100",
      });
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue({
        id: "cust-db-1",
        barbershopId: "shop-1",
        asaasCustomerId: "cus_remote_200",
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      });

      const res = await getCurrentPayment();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.exists).toBe(false);
    });

    it("Task 3: GET /status exige currentPeriodEnd / trialEndsAt no futuro para validar ACTIVE / TRIAL", async () => {
      getAdminSessionMock.mockResolvedValue({
        error: null,
        data: { userId: "owner-1", barbershopId: "shop-1", role: "OWNER" },
      });

      prismaMock.barbershopBillingProfile.findUnique.mockResolvedValue(BILLING_PROFILE);
      prismaMock.asaasBillingCustomer.findFirst.mockResolvedValue(null);
      prismaMock.asaasBillingSubscription.findFirst.mockResolvedValue(null);
      prismaMock.asaasBillingPayment.findMany.mockResolvedValue([]);

      prismaMock.tenantSubscription.findUnique.mockReset();

      // 1. ACTIVE com currentPeriodEnd no futuro
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      prismaMock.tenantSubscription.findUnique.mockResolvedValueOnce({
        id: "sub-1",
        barbershopId: "shop-1",
        status: "ACTIVE",
        currentPeriodEnd: futureDate,
        trialEndsAt: null,
        gracePeriodEndsAt: null,
      });

      const resActive = await getStatus();
      const dataActive = await resActive.json();
      expect(dataActive.accessStatus).toBe("ACTIVE");
      expect(dataActive.remainingDays).toBeGreaterThan(0);

      // 2. ACTIVE com currentPeriodEnd vencido -> resulta em EXPIRED
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      prismaMock.tenantSubscription.findUnique.mockResolvedValueOnce({
        id: "sub-1",
        barbershopId: "shop-1",
        status: "ACTIVE",
        currentPeriodEnd: pastDate,
        trialEndsAt: null,
        gracePeriodEndsAt: null,
      });

      const resExpired = await getStatus();
      const dataExpired = await resExpired.json();
      expect(dataExpired.accessStatus).toBe("EXPIRED");
      expect(dataExpired.remainingDays).toBe(0);

      // 3. TRIAL ativo com trialEndsAt no futuro
      prismaMock.tenantSubscription.findUnique.mockResolvedValueOnce({
        id: "sub-1",
        barbershopId: "shop-1",
        status: "TRIAL",
        currentPeriodEnd: pastDate,
        trialEndsAt: futureDate,
        gracePeriodEndsAt: null,
      });

      const resTrial = await getStatus();
      const dataTrial = await resTrial.json();
      expect(dataTrial.accessStatus).toBe("TRIAL");
      expect(dataTrial.remainingDays).toBeGreaterThan(0);

      // 4. GRACE_PERIOD ativo
      prismaMock.tenantSubscription.findUnique.mockResolvedValueOnce({
        id: "sub-1",
        barbershopId: "shop-1",
        status: "PAST_DUE",
        currentPeriodEnd: pastDate,
        trialEndsAt: null,
        gracePeriodEndsAt: futureDate,
      });

      const resGrace = await getStatus();
      const dataGrace = await resGrace.json();
      expect(dataGrace.accessStatus).toBe("GRACE_PERIOD");
      expect(dataGrace.remainingDays).toBeGreaterThan(0);
    });

    it("addCalendarMonths preserva corretamente finais de mês e anos bissextos", () => {
      // 25/07/2026 -> 25/08/2026
      const d1 = new Date("2026-07-25T12:00:00.000Z");
      const r1 = addCalendarMonths(d1, 1);
      expect(r1.getMonth()).toBe(7); // Agosto (0-indexed 7)
      expect(r1.getDate()).toBe(25);

      // 31/01/2026 -> 28/02/2026
      const d2 = new Date("2026-01-31T12:00:00.000Z");
      const r2 = addCalendarMonths(d2, 1);
      expect(r2.getMonth()).toBe(1); // Fevereiro
      expect(r2.getDate()).toBe(28);

      // 31/01/2028 -> 29/02/2028 (ano bissexto)
      const d3 = new Date("2028-01-31T12:00:00.000Z");
      const r3 = addCalendarMonths(d3, 1);
      expect(r3.getMonth()).toBe(1); // Fevereiro
      expect(r3.getDate()).toBe(29);
    });

    it("Task 4.1: PAYMENT_RECEIVED pay_123 com updateMany (count=1) concede acesso atômico", async () => {
      prismaMock.plan.findUnique.mockResolvedValue({ id: "plan-db-1", code: "pro_monthly", name: "Plano Tem Barber" });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "sub-t1",
        barbershopId: "shop-1",
        planId: "plan-db-1",
        lastAccessPaymentId: null,
      });
      prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 1 });

      await syncTenantSubscriptionAccessOnPayment("shop-1", {
        id: "pay_123",
        dueDate: "2026-07-25",
        billingType: "PIX",
        value: 49.9,
      });

      expect(prismaMock.asaasBillingPayment.updateMany).toHaveBeenCalledWith({
        where: {
          asaasPaymentId: "pay_123",
          barbershopId: "shop-1",
          accessAppliedAt: null,
        },
        data: {
          accessAppliedAt: expect.any(Date),
        },
      });

      expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sub-t1" },
          data: expect.objectContaining({
            status: "ACTIVE",
            lastAccessPaymentId: "pay_123",
            currentPeriodStart: new Date("2026-07-25T00:00:00.000Z"),
            currentPeriodEnd: new Date("2026-08-25T00:00:00.000Z"),
          }),
        })
      );
    });

    it("Task 4.2: PAYMENT_CONFIRMED pay_123 já com accessAppliedAt (count=0) não concede acesso novamente", async () => {
      prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.tenantSubscription.update.mockClear();

      await syncTenantSubscriptionAccessOnPayment("shop-1", {
        id: "pay_123",
        dueDate: "2026-07-25",
        billingType: "PIX",
        value: 49.9,
      });

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
      expect(prismaMock.tenantSubscription.create).not.toHaveBeenCalled();
    });

    it("Task 4.3: Dois processamentos simultâneos de pay_123 resultam em apenas 1 extensão", async () => {
      prismaMock.plan.findUnique.mockResolvedValue({ id: "plan-db-1", code: "pro_monthly", name: "Plano Tem Barber" });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "sub-t1",
        barbershopId: "shop-1",
        planId: "plan-db-1",
      });

      // Worker 1 consegue a trava (count = 1), Worker 2 não consegue (count = 0)
      prismaMock.asaasBillingPayment.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      prismaMock.tenantSubscription.update.mockClear();

      const p1 = syncTenantSubscriptionAccessOnPayment("shop-1", {
        id: "pay_123",
        dueDate: "2026-07-25",
      });
      const p2 = syncTenantSubscriptionAccessOnPayment("shop-1", {
        id: "pay_123",
        dueDate: "2026-07-25",
      });

      await Promise.all([p1, p2]);

      expect(prismaMock.tenantSubscription.update).toHaveBeenCalledTimes(1);
    });

    it("Task 4.4: Evento duplicado de outro asaasEventId não estende pois updateMany retorna count=0", async () => {
      prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.tenantSubscription.update.mockClear();

      await syncTenantSubscriptionAccessOnPayment("shop-1", {
        id: "pay_123",
        dueDate: "2026-07-25",
      });

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
    });

    it("Task 4.5: pay_456 no mês seguinte com updateMany count=1 concede nova extensão", async () => {
      prismaMock.plan.findUnique.mockResolvedValue({ id: "plan-db-1", code: "pro_monthly", name: "Plano Tem Barber" });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({
        id: "sub-t1",
        barbershopId: "shop-1",
        planId: "plan-db-1",
      });
      prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.tenantSubscription.update.mockClear();

      await syncTenantSubscriptionAccessOnPayment("shop-1", {
        id: "pay_456",
        dueDate: "2026-08-25",
        billingType: "PIX",
        value: 49.9,
      });

      expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sub-t1" },
          data: expect.objectContaining({
            lastAccessPaymentId: "pay_456",
            currentPeriodStart: new Date("2026-08-25T00:00:00.000Z"),
            currentPeriodEnd: new Date("2026-09-25T00:00:00.000Z"),
          }),
        })
      );
    });

    it("Task 4.6: Evento atrasado de pay_123 depois de pay_456 não estende pois pay_123 tem count=0", async () => {
      prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.tenantSubscription.update.mockClear();

      await syncTenantSubscriptionAccessOnPayment("shop-1", {
        id: "pay_123",
        dueDate: "2026-07-25",
      });

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
    });

    it("Task 4.7: Falha ao atualizar TenantSubscription faz $transaction abortar", async () => {
      prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.plan.findUnique.mockResolvedValue({ id: "plan-db-1", code: "pro_monthly" });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({ id: "sub-t1", barbershopId: "shop-1", planId: "plan-db-1" });
      prismaMock.tenantSubscription.update.mockRejectedValue(new Error("DB_LOCK_ERROR"));
      prismaMock.tenantSubscription.update.mockRejectedValue(new Error("DB_LOCK_ERROR"));

      await expect(
        syncTenantSubscriptionAccessOnPayment("shop-1", { id: "pay_err_999", dueDate: "2026-07-25" })
      ).rejects.toThrow("DB_LOCK_ERROR");
    });

    it("Task 4.8: accessAppliedAt e updateMany pertencem ao payment e tenant corretos", async () => {
      prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 0 });

      await syncTenantSubscriptionAccessOnPayment("shop-100", {
        id: "pay_tenant_specific",
      });

      expect(prismaMock.asaasBillingPayment.updateMany).toHaveBeenCalledWith({
        where: {
          asaasPaymentId: "pay_tenant_specific",
          barbershopId: "shop-100",
          accessAppliedAt: null,
        },
        data: {
          accessAppliedAt: expect.any(Date),
        },
      });
    });

    it("Task 4.9: Payment de outro tenant (shop-OTHER) não ativa acesso", async () => {
      prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.tenantSubscription.update.mockClear();

      await syncTenantSubscriptionAccessOnPayment("shop-OTHER", {
        id: "pay_123",
      });

      expect(prismaMock.tenantSubscription.update).not.toHaveBeenCalled();
    });

    it("Task 4.10: Vencimento em 31/01 é tratado corretamente para 28/02", async () => {
      prismaMock.plan.findUnique.mockResolvedValue({ id: "plan-db-1", code: "pro_monthly", name: "Plano Tem Barber" });
      prismaMock.tenantSubscription.findUnique.mockResolvedValue({ id: "sub-t1", barbershopId: "shop-1", planId: "plan-db-1" });
      prismaMock.asaasBillingPayment.updateMany.mockResolvedValue({ count: 1 });

      await syncTenantSubscriptionAccessOnPayment("shop-1", {
        id: "pay_jan31",
        dueDate: "2026-01-31T12:00:00.000Z",
      });

      expect(prismaMock.tenantSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentPeriodStart: new Date("2026-01-31T12:00:00.000Z"),
            currentPeriodEnd: new Date("2026-02-28T12:00:00.000Z"),
          }),
        })
      );
    });
  });
});
