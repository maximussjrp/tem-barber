"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  MetricCard,
  DashboardCard,
  SectionHeader,
  MiniSparklineSvg,
  MiniBarsSvg,
} from "./DashboardPrimitives";
import {
  FinancialDueCard,
  DueAccountSummary,
  DueAccountItem,
} from "./FinancialDueCard";
import {
  TodayScheduleCard,
  DashboardAppointmentItem,
} from "./TodayScheduleCard";
import {
  ProfessionalPerformanceCard,
  ProfessionalSlotInfo,
} from "./ProfessionalPerformanceCard";
import DashboardCharts from "@/components/admin/DashboardCharts";
import BookingLinkShare from "@/components/admin/BookingLinkShare";

export interface ClientRecurrenceStats {
  recurringPct: number;
  newPct: number;
  inactivePct: number;
  totalCustomers?: number;
  hasData?: boolean;
  periodLabel?: string;
}

export interface MonthlyGoalStats {
  revenue: number;
  targetRevenue?: number;
  completedServices: number;
  targetServices?: number;
  newClients: number;
  targetNewClients?: number;
  averageTicket: number;
  averageTicketTrend?: string;
}

export interface ChannelPerformanceStats {
  available?: boolean;
  unavailableReason?: string;
  total: number;
  channels: {
    name: string;
    pct: number;
    count: number;
    color: string;
  }[];
}

export interface OperationalAlertItem {
  id: string;
  title: string;
  subtitle: string;
  badgeText?: string;
  badgeTone?: "red" | "gold" | "neutral";
  iconType?: "stock" | "maintenance" | "team" | "review";
}

export interface PremiumDashboardProps {
  barbershop: {
    id: string;
    name: string;
    slug: string;
    city?: string | null;
    state?: string | null;
    logoUrl?: string | null;
  } | null;
  userName?: string;
  todayFormatted: string;
  civilToday?: string;
  faturamentoHoje: number;
  faturamentoHojeTrend?: string;
  faturamentoSemana: number;
  faturamentoSemanaTrend?: string;
  faturamentoGraficoTotal?: number;
  faturamentoGraficoTrend?: string;
  peakDateLabel?: string;
  taxaOcupacaoPct: number;
  horariosOcupados: number;
  horariosDisponiveis: number;
  clientesAtendidosHoje: number;
  clientesAtendidosTrend?: string;
  agendamentosHojeCount?: number;
  agendamentosHojeTrend?: string;
  mobileClientsCount?: number;
  mobileDueSummary?: {
    count: number;
    amountCents: number;
  };
  mobileAppointments?: DashboardAppointmentItem[];
  mobileDueItems?: DueAccountItem[];
  todayAppointments: DashboardAppointmentItem[];
  professionals: ProfessionalSlotInfo[];
  financialSummary: DueAccountSummary;
  dueItems: DueAccountItem[];
  canAccessFinancial: boolean;
  dailyRevenue: { label: string; revenue: number; dateLabel?: string }[];
  revenueSeries?: number[];
  weeklyRevenueSeries?: number[];
  completedClientsSeries?: number[];
  appointmentsSeries?: number[];
  occupancyData: { occupied: number; available: number; blocked: number };
  onboarding: {
    done: number;
    total: number;
    complete: boolean;
  };
  recentClients: {
    id: string;
    name: string;
    initials: string;
    relativeTime: string;
  }[];
  clientRecurrence?: ClientRecurrenceStats;
  monthlyStats?: MonthlyGoalStats;
  channelPerformance?: ChannelPerformanceStats;
  operationalAlerts?: OperationalAlertItem[];
  // Compatibility elements for existing tests
  todaySlotsLegendProps?: {
    slots: { time: string; status: "available" | "occupied" | "blocked" }[];
  };
}

function formatBRL(val: number): string {
  return val.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatCentsBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function MobileRevenueLineChart({
  dailyRevenue,
  totalRevenue,
  trendText,
  peakDateLabel,
}: {
  dailyRevenue: { label: string; revenue: number; dateLabel?: string }[];
  totalRevenue: number;
  trendText?: string;
  peakDateLabel?: string;
}) {
  const W = 340;
  const H = 122;
  const padL = 42;
  const padR = 14;
  const padT = 30;
  const padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const rawMax = Math.max(...dailyRevenue.map((d) => d.revenue), 0);
  const yMax = rawMax > 0 ? Math.ceil(rawMax / 300) * 300 : 600;
  const ticks = [yMax, Math.round(yMax / 2), 0];

  const pts = dailyRevenue.map((d, idx) => {
    const x = padL + (idx / Math.max(dailyRevenue.length - 1, 1)) * plotW;
    const ratio = yMax > 0 ? Math.min(1, Math.max(0, d.revenue / yMax)) : 0;
    const y = padT + plotH - ratio * plotH;
    return { x, y, d, idx };
  });

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath =
    pts.length > 1
      ? `M${pts[0].x},${padT + plotH} ` +
        pts.map((p) => `L${p.x},${p.y}`).join(" ") +
        ` L${pts[pts.length - 1].x},${padT + plotH} Z`
      : "";

  let peakIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].d.revenue >= pts[peakIdx].d.revenue) peakIdx = i;
  }
  const peakPt = pts[peakIdx];
  const resolvedPeakLabel =
    peakDateLabel || peakPt?.d.dateLabel || (peakPt ? `Pico · ${peakPt.d.label}` : "");
  const isPositiveTrend = !trendText?.startsWith("-");

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <p className="text-2xl font-extrabold text-white tracking-tight tabular-nums leading-tight">
            {formatBRL(totalRevenue)}
          </p>
          <div className="flex items-center gap-1 text-[11px] mt-0.5">
            {trendText ? (
              <>
                <span
                  className={`font-bold ${
                    isPositiveTrend ? "text-[#16C784]" : "text-[#EF5A67]"
                  }`}
                >
                  {isPositiveTrend ? "▲" : "▼"} {trendText}
                </span>
                <span className="text-[#8E95A2]">vs. semana anterior</span>
              </>
            ) : (
              <span className="text-[#8E95A2]">
                Acumulado nos últimos 7 dias
              </span>
            )}
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="mobRevGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E8C76E" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#E8C76E" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {ticks.map((tVal, i) => {
          const ratio = yMax > 0 ? tVal / yMax : 0;
          const y = padT + plotH - ratio * plotH;
          return (
            <g key={i}>
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-[#7E8594] text-[9px] tabular-nums"
              >
                R$ {tVal}
              </text>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="3 3"
              />
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill="url(#mobRevGrad)" />}
        <polyline
          points={polyline}
          fill="none"
          stroke="#E8C76E"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {pts.map((p) => {
          const isPeak = p.idx === peakIdx && rawMax > 0;
          return (
            <g key={p.idx}>
              {isPeak && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="6"
                  fill="rgba(232,199,110,0.25)"
                />
              )}
              <circle
                cx={p.x}
                cy={p.y}
                r={isPeak ? "3.5" : "2.5"}
                fill={isPeak ? "#FFF6D6" : "#E8C76E"}
              />
            </g>
          );
        })}

        {peakPt && rawMax > 0 && (
          <g
            transform={`translate(${Math.min(
              Math.max(peakPt.x - 42, padL),
              W - 88
            )}, ${Math.max(peakPt.y - 34, 0)})`}
          >
            <rect
              x="0"
              y="0"
              width="84"
              height="27"
              rx="6"
              fill="#1E2128"
              stroke="rgba(232,199,110,0.45)"
              strokeWidth="1"
            />
            <text
              x="42"
              y="11"
              textAnchor="middle"
              className="fill-[#A6ADB9] text-[8.5px]"
            >
              {resolvedPeakLabel}
            </text>
            <text
              x="42"
              y="22"
              textAnchor="middle"
              className="fill-white text-[9.5px] font-bold"
            >
              {formatBRL(peakPt.d.revenue)}
            </text>
          </g>
        )}

        {pts.map((p) => (
          <text
            key={`mx-${p.idx}`}
            x={p.x}
            y={H - 4}
            textAnchor="middle"
            className={`text-[9.5px] ${
              p.idx === peakIdx
                ? "fill-[#E8C76E] font-bold"
                : "fill-[#8E95A2]"
            }`}
          >
            {p.d.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

export function PremiumDashboardView({
  barbershop,
  userName = "Max",
  todayFormatted,
  civilToday,
  faturamentoHoje,
  faturamentoHojeTrend,
  faturamentoSemana,
  faturamentoSemanaTrend,
  faturamentoGraficoTotal,
  faturamentoGraficoTrend,
  peakDateLabel,
  taxaOcupacaoPct,
  horariosOcupados,
  horariosDisponiveis,
  clientesAtendidosHoje,
  clientesAtendidosTrend,
  agendamentosHojeCount,
  agendamentosHojeTrend,
  mobileClientsCount,
  mobileDueSummary,
  mobileAppointments,
  mobileDueItems,
  todayAppointments,
  professionals,
  financialSummary,
  dueItems,
  canAccessFinancial,
  dailyRevenue,
  revenueSeries,
  weeklyRevenueSeries,
  completedClientsSeries,
  appointmentsSeries,
  occupancyData,
  onboarding,
  recentClients,
  clientRecurrence,
  monthlyStats,
  channelPerformance,
  operationalAlerts,
  todaySlotsLegendProps,
}: PremiumDashboardProps) {
  void recentClients;
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredTodayAppointments = useMemo(() => {
    if (!normalizedQuery) return todayAppointments;
    return todayAppointments.filter(
      (a) =>
        a.customerName.toLowerCase().includes(normalizedQuery) ||
        a.servicesFormatted.toLowerCase().includes(normalizedQuery) ||
        a.timeFormatted.toLowerCase().includes(normalizedQuery)
    );
  }, [todayAppointments, normalizedQuery]);

  const filteredProfessionals = useMemo(() => {
    if (!normalizedQuery) return professionals;
    return professionals.filter((p) =>
      p.memberName.toLowerCase().includes(normalizedQuery)
    );
  }, [professionals, normalizedQuery]);

  const filteredDueItems = useMemo(() => {
    if (!normalizedQuery) return dueItems;
    return dueItems.filter(
      (item) =>
        item.title.toLowerCase().includes(normalizedQuery) ||
        item.categoryName.toLowerCase().includes(normalizedQuery)
    );
  }, [dueItems, normalizedQuery]);

  const barbershopName = barbershop?.name ?? "Tem Barber";
  const initials = barbershopName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  const capitalizedDate =
    todayFormatted.charAt(0).toUpperCase() + todayFormatted.slice(1);

  const cityDisplay = barbershop?.city
    ? `${barbershop.city}${barbershop.state ? ` - ${barbershop.state}` : " - SP"}`
    : "São José do Rio Preto - SP";

  const chartTotal =
    typeof faturamentoGraficoTotal === "number"
      ? faturamentoGraficoTotal
      : faturamentoSemana;

  const effectiveChartTrend = faturamentoGraficoTrend ?? faturamentoSemanaTrend;

  const derivedDailyRevenueSeries = useMemo(
    () => dailyRevenue.map((d) => d.revenue),
    [dailyRevenue]
  );
  const effectiveRevenueSeries = revenueSeries ?? derivedDailyRevenueSeries;
  const effectiveWeeklyRevenueSeries =
    weeklyRevenueSeries ?? derivedDailyRevenueSeries;
  const effectiveCompletedClientsSeries = completedClientsSeries;
  const effectiveAppointmentsSeries = appointmentsSeries;

  // Real notification alert computation (no hardcoded red dot when 0 alerts)
  const financialAlertCount = canAccessFinancial
    ? financialSummary.overdueCount + financialSummary.todayCount
    : 0;
  const pendingApptsCount = todayAppointments.filter(
    (a) => a.status === "PENDING"
  ).length;
  const hasActiveAlerts = financialAlertCount > 0 || pendingApptsCount > 0;
  const bellHref =
    canAccessFinancial && financialAlertCount > 0
      ? "/admin/financeiro/contas?kind=PAYABLE"
      : "/admin/agendamentos";
  const bellAriaLabel =
    financialAlertCount > 0
      ? `${financialAlertCount} conta(s) vencida(s) ou vencendo hoje`
      : pendingApptsCount > 0
      ? `${pendingApptsCount} agendamento(s) aguardando confirmação`
      : "Sem alertas pendentes — abrir agenda";

  // Recurrence defaults from real props (never invent 68% / 24% / 8%)
  const recurrence: ClientRecurrenceStats = clientRecurrence ?? {
    recurringPct: 0,
    newPct: 0,
    inactivePct: 0,
    totalCustomers: 0,
    hasData: false,
  };
  const hasRecurrenceData =
    recurrence.hasData !== undefined
      ? recurrence.hasData
      : recurrence.recurringPct + recurrence.newPct + recurrence.inactivePct > 0;

  // Monthly stats defaults from real props (never mix weekly revenue or invent 70% goal)
  const monthData: MonthlyGoalStats = monthlyStats ?? {
    revenue: 0,
    completedServices: 0,
    newClients: 0,
    averageTicket: 0,
  };

  const hasConfiguredGoal = Boolean(
    monthData.targetRevenue && monthData.targetRevenue > 0
  );
  const monthGoalPct = hasConfiguredGoal
    ? Math.min(
        100,
        Math.round((monthData.revenue / monthData.targetRevenue!) * 100)
      )
    : 0;

  // Channel performance defaults from real props (never invent 52/28/15/5 or fake 100%)
  const isChannelTrackingAvailable =
    channelPerformance?.available !== undefined
      ? channelPerformance.available
      : Boolean(
          channelPerformance &&
            channelPerformance.channels.some((ch) => ch.count > 0)
        );

  const channelsData: ChannelPerformanceStats = channelPerformance ?? {
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

  // Operational alerts
  const alertsList: OperationalAlertItem[] =
    operationalAlerts && operationalAlerts.length > 0
      ? operationalAlerts
      : [
          {
            id: "a1",
            title: onboarding.complete
              ? "Estoque monitorado"
              : "Concluir cadastro inicial",
            subtitle: onboarding.complete
              ? "Produtos ativos em dia"
              : `${onboarding.done} de ${onboarding.total} etapas concluídas`,
            iconType: "stock",
          },
          {
            id: "a2",
            title:
              financialSummary.overdueCount > 0
                ? "Títulos em atraso"
                : "Contas em dia",
            subtitle:
              financialSummary.overdueCount > 0
                ? `${financialSummary.overdueCount} obrigação pendente`
                : "Sem pendências vencidas",
            badgeText: financialSummary.overdueCount > 0 ? "Hoje" : undefined,
            badgeTone: "red",
            iconType: "maintenance",
          },
          {
            id: "a3",
            title: "Escala da equipe",
            subtitle: `${
              professionals.filter((p) => p.working).length
            } profissionais ativos hoje`,
            iconType: "team",
          },
          {
            id: "a4",
            title: "Agenda do dia",
            subtitle: `${todayAppointments.length} atendimentos programados`,
            iconType: "review",
          },
        ];

  // Mobile KPI values
  const mobApptsCount =
    typeof agendamentosHojeCount === "number"
      ? agendamentosHojeCount
      : todayAppointments.length;
  const mobClientsAttended =
    typeof mobileClientsCount === "number"
      ? mobileClientsCount
      : clientesAtendidosHoje;
  const mobDueCount =
    mobileDueSummary?.count ??
    financialSummary.overdueCount +
      financialSummary.todayCount +
      financialSummary.next7DaysCount;
  const mobDueCents =
    mobileDueSummary?.amountCents ??
    financialSummary.overdueAmountCents +
      financialSummary.todayAmountCents +
      financialSummary.next7DaysAmountCents;

  // SVG Donut calculation for Clientes Recentes
  const recR = 38;
  const recC = 2 * Math.PI * recR;
  const recArc = hasRecurrenceData ? (recurrence.recurringPct / 100) * recC : 0;
  const newArc = hasRecurrenceData ? (recurrence.newPct / 100) * recC : 0;

  // SVG Donut calculation for Performance por Canal
  const chR = 36;
  const chC = 2 * Math.PI * chR;
  const channelSegments = isChannelTrackingAvailable
    ? channelsData.channels.reduce<
        { name: string; color: string; len: number; offset: number }[]
      >((acc, ch) => {
        const prevEnd =
          acc.length > 0
            ? acc[acc.length - 1].offset + acc[acc.length - 1].len
            : 0;
        const len = (ch.pct / 100) * chC;
        acc.push({ name: ch.name, color: ch.color, len, offset: prevEnd });
        return acc;
      }, [])
    : [];

  return (
    <div className="w-full max-w-[1440px] mx-auto">
      {/* ═══════════════════════════════════════════════════════════════════
          MOBILE DEDICATED COMPOSITION (< 1024px)
          Matches approved mobile reference & guarantees 320px full readability
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="lg:hidden -mt-[57px] px-3.5 pt-4 pb-6 space-y-3.5">
        {/* Mobile Top Header */}
        <div className="pb-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-[#252015] to-[#15171C] border border-[#D3AE55]/45 flex items-center justify-center font-serif font-bold text-[#E8C76E] text-sm sm:text-base shrink-0 shadow-[0_0_16px_rgba(211,174,85,0.16)]">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="font-serif text-[15px] sm:text-lg font-bold text-white tracking-wide line-clamp-2 leading-snug">
                  {barbershopName}
                </p>
                <div className="flex items-center gap-1 text-xs text-[#A6ADB9] mt-0.5">
                  <span className="truncate">
                    {barbershop?.city || "São José do Rio Preto"}
                  </span>
                  <svg
                    className="w-3 h-3 text-[#E8C76E] shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <Link
                href={bellHref}
                aria-label={bellAriaLabel}
                className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-[#181B22] border border-white/[0.09] flex items-center justify-center text-zinc-200"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                >
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {hasActiveAlerts && (
                  <span
                    data-testid="mobile-bell-alert-dot"
                    className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-[#EF5A67]"
                  />
                )}
              </Link>

              <Link
                href="/admin/configuracoes"
                aria-label="Perfil e configurações"
                className="h-9 sm:h-10 px-2 rounded-full bg-[#181B22] border border-[#D3AE55]/40 flex items-center gap-1 text-[#E8C76E] font-serif font-bold text-xs"
              >
                <span className="w-6 h-6 rounded-full bg-[#242016] flex items-center justify-center">
                  {userName.charAt(0).toUpperCase()}
                </span>
                <svg
                  className="w-3 h-3 text-zinc-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-1.5 mt-2 text-xs text-[#9CA3AF]">
            <span>{capitalizedDate}</span>
            <span aria-hidden="true">☀️</span>
          </div>
        </div>

        {/* Mobile 2x2 KPI Grid — full-width titles & values inside each card so 320px never truncates */}
        <div className="grid grid-cols-2 gap-2.5">
          {/* Card 1: FATURAMENTO HOJE */}
          <DashboardCard
            variant="highlight"
            className="p-3 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-1.5">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#2C2416] to-[#1A1712] border border-[#D3AE55]/40 text-[#E8C76E] flex items-center justify-center shrink-0">
                  <span className="font-bold text-xs">$</span>
                </div>
                <MiniSparklineSvg
                  series={effectiveRevenueSeries}
                  className="w-12 h-5 shrink-0"
                />
              </div>
              <span className="mt-2 block text-[10px] font-bold uppercase tracking-tight text-[#B4BAC6] leading-tight">
                Faturamento hoje
              </span>
              <p className="text-[16px] sm:text-[17px] font-extrabold text-white tabular-nums leading-tight mt-0.5">
                {formatBRL(faturamentoHoje)}
              </p>
            </div>
            <div className="mt-1.5">
              {faturamentoHojeTrend ? (
                <span className="text-[10px] text-[#8E95A2] block">
                  <strong
                    className={
                      faturamentoHojeTrend.startsWith("-")
                        ? "text-[#EF5A67]"
                        : "text-[#16C784]"
                    }
                  >
                    {faturamentoHojeTrend.startsWith("-") ? "▼" : "▲"}{" "}
                    {faturamentoHojeTrend}
                  </strong>{" "}
                  vs. ontem
                </span>
              ) : (
                <span className="text-[10px] text-[#8E95A2] block">
                  Realizado hoje
                </span>
              )}
            </div>
          </DashboardCard>

          {/* Card 2: AGENDAMENTOS HOJE */}
          <DashboardCard
            variant="highlight"
            className="p-3 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between gap-1.5">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#2C2416] to-[#1A1712] border border-[#D3AE55]/40 text-[#E8C76E] flex items-center justify-center shrink-0">
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <MiniBarsSvg
                  variant="gold"
                  series={effectiveAppointmentsSeries}
                  className="w-11 h-5 shrink-0"
                />
              </div>
              <span className="mt-2 block text-[10px] font-bold uppercase tracking-tight text-[#B4BAC6] leading-tight">
                Agendamentos hoje
              </span>
              <p className="text-[16px] sm:text-[17px] font-extrabold text-white tabular-nums leading-tight mt-0.5">
                {mobApptsCount}
              </p>
            </div>
            <div className="mt-1.5">
              {agendamentosHojeTrend ? (
                <span className="text-[10px] text-[#8E95A2] block">
                  <strong
                    className={
                      agendamentosHojeTrend.startsWith("-")
                        ? "text-[#EF5A67]"
                        : "text-[#16C784]"
                    }
                  >
                    {agendamentosHojeTrend.startsWith("-") ? "▼" : "▲"}{" "}
                    {agendamentosHojeTrend}
                  </strong>{" "}
                  vs. ontem
                </span>
              ) : (
                <span className="text-[10px] text-[#8E95A2] block">
                  Programados hoje
                </span>
              )}
            </div>
          </DashboardCard>

          {/* Card 3: CLIENTES ATENDIDOS */}
          <DashboardCard className="p-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-1.5">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#2C2416] to-[#1A1712] border border-[#D3AE55]/35 text-[#E8C76E] flex items-center justify-center shrink-0">
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <MiniBarsSvg
                  variant="slate"
                  series={effectiveCompletedClientsSeries}
                  className="w-11 h-5 shrink-0"
                />
              </div>
              <span className="mt-2 block text-[10px] font-bold uppercase tracking-tight text-[#B4BAC6] leading-tight">
                Clientes atendidos
              </span>
              <p className="text-[16px] sm:text-[17px] font-extrabold text-white tabular-nums leading-tight mt-0.5">
                {mobClientsAttended}
              </p>
            </div>
            <div className="mt-1.5">
              {clientesAtendidosTrend ? (
                <span className="text-[10px] text-[#8E95A2] block">
                  <strong
                    className={
                      clientesAtendidosTrend.startsWith("-")
                        ? "text-[#EF5A67]"
                        : "text-[#16C784]"
                    }
                  >
                    {clientesAtendidosTrend.startsWith("-") ? "▼" : "▲"}{" "}
                    {clientesAtendidosTrend}
                  </strong>{" "}
                  vs. ontem
                </span>
              ) : (
                <span className="text-[10px] text-[#8E95A2] block">
                  Concluídos hoje
                </span>
              )}
            </div>
          </DashboardCard>

          {/* Card 4: CONTAS A VENCER (Red Highlight Card) */}
          {canAccessFinancial ? (
            <Link
              href="/admin/financeiro/contas?kind=PAYABLE"
              className="rounded-2xl p-3 border border-[#DC4854]/60 bg-gradient-to-br from-[#2E161B] via-[#211317] to-[#151215] shadow-[0_0_24px_rgba(220,72,84,0.2)] flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-1.5">
                  <div className="w-7 h-7 rounded-lg bg-[#DC4854]/20 border border-[#DC4854]/45 text-[#FF6B78] flex items-center justify-center shrink-0">
                    <svg
                      className="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <polyline points="12 7 12 12 15 14" />
                    </svg>
                  </div>
                  <span className="text-[#FF6B78] text-sm font-bold">›</span>
                </div>
                <span className="mt-2 block text-[10px] font-bold uppercase tracking-tight text-zinc-200 leading-tight">
                  Contas a vencer
                </span>
                <p className="text-[16px] sm:text-[17px] font-extrabold text-white tabular-nums leading-tight mt-0.5">
                  {mobDueCount}
                </p>
              </div>
              <div className="mt-1.5">
                <span className="text-[11px] font-extrabold text-[#FF6B78] tabular-nums block">
                  {formatCentsBRL(mobDueCents)}
                </span>
              </div>
            </Link>
          ) : (
            <DashboardCard className="p-3 flex flex-col justify-between">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-tight text-[#B4BAC6] leading-tight">
                  Taxa de ocupação
                </span>
                <p className="text-[16px] sm:text-[17px] font-extrabold text-white mt-1 tabular-nums">
                  {taxaOcupacaoPct}%
                </p>
              </div>
              <span className="text-[10px] text-[#8E95A2] mt-1.5 block">
                {horariosOcupados} ocupados hoje
              </span>
            </DashboardCard>
          )}
        </div>

        {/* Mobile Agenda de hoje */}
        <TodayScheduleCard
          appointments={mobileAppointments ?? filteredTodayAppointments}
          compact
        />

        {/* Mobile Contas a vencer */}
        <FinancialDueCard
          summary={financialSummary}
          items={mobileDueItems ?? filteredDueItems}
          canAccessFinancial={canAccessFinancial}
          civilToday={civilToday}
          compactMobile
        />

        {/* Mobile Visão do faturamento */}
        <DashboardCard className="p-4">
          <SectionHeader
            title="Visão do faturamento"
            icon={
              <svg
                className="w-4 h-4 text-[#E8C76E]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            }
            action={
              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[#A6ADB9] bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1">
                Últimos 7 dias
                <svg
                  className="w-3 h-3 text-zinc-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            }
          />
          <MobileRevenueLineChart
            dailyRevenue={dailyRevenue}
            totalRevenue={chartTotal}
            trendText={effectiveChartTrend}
            peakDateLabel={peakDateLabel}
          />
        </DashboardCard>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          DESKTOP COMPOSITION (>= 1024px)
          Matches approved desktop reference (media_1793382142333_c995c8d6.png)
         ═══════════════════════════════════════════════════════════════════ */}
      <div className="hidden lg:block space-y-5 px-6 py-5">
        {/* ─── Desktop Top Header Bar ─── */}
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-white/[0.07]">
          {/* Left: Scissors/Logo Icon + Title + PRO + Date + City */}
          <div className="flex items-center gap-3.5 min-w-0">
            {barbershop?.logoUrl ? (
              <img
                src={barbershop.logoUrl}
                alt={barbershopName}
                className="w-12 h-12 rounded-2xl object-contain p-1 bg-[#1A1C20] border border-[#D3AE55]/40 shadow-sm shrink-0"
              />
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#262015] to-[#15171C] border border-[#D3AE55]/45 flex items-center justify-center text-[#E8C76E] shrink-0 shadow-[0_0_20px_rgba(211,174,85,0.15)]">
                <svg
                  className="w-6 h-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <line x1="20" y1="4" x2="8.12" y2="15.88" />
                  <line x1="14.47" y1="14.48" x2="20" y2="20" />
                  <line x1="8.12" y1="8.12" x2="12" y2="12" />
                </svg>
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="font-serif text-2xl font-bold text-white tracking-wide truncate leading-tight">
                  {barbershopName}
                </h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-[#D3AE55]/20 text-[#E8C76E] border border-[#D3AE55]/40">
                  PRO
                </span>
              </div>
              <p className="text-xs text-[#A6ADB9] mt-0.5 flex items-center gap-1.5">
                <span>{capitalizedDate}</span>
                <span aria-hidden="true">☀️</span>
              </p>
              <p className="text-[11px] text-[#7E8594]">{cityDisplay}</p>
            </div>
          </div>

          {/* Center: Live Dashboard Search Input with real Ctrl+K shortcut */}
          <form
            role="search"
            onSubmit={(e) => e.preventDefault()}
            className="flex-1 max-w-md mx-4"
          >
            <div className="relative flex items-center">
              <svg
                className="w-4 h-4 text-[#7E8594] absolute left-3.5 pointer-events-none"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrar agenda de hoje, profissional ou conta..."
                aria-label="Filtrar agenda de hoje, profissional ou conta"
                className="w-full h-10 pl-10 pr-16 rounded-xl bg-[#161920] border border-white/[0.08] text-xs text-white placeholder-[#7E8594] focus:outline-none focus:border-[#D3AE55]/50 transition-colors"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Limpar filtro"
                  className="absolute right-2.5 px-1.5 py-0.5 rounded bg-white/[0.08] hover:bg-white/[0.14] text-[10px] text-zinc-200 cursor-pointer"
                >
                  Limpar
                </button>
              ) : (
                <kbd className="absolute right-2.5 px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[10px] text-[#8E95A2] font-mono pointer-events-none">
                  Ctrl K
                </kbd>
              )}
            </div>
          </form>

          {/* Right: Notification Bell + Primary CTA + Secondary CTA */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href={bellHref}
              aria-label={bellAriaLabel}
              className="relative w-10 h-10 rounded-xl bg-[#161920] hover:bg-[#1E222B] border border-white/[0.08] flex items-center justify-center text-zinc-300 transition-colors"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {hasActiveAlerts && (
                <span
                  data-testid="desktop-bell-alert-dot"
                  className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#EF5A67]"
                />
              )}
            </Link>

            <Link
              href="/admin/agendamentos"
              className="inline-flex items-center justify-center gap-2 px-4 h-10 rounded-xl text-xs font-bold bg-gradient-to-r from-[#F2D785] via-[#E4C065] to-[#CA9E42] text-[#111317] hover:brightness-105 shadow-[0_4px_20px_rgba(211,174,85,0.3)] transition-all"
            >
              <span className="text-sm font-extrabold leading-none">+</span>
              Novo agendamento
            </Link>

            <Link
              href="/admin/agendamentos"
              className="inline-flex items-center justify-center gap-2 px-3.5 h-10 rounded-xl text-xs font-semibold bg-[#161920] hover:bg-[#1E222B] text-zinc-200 border border-white/[0.10] transition-colors"
            >
              <svg
                className="w-3.5 h-3.5 text-[#E8C76E]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Ver agenda
            </Link>
          </div>
        </div>

        {/* ─── Row 1: 4 Top Premium KPI Cards ─── */}
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            label="Faturamento hoje"
            value={formatBRL(faturamentoHoje)}
            sublabel="Realizado hoje"
            trend={
              faturamentoHojeTrend
                ? {
                    value: faturamentoHojeTrend,
                    label: "vs. ontem",
                    positive: !faturamentoHojeTrend.startsWith("-"),
                  }
                : undefined
            }
            visualType="sparkline"
            series={effectiveRevenueSeries}
            highlight
            icon={<span className="text-lg font-extrabold">$</span>}
          />

          <MetricCard
            label="Faturamento semanal"
            value={formatBRL(faturamentoSemana)}
            sublabel="Acumulado nos últimos 7 dias"
            trend={
              faturamentoSemanaTrend
                ? {
                    value: faturamentoSemanaTrend,
                    label: "vs. semana anterior",
                    positive: !faturamentoSemanaTrend.startsWith("-"),
                  }
                : undefined
            }
            visualType="bars-gold"
            series={effectiveWeeklyRevenueSeries}
            icon={
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            }
          />

          <MetricCard
            label="Taxa de ocupação"
            value={`${taxaOcupacaoPct}%`}
            sublabel={`${horariosOcupados} ocupados de ${
              horariosOcupados + horariosDisponiveis
            } horários`}
            progress={{
              value: taxaOcupacaoPct,
            }}
            icon={
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
          />

          <MetricCard
            label="Clientes atendidos"
            value={clientesAtendidosHoje}
            sublabel="Concluídos hoje"
            trend={
              clientesAtendidosTrend
                ? {
                    value: clientesAtendidosTrend,
                    label: "vs. ontem",
                    positive: !clientesAtendidosTrend.startsWith("-"),
                  }
                : undefined
            }
            visualType="bars-slate"
            series={effectiveCompletedClientsSeries}
            icon={
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
          />
        </div>

        {/* ─── Row 2: 3-Column Operational & Financial Priority Grid (5 + 3 + 4 = 12 cols) ─── */}
        <div className="grid grid-cols-12 gap-4 items-stretch">
          {/* Col 1 (5 cols): Agenda de hoje */}
          <div className="col-span-5">
            <TodayScheduleCard appointments={filteredTodayAppointments} />
          </div>

          {/* Col 2 (3 cols): Desempenho por profissional */}
          <div className="col-span-3">
            <ProfessionalPerformanceCard
              professionals={filteredProfessionals}
              canAccessFinancial={canAccessFinancial}
            />
          </div>

          {/* Col 3 (4 cols): Contas a vencer (Red-bordered priority panel) */}
          <div className="col-span-4">
            {canAccessFinancial ? (
              <FinancialDueCard
                summary={financialSummary}
                items={filteredDueItems}
                canAccessFinancial={canAccessFinancial}
                civilToday={civilToday}
              />
            ) : (
              <DashboardCard className="p-5 h-full">
                <BookingLinkShare slug={barbershop?.slug ?? ""} />
              </DashboardCard>
            )}
          </div>
        </div>

        {/* ─── Row 3: Bottom Analytics & Management Grid (4 + 4 + 4 = 12 cols) ─── */}
        <div className="grid grid-cols-12 gap-4 items-stretch">
          {/* Left (4 cols): Visão geral do faturamento */}
          <div className="col-span-4">
            <DashboardCard className="p-5 h-full flex flex-col justify-between">
              <SectionHeader
                title="Visão geral do faturamento"
                icon={
                  <svg
                    className="w-4 h-4 text-[#E8C76E]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                }
                action={
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#A6ADB9] bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1">
                    Últimos 7 dias
                    <svg
                      className="w-3 h-3 text-zinc-500"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                }
              />

              <DashboardCharts
                dailyRevenue={dailyRevenue}
                weekRevenue={chartTotal}
                occupancy={occupancyData}
                trendText={effectiveChartTrend}
                trendPositive={!effectiveChartTrend?.startsWith("-")}
                peakDateLabel={peakDateLabel}
              />
            </DashboardCard>
          </div>

          {/* Center (4 cols): Stacked Clientes recentes + Metas do mês */}
          <div className="col-span-4 flex flex-col gap-4">
            {/* Top card: Clientes recentes (Recurrence Donut) */}
            <DashboardCard className="p-4 sm:p-5 flex-1">
              <SectionHeader
                title="Clientes recentes"
                subtitle={
                  recurrence.periodLabel ??
                  "Ativos nos últimos 30 dias vs. histórico"
                }
                icon={
                  <svg
                    className="w-4 h-4 text-[#E8C76E]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                }
                action={
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#A6ADB9] bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1">
                    Últimos 30 dias
                    <svg
                      className="w-3 h-3 text-zinc-500"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                }
              />

              <div className="flex items-center gap-5 pt-1">
                {/* Donut Gauge */}
                <div className="relative w-24 h-24 shrink-0">
                  <svg
                    viewBox="0 0 100 100"
                    className="w-24 h-24 -rotate-90"
                    aria-hidden="true"
                  >
                    <circle
                      cx="50"
                      cy="50"
                      r={recR}
                      fill="none"
                      stroke="#2A2F3A"
                      strokeWidth="11"
                    />
                    {recArc > 0 && (
                      <circle
                        cx="50"
                        cy="50"
                        r={recR}
                        fill="none"
                        stroke="#E8C76E"
                        strokeWidth="11"
                        strokeLinecap="round"
                        strokeDasharray={`${recArc} ${recC - recArc}`}
                      />
                    )}
                    {newArc > 0 && (
                      <circle
                        cx="50"
                        cy="50"
                        r={recR}
                        fill="none"
                        stroke="#93A8C8"
                        strokeWidth="11"
                        strokeDasharray={`${newArc} ${recC - newArc}`}
                        strokeDashoffset={-recArc}
                      />
                    )}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-base font-extrabold text-white leading-none tabular-nums">
                      {hasRecurrenceData ? `${recurrence.recurringPct}%` : "0%"}
                    </span>
                    <span className="text-[10px] text-[#9CA3AF] mt-0.5">
                      {hasRecurrenceData ? "Recorrentes" : "Sem base"}
                    </span>
                  </div>
                </div>

                {/* Legend */}
                <div className="flex-1 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-zinc-200">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#E8C76E]" />
                      Clientes recorrentes
                    </span>
                    <span className="font-bold text-white tabular-nums">
                      {hasRecurrenceData ? `${recurrence.recurringPct}%` : "0%"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-zinc-300">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#93A8C8]" />
                      Novos clientes
                    </span>
                    <span className="font-bold text-white tabular-nums">
                      {hasRecurrenceData ? `${recurrence.newPct}%` : "0%"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-zinc-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#525B6C]" />
                      Inativos
                    </span>
                    <span className="font-bold text-zinc-300 tabular-nums">
                      {hasRecurrenceData ? `${recurrence.inactivePct}%` : "0%"}
                    </span>
                  </div>
                  {!hasRecurrenceData && (
                    <p className="text-[10.5px] text-[#8E95A2] pt-0.5">
                      Sem histórico de visitas para cálculo de recorrência.
                    </p>
                  )}
                </div>
              </div>
            </DashboardCard>

            {/* Bottom card: Metas do mês */}
            <DashboardCard className="p-4 sm:p-5 flex-1">
              <SectionHeader
                title="Metas do mês"
                icon={
                  <svg
                    className="w-4 h-4 text-[#E8C76E]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <circle cx="12" cy="12" r="5" />
                    <circle cx="12" cy="12" r="1" />
                  </svg>
                }
                action={
                  <Link
                    href="/admin/financeiro/relatorio-gerencial"
                    className="text-xs font-semibold text-[#E8C76E] hover:text-[#F4DC92] flex items-center gap-1"
                  >
                    Ver detalhes
                    <span aria-hidden="true">→</span>
                  </Link>
                }
              />

              <div>
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg font-extrabold text-white tabular-nums">
                      {formatBRL(monthData.revenue)}
                    </span>
                    {hasConfiguredGoal ? (
                      <span className="text-xs text-[#8E95A2] tabular-nums">
                        de {formatBRL(monthData.targetRevenue!)}
                      </span>
                    ) : (
                      <span className="text-xs text-[#8E95A2]">
                        acumulado no mês
                      </span>
                    )}
                  </div>
                  {hasConfiguredGoal ? (
                    <span className="text-xs font-bold text-[#E8C76E] tabular-nums">
                      {monthGoalPct}%
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-[#8E95A2]">
                      Meta não configurada
                    </span>
                  )}
                </div>

                <div className="h-2 w-full bg-white/[0.08] rounded-full overflow-hidden mb-3.5">
                  {hasConfiguredGoal && (
                    <div
                      className="h-full bg-gradient-to-r from-[#D3AE55] to-[#F0D78C] rounded-full shadow-[0_0_10px_rgba(211,174,85,0.35)]"
                      style={{ width: `${monthGoalPct}%` }}
                    />
                  )}
                </div>

                {/* 3 Bottom Sub-Boxes */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <span className="text-[10px] text-[#9CA3AF] flex items-center gap-1">
                      <span className="text-[#E8C76E]">✦</span> Serviços
                    </span>
                    <p className="text-sm font-extrabold text-white mt-1 tabular-nums">
                      {monthData.completedServices}
                      {monthData.targetServices ? (
                        <span className="text-[11px] font-normal text-[#8E95A2]">
                          {" "}
                          / {monthData.targetServices}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <span className="text-[10px] text-[#9CA3AF] flex items-center gap-1">
                      <span className="text-[#E8C76E]">✦</span> Novos clientes
                    </span>
                    <p className="text-sm font-extrabold text-white mt-1 tabular-nums">
                      {monthData.newClients}
                      {monthData.targetNewClients ? (
                        <span className="text-[11px] font-normal text-[#8E95A2]">
                          {" "}
                          / {monthData.targetNewClients}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                    <span className="text-[10px] text-[#9CA3AF] flex items-center gap-1">
                      <span className="text-[#16C784]">▊</span> Ticket médio
                    </span>
                    <p className="text-xs font-extrabold text-white mt-1 tabular-nums">
                      {formatBRL(monthData.averageTicket)}
                    </p>
                    {monthData.averageTicketTrend && (
                      <span
                        className={`inline-block mt-0.5 text-[9.5px] font-bold px-1.5 py-0.2 rounded ${
                          monthData.averageTicketTrend.startsWith("-")
                            ? "text-[#EF5A67] bg-[#EF5A67]/15"
                            : "text-[#16C784] bg-[#16C784]/15"
                        }`}
                      >
                        {monthData.averageTicketTrend.startsWith("-")
                          ? "▼"
                          : "▲"}{" "}
                        {monthData.averageTicketTrend}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </DashboardCard>
          </div>

          {/* Right (4 cols): Stacked Performance por canal + Lembretes e avisos */}
          <div className="col-span-4 flex flex-col gap-4">
            {/* Top card: Performance por canal */}
            <DashboardCard className="p-4 sm:p-5 flex-1">
              <SectionHeader
                title="Performance por canal"
                subtitle={
                  !isChannelTrackingAvailable
                    ? channelsData.unavailableReason ??
                      "Origem do agendamento não rastreada"
                    : undefined
                }
                icon={
                  <svg
                    className="w-4 h-4 text-[#E8C76E]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 3a9 9 0 0 1 9 9" />
                  </svg>
                }
                action={
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[#A6ADB9] bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1">
                    Este mês
                    <svg
                      className="w-3 h-3 text-zinc-500"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                }
              />

              <div className="flex items-center gap-4 pt-1">
                {/* Multi-segment Donut */}
                <div className="relative w-20 h-20 shrink-0">
                  <svg
                    viewBox="0 0 100 100"
                    className="w-20 h-20 -rotate-90"
                    aria-hidden="true"
                  >
                    <circle
                      cx="50"
                      cy="50"
                      r={chR}
                      fill="none"
                      stroke="#252932"
                      strokeWidth="11"
                    />
                    {channelSegments.map((seg) => (
                      <circle
                        key={seg.name}
                        cx="50"
                        cy="50"
                        r={chR}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="11"
                        strokeDasharray={`${seg.len} ${chC - seg.len}`}
                        strokeDashoffset={-seg.offset}
                      />
                    ))}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-sm font-extrabold text-white leading-none tabular-nums">
                      {isChannelTrackingAvailable ? channelsData.total : "—"}
                    </span>
                    <span className="text-[8.5px] text-[#9CA3AF] mt-0.5">
                      {isChannelTrackingAvailable ? "agendamentos" : "sem origem"}
                    </span>
                  </div>
                </div>

                {/* Channel Legend */}
                <div className="flex-1 space-y-2 text-xs">
                  {channelsData.channels.map((ch) => (
                    <div
                      key={ch.name}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-2 text-zinc-200 truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: ch.color }}
                        />
                        <span className="truncate">{ch.name}</span>
                      </span>
                      <div className="flex items-center gap-3 shrink-0 tabular-nums">
                        <span className="text-[#9CA3AF]">
                          {isChannelTrackingAvailable ? `${ch.pct}%` : "—"}
                        </span>
                        <span className="font-bold text-white w-6 text-right">
                          {isChannelTrackingAvailable ? ch.count : "—"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </DashboardCard>

            {/* Bottom card: Lembretes e avisos */}
            <DashboardCard className="p-4 sm:p-5 flex-1">
              <SectionHeader
                title="Lembretes e avisos"
                icon={
                  <svg
                    className="w-4 h-4 text-[#E8C76E]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                }
                action={
                  <Link
                    href="/admin/configuracoes"
                    className="text-xs font-semibold text-[#E8C76E] hover:text-[#F4DC92] flex items-center gap-1"
                  >
                    Ver todos
                    <span aria-hidden="true">→</span>
                  </Link>
                }
              />

              <div className="grid grid-cols-2 gap-2.5">
                {alertsList.slice(0, 4).map((alert) => (
                  <div
                    key={alert.id}
                    className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-start gap-2"
                  >
                    <div className="w-6 h-6 rounded-lg bg-[#D3AE55]/15 border border-[#D3AE55]/30 text-[#E8C76E] flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[11px] font-bold">!</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-[11px] font-bold text-white truncate">
                          {alert.title}
                        </p>
                        {alert.badgeText && (
                          <span
                            className={`text-[9px] font-bold px-1 rounded shrink-0 ${
                              alert.badgeTone === "red"
                                ? "text-[#FF6B78]"
                                : "text-[#9CA3AF]"
                            }`}
                          >
                            {alert.badgeText}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-[#8E95A2] truncate mt-0.5">
                        {alert.subtitle}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </DashboardCard>
          </div>
        </div>

        {/* Slots Availability Legend for UI test backward compatibility */}
        {todaySlotsLegendProps && (
          <DashboardCard className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Horários de hoje
              </span>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Disponível
                </span>
                <span className="flex items-center gap-1.5 text-[#D3AE55]">
                  <span className="w-2 h-2 rounded-full bg-[#D3AE55]" />
                  Ocupado
                </span>
                <span className="flex items-center gap-1.5 text-zinc-500">
                  <span className="w-2 h-2 rounded-full bg-zinc-600" />
                  Bloqueado
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {todaySlotsLegendProps.slots.map((slot) => {
                let cls =
                  "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
                if (slot.status === "occupied") {
                  cls =
                    "text-[var(--gold)] bg-[var(--gold-surface)] border-[var(--gold-border)]";
                } else if (slot.status === "blocked") {
                  cls = "text-zinc-500 bg-zinc-800/50 border-zinc-700/30";
                }
                return (
                  <span
                    key={slot.time}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium border ${cls}`}
                  >
                    {slot.time}
                  </span>
                );
              })}
            </div>
          </DashboardCard>
        )}
      </div>
    </div>
  );
}
