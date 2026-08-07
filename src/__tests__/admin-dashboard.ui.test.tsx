import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardPage from "@/app/admin/dashboard/page";
import prisma from "@/lib/prisma";
import React from "react";

// Mock das dependências externas
vi.mock("@/lib/admin-guard", () => ({
  requireAdmin: vi.fn().mockResolvedValue({
    barbershopId: "tenant-1",
    barbershop: {
      id: "tenant-1",
      name: "Barbearia Teste Tenant 1",
      slug: "barbearia-teste-tenant-1",
      description: "Descrição",
      phone: "11999999999",
    },
  }),
}));

vi.mock("@/components/admin/BookingLinkShare", () => ({
  default: () => <div data-testid="booking-link">BookingLinkShare</div>,
}));

vi.mock("@/components/admin/DashboardCharts", () => ({
  default: (props: any) => (
    <div data-testid="dashboard-charts">
      Charts: weekRevenue={props.weekRevenue} occupied={props.occupancy.occupied} available={props.occupancy.available} blocked={props.occupancy.blocked}
    </div>
  ),
}));

// Mock do prisma
vi.mock("@/lib/prisma", () => ({
  default: {
    appointment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    service: {
      count: vi.fn().mockResolvedValue(1),
    },
    workingHour: {
      count: vi.fn().mockResolvedValue(1),
    },
    barbershopMember: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe("Dashboard Page - Finance & Availability Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T1, T2, T3, T4 — Disponibilidade e Legendas (Disponível Verde, Ocupado Dourado, Bloqueado Cinza)", async () => {
    // Mocking active members, working hours, appointments and timeOffs
    vi.mocked(prisma.barbershopMember.findMany).mockResolvedValue([
      {
        id: "member-1",
        user: { name: "Barbeiro Teste" },
        services: [{ serviceId: "s-1" }],
        workingHours: [
          {
            dayOfWeek: new Date().getDay(),
            startTime: "09:00",
            endTime: "10:30", // 3 slots: 09:00, 09:30, 10:00
            breakStart: null,
            breakEnd: null,
            isActive: true,
          },
        ],
        timeOffs: [
          {
            id: "to-1",
            startDate: new Date(Date.UTC(2026, 7, 7, 9, 30)), // 09:30 slot is blocked
            endDate: new Date(Date.UTC(2026, 7, 7, 10, 0)),
            allDay: false,
          },
        ],
      } as any,
    ]);

    vi.mocked(prisma.appointment.findMany).mockImplementation(((args: any) => {
      // Para o bookedAppointments do dia
      if (args?.where?.status?.in && args.where.status.in.includes("PENDING")) {
        return Promise.resolve([
          {
            id: "appt-1",
            memberId: "member-1",
            dateTime: new Date(Date.UTC(2026, 7, 7, 9, 0)), // 09:00 slot is occupied
            durationMin: 30,
            status: "CONFIRMED",
          },
        ] as any);
      }
      // Para outros findMany vazios
      return Promise.resolve([]);
    }) as any);

    // Mock date to 2026-08-07
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));

    const pageElement = await DashboardPage();
    render(pageElement);

    // T4 - Legenda de disponibilidade bate com os slots
    expect(screen.getByText("Disponível")).toBeInTheDocument();
    expect(screen.getByText("Ocupado")).toBeInTheDocument();
    expect(screen.getByText("Bloqueado")).toBeInTheDocument();

    // Procurando os chips de horários
    const slot0900 = screen.getByText("09:00");
    const slot0930 = screen.getByText("09:30");
    const slot1000 = screen.getByText("10:00");

    // T1 - Disponível usa classe/token verde
    expect(slot1000.className).toContain("text-emerald-400");
    expect(slot1000.className).toContain("bg-emerald-500/10");

    // T2 - Ocupado usa classe/token dourado/amarelo
    expect(slot0900.className).toContain("text-[var(--gold)]");
    expect(slot0900.className).toContain("bg-[var(--gold-surface)]");

    // T3 - Bloqueado não usa a mesma cor de disponível (usa cinza)
    expect(slot0930.className).toContain("text-zinc-500");
    expect(slot0930.className).toContain("bg-zinc-800/50");

    vi.useRealTimers();
  });

  it("T5, T6, T7, T8, T9, T10 - Faturamento com Desconto e Comandas Canceladas/Estornadas", async () => {
    // Mocking appointments and comandas for today
    // T8: Comanda de R$ 70 com desconto de R$ 10 conta R$ 60 no dashboard
    vi.mocked(prisma.appointment.findMany).mockImplementation(((args: any) => {
      // Se for a query do faturamento de hoje
      if (args?.where?.dateTime?.gte && !args.where.status) {
        return Promise.resolve([
          {
            id: "appt-completed-1",
            status: "COMPLETED",
            totalPrice: 70.0,
            dateTime: new Date("2026-08-07T12:00:00.000Z"),
            customer: { name: "Cliente 1" },
            services: [],
            comandas: [
              {
                status: "CLOSED",
                total: 60.0,
                discountTotal: 10.0,
                surchargeTotal: 0.0,
              },
            ],
          },
          // T9 - Comanda cancelada não entra no faturamento
          {
            id: "appt-completed-2",
            status: "COMPLETED",
            totalPrice: 50.0,
            dateTime: new Date("2026-08-07T12:00:00.000Z"),
            customer: { name: "Cliente 2" },
            services: [],
            comandas: [
              {
                status: "CANCELLED",
                total: 0.0,
                discountTotal: 0.0,
                surchargeTotal: 0.0,
              },
            ],
          },
        ] as any);
      }

      // Se for a query do faturamento semanal
      if (args?.where?.status === "COMPLETED") {
        return Promise.resolve([
          {
            id: "appt-completed-1",
            status: "COMPLETED",
            totalPrice: 70.0,
            dateTime: new Date("2026-08-07T12:00:00.000Z"),
            comandas: [
              {
                status: "CLOSED",
                total: 60.0,
                discountTotal: 10.0,
                surchargeTotal: 0.0,
              },
            ],
          },
          {
            id: "appt-completed-2",
            status: "COMPLETED",
            totalPrice: 50.0,
            dateTime: new Date("2026-08-07T12:00:00.000Z"),
            comandas: [
              {
                status: "CANCELLED",
                total: 0.0,
                discountTotal: 0.0,
                surchargeTotal: 0.0,
              },
            ],
          },
        ] as any);
      }

      return Promise.resolve([]);
    }) as any);

    // Mock date to 2026-08-07
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));

    const pageElement = await DashboardPage();
    render(pageElement);

    // Faturamento esperado de hoje: R$ 60 (appt 1 com comanda fechada de 60, appt 2 com comanda cancelada é 0)
    // T5 - Card Faturamento considera desconto
    // T8 - Comanda de R$ 70 com desconto de R$ 10 conta R$ 60 no dashboard
    // T9 - Comanda cancelada não entra no faturamento
    const faturamentoCard = screen.getAllByText("R$ 60,00");
    expect(faturamentoCard.length).toBeGreaterThan(0);

    // T6 & T7 - Visão rápida do negócio e Faturamento da semana consideram desconto
    const chartsDiv = screen.getByTestId("dashboard-charts");
    expect(chartsDiv.textContent).toContain("weekRevenue=60");

    vi.useRealTimers();
  });

  it("T13 - Tenant-scope preservado", async () => {
    const pageElement = await DashboardPage();
    render(pageElement);

    expect(prisma.appointment.findMany).toHaveBeenCalled();
    const calls = vi.mocked(prisma.appointment.findMany).mock.calls;
    
    // Todas as chamadas de findMany para appointment devem filtrar por barbershopId: "tenant-1"
    for (const call of calls) {
      const args = call[0];
      expect(args?.where?.barbershopId).toBe("tenant-1");
    }
  });
});
