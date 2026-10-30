import React from "react";
import Link from "next/link";
import {
  MetricCard,
  DashboardCard,
  SectionHeader,
} from "./DashboardPrimitives";
import { FinancialDueCard, DueAccountSummary, DueAccountItem } from "./FinancialDueCard";
import { TodayScheduleCard, DashboardAppointmentItem } from "./TodayScheduleCard";
import { ProfessionalPerformanceCard, ProfessionalSlotInfo } from "./ProfessionalPerformanceCard";
import DashboardCharts from "@/components/admin/DashboardCharts";
import BookingLinkShare from "@/components/admin/BookingLinkShare";

export interface PremiumDashboardProps {
  barbershop: {
    id: string;
    name: string;
    slug: string;
    city?: string | null;
    logoUrl?: string | null;
  } | null;
  todayFormatted: string;
  faturamentoHoje: number;
  faturamentoSemana: number;
  taxaOcupacaoPct: number;
  horariosOcupados: number;
  horariosDisponiveis: number;
  clientesAtendidosHoje: number;
  todayAppointments: DashboardAppointmentItem[];
  professionals: ProfessionalSlotInfo[];
  financialSummary: DueAccountSummary;
  dueItems: DueAccountItem[];
  canAccessFinancial: boolean;
  dailyRevenue: { label: string; revenue: number }[];
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

export function PremiumDashboardView({
  barbershop,
  todayFormatted,
  faturamentoHoje,
  faturamentoSemana,
  taxaOcupacaoPct,
  horariosOcupados,
  horariosDisponiveis,
  clientesAtendidosHoje,
  todayAppointments,
  professionals,
  financialSummary,
  dueItems,
  canAccessFinancial,
  dailyRevenue,
  occupancyData,
  onboarding,
  recentClients,
  todaySlotsLegendProps,
}: PremiumDashboardProps) {
  const barbershopName = barbershop?.name ?? "Tem Barber";
  const initials = barbershopName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* ─── Premium Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div className="flex items-center gap-3.5">
          {barbershop?.logoUrl ? (
            <img
              src={barbershop.logoUrl}
              alt={barbershopName}
              className="w-12 h-12 rounded-2xl object-contain p-1 bg-[#1A1C20] border border-white/[0.10] shadow-sm shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-2xl bg-[#1A1C20] border border-[#D3AE55]/30 flex items-center justify-center font-serif font-bold text-[#D3AE55] text-lg shrink-0 shadow-sm">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-xl sm:text-2xl font-bold text-white tracking-wide truncate">
                {barbershopName}
              </h1>
              <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#D3AE55]/15 text-[#D3AE55] border border-[#D3AE55]/30">
                PRO
              </span>
            </div>
            <p className="text-xs text-zinc-400 capitalize mt-0.5">
              {todayFormatted}
            </p>
          </div>
        </div>

        {/* Quick action buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          <Link
            href="/admin/agendamentos"
            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-[#D3AE55] text-black hover:bg-[#E8C76E] shadow-sm hover:shadow transition-colors min-h-[44px]"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Novo agendamento
          </Link>
          <Link
            href="/admin/agendamentos"
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium bg-[#1A1C20] hover:bg-[#22252B] text-zinc-300 hover:text-white border border-white/[0.08] transition-colors min-h-[44px]"
          >
            Ver agenda
          </Link>
        </div>
      </div>

      {/* ─── 4 Top Metric Cards (Row 1) ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-5">
        <MetricCard
          label="Faturamento hoje"
          value={formatBRL(faturamentoHoje)}
          sublabel="serviços concluídos"
          highlight
          icon={
            <svg
              className="w-4 h-4 text-[#D3AE55]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
          }
        />

        <MetricCard
          label="Faturamento semanal"
          value={formatBRL(faturamentoSemana)}
          sublabel="total acumulado"
          icon={
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          }
        />

        <MetricCard
          label="Taxa de ocupação"
          value={`${taxaOcupacaoPct}%`}
          sublabel={`${horariosOcupados} ocupados de ${horariosOcupados + horariosDisponiveis}`}
          progress={{
            value: taxaOcupacaoPct,
            color: "bg-[#D3AE55]",
          }}
          icon={
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
        />

        <MetricCard
          label="Clientes atendidos"
          value={clientesAtendidosHoje}
          sublabel="hoje na barbearia"
          icon={
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <polyline points="17 11 19 13 23 9" />
            </svg>
          }
        />
      </div>

      {/* ─── Main Two-Column Layout ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Column: Schedule & Team (3 cols) */}
        <div className="lg:col-span-3 space-y-6">
          <TodayScheduleCard appointments={todayAppointments} />

          <ProfessionalPerformanceCard professionals={professionals} />

          {/* Slots Availability Legend for UI test backward compatibility */}
          {todaySlotsLegendProps && (
            <DashboardCard className="p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
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
              <div className="flex flex-wrap gap-2 pt-2">
                {todaySlotsLegendProps.slots.map((slot) => {
                  let cls = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
                  if (slot.status === "occupied") {
                    cls = "text-[var(--gold)] bg-[var(--gold-surface)] border-[var(--gold-border)]";
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

        {/* Right Column: Financial Due (Priority), Charts, Link & Clients (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contas a Vencer — Destaque Prioritário */}
          <FinancialDueCard
            summary={financialSummary}
            items={dueItems}
            canAccessFinancial={canAccessFinancial}
          />

          {/* Visão geral do faturamento (Gráfico semanal) */}
          <DashboardCard className="p-5">
            <SectionHeader
              title="Visão rápida do negócio"
              subtitle="Desempenho da semana"
              icon={
                <svg
                  className="w-4 h-4 text-[#D3AE55]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              }
              action={
                <span className="text-[11px] text-zinc-400 bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1">
                  Esta semana
                </span>
              }
            />
            <DashboardCharts
              dailyRevenue={dailyRevenue}
              weekRevenue={faturamentoSemana}
              occupancy={occupancyData}
            />
          </DashboardCard>

          {/* Link público de agendamento */}
          <DashboardCard className="p-5">
            <BookingLinkShare slug={barbershop?.slug ?? ""} />
          </DashboardCard>

          {/* Configuração da barbearia (Onboarding progress) */}
          <DashboardCard className="p-5">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Configuração da barbearia
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {onboarding.complete
                    ? "Sua barbearia está pronta para operar."
                    : `${onboarding.done} de ${onboarding.total} etapas concluídas`}
                </p>
              </div>
              <span
                className={`text-[11px] px-2.5 py-0.5 rounded-full border font-semibold shrink-0 ${
                  onboarding.complete
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : "border-[#D3AE55]/30 bg-[#D3AE55]/10 text-[#D3AE55]"
                }`}
              >
                {onboarding.complete ? "Pronta" : "Em andamento"}
              </span>
            </div>

            <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden mb-4">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#D3AE55] to-[#E8C76E]"
                style={{
                  width: `${Math.round(
                    (onboarding.done / Math.max(onboarding.total, 1)) * 100
                  )}%`,
                }}
              />
            </div>

            <Link
              href="/admin/onboarding"
              className="w-full inline-flex items-center justify-center px-4 py-2 text-xs font-semibold rounded-xl bg-white/[0.05] hover:bg-white/[0.08] text-white border border-white/[0.08] transition-colors"
            >
              {onboarding.complete
                ? "Revisar configuração"
                : "Continuar configuração"}
            </Link>
          </DashboardCard>

          {/* Clientes recentes */}
          <DashboardCard className="p-5">
            <SectionHeader
              title="Clientes recentes"
              subtitle="Últimos atendimentos"
              icon={
                <svg
                  className="w-4 h-4 text-zinc-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87" />
                  <path d="M16 3.13a4 4 0 010 7.75" />
                </svg>
              }
              action={
                <Link
                  href="/admin/clientes"
                  className="text-xs text-[#D3AE55] hover:text-[#E8C76E] transition-colors"
                >
                  Ver todos
                </Link>
              }
            />

            {recentClients.length === 0 ? (
              <p className="text-xs text-zinc-500 py-3 text-center">
                Nenhum cliente ainda.
              </p>
            ) : (
              <div className="space-y-3">
                {recentClients.map((c) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#22252B] border border-[#D3AE55]/30 flex items-center justify-center text-xs font-bold text-[#D3AE55] font-serif shrink-0">
                      {c.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {c.name}
                      </p>
                      <p className="text-xs text-zinc-400">{c.relativeTime}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}
