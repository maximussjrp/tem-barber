import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetRateLimitStore } from "@/lib/public-rate-limit";

const txMock = {
  idempotencyKey: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  barbershop: { findFirst: vi.fn() },
  barbershopMember: { findFirst: vi.fn() },
  service: { findMany: vi.fn() },
  barberService: { findMany: vi.fn() },
  appointmentWhatsappConfirmation: { create: vi.fn() },
  appointment: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  timeOff: { findMany: vi.fn() },
  user: { findFirst: vi.fn(), create: vi.fn() },
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
};

const { prismaMock, getServerSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    barbershop: { findUnique: vi.fn(), findFirst: vi.fn() },
    tenantSubscription: { findFirst: vi.fn() },
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

function activeMemberWithSchedule(
  workingHours: Array<{
    startTime: string;
    endTime: string;
    breakStart: string | null;
    breakEnd: string | null;
  }> = [
    { startTime: "09:00", endTime: "18:00", breakStart: null, breakEnd: null },
  ]
) {
  return {
    id: "member-a",
    barbershopId: "shop-a",
    isActive: true,
    workingHours,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-20T14:30:00.000Z"));
  resetRateLimitStore();
  getServerSessionMock.mockResolvedValue(null);
  prismaMock.barbershop.findUnique.mockResolvedValue({
    id: "shop-a",
    name: "Barbearia A",
    slug: "barbearia-a",
    phone: "5511999999999",
  });
  prismaMock.barbershop.findFirst = prismaMock.barbershop.findUnique;
  prismaMock.tenantSubscription.findFirst.mockResolvedValue({
    status: "ACTIVE",
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24),
  });
  prismaMock.idempotencyKey.findUnique.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof txMock) => unknown) =>
    callback(txMock)
  );
  txMock.idempotencyKey.findUnique.mockResolvedValue(null);
  txMock.idempotencyKey.create.mockResolvedValue({ id: "idem-a" });
  txMock.idempotencyKey.update.mockResolvedValue({ id: "idem-a" });
  txMock.appointmentWhatsappConfirmation.create.mockResolvedValue({ id: "whatsapp-confirmation-a" });
  txMock.$executeRaw.mockResolvedValue(0);
  txMock.barbershop.findFirst.mockResolvedValue({ id: "shop-a" });
  txMock.barbershopMember.findFirst.mockResolvedValue(activeMemberWithSchedule());
  txMock.service.findMany.mockResolvedValue(services);
  txMock.barberService.findMany.mockResolvedValue([
    { serviceId: "svc-a" },
    { serviceId: "svc-b" },
  ]);
  txMock.appointment.findMany.mockResolvedValue([
    { customer: { id: "customer-existing", name: "Cliente A", phone: "11999999999" } },
  ]);
  txMock.appointment.findFirst.mockResolvedValue(null);
  txMock.appointment.count.mockResolvedValue(0);
  txMock.timeOff.findMany.mockResolvedValue([]);
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

afterEach(() => {
  vi.useRealTimers();
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

  it("bloqueia tentativa publica de criar encaixe operacional", async () => {
    const response = await POST(
      request({
        ...validBody,
        bookingMode: "FIT_IN",
      }),
      params
    );
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("FIT_IN_NOT_ALLOWED");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("aceita barbearia ativa e cria appointment com barbershopId correto", async () => {
    const response = await POST(request(validBody), params);

    expect(response.status).toBe(201);
    expect(prismaMock.barbershop.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ slug: "barbearia-a" }),
      })
    );
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

  it("cria confirmacao WhatsApp pendente com token hash e retorna link wa.me", async () => {
    const response = await POST(request(validBody), params);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(txMock.appointmentWhatsappConfirmation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        barbershopId: "shop-a",
        appointmentId: "appointment-a",
        customerPhone: "5511999999999",
        status: "PENDING",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        tokenHint: expect.stringMatching(/^TB-\*\*\*\*\d{2}$/),
        expiresAt: expect.any(Date),
      }),
    });
    expect(data.whatsappConfirmation).toEqual(
      expect.objectContaining({
        status: "PENDING",
        token: expect.stringMatching(/^TB-\d{6}$/),
        link: expect.stringMatching(/^https:\/\/wa\.me\/5511999999999\?text=/),
      })
    );
    expect(txMock.idempotencyKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          result: expect.objectContaining({
            whatsappConfirmation: expect.not.objectContaining({
              token: expect.any(String),
              message: expect.any(String),
              link: expect.any(String),
            }),
          }),
        },
      })
    );
  });

  it("rejeita booking publico quando a barbearia nao tem WhatsApp valido", async () => {
    prismaMock.barbershop.findUnique.mockResolvedValue({
      id: "shop-a",
      name: "Barbearia A",
      slug: "barbearia-a",
      phone: "1732223333",
    });

    const response = await POST(request(validBody), params);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("BARBERSHOP_WHATSAPP_NOT_CONFIGURED");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
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
      select: { id: true, barbershopId: true, isActive: true },
    });
  });

  it("rejeita profissional desativado depois da disponibilidade", async () => {
    txMock.barbershopMember.findFirst.mockResolvedValue(null);

    const response = await POST(request(validBody), params);

    expect(response.status).toBe(404);
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("valida servicos ativos do tenant", async () => {
    await POST(request(validBody), params);

    expect(txMock.service.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["svc-a", "svc-b"] }, barbershopId: "shop-a", isActive: true },
      select: { id: true, price: true, durationMin: true },
    });
  });

  it("usa cliente existente localizado pelo telefone limpo", async () => {
    await POST(request(validBody), params);

    expect(txMock.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ barbershopId: "shop-a" }),
      })
    );
    expect(txMock.user.create).not.toHaveBeenCalled();
    expect(txMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ customerId: "customer-existing" }),
      })
    );
  });

  it("cria novo cliente quando telefone nao existe", async () => {
    txMock.appointment.findMany.mockResolvedValue([]);
    txMock.user.findFirst.mockResolvedValue(null);

    await POST(request(validBody), params);

    expect(txMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: "Cliente A", phone: "5511999999999", role: "USER" },
      })
    );
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

  it("rejeita appointment criado depois da disponibilidade", async () => {
    txMock.$queryRaw.mockReset();
    txMock.$queryRaw.mockResolvedValueOnce([{ id: "conflict-a" }]);

    const response = await POST(request(validBody), params);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe("SLOT_UNAVAILABLE");
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("rejeita timeOff criado depois da disponibilidade", async () => {
    txMock.timeOff.findMany.mockResolvedValue([
      {
        id: "block-a",
        memberId: "member-a",
        startDate: new Date("2026-07-20T13:00:00.000Z"),
        endDate: new Date("2026-07-20T14:00:00.000Z"),
        reason: "Bloqueio",
        allDay: false,
      },
    ]);

    const response = await POST(request(validBody), params);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toBe("SCHEDULE_BLOCK_CONFLICT");
    expect(txMock.appointment.create).not.toHaveBeenCalled();
    expect(txMock.appointmentWhatsappConfirmation.create).not.toHaveBeenCalled();
    expect(txMock.idempotencyKey.update).not.toHaveBeenCalled();
  });

  it("rejeita capability removida depois da disponibilidade", async () => {
    txMock.barberService.findMany.mockResolvedValue([{ serviceId: "svc-a" }]);

    const response = await POST(request(validBody), params);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("PROFESSIONAL_SERVICE_MISMATCH");
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("bloqueia terceiro agendamento futuro na mesma semana para a mesma barbearia", async () => {
    txMock.appointment.count.mockResolvedValue(2);

    const response = await POST(request(validBody), params);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("WEEKLY_BOOKING_LIMIT_REACHED");
    expect(data.message).toContain("limite de agendamentos futuros");
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("bloqueia duplicidade de agendamento no mesmo horario para o mesmo cliente na mesma barbearia", async () => {
    txMock.appointment.findFirst.mockResolvedValue({ id: "duplicate-a" });

    const response = await POST(request(validBody), params);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("DUPLICATE_APPOINTMENT");
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("1. sessao publica + telefone valido + body sem telefone -> usa telefone da sessao (booking PASS)", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-existing", name: "Cliente Logado", phone: "5511999999999", authLevel: "phone_lookup" },
    });

    const bodyWithoutPhone = {
      memberId: "member-a",
      serviceIds: ["svc-a", "svc-b"],
      dateTime: "2026-07-20T13:00:00.000Z",
      customerName: "Cliente Logado",
    };

    const response = await POST(request(bodyWithoutPhone, "11111111-1111-4111-8111-111111111101"), params);
    expect(response.status).toBe(201);
  });

  it("2. sessao publica + telefone valido + body com telefone DIFERENTE -> telefone da sessao continua autoridade", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-existing", name: "Cliente Logado", phone: "5511999999999", authLevel: "phone_lookup" },
    });

    const bodyWithDifferentPhone = {
      memberId: "member-a",
      serviceIds: ["svc-a", "svc-b"],
      dateTime: "2026-07-20T13:00:00.000Z",
      customerName: "Cliente Logado",
      customerPhone: "(11) 98888-7777",
    };

    const response = await POST(request(bodyWithDifferentPhone, "11111111-1111-4111-8111-111111111102"), params);
    expect(response.status).toBe(201);
    // Customer ID used in appointment creation should match session user ID (customer-existing)
    expect(txMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "customer-existing",
        }),
      })
    );
  });

  it("preserva quantidades no calculo autoritativo de preco e duracao", async () => {
    const response = await POST(
      request({
        ...validBody,
        serviceIds: undefined,
        services: [
          { serviceId: "svc-a", quantity: 2 },
          { serviceId: "svc-b", quantity: 1 },
        ],
      }),
      params
    );

    expect(response.status).toBe(201);
    expect(txMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalPrice: 115.5,
          durationMin: 105,
        }),
      })
    );
  });

  it("3. sessao publica + telefone invalido/nulo + body com telefone valido -> usa body (recovery PASS)", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-bad-phone", name: "Cliente Bad Phone", phone: "invalid", authLevel: "phone_lookup" },
    });

    const bodyWithValidPhone = {
      memberId: "member-a",
      serviceIds: ["svc-a", "svc-b"],
      dateTime: "2026-07-20T13:00:00.000Z",
      customerName: "Cliente Bad Phone",
      customerPhone: "(11) 99999-9999",
    };

    const response = await POST(request(bodyWithValidPhone, "11111111-1111-4111-8111-111111111103"), params);
    expect(response.status).toBe(201);
  });

  it("4. sessao publica + telefone invalido + body sem telefone -> INVALID_PHONE", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "customer-bad-phone", name: "Cliente Bad Phone", phone: "", authLevel: "phone_lookup" },
    });

    const bodyWithoutPhone = {
      memberId: "member-a",
      serviceIds: ["svc-a", "svc-b"],
      dateTime: "2026-07-20T13:00:00.000Z",
      customerName: "Cliente Bad Phone",
    };

    const response = await POST(request(bodyWithoutPhone, "11111111-1111-4111-8111-111111111104"), params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("INVALID_PHONE");
  });

  it("5. sessao authLevel=admin + telefone admin + body com telefone de cliente -> NAO usar telefone admin", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin-user-id", name: "Owner Barba", phone: "5511977777777", authLevel: "admin", role: "OWNER" },
    });

    const bodyClientPhone = {
      memberId: "member-a",
      serviceIds: ["svc-a", "svc-b"],
      dateTime: "2026-07-20T13:00:00.000Z",
      customerName: "Cliente Publico",
      customerPhone: "(11) 99999-9999",
    };

    const response = await POST(request(bodyClientPhone, "11111111-1111-4111-8111-111111111105"), params);
    expect(response.status).toBe(201);
    expect(txMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "customer-existing", // resolved customer id from phone, NOT admin-user-id
        }),
      })
    );
  });

  it("6. sessao authLevel=admin nao deve transformar o User admin em customerId no booking publico", async () => {
    getServerSessionMock.mockResolvedValue({
      user: { id: "admin-user-id", name: "Owner Barba", phone: "5511977777777", authLevel: "admin", role: "OWNER" },
    });

    const bodyClientPhone = {
      memberId: "member-a",
      serviceIds: ["svc-a", "svc-b"],
      dateTime: "2026-07-20T13:00:00.000Z",
      customerName: "Cliente Publico",
      customerPhone: "(11) 99999-9999",
    };

    const response = await POST(request(bodyClientPhone, "11111111-1111-4111-8111-111111111106"), params);
    expect(response.status).toBe(201);

    expect(txMock.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "customer-existing", // resolved customer id from phone, NOT admin-user-id
        }),
      })
    );
  });

  it("rejeita horario passado no dia atual", async () => {
    const response = await POST(
      request({ ...validBody, dateTime: "2026-07-20T11:00:00.000Z" }),
      params
    );
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("PUBLIC_SLOT_INVALID");
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("rejeita horario antes da abertura", async () => {
    const response = await POST(
      request({ ...validBody, dateTime: "2026-07-21T08:30:00.000Z" }),
      params
    );

    expect(response.status).toBe(422);
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("rejeita horario no ou depois do encerramento", async () => {
    const response = await POST(
      request({ ...validBody, dateTime: "2026-07-21T18:00:00.000Z" }),
      params
    );

    expect(response.status).toBe(422);
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("rejeita appointment que comeca dentro do break", async () => {
    txMock.barbershopMember.findFirst.mockResolvedValue(
      activeMemberWithSchedule([
        { startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" },
      ])
    );

    const response = await POST(
      request({ ...validBody, dateTime: "2026-07-21T12:00:00.000Z" }),
      params
    );

    expect(response.status).toBe(422);
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("rejeita appointment que cruza o inicio do break", async () => {
    txMock.barbershopMember.findFirst.mockResolvedValue(
      activeMemberWithSchedule([
        { startTime: "09:00", endTime: "18:00", breakStart: "12:00", breakEnd: "13:00" },
      ])
    );

    const response = await POST(
      request({ ...validBody, dateTime: "2026-07-21T11:30:00.000Z" }),
      params
    );

    expect(response.status).toBe(422);
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("rejeita appointment que termina depois do fechamento", async () => {
    const response = await POST(
      request({ ...validBody, dateTime: "2026-07-21T17:00:00.000Z" }),
      params
    );

    expect(response.status).toBe(422);
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("rejeita dia sem workingHours", async () => {
    txMock.barbershopMember.findFirst.mockResolvedValue(activeMemberWithSchedule([]));

    const response = await POST(
      request({ ...validBody, dateTime: "2026-07-21T13:00:00.000Z" }),
      params
    );

    expect(response.status).toBe(422);
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("revalida workingHours alterado depois da disponibilidade", async () => {
    txMock.barbershopMember.findFirst
      .mockResolvedValueOnce(activeMemberWithSchedule())
      .mockResolvedValueOnce(
        activeMemberWithSchedule([
          { startTime: "14:00", endTime: "18:00", breakStart: null, breakEnd: null },
        ])
      );

    const response = await POST(
      request({ ...validBody, dateTime: "2026-07-21T13:00:00.000Z" }),
      params
    );

    expect(response.status).toBe(422);
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("revalida elegibilidade publica do tenant dentro da transacao", async () => {
    txMock.barbershop.findFirst.mockResolvedValue(null);

    const response = await POST(request(validBody), params);
    const data = await response.json();

    expect(response.status).toBe(422);
    expect(data.error).toBe("PUBLIC_BOOKING_UNAVAILABLE");
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("rejeita servico desativado depois da disponibilidade", async () => {
    txMock.service.findMany.mockResolvedValue([{ id: "svc-a", price: "40.00", durationMin: 30 }]);

    const response = await POST(request(validBody), params);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("INVALID_SERVICE_SELECTION");
    expect(txMock.appointment.create).not.toHaveBeenCalled();
  });

  it("permite appointment adjacente sem sobreposicao", async () => {
    txMock.$queryRaw.mockReset();
    txMock.$queryRaw.mockResolvedValue([]);

    const response = await POST(
      request({ ...validBody, dateTime: "2026-07-21T10:30:00.000Z" }),
      params
    );

    expect(response.status).toBe(201);
    expect(txMock.appointment.create).toHaveBeenCalled();
  });
});
