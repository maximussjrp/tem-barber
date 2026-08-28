import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimitStore } from "@/lib/public-rate-limit";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findFirst: vi.fn(), create: vi.fn() },
    barbershop: { findUnique: vi.fn(), create: vi.fn() },
    barbershopMember: { create: vi.fn() },
    category: { create: vi.fn() },
    service: { create: vi.fn() },
    barberService: { create: vi.fn() },
    workingHour: { create: vi.fn() },
    plan: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    tenantSubscription: { upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { POST as registerBarbershop } from "@/app/api/auth/register/route";

function createRequest(body: unknown) {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: "Proprietário",
  email: "owner@example.com",
  phone: "(11) 99999-9999",
  cpf: "529.982.247-25",
  password: "password123",
  barbershopName: "Barbearia Nova",
};

describe("cadastro publico de barbearia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.barbershop.findUnique.mockResolvedValue(null);
    prismaMock.plan.findUnique.mockResolvedValue({
      id: "plan-pro",
      code: "pro_monthly",
      name: "Plano Tem Barber",
      price: 49.9,
      period: "MONTHLY",
      isActive: true,
    });
    prismaMock.plan.findMany.mockResolvedValue([{
      id: "plan-pro",
      code: "pro_monthly",
      name: "Plano Tem Barber",
      price: 49.9,
      period: "MONTHLY",
      isActive: true,
    }]);
    prismaMock.tenantSubscription.upsert.mockResolvedValue({ id: "subscription-1", status: "TRIAL" });
    prismaMock.$transaction.mockImplementation((callback: any) =>
      callback(prismaMock)
    );
    prismaMock.user.create.mockResolvedValue({ id: "user-1", name: "Proprietário" });
    prismaMock.barbershop.create.mockResolvedValue({ id: "shop-1", name: "Barbearia Nova", slug: "barbearia-nova" });
    prismaMock.barbershopMember.create.mockResolvedValue({ id: "member-1" });
    prismaMock.category.create.mockResolvedValue({ id: "category-1" });
    prismaMock.service.create.mockResolvedValue({ id: "service-1" });
    prismaMock.barberService.create.mockResolvedValue({ id: "barber-service-1" });
    prismaMock.workingHour.create.mockResolvedValue({ id: "working-hour-1" });
  });

  it("exige todos os campos obrigatorios", async () => {
    const incompleteBody = { ...validBody, email: "" };
    const response = await registerBarbershop(createRequest(incompleteBody));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("obrigatórios");
  });

  it("valida comprimento minimo da senha", async () => {
    const shortPasswordBody = { ...validBody, password: "123" };
    const response = await registerBarbershop(createRequest(shortPasswordBody));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("senha deve ter no mínimo 6 caracteres");
  });

  it("valida formato do e-mail", async () => {
    const invalidEmailBody = { ...validBody, email: "invalid-email" };
    const response = await registerBarbershop(createRequest(invalidEmailBody));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("E-mail em formato inválido");
  });

  it("cria trial local dentro da transacao", async () => {
    const response = await registerBarbershop(createRequest(validBody));

    expect(response.status).toBe(201);
    expect(prismaMock.tenantSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        barbershopId: "shop-1",
        planId: "plan-pro",
        status: "TRIAL",
        monthlyPrice: 49.9,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        trialEndsAt: expect.any(Date),
      }),
    }));
    const trialEnd = prismaMock.tenantSubscription.upsert.mock.calls[0][0].create.trialEndsAt as Date;
    expect(trialEnd.getTime()).toBeGreaterThan(Date.now());
  });

  it("faz rollback quando a criacao do trial falha", async () => {
    prismaMock.tenantSubscription.upsert.mockRejectedValue(new Error("trial failure"));

    const response = await registerBarbershop(createRequest({
      ...validBody,
      email: "rollback@example.com",
      barbershopName: "Barbearia Rollback",
    }));

    expect(response.status).toBe(500);
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });

  it("aplica rate limit estrito", async () => {
    for (let i = 0; i < 5; i++) {
      const response = await registerBarbershop(createRequest(validBody));
      expect(response.status).not.toBe(429);
    }

    const response = await registerBarbershop(createRequest(validBody));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeDefined();
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});
