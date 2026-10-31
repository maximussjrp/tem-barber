import { describe, it, expect } from "vitest";
import {
  computeDashboardOperationalMetrics,
  computeAttendanceSummary,
  deduplicateTodayAppointments,
  resolveReliableDurationMin,
  formatOccupancyPercent,
  formatEquivalentUnits,
} from "@/lib/dashboard/operational-metrics";
import { resolveSidebarActiveState } from "@/components/admin/Sidebar";
import { ADMIN_NAV_CONFIG } from "@/components/admin/navigation/nav-config";

const TODAY_STR = "2026-10-30";

function makeStandardBarber(
  overrides?: Partial<{
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    breakStart: string | null;
    breakEnd: string | null;
    allDayTimeOff: boolean;
    partialTimeOffs: { startDate: Date; endDate: Date; allDay: boolean }[];
    noWorkingHours: boolean;
  }>
) {
  const id = overrides?.id ?? "member-1";
  const name = overrides?.name ?? "Lucas Barber";
  return {
    id,
    user: { name, avatarUrl: null },
    workingHours: overrides?.noWorkingHours
      ? []
      : [
          {
            startTime: overrides?.startTime ?? "09:00",
            endTime: overrides?.endTime ?? "17:00", // 8 hours = 480 min = 16 cuts of 30m
            breakStart: overrides?.breakStart ?? null,
            breakEnd: overrides?.breakEnd ?? null,
          },
        ],
    timeOffs: overrides?.allDayTimeOff
      ? [
          {
            startDate: new Date("2026-10-30T00:00:00.000Z"),
            endDate: new Date("2026-10-30T23:59:59.000Z"),
            allDay: true,
          },
        ]
      : overrides?.partialTimeOffs ?? [],
  };
}

function makeAppt(params: {
  id: string;
  memberId?: string;
  hhmm: string; // Local São Paulo time stored literally in UTC components on 2026-10-30
  durationMin?: number | null;
  serviceDurations?: number[];
  status: string;
  hasLinkedComanda?: boolean;
}) {
  const [hh, mm] = params.hhmm.split(":").map(Number);
  const dt = new Date(Date.UTC(2026, 9, 30, hh, mm, 0));
  return {
    id: params.id,
    memberId: params.memberId ?? "member-1",
    dateTime: dt,
    durationMin: params.durationMin !== undefined ? params.durationMin : 30,
    status: params.status,
    services: (params.serviceDurations ?? []).map((d) => ({
      service: { durationMin: d },
    })),
    comandas: params.hasLinkedComanda
      ? [{ id: `cmd-${params.id}`, status: "CLOSED" }]
      : [],
  };
}

describe("Dashboard Operational Metrics — Unit Suite (Corrections 2, 3, 4, 5, 6)", () => {
  describe("Ocupação e Produtividade Gerencial (Correções 3 e 5)", () => {
    it("1. Sem agendamentos -> 0% de ocupação (480 min disponíveis, 16 cortes equivalentes)", () => {
      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 8 * 60,
        activeMembers: [makeStandardBarber()],
        todayAppointments: [],
      });

      expect(res.occupancyBreakdown.capacityMinutes).toBe(480);
      expect(res.occupancyBreakdown.totalDemandMinutes).toBe(0);
      expect(res.occupancyBreakdown.workloadPct).toBe(0);
      expect(formatOccupancyPercent(res.occupancyBreakdown.workloadPct)).toBe(
        "0%"
      );
      expect(res.occupancyBreakdown.equivalentCapacity30).toBe(16);
    });

    it("2. Capacidade de 16 cortes (480 min) com 8 cortes de 30 minutos -> 50%", () => {
      const appts = Array.from({ length: 8 }, (_, i) =>
        makeAppt({
          id: `a-${i}`,
          hhmm: `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${
            i % 2 === 0 ? "00" : "30"
          }`,
          durationMin: 30,
          status: i < 4 ? "COMPLETED" : "CONFIRMED",
        })
      );

      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 11 * 60,
        activeMembers: [makeStandardBarber()],
        todayAppointments: appts,
      });

      expect(res.occupancyBreakdown.capacityMinutes).toBe(480);
      expect(res.occupancyBreakdown.completedMinutes).toBe(120);
      expect(res.occupancyBreakdown.scheduledMinutes).toBe(120);
      expect(res.occupancyBreakdown.totalDemandMinutes).toBe(240);
      expect(res.occupancyBreakdown.workloadPct).toBe(50);
      expect(formatOccupancyPercent(res.occupancyBreakdown.workloadPct)).toBe(
        "50%"
      );
    });

    it("3. Capacidade de 16 cortes (480 min) com 16 cortes de 30 minutos -> 100%", () => {
      const appts = Array.from({ length: 16 }, (_, i) =>
        makeAppt({
          id: `a-${i}`,
          hhmm: `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${
            i % 2 === 0 ? "00" : "30"
          }`,
          durationMin: 30,
          status: "COMPLETED",
        })
      );

      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 17 * 60,
        activeMembers: [makeStandardBarber()],
        todayAppointments: appts,
      });

      expect(res.occupancyBreakdown.capacityMinutes).toBe(480);
      expect(res.occupancyBreakdown.totalDemandMinutes).toBe(480);
      expect(res.occupancyBreakdown.workloadPct).toBe(100);
      expect(formatOccupancyPercent(res.occupancyBreakdown.workloadPct)).toBe(
        "100%"
      );
      expect(res.occupancyBreakdown.overloadMinutes).toBe(0);
    });

    it("4. Capacidade de 16 cortes (480 min) com 18 cortes equivalentes (540 min) -> 112,5% (sem limitar a 100%)", () => {
      const appts = Array.from({ length: 18 }, (_, i) =>
        makeAppt({
          id: `a-${i}`,
          hhmm: `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${
            i % 2 === 0 ? "00" : "30"
          }`,
          durationMin: 30,
          status: i < 12 ? "COMPLETED" : "CONFIRMED",
        })
      );

      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 15 * 60,
        activeMembers: [makeStandardBarber()],
        todayAppointments: appts,
      });

      expect(res.occupancyBreakdown.capacityMinutes).toBe(480);
      expect(res.occupancyBreakdown.totalDemandMinutes).toBe(540);
      expect(res.occupancyBreakdown.workloadPct).toBe(112.5);
      expect(formatOccupancyPercent(res.occupancyBreakdown.workloadPct)).toBe(
        "112,5%"
      );
      expect(res.occupancyBreakdown.overloadMinutes).toBe(60);
      expect(res.occupancyBreakdown.overloadPct).toBe(12.5);
      expect(res.occupancyBreakdown.workloadBarPct).toBe(100);
    });

    it("5. Exemplo obrigatório do profissional: 12 cortes de 30m concluídos + 7 agendados em capacidade de 16 -> 19 eq. e 118,75%", () => {
      const appts = Array.from({ length: 19 }, (_, i) =>
        makeAppt({
          id: `a-${i}`,
          hhmm: `${String(9 + Math.floor((i % 16) / 2)).padStart(2, "0")}:${
            i % 2 === 0 ? "00" : "30"
          }`,
          durationMin: 30,
          status: i < 12 ? "COMPLETED" : "PENDING",
        })
      );

      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 15 * 60,
        activeMembers: [makeStandardBarber()],
        todayAppointments: appts,
      });

      const prof = res.professionals[0];
      expect(prof.completedCount).toBe(12);
      expect(prof.scheduledCount).toBe(7);
      expect(prof.equivalentDemand30).toBe(19);
      expect(prof.equivalentCapacity30).toBe(16);
      expect(prof.workloadPct).toBe(118.75);
      expect(formatOccupancyPercent(prof.workloadPct)).toBe("118,75%");
      expect(formatEquivalentUnits(prof.equivalentOverload30)).toBe("3");
    });

    it("6. Capacidade de 16 cortes (480 min) com 20 cortes equivalentes (600 min) -> 125%", () => {
      const appts = Array.from({ length: 20 }, (_, i) =>
        makeAppt({
          id: `a-${i}`,
          hhmm: `${String(9 + Math.floor((i % 16) / 2)).padStart(2, "0")}:${
            i % 2 === 0 ? "00" : "30"
          }`,
          durationMin: 30,
          status: "COMPLETED",
        })
      );

      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 17 * 60,
        activeMembers: [makeStandardBarber()],
        todayAppointments: appts,
      });

      expect(res.occupancyBreakdown.workloadPct).toBe(125);
      expect(formatOccupancyPercent(res.occupancyBreakdown.workloadPct)).toBe(
        "125%"
      );
      expect(res.occupancyBreakdown.overloadMinutes).toBe(120);
    });

    it("7 & 8. Exclui CANCELLED, NO_SHOW e duplicações técnicas da mesma operação", () => {
      const appt1 = makeAppt({
        id: "dup-1",
        hhmm: "09:00",
        durationMin: 30,
        status: "COMPLETED",
      });
      const appt1Duplicate = makeAppt({
        id: "dup-1",
        hhmm: "09:00",
        durationMin: 30,
        status: "PENDING",
      });
      const cancelled = makeAppt({
        id: "canc-1",
        hhmm: "10:00",
        durationMin: 60,
        status: "CANCELLED",
      });
      const noShow = makeAppt({
        id: "noshow-1",
        hhmm: "11:00",
        durationMin: 45,
        status: "NO_SHOW",
      });

      const deduped = deduplicateTodayAppointments(
        [appt1, cancelled, noShow],
        [appt1Duplicate]
      );
      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 9 * 60,
        activeMembers: [makeStandardBarber()],
        todayAppointments: deduped,
      });

      expect(res.occupancyBreakdown.completedMinutes).toBe(30);
      expect(res.occupancyBreakdown.scheduledMinutes).toBe(0);
      expect(res.occupancyBreakdown.totalDemandMinutes).toBe(30);
    });

    it("9. Serviços de 45 e 60 minutos mantêm duração real em minutos e não inventam duração quando ausente", () => {
      const appt45 = makeAppt({
        id: "s-45",
        hhmm: "09:00",
        durationMin: 45,
        status: "COMPLETED",
      });
      const appt60 = makeAppt({
        id: "s-60",
        hhmm: "10:00",
        durationMin: 60,
        status: "CONFIRMED",
      });
      const apptInvalid = makeAppt({
        id: "s-invalid",
        hhmm: "12:00",
        durationMin: null,
        serviceDurations: [],
        status: "CONFIRMED",
      });

      expect(resolveReliableDurationMin(apptInvalid)).toBe(0);

      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 9 * 60,
        activeMembers: [makeStandardBarber()],
        todayAppointments: [appt45, appt60, apptInvalid],
      });

      expect(res.occupancyBreakdown.completedMinutes).toBe(45);
      expect(res.occupancyBreakdown.scheduledMinutes).toBe(60);
      expect(res.occupancyBreakdown.totalDemandMinutes).toBe(105);
      expect(res.occupancyBreakdown.equivalentDemand30).toBe(3.5);
    });

    it("10 & 11. Respeita intervalo de almoço e bloqueio parcial (TimeOff parcial) na capacidade produtiva", () => {
      const barber = makeStandardBarber({
        startTime: "09:00",
        endTime: "18:00",
        breakStart: "12:00",
        breakEnd: "13:00",
        partialTimeOffs: [
          {
            startDate: new Date(Date.UTC(2026, 9, 30, 15, 0, 0)),
            endDate: new Date(Date.UTC(2026, 9, 30, 16, 0, 0)),
            allDay: false,
          },
        ],
      });

      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 9 * 60,
        activeMembers: [barber],
        todayAppointments: [],
      });

      expect(res.occupancyBreakdown.capacityMinutes).toBe(420);
      expect(res.occupancyBreakdown.equivalentCapacity30).toBe(14);
    });

    it("12 & 13. Agendamentos sobrepostos e fora da jornada entram na demanda produtiva sem inflar ocupação física acima de 100%", () => {
      const barber = makeStandardBarber({
        startTime: "09:00",
        endTime: "10:00",
      });
      const overlapping1 = makeAppt({
        id: "ov-1",
        hhmm: "09:00",
        durationMin: 60,
        status: "COMPLETED",
      });
      const overlapping2 = makeAppt({
        id: "ov-2",
        hhmm: "09:00",
        durationMin: 60,
        status: "CONFIRMED",
      });
      const afterShift = makeAppt({
        id: "ov-3",
        hhmm: "10:00",
        durationMin: 30,
        status: "CONFIRMED",
      });

      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 9 * 60,
        activeMembers: [barber],
        todayAppointments: [overlapping1, overlapping2, afterShift],
      });

      expect(res.occupancyBreakdown.capacityMinutes).toBe(60);
      expect(res.occupancyBreakdown.totalDemandMinutes).toBe(150);
      expect(res.occupancyBreakdown.workloadPct).toBe(250);
      expect(res.occupancyBreakdown.physicallyOccupiedMinutes).toBe(60);
      expect(res.occupancyBreakdown.physicalOccupancyPct).toBe(100);
    });

    it("15 & 16. Comanda avulsa concluída soma na carga produtiva, enquanto comanda vinculada a agendamento não duplica", () => {
      const apptWithLinkedComanda = makeAppt({
        id: "appt-linked",
        hhmm: "09:00",
        durationMin: 30,
        status: "COMPLETED",
        hasLinkedComanda: true,
      });

      const standaloneClosedComanda = {
        id: "cmd-standalone-1",
        appointmentId: null,
        status: "CLOSED",
        items: [
          {
            id: "item-1",
            type: "SERVICE",
            status: "COMPLETED",
            executorId: "member-1",
            quantity: 1,
            service: { durationMin: 45 },
          },
        ],
      };

      const linkedClosedComanda = {
        id: "cmd-linked-dup",
        appointmentId: "appt-linked",
        status: "CLOSED",
        items: [
          {
            id: "item-2",
            type: "SERVICE",
            status: "COMPLETED",
            executorId: "member-1",
            quantity: 1,
            service: { durationMin: 30 },
          },
        ],
      };

      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 9 * 60,
        activeMembers: [makeStandardBarber()],
        todayAppointments: [apptWithLinkedComanda],
        standaloneComandas: [standaloneClosedComanda, linkedClosedComanda],
      });

      expect(res.occupancyBreakdown.completedMinutes).toBe(75);
      expect(res.professionals[0].completedCount).toBe(2);
    });

    it("17. Capacidade zero (todos os profissionais em folga) trata sem divisão por zero", () => {
      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 9 * 60,
        activeMembers: [makeStandardBarber({ allDayTimeOff: true })],
        todayAppointments: [],
      });

      expect(res.occupancyBreakdown.capacityMinutes).toBe(0);
      expect(res.occupancyBreakdown.capacityAvailable).toBe(false);
      expect(res.occupancyBreakdown.hasCapacity).toBe(false);
      expect(res.occupancyBreakdown.workloadPctDisplay).toBe(0);
      expect(Number.isFinite(res.occupancyBreakdown.workloadPctDisplay)).toBe(
        true
      );
    });
  });

  describe("Horários de Hoje (Correção 4)", () => {
    it("18-23. Classifica Disponível, Agendado, Concluído, Bloqueado, fora da grade (09:45), horários passados e múltiplos profissionais", () => {
      const barber1 = makeStandardBarber({
        id: "m-1",
        name: "Lucas",
        startTime: "08:00",
        endTime: "12:00",
      });
      const barber2 = makeStandardBarber({
        id: "m-2",
        name: "Mateus",
        startTime: "08:00",
        endTime: "12:00",
      });

      const appts = [
        makeAppt({
          id: "c-1",
          memberId: "m-1",
          hhmm: "09:00",
          durationMin: 30,
          status: "COMPLETED",
        }),
        makeAppt({
          id: "c-2",
          memberId: "m-2",
          hhmm: "09:00",
          durationMin: 30,
          status: "COMPLETED",
        }),
        makeAppt({
          id: "o-1",
          memberId: "m-1",
          hhmm: "09:45",
          durationMin: 30,
          status: "CONFIRMED",
        }),
      ];

      const res = computeDashboardOperationalMetrics({
        todayStr: TODAY_STR,
        currentMinutesBR: 9 * 60,
        activeMembers: [barber1, barber2],
        todayAppointments: appts,
      });

      const slotMap = new Map(res.todaySlots.map((s) => [s.time, s]));

      expect(slotMap.get("08:00")?.status).toBe("blocked");
      expect(slotMap.get("08:30")?.status).toBe("blocked");

      expect(slotMap.get("09:00")?.status).toBe("completed");
      expect(slotMap.get("09:00")?.completedCount).toBe(2);

      expect(slotMap.get("09:30")?.status).toBe("scheduled");
      expect(slotMap.get("09:30")?.availableCount).toBe(1);
      expect(slotMap.get("09:30")?.scheduledCount).toBe(1);

      expect(slotMap.get("10:00")?.status).toBe("scheduled");
      expect(slotMap.get("10:00")?.availableCount).toBe(1);

      expect(slotMap.get("10:30")?.status).toBe("available");
      expect(slotMap.get("10:30")?.availableCount).toBe(2);
    });
  });

  describe("Menu Lateral Desktop (Correção 2)", () => {
    it("24-27. Separa rota ativa, grupo expandido, Financeiro vs Relatórios e Contas a Pagar vs Contas a Receber", () => {
      const items = ADMIN_NAV_CONFIG.filter(
        (i) => i.href !== "/admin/financeiro/contas"
      );

      // 1. Em /admin/dashboard: apenas Dashboard ativo, Financeiro e Relatórios sem rota ativa
      const onDashboard = resolveSidebarActiveState({
        items,
        pathname: "/admin/dashboard",
        search: "",
        userRole: "OWNER",
      });
      expect(onDashboard.activeItemHref).toBe("/admin/dashboard");
      expect(onDashboard.activeGroupHref).toBeNull();

      // 2. Em /admin/financeiro: apenas Visão Geral ativa dentro de Financeiro; Relatórios NÃO ativo
      const onFinanceiro = resolveSidebarActiveState({
        items,
        pathname: "/admin/financeiro",
        search: "",
        userRole: "OWNER",
      });
      expect(onFinanceiro.activeItemHref).toBe("/admin/financeiro");
      expect(onFinanceiro.activeGroupHref).toBe("/admin/financeiro");

      // 3. Em /admin/financeiro/relatorio-gerencial: apenas Relatório Gerencial ativo em Relatórios; Financeiro NÃO ativo
      const onRelatorios = resolveSidebarActiveState({
        items,
        pathname: "/admin/financeiro/relatorio-gerencial",
        search: "",
        userRole: "OWNER",
      });
      expect(onRelatorios.activeItemHref).toBe(
        "/admin/financeiro/relatorio-gerencial"
      );
      expect(onRelatorios.activeGroupHref).toBe(
        "/admin/financeiro/relatorio-gerencial"
      );

      // 4. Em /admin/financeiro/contas?kind=PAYABLE: apenas Contas a Pagar ativo
      const onPayable = resolveSidebarActiveState({
        items,
        pathname: "/admin/financeiro/contas",
        search: "kind=PAYABLE",
        userRole: "OWNER",
      });
      expect(onPayable.activeItemHref).toBe(
        "/admin/financeiro/contas?kind=PAYABLE"
      );
      expect(onPayable.activeGroupHref).toBe("/admin/financeiro");

      // 5. Em /admin/financeiro/contas?kind=RECEIVABLE: apenas Contas a Receber ativo
      const onReceivable = resolveSidebarActiveState({
        items,
        pathname: "/admin/financeiro/contas",
        search: "kind=RECEIVABLE",
        userRole: "OWNER",
      });
      expect(onReceivable.activeItemHref).toBe(
        "/admin/financeiro/contas?kind=RECEIVABLE"
      );
      expect(onReceivable.activeGroupHref).toBe("/admin/financeiro");
    });
  });

  describe("Resumo dos Atendimentos (Correção 6)", () => {
    it("28 & 29. Agrega mutuamente exclusivo por status e suporta estado vazio", () => {
      const empty = computeAttendanceSummary([]);
      expect(empty).toEqual({
        periodLabel: "Hoje",
        total: 0,
        completed: 0,
        pending: 0,
        confirmed: 0,
        cancelled: 0,
        noShow: 0,
      });

      const populated = computeAttendanceSummary([
        { status: "COMPLETED" },
        { status: "COMPLETED" },
        { status: "CONFIRMED" },
        { status: "PENDING" },
        { status: "CANCELLED" },
        { status: "NO_SHOW" },
      ]);
      expect(populated).toEqual({
        periodLabel: "Hoje",
        total: 6,
        completed: 2,
        confirmed: 1,
        pending: 1,
        cancelled: 1,
        noShow: 1,
      });
    });
  });
});
