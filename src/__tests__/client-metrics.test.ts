import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { AppointmentStatus, AppointmentBookingMode, ComandaStatus } from "@prisma/client";

// --- Hoisted Mock Declarations to satisfy Vitest hoisting constraints ---
const { prismaMock, getAdminSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    appointment: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    comanda: {
      findMany: vi.fn(),
    },
    review: {
      findMany: vi.fn(),
    },
  },
  getAdminSessionMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/api-auth", () => ({ getAdminSession: getAdminSessionMock }));

import {
  computeClientMetrics,
  getLocalDateString,
  diffInDaysLocal,
} from "@/lib/clients/client-metrics";
import { GET as getClientDetail } from "@/app/api/admin/clients/[id]/route";

describe("CRM 360 Client Metrics Logic Unit Tests", () => {
  const mockBarber = { id: "barber-1", user: { name: "Douglas Barber" } };
  const mockBarber2 = { id: "barber-2", user: { name: "Douglas Barber 2" } };
  const mockService = { service: { id: "svc-1", name: "Corte de Cabelo" } };
  const mockService2 = { service: { id: "svc-2", name: "Barba Simples" } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Rule 1: COMPLETED normal conta.
  // Rule 2: COMPLETED FIT_IN conta.
  it("contabiliza visitas concluidas normais e de encaixe (FIT_IN)", () => {
    const appointments = [
      {
        id: "a1",
        dateTime: new Date("2026-07-01T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a2",
        dateTime: new Date("2026-07-02T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.FIT_IN,
        createdAt: new Date(),
        totalPrice: 40.0,
        barber: mockBarber,
        services: [mockService],
      },
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
    });

    expect(metrics.completedVisits).toBe(2);
    expect(metrics.totalAppointments).toBe(2);
  });

  // Rule 3: CANCELLED separado de NO_SHOW.
  it("separa cancelamentos e no-shows (faltas) nas metricas", () => {
    const appointments = [
      {
        id: "a1",
        dateTime: new Date(),
        status: AppointmentStatus.CANCELLED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a2",
        dateTime: new Date(),
        status: AppointmentStatus.NO_SHOW,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
    });

    expect(metrics.cancelledCount).toBe(1);
    expect(metrics.noShowCount).toBe(1);
  });

  // Rule 4: Futuro nao vira ultima visita.
  // Rule 5: CANCELLED nao vira ultima visita.
  // Rule 6: NO_SHOW nao vira ultima visita.
  it("ignora agendamentos futuros, cancelados e no-shows ao calcular a data da ultima visita concluida", () => {
    const appointments = [
      {
        id: "a1",
        dateTime: new Date("2026-07-01T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a2",
        dateTime: new Date("2026-07-05T10:00:00Z"), // Futuro ativo
        status: AppointmentStatus.CONFIRMED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a3",
        dateTime: new Date("2026-07-03T10:00:00Z"),
        status: AppointmentStatus.CANCELLED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a4",
        dateTime: new Date("2026-07-04T10:00:00Z"),
        status: AppointmentStatus.NO_SHOW,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
      now: new Date("2026-07-02T12:00:00Z"),
    });

    expect(metrics.lastCompletedVisitAt?.toISOString()).toBe(
      new Date("2026-07-01T10:00:00Z").toISOString()
    );
  });

  // Rule 7: nextAppointmentAt usa menor futuro ativo.
  it("retorna o proximo agendamento ativo mais proximo no tempo", () => {
    const appointments = [
      {
        id: "a1",
        dateTime: new Date("2026-07-05T15:00:00Z"),
        status: AppointmentStatus.CONFIRMED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a2",
        dateTime: new Date("2026-07-04T10:00:00Z"),
        status: AppointmentStatus.CONFIRMED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a3",
        dateTime: new Date("2026-07-03T10:00:00Z"), // Passado
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
      now: new Date("2026-07-03T12:00:00Z"),
    });

    expect(metrics.nextAppointmentAt?.toISOString()).toBe(
      new Date("2026-07-04T10:00:00Z").toISOString()
    );
  });

  // Rule 8: customerSinceAt eh tenant-scoped.
  it("calcula customerSinceAt usando a data de criacao do primeiro agendamento do cliente no tenant", () => {
    const appointments = [
      {
        id: "a1",
        dateTime: new Date(),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date("2026-06-01T10:00:00Z"),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a2",
        dateTime: new Date(),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date("2026-05-15T12:00:00Z"), // Mais antigo
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
    });

    expect(metrics.customerSinceAt?.toISOString()).toBe(
      new Date("2026-05-15T12:00:00Z").toISOString()
    );
  });

  // Rule 9: totalSpent usa paidTotal das comandas nao canceladas com valor > 0.
  // Rule 10: estorno reduz totalSpent (ja vem refletido no paidTotal recalculado).
  // Rule 11: pagamento parcial conta somente recebido.
  it("calcula totalSpent baseado no paidTotal real das comandas", () => {
    const comandas = [
      { id: "c1", status: ComandaStatus.CLOSED, paidTotal: 100.0 }, // Fechada e paga
      { id: "c2", status: ComandaStatus.PENDING_PAYMENT, paidTotal: 40.0 }, // Pagamento parcial
      { id: "c3", status: ComandaStatus.CANCELLED, paidTotal: 50.0 }, // Cancelada (deve ignorar paidTotal)
      { id: "c4", status: ComandaStatus.CLOSED, paidTotal: -10.0 }, // Valor <= 0 (ignorar)
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments: [],
      comandas,
      reviews: [],
    });

    // 100.0 (c1) + 40.0 (c2) = 140.0
    expect(metrics.totalSpent).toBe(140.0);
  });

  // Rule 12: averageTicket usa paidCommandasCount.
  it("calcula o ticket medio dividindo totalSpent pelo numero de comandas validas pagas", () => {
    const comandas = [
      { id: "c1", status: ComandaStatus.CLOSED, paidTotal: 100.0 },
      { id: "c2", status: ComandaStatus.PENDING_PAYMENT, paidTotal: 50.0 },
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments: [],
      comandas,
      reviews: [],
    });

    // totalSpent = 150. paidCommandasCount = 2. averageTicket = 75.0
    expect(metrics.averageTicket).toBe(75.0);
  });

  // Rule 13: 0 visitas -> INSUFFICIENT_DATA.
  it("define returnStatus como INSUFFICIENT_DATA se o cliente possui 0 visitas", () => {
    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments: [],
      comandas: [],
      reviews: [],
    });
    expect(metrics.returnStatus).toBe("INSUFFICIENT_DATA");
    expect(metrics.averageReturnDays).toBeNull();
  });

  // Rule 14: 1 visita -> INSUFFICIENT_DATA.
  it("define returnStatus como INSUFFICIENT_DATA se o cliente possui apenas 1 visita", () => {
    const appointments = [
      {
        id: "a1",
        dateTime: new Date("2026-07-01T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
    });
    expect(metrics.returnStatus).toBe("INSUFFICIENT_DATA");
    expect(metrics.averageReturnDays).toBeNull();
  });

  // Rule 15: 2 datas: averageReturnDays possivel, status insuficiente.
  it("calcula averageReturnDays para 2 visitas em datas distintas, mas mantem returnStatus como insuficiente", () => {
    const appointments = [
      {
        id: "a1",
        dateTime: new Date("2026-07-01T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a2",
        dateTime: new Date("2026-07-11T10:00:00Z"), // 10 dias depois
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
    });

    expect(metrics.averageReturnDays).toBe(10);
    expect(metrics.returnStatus).toBe("INSUFFICIENT_DATA");
  });

  // Rule 16: 3+ datas: status calculado (IN_CYCLE, DUE_SOON, LATE, AT_RISK).
  it("calcula o returnStatus comportamental caso haja pelo menos 3 datas de atendimentos concluídos distintas", () => {
    const appointments = [
      {
        id: "a1",
        dateTime: new Date("2026-06-01T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a2",
        dateTime: new Date("2026-06-11T10:00:00Z"), // 10 dias de intervalo
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a3",
        dateTime: new Date("2026-06-21T10:00:00Z"), // 10 dias de intervalo. Média = 10
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
    ];

    // Caso A: D = 4 dias (4 <= 0.8 * 10) -> IN_CYCLE
    const metricsCycle = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
      now: new Date("2026-06-25T12:00:00Z"),
    });
    expect(metricsCycle.averageReturnDays).toBe(10);
    expect(metricsCycle.returnStatus).toBe("IN_CYCLE");

    // Caso B: D = 9 dias (0.8 * 10 < 9 <= 1.1 * 10) -> DUE_SOON
    const metricsDue = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
      now: new Date("2026-06-30T12:00:00Z"),
    });
    expect(metricsDue.returnStatus).toBe("DUE_SOON");

    // Caso C: D = 14 dias (1.1 * 10 < 14 <= 1.5 * 10) -> LATE
    const metricsLate = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
      now: new Date("2026-07-05T12:00:00Z"),
    });
    expect(metricsLate.returnStatus).toBe("LATE");

    // Caso D: D = 18 dias (D > 1.5 * 10) -> AT_RISK
    const metricsRisk = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
      now: new Date("2026-07-09T12:00:00Z"),
    });
    expect(metricsRisk.returnStatus).toBe("AT_RISK");
  });

  // Rule 17: proximo appointment forca IN_CYCLE sem apagar media.
  it("forca returnStatus para IN_CYCLE se houver reserva futura ativa, preservando a media calculada", () => {
    const appointments = [
      {
        id: "a1",
        dateTime: new Date("2026-06-01T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a2",
        dateTime: new Date("2026-06-11T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a3",
        dateTime: new Date("2026-06-21T10:00:00Z"), // Média = 10
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
      {
        id: "a4",
        dateTime: new Date("2026-07-20T10:00:00Z"), // Agendamento futuro ativo
        status: AppointmentStatus.CONFIRMED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService],
      },
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
      now: new Date("2026-07-15T12:00:00Z"), // Atraso de 24 dias, mas tem reserva futura
    });

    expect(metrics.averageReturnDays).toBe(10);
    expect(metrics.returnStatus).toBe("IN_CYCLE");
  });

  // Rule 18: timezone local nao desloca dia.
  it("utiliza fuso horario de Sao Paulo para deduplicar e contar visitas sem deslocamento de dia", () => {
    // Data no UTC representaria dias diferentes dependendo do horário,
    // mas no fuso de São Paulo ambas caem no mesmo dia calendário
    const date1 = new Date("2026-07-02T01:00:00Z"); // SP: 2026-07-01 às 22:00
    const date2 = new Date("2026-07-02T02:00:00Z"); // SP: 2026-07-01 às 23:00

    const str1 = getLocalDateString(date1, "America/Sao_Paulo");
    const str2 = getLocalDateString(date2, "America/Sao_Paulo");

    expect(str1).toBe("2026-07-01");
    expect(str2).toBe("2026-07-01");

    // Testar com diffInDaysLocal
    const d1 = new Date("2026-07-01T12:00:00Z"); // 2026-07-01
    const d2 = new Date("2026-07-03T12:00:00Z"); // 2026-07-03
    const diff = diffInDaysLocal(d1, d2, "America/Sao_Paulo");
    expect(diff).toBe(2);
  });

  // Rule 19: favoriteProfessional desempate deterministico.
  it("retorna o profissional com mais visitas concluidas, usando desempate pelo atendimento mais recente", () => {
    const appointments = [
      {
        id: "a1",
        dateTime: new Date("2026-07-01T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber, // Douglas Barber
        services: [mockService],
      },
      {
        id: "a2",
        dateTime: new Date("2026-07-02T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber2, // Douglas Barber 2 (Mais recente)
        services: [mockService],
      },
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
    });

    expect(metrics.favoriteProfessional?.id).toBe("barber-2"); // Barber 2 vence pelo desempate de recência
  });

  // Rule 20: favoriteService desempate deterministico.
  it("retorna o servico com mais frequencia em visitas concluidas, desempatando pelo atendimento mais recente", () => {
    const appointments = [
      {
        id: "a1",
        dateTime: new Date("2026-07-01T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService], // Corte de Cabelo
      },
      {
        id: "a2",
        dateTime: new Date("2026-07-02T10:00:00Z"),
        status: AppointmentStatus.COMPLETED,
        bookingMode: AppointmentBookingMode.NORMAL,
        createdAt: new Date(),
        totalPrice: 50.0,
        barber: mockBarber,
        services: [mockService2], // Barba Simples (Mais recente)
      },
    ];

    const metrics = computeClientMetrics({
      barbershopId: "shop-1",
      customerId: "cust-1",
      appointments,
      comandas: [],
      reviews: [],
    });

    expect(metrics.favoriteService?.id).toBe("svc-2"); // Vence Barba Simples
  });
});

describe("CRM 360 Client API Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Rule 21: tenant A nao enxerga dados tenant B.
  // Rule 22: cliente inexistente/outro tenant retorna resposta segura.
  it("retorna 404 seguro para cliente sem historico ou pertencente a outra barbearia (tenant)", async () => {
    getAdminSessionMock.mockResolvedValue({
      data: { barbershopId: "shop-tenant-A" },
    });

    // Se o cliente nao tem agendamentos no tenant A
    prismaMock.appointment.count.mockResolvedValue(0);

    const req = new NextRequest("http://localhost/api/admin/clients/client-from-tenant-B");
    const response = await getClientDetail(req, {
      params: Promise.resolve({ id: "client-from-tenant-B" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("Cliente não encontrado ou sem histórico");
  });

  // Rule 23: rebook nao depende de nome/telefone em URL.
  it("nao exige nome ou telefone na URL de rebook/prefill", async () => {
    getAdminSessionMock.mockResolvedValue({
      data: { barbershopId: "shop-1" },
    });

    prismaMock.appointment.count.mockResolvedValue(1);
    prismaMock.user.findUnique.mockResolvedValue({
      id: "cust-1",
      name: "Marcelo Silva",
      phone: "17999999999",
      createdAt: new Date(),
    });
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.comanda.findMany.mockResolvedValue([]);
    prismaMock.review.findMany.mockResolvedValue([]);

    // O endpoint detail nao depende de nomes passados por query params,
    // ele busca tudo pelo ID com seguranca direto em banco.
    const req = new NextRequest("http://localhost/api/admin/clients/cust-1");
    const response = await getClientDetail(req, {
      params: Promise.resolve({ id: "cust-1" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Marcelo Silva");
    expect(body.phone).toBe("17999999999");
  });
});
