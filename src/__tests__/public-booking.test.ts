import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const txMock = {
  idempotencyKey: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  barbershopMember: { findFirst: vi.fn() },
  service: { findMany: vi.fn() },
  appointment: { create: vi.fn() },
  user: { findFirst: vi.fn(), create: vi.fn() },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
};

const { prismaMock, getServerSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findUnique: vi.fn() },
    idempotencyKey: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  getServerSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }));

import { POST } from "@/app/api/public/barbershop/[slug]/book/route";

const params = { params: Promise.resolve({ slug: "barbearia-a" }) };

function request(body: unknown, key = "11111111-1111-4111-8111-111111111111") {
  return new NextRequest("http://localhost/api/public/barbershop/barbearia-a/book", {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

const validBody = {
  memberId: "member-a",
  serviceIds: ["svc-a", "svc-b"],
  dateTime: "2026-07-20T13:00:00.000Z",
  customerName: "Cliente A",
  customerPhone: "(11) 99999-9999",
};

const services = [
  { id: "svc-a", price: "40.00", durationMin: 30 },
  { id: "svc-b", price: "35.50", durationMin: 45 },
];

beforeEach(() => {
  vi.clearAllMocks();
  getServerSessionMock.mockResolvedValue(null);
  prismaMock.barbershop.findUnique.mockResolvedValue({
    id: "shop-a",
    name: "Barbearia A",
    slug: "barbearia-a",
  });
  prismaMock.idempotencyKey.findUnique.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof txMock) => unknown) =>
    callback(txMock)
  );
  txMock.idempotencyKey.findUnique.mockResolvedValue(null);
  txMock.idempotencyKey.create.mockResolvedValue({ id: "idem-a" });
  txMock.idempotencyKey.update.mockResolvedValue({ id: "idem-a" });
  txMock.$executeRaw.mockResolvedValue(0);
  txMock.barbershopMember.findFirst.mockResolvedValue({
    id: "member-a",
    barbershopId: "shop-a",
    isActive: true,
  });
  txMock.service.findMany.mockResolvedValue(services);
  txMock.$queryRaw.mockResolvedValueOnce([]).mockResolvedValue([]);
  txMock.user.findFirst.mockResolvedValue({ id: "customer-existing", phone: "11999999999" });
  txMock.user.create.mockResolvedValue({ id: "customer-new", phone: "11999999999" });
  txMock.appointment.create.mockImplementation(async ({ data }) => ({
    id: "appointment-a",
    ...data,
    customer: { id: data.customerId, name: "Cliente A", phone: "11999999999" },
    barber: { user: { name: "Barbeiro A" } },
    services: data.services.create.map((item: { serviceId: string; priceApplied: string }) => ({
      service: { name: item.serviceId, durationMin: 30 },
    })),
  }));
});

describe("agendamento publico", () => {
  it("exige chave de idempotencia", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/public/barbershop/barbearia-a/book", {
        method: "POST",
        body: JSON.stringify(validBody),
      }),
      params
    );

    expect(response.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("aceita barbearia ativa e cria appointment com barbershopId correto", async () => {
    const response = await POST(request(validBody), params);

    expect(response.status).toBe(201);
    expect(prismaMock.barbershop.findUnique).toHaveBeenCalledWith({
      where: { slug: "barbearia-a", active: true },
    });
    expect(txMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ barbershopId: "shop-a" }),
      })
    );
    expect(txMock.idempotencyKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { result: expect.objectContaining({ appointment: expect.any(Object) }) },
      })
    );
  });

  it("rejeita chave reaproveitada com outra requisicao", async () => {
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      requestHash:
        "placeholder",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      result: { appointment: { id: "appointment-a" } },
    });
    const response = await POST(request(validBody), params);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejeita barbearia inexistente ou inativa", async () => {
    prismaMock.barbershop.findUnique.mockResolvedValue(null);

    const response = await POST(request(validBody), params);

    expect(response.status).toBe(404);
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("valida profissional dentro da barbearia", async () => {
    await POST(request(validBody), params);

    expect(txMock.barbershopMember.findFirst).toHaveBeenCalledWith({
      where: { id: "member-a", barbershopId: "shop-a", isActive: true },
    });
  });

  it("rejeita profissional invalido", async () => {
    txMock.barbershopMember.findFirst.mockResolvedValue(null);

    const response = await POST(request(validBody), params);

    expect(response.status).toBe(404);
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("valida servicos ativos do tenant", async () => {
    await POST(request(validBody), params);

    expect(txMock.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["svc-a", "svc-b"] }, barbershopId: "shop-a", isActive: true },
    });
  });

  it("usa cliente existente localizado pelo telefone limpo", async () => {
    await POST(request(validBody), params);

    expect(txMock.user.findFirst).toHaveBeenCalledWith({ where: { phone: "11999999999" } });
    expect(txMock.user.create).not.toHaveBeenCalled();
    expect(txMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: "customer-existing" }),
      })
    );
  });

  it("cria novo cliente quando telefone nao existe", async () => {
    txMock.user.findFirst.mockResolvedValue(null);

    await POST(request(validBody), params);

    expect(txMock.user.create).toHaveBeenCalledWith({
      data: { name: "Cliente A", phone: "11999999999", role: "USER" },
    });
    expect(txMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: "customer-new" }),
      })
    );
  });

  it("cria AppointmentService com snapshots de preco dentro da criacao atomica", async () => {
    await POST(request(validBody), params);

    expect(txMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalPrice: 75.5,
          durationMin: 75,
          services: {
            create: [
              { serviceId: "svc-a", priceApplied: "40.00" },
              { serviceId: "svc-b", priceApplied: "35.50" },
            ],
          },
        }),
      })
    );
  });

  it("rejeita horario indisponivel por conflito ativo", async () => {
    txMock.$queryRaw.mockReset();
    txMock.$queryRaw.mockResolvedValueOnce([{ id: "conflict-a" }]);

    const response = await POST(request(validBody), params);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe("SLOT_UNAVAILABLE");
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("registra a lacuna atual: nao valida explicitamente se o profissional executa todos os servicos", async () => {
    await POST(request(validBody), params);

    expect(txMock.barbershopMember.findFirst).toHaveBeenCalledTimes(1);
    expect(txMock.barbershopMember.findFirst).toHaveBeenCalledWith({
      where: { id: "member-a", barbershopId: "shop-a", isActive: true },
    });
  });
});
