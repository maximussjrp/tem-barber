import React from "react";
import { DashboardCard, SectionHeader, DashboardEmptyState } from "./DashboardPrimitives";
import {
  formatOccupancyPercent,
  formatEquivalentUnits,
} from "@/lib/dashboard/operational-metrics";

export interface ProfessionalSlotInfo {
  memberId?: string;
  memberName: string;
  avatarUrl?: string | null;
  weeklyRevenue?: number;
  dailyRevenue?: number;
  working: boolean;
  onTimeOff: boolean;
  startTime: string;
  endTime: string;
  totalSlots: number;
  bookedSlots: number;
  completedSlots?: number;
  freeSlots: number[];
  blockedSlots: number[];
  // Canonical daily managerial productivity fields (in minutes & counts)
  capacityMinutes?: number;
  completedMinutes?: number;
  scheduledMinutes?: number;
  totalDemandMinutes?: number;
  overloadMinutes?: number;
  completedCount?: number;
  scheduledCount?: number;
  equivalentCapacity30?: number;
  equivalentDemand30?: number;
  equivalentOverload30?: number;
  workloadPct?: number | null;
  physicallyOccupiedMinutes?: number;
  physicalOccupancyPct?: number | null;
}

const AVATAR_STYLES = [
  "from-[#3B3022] to-[#1E1912] text-[#E8C76E] border-[#D3AE55]/40",
  "from-[#1F2D3A] to-[#131B24] text-[#93C5FD] border-sky-500/35",
  "from-[#2C223E] to-[#181324] text-[#C4B5FD] border-violet-500/35",
  "from-[#1D332B] to-[#11201B] text-[#6EE7B7] border-emerald-500/35",
  "from-[#3A2328] to-[#1F1316] text-[#FDA4AF] border-rose-500/35",
];

function formatBRL(val: number): string {
  return val.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function ProfessionalPerformanceCard({
  professionals,
  canAccessFinancial = true,
}: {
  professionals: ProfessionalSlotInfo[];
  canAccessFinancial?: boolean;
}) {
  return (
    <DashboardCard
      data-testid="professional-performance-card"
      className="p-4 sm:p-5 h-full flex flex-col justify-between"
    >
      <div>
        <SectionHeader
          title="Desempenho por profissional"
          subtitle="Produtividade e carga diária"
          icon={
            <svg
              className="w-4 h-4 text-[#E8C76E]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
          action={
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#E8C76E] bg-[#D3AE55]/12 border border-[#D3AE55]/30 rounded-lg px-2 py-0.5">
              Hoje
            </span>
          }
        />

        {professionals.length === 0 ? (
          <DashboardEmptyState
            title="Nenhum colaborador ativo"
            description="Cadastre colaboradores na aba Equipe para acompanhar escalas e desempenho."
          />
        ) : (
          <div className="space-y-3 mt-1">
            {professionals.slice(0, 5).map((m, idx) => {
              const capacityMin = m.capacityMinutes ?? m.totalSlots * 30;
              const completedCnt = m.completedCount ?? m.completedSlots ?? 0;
              const scheduledCnt =
                m.scheduledCount ??
                Math.max(0, m.bookedSlots - (m.completedSlots ?? 0));
              const completedMin = m.completedMinutes ?? completedCnt * 30;
              const scheduledMin = m.scheduledMinutes ?? scheduledCnt * 30;
              const totalDemandMin =
                m.totalDemandMinutes ?? completedMin + scheduledMin;
              const overloadMin =
                m.overloadMinutes ?? Math.max(0, totalDemandMin - capacityMin);

              const equivCap =
                m.equivalentCapacity30 ??
                Number((capacityMin / 30).toFixed(2));
              const equivDem =
                m.equivalentDemand30 ??
                Number((totalDemandMin / 30).toFixed(2));
              const equivOverload =
                m.equivalentOverload30 ??
                Number((overloadMin / 30).toFixed(2));

              const workloadPct =
                m.workloadPct ??
                (capacityMin > 0
                  ? Number(((totalDemandMin / capacityMin) * 100).toFixed(2))
                  : 0);

              const barWidthPct = Math.min(100, Math.max(0, workloadPct));
              const isOverloaded = workloadPct > 100 || overloadMin > 0;

              const initials = m.memberName
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0].toUpperCase())
                .join("");
              const avatarTone = AVATAR_STYLES[idx % AVATAR_STYLES.length];

              const shiftLabel = !m.working
                ? m.onTimeOff
                  ? "Em folga"
                  : "Não trabalha hoje"
                : `${m.startTime} às ${m.endTime} · ${capacityMin} min`;

              const showDailyRev =
                canAccessFinancial &&
                typeof m.dailyRevenue === "number" &&
                m.dailyRevenue > 0;
              const showWeeklyRev =
                canAccessFinancial &&
                !showDailyRev &&
                typeof m.weeklyRevenue === "number" &&
                m.weeklyRevenue > 0;

              return (
                <div
                  key={m.memberId ?? m.memberName}
                  data-testid={`professional-perf-row-${m.memberName}`}
                  className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1.5"
                >
                  <div className="flex items-start gap-2.5">
                    {m.avatarUrl ? (
                      <img
                        src={m.avatarUrl}
                        alt={m.memberName}
                        className="w-8 h-8 rounded-full object-cover border border-white/[0.14] shrink-0 mt-0.5"
                      />
                    ) : (
                      <div
                        className={`w-8 h-8 rounded-full bg-gradient-to-br border flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${avatarTone}`}
                      >
                        {initials}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-1.5">
                        <p className="text-xs font-bold text-white truncate leading-tight">
                          {m.memberName}
                        </p>
                        <span
                          data-testid={`professional-workload-pct-${m.memberName}`}
                          className={`text-xs font-extrabold tabular-nums shrink-0 ${
                            !m.working
                              ? "text-zinc-500"
                              : isOverloaded
                              ? "text-[#F4DC92]"
                              : "text-[#E8C76E]"
                          }`}
                        >
                          {m.working
                            ? formatOccupancyPercent(workloadPct)
                            : "—"}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mt-0.5">
                        <span className="text-[10.5px] text-[#9CA3AF] tabular-nums">
                          {shiftLabel}
                        </span>
                        {showDailyRev && (
                          <span className="text-[10px] text-[#A6ADB9] tabular-nums shrink-0">
                            Hoje: {formatBRL(m.dailyRevenue!)}
                          </span>
                        )}
                        {showWeeklyRev && (
                          <span className="text-[10px] text-[#A6ADB9] tabular-nums shrink-0">
                            Semana: {formatBRL(m.weeklyRevenue!)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {m.working ? (
                    <>
                      {/* Horizontal gold progress bar (visual clamped 0..100%, value uncapped) */}
                      <div className="h-1.5 w-full bg-white/[0.08] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isOverloaded
                              ? "bg-gradient-to-r from-[#D3AE55] via-[#F2D785] to-[#F59E0B] shadow-[0_0_10px_rgba(245,158,11,0.45)]"
                              : "bg-gradient-to-r from-[#D3AE55] to-[#F0D78C] shadow-[0_0_8px_rgba(211,174,85,0.35)]"
                          }`}
                          style={{ width: `${barWidthPct}%` }}
                        />
                      </div>

                      {/* Real attendances vs 30-min equivalent capacity breakdown */}
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] text-[#A6ADB9] pt-0.5 tabular-nums">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-violet-300 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                            Concluídos: {completedCnt} ({completedMin}m)
                          </span>
                          <span className="inline-flex items-center gap-1 text-[#E8C76E] font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#D3AE55]" />
                            Agendados: {scheduledCnt} ({scheduledMin}m)
                          </span>
                        </div>
                        <span className="text-[#8E95A2]">
                          Eq. 30m: {formatEquivalentUnits(equivDem)}/
                          {formatEquivalentUnits(equivCap)}
                        </span>
                      </div>

                      {isOverloaded && (
                        <div className="flex items-center justify-between text-[10px] font-semibold text-amber-300/95 bg-amber-500/10 border border-amber-500/25 rounded-lg px-2 py-0.5 tabular-nums">
                          <span>Excedente de capacidade</span>
                          <span>
                            +{overloadMin} min (+
                            {formatEquivalentUnits(equivOverload)} eq.)
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-[10.5px] text-zinc-500 italic pt-0.5">
                      {m.onTimeOff
                        ? "Ausência/folga registrada para hoje"
                        : "Sem expediente configurado hoje"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
