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
  cpf: "123.456.789-00",
  password: "password123",
  barbershopName: "Barbearia Nova",
};

describe("cadastro publico de barbearia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.barbershop.findUnique.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation((callback: any) =>
      callback(prismaMock)
    );
    prismaMock.user.create.mockResolvedValue({ id: "user-1", name: "Proprietário" });
    prismaMock.barbershop.create.mockResolvedValue({ id: "shop-1", name: "Barbearia Nova", slug: "barbearia-nova" });
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

  it("aplica rate limit estrito", async () => {
    for (let i = 0; i < 5; i++) {
      const response = await registerBarbershop(createRequest(validBody));
      expect(response.status).not.toBe(429);
    }

    const response = await registerBarbershop(createRequest(validBody));
    expect(response.status).toBe(429);
  });
});
