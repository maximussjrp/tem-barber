import { requireAdmin } from "@/lib/admin-guard";
import prisma from "@/lib/prisma";
import Link from "next/link";
import BookingLinkShare from "@/components/admin/BookingLinkShare";
import DashboardCharts from "@/components/admin/DashboardCharts";
import { nowBR, toBR, startOfDayUTC, endOfDayUTC, formatHeaderDate } from "@/lib/time-utils";
import { buildOnboardingSteps, countCompletedOnboardingSteps } from "@/lib/onboarding";

// ——————————————————————————————————————————————————————————————————————————————

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

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatApptTimeBR(dateTime: Date): string {
  const br = toBR(dateTime);
  return `${String(br.getUTCHours()).padStart(2, "0")}:${String(br.getUTCMinutes()).padStart(2, "0")}`;
}

function formatRelativeTimeBR(dateTime: Date, todayStr: string): string {
  const br = toBR(dateTime);
  const dateStr = br.toISOString().slice(0, 10);
  const hh = String(br.getUTCHours()).padStart(2, "0");
  const mm = String(br.getUTCMinutes()).padStart(2, "0");
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const yesterdayStr = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);
  if (dateStr === todayStr) return `Hoje, ${hh}:${mm}`;
  if (dateStr === yesterdayStr) return `Ontem, ${hh}:${mm}`;
  return br.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });
}

const APPT_STATUS: Record<string, { label: string; dot: string; badge: string }> = {
  PENDING: {
    label: "Aguardando",
    dot: "bg-amber-400",
    badge: "text-amber-400 bg-amber-500/15 border-amber-500/25",
  },
  CONFIRMED: {
    label: "Confirmado",
    dot: "bg-emerald-400",
    badge: "text-emerald-400 bg-emerald-500/15 border-emerald-500/25",
  },
  COMPLETED: {
    label: "Concluído",
    dot: "bg-violet-400",
    badge: "text-violet-400 bg-violet-500/15 border-violet-500/25",
  },
  CANCELLED: {
    label: "Cancelado",
    dot: "bg-red-400",
    badge: "text-red-400 bg-red-500/15 border-red-500/25",
  },
  NO_SHOW: {
    label: "Não compareceu",
    dot: "bg-zinc-500",
    badge: "text-zinc-400 bg-zinc-500/15 border-zinc-500/25",
  },
};

// â”€â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default async function DashboardPage() {
  const { barbershop, barbershopId } = await requireAdmin();
  const { str: todayStr, dayOfWeek, startOfDay, endOfDay } = getTodayBR();
  const weekStart = getWeekStartBR();

  // â”€â”€ Queries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [todayDetailedAppts, servicesCount, workingHoursCount, weeklyAppts, recentApptRows] =
    await Promise.all([
      prisma.appointment.findMany({
        where: { barbershopId: barbershopId!, dateTime: { gte: startOfDay, lte: endOfDay } },
        include: {
          customer: { select: { name: true } },
          services: { include: { service: { select: { name: true } } } },
        },
        orderBy: { dateTime: "asc" },
      }),
      prisma.service.count({ where: { barbershopId: barbershopId!, isActive: true } }),
      prisma.workingHour.count({
        where: { member: { barbershopId: barbershopId!, isActive: true }, isActive: true },
      }),
      prisma.appointment.findMany({
        where: {
          barbershopId: barbershopId!,
          dateTime: { gte: weekStart, lte: endOfDay },
          status: "COMPLETED",
        },
        select: { dateTime: true, totalPrice: true },
      }),
      prisma.appointment.findMany({
        where: { barbershopId: barbershopId! },
        orderBy: { dateTime: "desc" },
        take: 30,
        select: {
          dateTime: true,
          customerId: true,
          customer: { select: { name: true } },
        },
      }),
    ]);

  // â”€â”€ Derived stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const confirmedCount = todayDetailedAppts.filter((a) => a.status === "CONFIRMED").length;
  const cancelledCount = todayDetailedAppts.filter((a) => a.status === "CANCELLED").length;
  const revenue = todayDetailedAppts
    .filter((a) => a.status === "COMPLETED")
    .reduce((s, a) => s + Number(a.totalPrice), 0);
  const totalCount = todayDetailedAppts.length;
  const confirmedPct = totalCount > 0 ? Math.round((confirmedCount / totalCount) * 100) : 0;
  const cancelledPct = totalCount > 0 ? Math.round((cancelledCount / totalCount) * 100) : 0;

  // â”€â”€ Weekly revenue by day â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const DAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const dailyRevByDay: Record<number, number> = {};
  let totalWeekRevenue = 0;
  for (const a of weeklyAppts) {
    const br = new Date(a.dateTime.getTime() - 3 * 3600 * 1000);
    const dow = br.getUTCDay();
    const isoDay = dow === 0 ? 6 : dow - 1;
    dailyRevByDay[isoDay] = (dailyRevByDay[isoDay] ?? 0) + Number(a.totalPrice);
    totalWeekRevenue += Number(a.totalPrice);
  }
  const dailyRevenue = DAY_LABELS.map((label, i) => ({ label, revenue: dailyRevByDay[i] ?? 0 }));

  // â”€â”€ Recent unique clients â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const seenCustomers = new Set<string>();
  const recentClients = recentApptRows
    .filter((a) => {
      if (seenCustomers.has(a.customerId)) return false;
      seenCustomers.add(a.customerId);
      return true;
    })
    .slice(0, 5);

  // â”€â”€ Today's slots per barber â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const SLOT_MIN = 30;

  const activeMembers = await prisma.barbershopMember.findMany({
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
  });

  const bookedAppointments = await prisma.appointment.findMany({
    where: {
      barbershopId: barbershopId!,
      dateTime: { gte: startOfDay, lte: endOfDay },
      status: { in: ["PENDING", "CONFIRMED"] },
    },
    select: { memberId: true, dateTime: true, durationMin: true },
  });

  type SlotInfo = {
    memberName: string;
    working: boolean;
    onTimeOff: boolean;
    startTime: string;
    endTime: string;
    totalSlots: number;
    bookedSlots: number;
    freeSlots: number[];
  };

  const memberSlots: SlotInfo[] = activeMembers.map((m) => {
    const wh = m.workingHours[0];
    const onTimeOff = m.timeOffs.length > 0;

    if (!wh || onTimeOff) {
      return {
        memberName: m.user.name,
        working: false,
        onTimeOff,
        startTime: "",
        endTime: "",
        totalSlots: 0,
        bookedSlots: 0,
        freeSlots: [],
      };
    }

    const start = parseTime(wh.startTime);
    const end = parseTime(wh.endTime);
    const breakStart = wh.breakStart ? parseTime(wh.breakStart) : null;
    const breakEnd = wh.breakEnd ? parseTime(wh.breakEnd) : null;

    const allSlots: number[] = [];
    for (let t = start; t + SLOT_MIN <= end; t += SLOT_MIN) {
      if (breakStart !== null && breakEnd !== null && t >= breakStart && t < breakEnd) continue;
      allSlots.push(t);
    }

    const memberBooked = bookedAppointments.filter((a) => a.memberId === m.id);
    const occupiedMinutes = new Set<number>();
    for (const appt of memberBooked) {
      const apptStart =
        new Date(appt.dateTime).getUTCHours() * 60 + new Date(appt.dateTime).getUTCMinutes();
      for (let t = apptStart; t < apptStart + appt.durationMin; t += SLOT_MIN) {
        occupiedMinutes.add(t);
      }
    }

    const freeSlots = allSlots.filter((t) => !occupiedMinutes.has(t));
    const bookedCount = allSlots.filter((t) => occupiedMinutes.has(t)).length;

    return {
      memberName: m.user.name,
      working: true,
      onTimeOff: false,
      startTime: wh.startTime,
      endTime: wh.endTime,
      totalSlots: allSlots.length,
      bookedSlots: bookedCount,
      freeSlots,
    };
  });

  const workingToday = memberSlots.filter((m) => m.working);

  // â”€â”€ Checklist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const checkItems = [
    {
      label: "Configurar informações da barbearia",
      href: "/admin/configuracoes",
      done: !!(barbershop?.description && barbershop.phone),
    },
    {
      label: "Definir horários de funcionamento",
      href: "/admin/configuracoes/horarios",
      done: workingHoursCount > 0,
    },
    {
      label: "Cadastrar serviços oferecidos",
      href: "/admin/servicos",
      done: servicesCount > 0,
    },
    {
      label: "Convidar equipe",
      href: "/admin/equipe",
      done: activeMembers.length > 1,
    },
  ];
  const onboardingSteps = buildOnboardingSteps({
    barbershop,
    activeServicesCount: servicesCount,
    activeWorkingHoursCount: workingHoursCount,
    schedulableProfessionalsCount: activeMembers.filter((member) => member.services.length > 0).length,
  });
  const onboardingDone = countCompletedOnboardingSteps(onboardingSteps);
  const onboardingTotal = onboardingSteps.length;
  const setupComplete = onboardingDone === onboardingTotal;

  // â”€â”€ Occupancy summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const occupancyData = {
    occupied: memberSlots.reduce((s, m) => s + m.bookedSlots, 0),
    available: memberSlots.reduce((s, m) => s + m.freeSlots.length, 0),
    blocked: 0,
  };

  // â”€â”€ Current time (BRT) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const currentTimeObj = nowBR();
  const currentTimeBR = `${String(currentTimeObj.getUTCHours()).padStart(2, "0")}:${String(currentTimeObj.getUTCMinutes()).padStart(2, "0")}`;

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="p-5 md:p-8 space-y-6 max-w-7xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl font-bold text-[var(--text-primary)]">
            {barbershop?.name}
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1 capitalize">
            {formatHeaderDate(todayStr)}
          </p>
        </div>
        <Link
          href="/admin/agendamentos"
          className="btn-outline-gold flex items-center gap-2 text-xs px-4 py-2.5 min-h-0"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          Ver agenda
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
        {[
          {
            label: "Agendamentos Hoje",
            value: totalCount,
            icon: (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            ),
            sub: "total de agendamentos",
            highlight: false,
          },
          {
            label: "Confirmados",
            value: confirmedCount,
            icon: (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            ),
            sub: `${confirmedPct}% do total`,
            highlight: true,
          },
          {
            label: "Cancelados",
            value: cancelledCount,
            icon: (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            ),
            sub: `${cancelledPct}% do total`,
            highlight: false,
          },
          {
            label: "Faturamento",
            value: formatCurrency(revenue),
            icon: (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
              </svg>
            ),
            sub: "serviços concluídos",
            highlight: true,
          },
        ].map((card) => (
          <div
            key={card.label}
            className={`rounded-2xl p-5 flex flex-col gap-3 border transition-all ${
              card.highlight
                ? "bg-[var(--surface-1)] border-[var(--gold-border)] glow-gold-sm"
                : "bg-[var(--surface-1)] border-[var(--border-subtle)]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                {card.label}
              </span>
              <span
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  card.highlight
                    ? "bg-[var(--gold-surface)] text-[var(--gold)] border border-[var(--gold-border)]"
                    : "bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border-subtle)]"
                }`}
              >
                {card.icon}
              </span>
            </div>
            <p className="font-serif text-2xl md:text-3xl font-bold text-[var(--text-primary)] leading-none">
              {card.value}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* â”€â”€ Left column â”€â”€ */}
        <div className="lg:col-span-3 space-y-5">

          {/* Resumo da agenda de hoje */}
          <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[var(--gold-surface)] border border-[var(--gold-border)] flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </div>
                <h2 className="text-sm font-bold text-[var(--text-primary)]">Resumo da agenda de hoje</h2>
              </div>
              <Link
                href="/admin/agendamentos"
                className="text-xs text-[var(--gold)] hover:text-[var(--gold-light)] transition-colors"
              >
                Ver todos
              </Link>
            </div>

            {todayDetailedAppts.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <svg className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <p className="text-[var(--text-muted)] text-sm">Nenhum agendamento para hoje</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {todayDetailedAppts.slice(0, 7).map((appt) => {
                  const st = APPT_STATUS[appt.status] ?? APPT_STATUS.PENDING;
                  return (
                    <div key={appt.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="text-xs tabular-nums font-mono text-[var(--text-muted)] w-10 shrink-0">
                        {formatApptTimeBR(appt.dateTime)}
                      </span>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                      <span className="text-sm font-medium text-[var(--text-primary)] flex-1 min-w-0 truncate">
                        {appt.customer.name}
                      </span>
                      <span className="text-xs text-[var(--text-muted)] truncate flex-1 min-w-0 hidden sm:block">
                        {appt.services.map((s) => s.service.name).join(" + ")}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full border font-medium shrink-0 ${st.badge}`}
                      >
                        {st.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between px-5 py-3 bg-[var(--surface-2)] border-t border-[var(--border-subtle)]">
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>Última atualização: {currentTimeBR}</span>
              </div>
              <span className="text-xs text-[var(--text-muted)]">{totalCount} agendamentos hoje</span>
            </div>
          </div>

          {/* Disponibilidade hoje */}
          <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-6 h-6 rounded-lg bg-[var(--gold-surface)] border border-[var(--gold-border)] flex items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <h2 className="text-sm font-bold text-[var(--text-primary)]">Disponibilidade hoje</h2>
            </div>

            {activeMembers.length === 0 ? (
              <p className="text-[var(--text-muted)] text-sm">
                Nenhum barbeiro ativo.{" "}
                <Link href="/admin/equipe" className="text-[var(--gold)] hover:text-[var(--gold-light)]">
                  Adicione um membro
                </Link>.
              </p>
            ) : workingToday.length === 0 ? (
              <p className="text-[var(--text-muted)] text-sm">Nenhum barbeiro trabalha hoje.</p>
            ) : (
              <div className="space-y-6 divide-y divide-[var(--border-subtle)]">
                {workingToday.map((m) => {
                  const occupancyPct =
                    m.totalSlots > 0 ? Math.round((m.bookedSlots / m.totalSlots) * 100) : 0;
                  return (
                    <div key={m.memberName} className="pt-5 first:pt-0">
                      {/* Member header */}
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[var(--gold-surface)] border border-[var(--gold-border)] flex items-center justify-center font-serif font-bold text-sm text-[var(--gold)] shrink-0">
                            {m.memberName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{m.memberName}</p>
                            <p className="text-xs text-[var(--text-muted)]">{m.startTime} - {m.endTime}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--surface-3)] border border-[var(--border-medium)]" />Disponível</span>
                          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--gold)]" />Ocupado</span>
                          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />Bloqueado</span>
                        </div>
                      </div>

                      {/* Slot grid */}
                      <div className="flex flex-wrap gap-1.5">
                        {(() => {
                          const allTimes: number[] = [];
                          const freeSet = new Set(m.freeSlots);
                          const start = parseTime(m.startTime);
                          const end = parseTime(m.endTime);
                          for (let t = start; t + SLOT_MIN <= end; t += SLOT_MIN) allTimes.push(t);
                          return allTimes.map((t) => {
                            const isFree = freeSet.has(t);
                            return (
                              <span
                                key={t}
                                className={`text-[10px] tabular-nums px-2 py-1 rounded-lg font-semibold border transition-colors ${
                                  isFree
                                    ? "bg-[var(--surface-2)] text-[var(--text-secondary)] border-[var(--border-subtle)]"
                                    : "bg-[var(--gold-surface)] text-[var(--gold)] border-[var(--gold-border)]"
                                }`}
                              >
                                {formatTime(t)}
                              </span>
                            );
                          });
                        })()}
                      </div>

                      {/* Progress bar */}
                      <div className="mt-3 h-1 bg-[var(--surface-3)] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--gold)] rounded-full transition-all"
                          style={{ width: `${occupancyPct}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-[var(--text-muted)]">{m.freeSlots.length} livre{m.freeSlots.length !== 1 ? "s" : ""}</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{occupancyPct}% ocupado</span>
                      </div>
                    </div>
                  );
                })}

                {memberSlots
                  .filter((m) => !m.working)
                  .map((m) => (
                    <div key={m.memberName} className="pt-4 flex items-center gap-3 opacity-40">
                      <div className="w-9 h-9 rounded-full bg-[var(--surface-2)] flex items-center justify-center text-xs font-bold text-[var(--text-muted)] shrink-0">
                        {m.memberName.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm text-[var(--text-muted)]">{m.memberName}</span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {m.onTimeOff ? "· folga" : "· não trabalha hoje"}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* â”€â”€ Right column â”€â”€ */}
        <div className="lg:col-span-2 space-y-5">

          {/* Visão rápida do negócio */}
          <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[var(--gold-surface)] border border-[var(--gold-border)] flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                  </svg>
                </div>
                <h2 className="text-sm font-bold text-[var(--text-primary)]">Visão rápida do negócio</h2>
              </div>
              <span className="text-[11px] text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1">
                Esta semana
              </span>
            </div>
            <DashboardCharts
              dailyRevenue={dailyRevenue}
              weekRevenue={totalWeekRevenue}
              occupancy={occupancyData}
            />
          </div>

          {/* Link de agendamento */}
          <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-2xl p-5">
            <BookingLinkShare slug={barbershop?.slug ?? ""} />
          </div>

          {/* Configuracao da barbearia */}
          <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-2xl p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-sm font-bold text-[var(--text-primary)]">Configuracao da barbearia</h2>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {setupComplete
                    ? "Sua barbearia esta pronta para operar."
                    : `${onboardingDone} de ${onboardingTotal} etapas concluidas`}
                </p>
              </div>
              <span className={`text-[11px] px-2 py-1 rounded-full border font-semibold shrink-0 ${
                setupComplete
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                  : "border-[var(--gold-border)] bg-[var(--gold-surface)] text-[var(--gold)]"
              }`}>
                {setupComplete ? "Pronta" : "Em andamento"}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden mb-4">
              <div
                className="h-full rounded-full bg-[var(--gold)]"
                style={{ width: `${Math.round((onboardingDone / onboardingTotal) * 100)}%` }}
              />
            </div>
            <Link href="/admin/onboarding" className="btn-outline-gold w-full justify-center px-4 py-2 text-sm">
              {setupComplete ? "Revisar configuracao" : "Continuar configuracao"}
            </Link>
          </div>

          {/* Clientes recentes */}
          <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[var(--surface-2)] border border-[var(--border-subtle)] flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
                  </svg>
                </div>
                <h2 className="text-sm font-bold text-[var(--text-primary)]">Clientes recentes</h2>
              </div>
              <Link
                href="/admin/clientes"
                className="text-xs text-[var(--gold)] hover:text-[var(--gold-light)] transition-colors"
              >
                Ver todos
              </Link>
            </div>

            {recentClients.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] py-3">Nenhum cliente ainda.</p>
            ) : (
              <div className="space-y-3">
                {recentClients.map((c) => {
                  const initials = c.customer.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  return (
                    <div key={c.customerId} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[var(--gold-surface)] border border-[var(--gold-border)] flex items-center justify-center text-xs font-bold text-[var(--gold)] font-serif shrink-0">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {c.customer.name}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {formatRelativeTimeBR(c.dateTime, todayStr)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
