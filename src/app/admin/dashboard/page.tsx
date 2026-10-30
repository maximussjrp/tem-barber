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
import { PremiumDashboardView } from "@/components/admin/dashboard/PremiumDashboardView";
import { DueAccountSummary, DueAccountItem } from "@/components/admin/dashboard/FinancialDueCard";
import { DashboardAppointmentItem } from "@/components/admin/dashboard/TodayScheduleCard";
import { ProfessionalSlotInfo } from "@/components/admin/dashboard/ProfessionalPerformanceCard";

function getTodayBR() {
  const br = nowBR();
  const str = br.toISOString().slice(0, 10);
  const [y, m, d] = str.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const startOfDay = startOfDayUTC(y, m, d);
  const endOfDay = endOfDayUTC(y, m, d);
  return { str, dayOfWeek, startOfDay, endOfDay };
}

function getWeekStartBR() {
  const br = nowBR();
  const str = br.toISOString().slice(0, 10);
  const [y, m, d] = str.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const daysToMon = (dow + 6) % 7;
  return new Date(Date.UTC(y, m - 1, d - daysToMon, 0, 0, 0));
}

function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
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

export default async function DashboardPage() {
  const { barbershop, barbershopId, isPlatform, role } =
    await requireManagerialAdmin();

  if (!barbershopId) {
    return redirect(isPlatform ? "/admin/platform" : "/acesso-negado");
  }

  const canAccessFinancial =
    role === "OWNER" || role === "MANAGER" || role === "SUPER_ADMIN" || isPlatform;

  const { str: todayStr, dayOfWeek, startOfDay, endOfDay } = getTodayBR();
  const weekStart = getWeekStartBR();
  const civilToday = todayIsoBR();

  // Queries base em paralelo
  const [
    todayDetailedAppts,
    servicesCount,
    workingHoursCount,
    weeklyAppts,
    recentApptRows,
    activeMembers,
    bookedAppointments,
    payableTitles,
  ] = await Promise.all([
    // 1. Agendamentos de hoje
    prisma.appointment.findMany({
      where: {
        barbershopId: barbershopId!,
        dateTime: { gte: startOfDay, lte: endOfDay },
      },
      include: {
        customer: { select: { name: true } },
        services: { include: { service: { select: { name: true } } } },
        comandas: {
          select: {
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

    // 4. Agendamentos da semana para receita semanal
    prisma.appointment.findMany({
      where: {
        barbershopId: barbershopId!,
        dateTime: { gte: weekStart, lte: endOfDay },
        status: "COMPLETED",
      },
      select: {
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

    // 5. Últimos agendamentos para clientes recentes
    prisma.appointment.findMany({
      where: { barbershopId: barbershopId! },
      orderBy: { dateTime: "desc" },
      take: 20,
      select: {
        customerId: true,
        dateTime: true,
        customer: { select: { name: true } },
      },
    }),

    // 6. Colaboradores ativos e jornadas de hoje
    prisma.barbershopMember.findMany({
      where: { barbershopId: barbershopId!, isActive: true },
      include: {
        user: { select: { name: true } },
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

    // 7. Agendamentos ocupando slots hoje
    prisma.appointment.findMany({
      where: {
        barbershopId: barbershopId!,
        dateTime: { gte: startOfDay, lte: endOfDay },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      select: { memberId: true, dateTime: true, durationMin: true },
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
  ]);

  // ─── Métricas do Faturamento de Hoje ───
  const revenueToday = todayDetailedAppts
    .filter((a) => a.status === "COMPLETED")
    .reduce((s, a) => s + getAppointmentNetRevenue(a), 0);

  // Clientes atendidos hoje (COMPLETED)
  const clientesAtendidosHoje = todayDetailedAppts.filter(
    (a) => a.status === "COMPLETED"
  ).length;

  // ─── Receita semanal por dia ───
  const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const dailyRevByDay: Record<number, number> = {};
  let totalWeekRevenue = 0;
  for (const a of weeklyAppts) {
    const br = new Date(a.dateTime.getTime() - 3 * 3600 * 1000);
    const dow = br.getUTCDay();
    const isoDay = dow === 0 ? 6 : dow - 1;
    const netRev = getAppointmentNetRevenue(a);
    dailyRevByDay[isoDay] = (dailyRevByDay[isoDay] ?? 0) + netRev;
    totalWeekRevenue += netRev;
  }
  const dailyRevenue = DAY_LABELS.map((label, i) => ({
    label,
    revenue: dailyRevByDay[i] ?? 0,
  }));

  // ─── Cálculo de Slots e Ocupação dos Profissionais ───
  const SLOT_MIN = 30;
  const legacyLegendSlots: {
    time: string;
    status: "available" | "occupied" | "blocked";
  }[] = [];

  const professionalSlots: ProfessionalSlotInfo[] = activeMembers.map((m) => {
    const wh = m.workingHours[0];
    const onTimeOff = m.timeOffs.some((to) => to.allDay);

    if (!wh || onTimeOff) {
      return {
        memberName: m.user?.name ?? "Colaborador",
        working: false,
        onTimeOff,
        startTime: wh?.startTime ?? "--:--",
        endTime: wh?.endTime ?? "--:--",
        totalSlots: 0,
        bookedSlots: 0,
        blockedSlots: [],
        freeSlots: [],
      };
    }

    const start = parseTime(wh.startTime);
    const end = parseTime(wh.endTime);
    const breakStart = wh.breakStart ? parseTime(wh.breakStart) : null;
    const breakEnd = wh.breakEnd ? parseTime(wh.breakEnd) : null;

    const allSlots: number[] = [];
    for (let t = start; t + SLOT_MIN <= end; t += SLOT_MIN) {
      if (
        breakStart !== null &&
        breakEnd !== null &&
        t >= breakStart &&
        t < breakEnd
      )
        continue;
      allSlots.push(t);
    }

    const memberBooked = bookedAppointments.filter((a) => a.memberId === m.id);
    const occupiedMinutes = new Set<number>();
    for (const appt of memberBooked) {
      const apptStart =
        new Date(appt.dateTime).getUTCHours() * 60 +
        new Date(appt.dateTime).getUTCMinutes();
      for (let t = apptStart; t < apptStart + appt.durationMin; t += SLOT_MIN) {
        occupiedMinutes.add(t);
      }
    }

    const [y, mMonth, d] = todayStr.split("-").map(Number);
    const blockedSlots: number[] = [];
    const partialTimeOffs = m.timeOffs.filter((to) => !to.allDay);
    for (const t of allSlots) {
      const slotStart = new Date(
        Date.UTC(y, mMonth - 1, d, Math.floor(t / 60), t % 60)
      );
      const slotEnd = new Date(
        Date.UTC(y, mMonth - 1, d, Math.floor((t + SLOT_MIN) / 60), (t + SLOT_MIN) % 60)
      );
      const isOverlapping = partialTimeOffs.some((to) => {
        const toStart = new Date(to.startDate);
        const toEnd = new Date(to.endDate);
        return toStart < slotEnd && toEnd > slotStart;
      });
      if (isOverlapping) {
        blockedSlots.push(t);
      }
    }

    const freeSlots = allSlots.filter(
      (t) => !occupiedMinutes.has(t) && !blockedSlots.includes(t)
    );

    // Populate legacy legend chips for test compatibility
    for (const t of allSlots) {
      const hh = String(Math.floor(t / 60)).padStart(2, "0");
      const mm = String(t % 60).padStart(2, "0");
      const timeStr = `${hh}:${mm}`;
      let status: "available" | "occupied" | "blocked" = "available";
      if (occupiedMinutes.has(t)) status = "occupied";
      else if (blockedSlots.includes(t)) status = "blocked";
      if (!legacyLegendSlots.some((s) => s.time === timeStr)) {
        legacyLegendSlots.push({ time: timeStr, status });
      }
    }

    return {
      memberName: m.user?.name ?? "Colaborador",
      working: true,
      onTimeOff: false,
      startTime: wh.startTime,
      endTime: wh.endTime,
      totalSlots: allSlots.length,
      bookedSlots: occupiedMinutes.size,
      blockedSlots,
      freeSlots,
    };
  });

  const totalOccupiedSlots = professionalSlots.reduce(
    (sum, m) => sum + m.bookedSlots,
    0
  );
  const totalFreeSlots = professionalSlots.reduce(
    (sum, m) => sum + m.freeSlots.length,
    0
  );
  const totalBlockedSlots = professionalSlots.reduce(
    (sum, m) => sum + m.blockedSlots.length,
    0
  );
  const totalPossibleSlots = totalOccupiedSlots + totalFreeSlots;
  const taxaOcupacaoPct =
    totalPossibleSlots > 0
      ? Math.round((totalOccupiedSlots / totalPossibleSlots) * 100)
      : 0;

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
      (sum: number, s: { principalAmount: unknown; reversals?: Array<{ id: string }> }) => {
        // Excluir se houver reversões ativas
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

  // Ordenar itens pendentes: atrasados primeiro, seguidos pelo vencimento mais próximo
  pendingDueItems.sort((a, b) => {
    if (a.derivedStatus === "OVERDUE" && b.derivedStatus !== "OVERDUE") return -1;
    if (b.derivedStatus === "OVERDUE" && a.derivedStatus !== "OVERDUE") return 1;
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
  const dashboardAppointments: DashboardAppointmentItem[] = todayDetailedAppts.map(
    (appt) => ({
      id: appt.id,
      customerName: appt.customer.name,
      timeFormatted: formatApptTimeBR(appt.dateTime),
      servicesFormatted:
        appt.services.map((s) => s.service.name).join(" + ") || "Serviço",
      status: appt.status,
    })
  );

  // ─── Recent Unique Clients ───
  const seenCustomers = new Set<string>();
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

  return (
    <PremiumDashboardView
      barbershop={barbershop}
      todayFormatted={formatHeaderDate(todayStr)}
      faturamentoHoje={revenueToday}
      faturamentoSemana={totalWeekRevenue}
      taxaOcupacaoPct={taxaOcupacaoPct}
      horariosOcupados={totalOccupiedSlots}
      horariosDisponiveis={totalFreeSlots}
      clientesAtendidosHoje={clientesAtendidosHoje}
      todayAppointments={dashboardAppointments}
      professionals={professionalSlots}
      financialSummary={financialSummary}
      dueItems={pendingDueItems}
      canAccessFinancial={canAccessFinancial}
      dailyRevenue={dailyRevenue}
      occupancyData={occupancyData}
      onboarding={{
        done: onboardingDone,
        total: onboardingTotal,
        complete: setupComplete,
      }}
      recentClients={recentClients}
      todaySlotsLegendProps={
        legacyLegendSlots.length > 0
          ? { slots: legacyLegendSlots }
          : undefined
      }
    />
  );
}
