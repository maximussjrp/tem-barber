import { redirect } from "next/navigation";
import { requireManagerialAdmin } from "@/lib/admin-guard";
import prisma from "@/lib/prisma";
import {
  nowBR,
  toBR,
  startOfDayUTC,
  endOfDayUTC,
  formatHeaderDate,
  todayIsoBR,
} from "@/lib/time-utils";
import { buildOnboardingSteps, countCompletedOnboardingSteps } from "@/lib/onboarding";
import { calculateTitleDerivedStatus } from "@/lib/financial/titles";
import {
  PremiumDashboardView,
  ClientRecurrenceStats,
  MonthlyGoalStats,
  ChannelPerformanceStats,
  OperationalAlertItem,
} from "@/components/admin/dashboard/PremiumDashboardView";
import { DueAccountSummary, DueAccountItem } from "@/components/admin/dashboard/FinancialDueCard";
import { DashboardAppointmentItem } from "@/components/admin/dashboard/TodayScheduleCard";
import {
  computeDashboardOperationalMetrics,
  deduplicateTodayAppointments,
} from "@/lib/dashboard/operational-metrics";

function getTodayBR() {
  const br = nowBR();
  const str = br.toISOString().slice(0, 10);
  const [y, m, d] = str.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const startOfDay = startOfDayUTC(y, m, d);
  const endOfDay = endOfDayUTC(y, m, d);
  const currentMinutesBR = br.getUTCHours() * 60 + br.getUTCMinutes();
  return { str, dayOfWeek, startOfDay, endOfDay, currentMinutesBR };
}

function getWeekStartBR() {
  const br = nowBR();
  const str = br.toISOString().slice(0, 10);
  const [y, m, d] = str.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const daysToMon = (dow + 6) % 7;
  return new Date(Date.UTC(y, m - 1, d - daysToMon, 0, 0, 0));
}

function formatApptTimeBR(dateTime: Date): string {
  const br = toBR(dateTime);
  return `${String(br.getUTCHours()).padStart(2, "0")}:${String(
    br.getUTCMinutes()
  ).padStart(2, "0")}`;
}

function formatRelativeTimeBR(dateTime: Date, todayStr: string): string {
  const br = toBR(dateTime);
  const dateStr = br.toISOString().slice(0, 10);
  const hh = String(br.getUTCHours()).padStart(2, "0");
  const mm = String(br.getUTCMinutes()).padStart(2, "0");
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const yesterdayStr = new Date(Date.UTC(ty, tm - 1, td - 1))
    .toISOString()
    .slice(0, 10);
  if (dateStr === todayStr) return `Hoje, ${hh}:${mm}`;
  if (dateStr === yesterdayStr) return `Ontem, ${hh}:${mm}`;
  return br.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function getAppointmentNetRevenue(a: {
  totalPrice: unknown;
  comandas?: { status: string; total: unknown }[];
}): number {
  const comanda = a.comandas?.[0];
  if (comanda) {
    if (comanda.status === "CANCELLED") {
      return 0;
    }
    return Number(comanda.total);
  }
  return Number(a.totalPrice);
}

function computeVariationStr(
  current: number,
  previous: number
): string | undefined {
  if (!Number.isFinite(previous) || previous <= 0) {
    return undefined;
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export default async function DashboardPage() {
  const { barbershop, barbershopId, isPlatform, role, session } =
    await requireManagerialAdmin();

  if (!barbershopId) {
    return redirect(isPlatform ? "/admin/platform" : "/acesso-negado");
  }

  const canAccessFinancial =
    role === "OWNER" || role === "MANAGER" || role === "SUPER_ADMIN" || isPlatform;

  const {
    str: todayStr,
    dayOfWeek,
    startOfDay,
    endOfDay,
    currentMinutesBR,
  } = getTodayBR();
  const [ty, tm, td] = todayStr.split("-").map(Number);

  // Yesterday boundaries (America/Sao_Paulo civil day)
  const yesterdayUtc = new Date(Date.UTC(ty, tm - 1, td - 1));
  const [yy, ym, yd] = yesterdayUtc
    .toISOString()
    .slice(0, 10)
    .split("-")
    .map(Number);
  const startOfYesterday = startOfDayUTC(yy, ym, yd);
  const endOfYesterday = endOfDayUTC(yy, ym, yd);

  // Current week & previous week boundaries
  const weekStart = getWeekStartBR();
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prevWeekEnd = new Date(weekStart.getTime() - 1);

  // Current month & previous month boundaries (America/Sao_Paulo civil month)
  const startOfMonth = startOfDayUTC(ty, tm, 1);
  const prevMonthUtc = new Date(Date.UTC(ty, tm - 2, 1));
  const [pmy, pmm] = prevMonthUtc
    .toISOString()
    .slice(0, 7)
    .split("-")
    .map(Number);
  const prevMonthStart = startOfDayUTC(pmy, pmm, 1);
  const prevMonthEnd = new Date(startOfMonth.getTime() - 1);

  const earliestCompletedDate = new Date(
    Math.min(
      weekStart.getTime(),
      prevWeekStart.getTime(),
      startOfMonth.getTime(),
      prevMonthStart.getTime(),
      startOfYesterday.getTime()
    )
  );
  const thirtyDaysAgo = new Date(endOfDay.getTime() - 30 * 24 * 60 * 60 * 1000);
  const civilToday = todayIsoBR();

  // Queries base em paralelo (sem N+1 e sempre escopadas por barbershopId)
  const [
    todayDetailedAppts,
    servicesCount,
    workingHoursCount,
    completedPeriodAppts,
    recentApptRows,
    activeMembers,
    bookedAppointments,
    payableTitles,
    customerHistoryRows,
    standaloneComandas,
  ] = await Promise.all([
    // 1. Agendamentos de hoje (incluindo durationMin dos serviços para carga produtiva real)
    prisma.appointment.findMany({
      where: {
        barbershopId: barbershopId!,
        dateTime: { gte: startOfDay, lte: endOfDay },
      },
      include: {
        customer: { select: { name: true, avatarUrl: true } },
        services: {
          include: {
            service: { select: { name: true, durationMin: true } },
          },
        },
        comandas: {
          select: {
            id: true,
            status: true,
            total: true,
            discountTotal: true,
            surchargeTotal: true,
          },
        },
      },
      orderBy: { dateTime: "asc" },
    }),

    // 2. Total de serviços ativos
    prisma.service.count({
      where: { barbershopId: barbershopId!, isActive: true },
    }),

    // 3. Horários de funcionamento
    prisma.workingHour.count({
      where: {
        member: { barbershopId: barbershopId!, isActive: true },
        isActive: true,
      },
    }),

    // 4. Agendamentos concluídos para faturamento semanal, mensal e comparativos reais (sem limite take)
    prisma.appointment.findMany({
      where: {
        barbershopId: barbershopId!,
        dateTime: { gte: earliestCompletedDate, lte: endOfDay },
        status: "COMPLETED",
      },
      select: {
        id: true,
        customerId: true,
        memberId: true,
        dateTime: true,
        totalPrice: true,
        comandas: {
          select: {
            status: true,
            total: true,
            discountTotal: true,
            surchargeTotal: true,
          },
        },
      },
    }),

    // 5. Últimos agendamentos para lista rápida de clientes recentes
    prisma.appointment.findMany({
      where: { barbershopId: barbershopId! },
      orderBy: { dateTime: "desc" },
      take: 25,
      select: {
        customerId: true,
        dateTime: true,
        status: true,
        totalPrice: true,
        customer: { select: { name: true, avatarUrl: true } },
      },
    }),

    // 6. Colaboradores ativos e jornadas de hoje
    prisma.barbershopMember.findMany({
      where: { barbershopId: barbershopId!, isActive: true },
      include: {
        user: { select: { name: true, avatarUrl: true } },
        services: { select: { serviceId: true } },
        workingHours: { where: { dayOfWeek, isActive: true } },
        timeOffs: {
          where: {
            startDate: { lte: endOfDay },
            endDate: { gte: startOfDay },
          },
        },
      },
      orderBy: { user: { name: "asc" } },
    }),

    // 7. Agendamentos ocupando slots hoje (PENDING, CONFIRMED e COMPLETED)
    prisma.appointment.findMany({
      where: {
        barbershopId: barbershopId!,
        dateTime: { gte: startOfDay, lte: endOfDay },
        status: { in: ["PENDING", "CONFIRMED", "COMPLETED"] },
      },
      select: {
        memberId: true,
        dateTime: true,
        durationMin: true,
      },
    }),

    // 8. Títulos a pagar reais (apenas se tiver permissão financeira e prisma suportar o model)
    canAccessFinancial && prisma.financialTitle
      ? prisma.financialTitle.findMany({
          where: {
            barbershopId: barbershopId!,
            kind: "PAYABLE",
            cancelledAt: null,
          },
          include: {
            category: { select: { name: true } },
            settlements: {
              include: {
                reversals: { select: { id: true } },
              },
            },
          },
          orderBy: { dueOn: "asc" },
        })
      : Promise.resolve([]),

    // 9. Histórico completo de visitas efetivamente concluídas por cliente para recorrência e novos clientes no mês (sem take: 60)
    prisma.appointment.findMany({
      where: {
        barbershopId: barbershopId!,
        status: "COMPLETED",
        dateTime: { lte: endOfDay },
      },
      select: {
        customerId: true,
        dateTime: true,
        status: true,
      },
    }),

    // 10. Comandas avulsas concluídas hoje sem agendamento vinculado (evitando omissão de carga e sem duplicar comandas com appointmentId)
    prisma.comanda?.findMany
      ? prisma.comanda.findMany({
          where: {
            barbershopId: barbershopId!,
            appointmentId: null,
            status: "CLOSED",
            OR: [
              { closedAt: { gte: startOfDay, lte: endOfDay } },
              { closedAt: null, openedAt: { gte: startOfDay, lte: endOfDay } },
            ],
          },
          select: {
            id: true,
            appointmentId: true,
            status: true,
            openedAt: true,
            closedAt: true,
            items: {
              select: {
                id: true,
                type: true,
                status: true,
                quantity: true,
                executorId: true,
                service: { select: { name: true, durationMin: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  // ─── Métricas do Faturamento de Hoje & Faturamento Diário por Profissional ───
  const memberDailyRev: Record<string, number> = {};
  let revenueToday = 0;

  for (const a of todayDetailedAppts) {
    if (a.status === "COMPLETED") {
      const netRev = getAppointmentNetRevenue(a);
      revenueToday += netRev;
      if (a.memberId) {
        memberDailyRev[a.memberId] = (memberDailyRev[a.memberId] ?? 0) + netRev;
      }
    }
  }

  // Clientes atendidos hoje (COMPLETED)
  const clientesAtendidosHoje = todayDetailedAppts.filter(
    (a) => a.status === "COMPLETED"
  ).length;

  // ─── Agregações Reais por Período (Semana Atual, Semana Anterior, Ontem, Mês Atual e Mês Anterior) ───
  const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const dailyRevByDay: Record<number, number> = {};
  const dailyCompletedByDay: Record<number, number> = {};
  const memberWeeklyRev: Record<string, number> = {};
  let totalWeekRevenue = 0;
  let prevWeekRevenue = 0;
  let yesterdayRevenue = 0;
  let yesterdayCompletedCount = 0;
  let monthRevenue = 0;
  let monthCompletedCount = 0;
  let prevMonthRevenue = 0;
  let prevMonthCompletedCount = 0;

  for (const a of completedPeriodAppts) {
    const dt = new Date(a.dateTime);
    const tMs = dt.getTime();
    const netRev = getAppointmentNetRevenue(a);

    // Semana atual (weekStart .. endOfDay)
    if (tMs >= weekStart.getTime() && tMs <= endOfDay.getTime()) {
      const br = new Date(tMs - 3 * 3600 * 1000);
      const dow = br.getUTCDay();
      const isoDay = dow === 0 ? 6 : dow - 1;
      dailyRevByDay[isoDay] = (dailyRevByDay[isoDay] ?? 0) + netRev;
      dailyCompletedByDay[isoDay] = (dailyCompletedByDay[isoDay] ?? 0) + 1;
      totalWeekRevenue += netRev;
      if (a.memberId) {
        memberWeeklyRev[a.memberId] =
          (memberWeeklyRev[a.memberId] ?? 0) + netRev;
      }
    }

    // Semana anterior (prevWeekStart .. prevWeekEnd)
    if (tMs >= prevWeekStart.getTime() && tMs <= prevWeekEnd.getTime()) {
      prevWeekRevenue += netRev;
    }

    // Ontem (startOfYesterday .. endOfYesterday)
    if (
      tMs >= startOfYesterday.getTime() &&
      tMs <= endOfYesterday.getTime()
    ) {
      yesterdayRevenue += netRev;
      yesterdayCompletedCount += 1;
    }

    // Mês atual (startOfMonth .. endOfDay)
    if (tMs >= startOfMonth.getTime() && tMs <= endOfDay.getTime()) {
      monthRevenue += netRev;
      monthCompletedCount += 1;
    }

    // Mês anterior (prevMonthStart .. prevMonthEnd)
    if (tMs >= prevMonthStart.getTime() && tMs <= prevMonthEnd.getTime()) {
      prevMonthRevenue += netRev;
      prevMonthCompletedCount += 1;
    }
  }

  const dailyRevenue = DAY_LABELS.map((label, i) => ({
    label,
    revenue: dailyRevByDay[i] ?? 0,
  }));
  const completedClientsSeries = DAY_LABELS.map(
    (_, i) => dailyCompletedByDay[i] ?? 0
  );

  const faturamentoHojeTrend = computeVariationStr(
    revenueToday,
    yesterdayRevenue
  );
  const faturamentoSemanaTrend = computeVariationStr(
    totalWeekRevenue,
    prevWeekRevenue
  );
  const clientesAtendidosTrend = computeVariationStr(
    clientesAtendidosHoje,
    yesterdayCompletedCount
  );

  // ─── Cálculo Canônico de Ocupação Gerencial, Horários de Hoje, Produtividade por Profissional e Resumo dos Atendimentos ───
  const deduplicatedTodayAppts = deduplicateTodayAppointments(
    todayDetailedAppts,
    bookedAppointments
  );

  const {
    professionals: professionalSlots,
    occupancyBreakdown,
    todaySlots,
    attendanceSummary,
    totalOccupiedSlots,
    totalFreeSlots,
    totalBlockedSlots,
  } = computeDashboardOperationalMetrics({
    todayStr,
    currentMinutesBR,
    activeMembers,
    todayAppointments: deduplicatedTodayAppts,
    standaloneComandas,
    memberWeeklyRev,
    memberDailyRev,
  });

  const taxaOcupacaoPct = occupancyBreakdown.workloadPctDisplay;

  const occupancyData = {
    occupied: totalOccupiedSlots,
    available: totalFreeSlots,
    blocked: totalBlockedSlots,
  };

  // ─── Processamento das Contas a Vencer (Prioridade Financeira) ───
  let overdueCount = 0;
  let overdueAmountCents = 0;
  let todayCount = 0;
  let todayAmountCents = 0;
  let next7DaysCount = 0;
  let next7DaysAmountCents = 0;

  const [cy, cm, cd] = civilToday.split("-").map(Number);
  const next7DaysLimit = new Date(Date.UTC(cy, cm - 1, cd + 7))
    .toISOString()
    .slice(0, 10);

  const pendingDueItems: DueAccountItem[] = [];

  for (const t of payableTitles as Array<{
    id: string;
    title: string;
    originalAmount: unknown;
    dueOn: Date;
    cancelledAt: Date | null;
    category?: { name: string } | null;
    settlements?: Array<{
      principalAmount: unknown;
      reversals?: Array<{ id: string }>;
    }>;
  }>) {
    const dueCivil = t.dueOn.toISOString().slice(0, 10);
    const origCents = Math.round(Number(t.originalAmount) * 100);
    const settlementsList = t.settlements || [];
    const settledCents = settlementsList.reduce(
      (
        sum: number,
        s: { principalAmount: unknown; reversals?: Array<{ id: string }> }
      ) => {
        if (s.reversals && s.reversals.length > 0) return sum;
        return sum + Math.round(Number(s.principalAmount) * 100);
      },
      0
    );

    const derived = calculateTitleDerivedStatus({
      cancelledAt: t.cancelledAt,
      originalAmountCents: origCents,
      settledPrincipalCents: settledCents,
      dueOnCivil: dueCivil,
      civilTodayCivil: civilToday,
    });

    if (derived.status === "PAID" || derived.status === "CANCELLED") {
      continue;
    }

    const remainingCents = derived.outstandingPrincipalCents;

    if (dueCivil < civilToday) {
      overdueCount += 1;
      overdueAmountCents += remainingCents;
    } else if (dueCivil === civilToday) {
      todayCount += 1;
      todayAmountCents += remainingCents;
    } else if (dueCivil <= next7DaysLimit) {
      next7DaysCount += 1;
      next7DaysAmountCents += remainingCents;
    }

    pendingDueItems.push({
      id: t.id,
      title: t.title,
      categoryName: t.category?.name ?? "",
      dueOnCivil: dueCivil,
      outstandingPrincipalCents: remainingCents,
      derivedStatus: derived.status,
    });
  }

  pendingDueItems.sort((a, b) => {
    if (a.derivedStatus === "OVERDUE" && b.derivedStatus !== "OVERDUE")
      return -1;
    if (b.derivedStatus === "OVERDUE" && a.derivedStatus !== "OVERDUE")
      return 1;
    return a.dueOnCivil.localeCompare(b.dueOnCivil);
  });

  const financialSummary: DueAccountSummary = {
    overdueCount,
    overdueAmountCents,
    todayCount,
    todayAmountCents,
    next7DaysCount,
    next7DaysAmountCents,
  };

  // ─── Format Appointments for Today ───
  const dashboardAppointments: DashboardAppointmentItem[] =
    todayDetailedAppts.map((appt) => ({
      id: appt.id,
      customerName: appt.customer.name,
      customerAvatarUrl: appt.customer.avatarUrl ?? null,
      timeFormatted: formatApptTimeBR(appt.dateTime),
      servicesFormatted:
        appt.services.map((s) => s.service.name).join(" + ") || "Serviço",
      status: appt.status,
    }));

  // ─── Recorrência Real de Clientes & Novos Clientes no Mês (exclusivamente atendimentos COMPLETED realizados até endOfDay) ───
  const seenCustomers = new Set<string>();
  const rawVisitRows =
    customerHistoryRows.length > 0 ? customerHistoryRows : recentApptRows;
  const sourceVisitRows = rawVisitRows.filter(
    (r) =>
      r.status === "COMPLETED" &&
      Boolean(r.dateTime) &&
      new Date(r.dateTime).getTime() <= endOfDay.getTime()
  );

  const customerSummary = new Map<
    string,
    { count: number; firstVisit: Date; lastVisit: Date }
  >();

  for (const row of sourceVisitRows) {
    if (!row.customerId || !row.dateTime) continue;
    const dt = new Date(row.dateTime);
    const existing = customerSummary.get(row.customerId);
    if (!existing) {
      customerSummary.set(row.customerId, {
        count: 1,
        firstVisit: dt,
        lastVisit: dt,
      });
    } else {
      existing.count += 1;
      if (dt < existing.firstVisit) existing.firstVisit = dt;
      if (dt > existing.lastVisit) existing.lastVisit = dt;
    }
  }

  let recurringCustomerCount = 0;
  let newCustomerCount = 0;
  let inactiveCustomerCount = 0;
  let monthNewClientsCount = 0;

  for (const info of customerSummary.values()) {
    if (
      info.firstVisit.getTime() >= startOfMonth.getTime() &&
      info.firstVisit.getTime() <= endOfDay.getTime()
    ) {
      monthNewClientsCount += 1;
    }

    if (info.lastVisit.getTime() < thirtyDaysAgo.getTime()) {
      inactiveCustomerCount += 1;
    } else if (info.count > 1) {
      recurringCustomerCount += 1;
    } else {
      newCustomerCount += 1;
    }
  }

  const totalTrackedCustomers = customerSummary.size;
  let recurringPct = 0;
  let newPct = 0;
  let inactivePct = 0;

  if (totalTrackedCustomers > 0) {
    recurringPct = Math.round(
      (recurringCustomerCount / totalTrackedCustomers) * 100
    );
    newPct = Math.round((newCustomerCount / totalTrackedCustomers) * 100);
    if (inactiveCustomerCount > 0) {
      inactivePct = Math.max(0, 100 - recurringPct - newPct);
    } else {
      newPct = Math.max(0, 100 - recurringPct);
      inactivePct = 0;
    }
  }

  const clientRecurrence: ClientRecurrenceStats = {
    recurringPct,
    newPct,
    inactivePct,
    totalCustomers: totalTrackedCustomers,
    hasData: totalTrackedCustomers > 0,
    periodLabel: "Ativos nos últimos 30 dias vs. histórico",
  };

  // ─── Resultado Real do Mês Corrente (sem Math.max com semana ou hoje e sem take: 60) ───
  const avgTicket =
    monthCompletedCount > 0 ? monthRevenue / monthCompletedCount : 0;
  const prevMonthAvgTicket =
    prevMonthCompletedCount > 0
      ? prevMonthRevenue / prevMonthCompletedCount
      : 0;
  const averageTicketTrend = computeVariationStr(avgTicket, prevMonthAvgTicket);

  const monthlyStats: MonthlyGoalStats = {
    revenue: monthRevenue,
    completedServices: monthCompletedCount,
    newClients: monthNewClientsCount,
    averageTicket: avgTicket,
    averageTicketTrend,
  };

  // Origem/canal não possui coluna dedicada em Appointment no schema atual (mantido por compatibilidade de contrato)
  const channelPerformance: ChannelPerformanceStats = {
    available: false,
    unavailableReason: "Origem do agendamento não rastreada",
    total: 0,
    channels: [
      { name: "WhatsApp", pct: 0, count: 0, color: "#16C784" },
      { name: "Site / Link", pct: 0, count: 0, color: "#6366F1" },
      { name: "Instagram", pct: 0, count: 0, color: "#EF5A67" },
      { name: "Presencial", pct: 0, count: 0, color: "#94A3B8" },
    ],
  };

  const recentClients = recentApptRows
    .filter((a) => {
      if (seenCustomers.has(a.customerId)) return false;
      seenCustomers.add(a.customerId);
      return true;
    })
    .slice(0, 5)
    .map((a) => {
      const name = a.customer?.name ?? "Cliente";
      const initials = name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join("");
      return {
        id: a.customerId,
        name,
        initials,
        relativeTime: formatRelativeTimeBR(a.dateTime, todayStr),
      };
    });

  // ─── Onboarding Progress ───
  const onboardingSteps = buildOnboardingSteps({
    barbershop,
    activeServicesCount: servicesCount,
    activeWorkingHoursCount: workingHoursCount,
    schedulableProfessionalsCount: activeMembers.filter(
      (member) => member.services.length > 0
    ).length,
  });
  const onboardingDone = countCompletedOnboardingSteps(onboardingSteps);
  const onboardingTotal = onboardingSteps.length;
  const setupComplete = onboardingDone === onboardingTotal;

  const operationalAlerts: OperationalAlertItem[] = [
    {
      id: "alert-due",
      title:
        overdueCount > 0
          ? `${overdueCount} conta${overdueCount > 1 ? "s" : ""} em atraso`
          : "Contas a pagar em dia",
      subtitle:
        todayCount > 0
          ? `${todayCount} vence${todayCount > 1 ? "m" : ""} hoje`
          : "Sem vencimentos atrasados",
      badgeText: overdueCount > 0 || todayCount > 0 ? "Hoje" : undefined,
      badgeTone: "red",
    },
    {
      id: "alert-agenda",
      title: "Agenda de hoje",
      subtitle: `${todayDetailedAppts.length} agendamento${
        todayDetailedAppts.length !== 1 ? "s" : ""
      } hoje`,
    },
    {
      id: "alert-team",
      title: "Equipe escalada",
      subtitle: `${
        professionalSlots.filter((p) => p.working).length
      } profissiona${
        professionalSlots.filter((p) => p.working).length !== 1 ? "is" : "l"
      } hoje`,
    },
    {
      id: "alert-setup",
      title: setupComplete ? "Barbearia ativa" : "Configuração pendente",
      subtitle: `${onboardingDone}/${onboardingTotal} etapas concluídas`,
    },
  ];

  return (
    <PremiumDashboardView
      barbershop={barbershop}
      userName={session?.user?.name ?? "Admin"}
      todayFormatted={formatHeaderDate(todayStr)}
      civilToday={civilToday}
      faturamentoHoje={revenueToday}
      faturamentoHojeTrend={faturamentoHojeTrend}
      faturamentoSemana={totalWeekRevenue}
      faturamentoSemanaTrend={faturamentoSemanaTrend}
      faturamentoGraficoTrend={faturamentoSemanaTrend}
      taxaOcupacaoPct={taxaOcupacaoPct}
      occupancyBreakdown={occupancyBreakdown}
      horariosOcupados={totalOccupiedSlots}
      horariosDisponiveis={totalFreeSlots}
      clientesAtendidosHoje={clientesAtendidosHoje}
      clientesAtendidosTrend={clientesAtendidosTrend}
      todayAppointments={dashboardAppointments}
      attendanceSummary={attendanceSummary}
      professionals={professionalSlots}
      financialSummary={financialSummary}
      dueItems={pendingDueItems}
      canAccessFinancial={canAccessFinancial}
      dailyRevenue={dailyRevenue}
      completedClientsSeries={completedClientsSeries}
      occupancyData={occupancyData}
      onboarding={{
        done: onboardingDone,
        total: onboardingTotal,
        complete: setupComplete,
      }}
      recentClients={recentClients}
      clientRecurrence={clientRecurrence}
      monthlyStats={monthlyStats}
      channelPerformance={channelPerformance}
      operationalAlerts={operationalAlerts}
      todaySlotsLegendProps={
        todaySlots.length > 0 ? { slots: todaySlots } : undefined
      }
    />
  );
}
