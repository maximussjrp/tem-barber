import React from "react";
import { DashboardCard, SectionHeader, DashboardEmptyState } from "./DashboardPrimitives";

export interface ProfessionalSlotInfo {
  memberName: string;
  avatarUrl?: string | null;
  weeklyRevenue?: number;
  working: boolean;
  onTimeOff: boolean;
  startTime: string;
  endTime: string;
  totalSlots: number;
  bookedSlots: number;
  freeSlots: number[];
  blockedSlots: number[];
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
    <DashboardCard className="p-4 sm:p-5 h-full flex flex-col justify-between">
      <div>
        <SectionHeader
          title="Desempenho por profissional"
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
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#A6ADB9] bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-0.5">
              Esta semana
              <svg
                className="w-2.5 h-2.5 text-zinc-500"
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

        {professionals.length === 0 ? (
          <DashboardEmptyState
            title="Nenhum colaborador ativo"
            description="Cadastre colaboradores na aba Equipe para acompanhar escalas e desempenho."
          />
        ) : (
          <div className="space-y-3.5 mt-2">
            {professionals.slice(0, 5).map((m, idx) => {
              const booked = m.bookedSlots;
              const total = m.totalSlots;
              const occupancyPct =
                total > 0 ? Math.round((booked / total) * 100) : 0;
              const initials = m.memberName
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0].toUpperCase())
                .join("");
              const avatarTone = AVATAR_STYLES[idx % AVATAR_STYLES.length];

              const subtitleText = !m.working
                ? m.onTimeOff
                  ? "Em folga"
                  : "Não trabalha hoje"
                : canAccessFinancial && typeof m.weeklyRevenue === "number"
                ? formatBRL(m.weeklyRevenue)
                : `${m.startTime} às ${m.endTime}`;

              return (
                <div
                  key={m.memberName}
                  className="flex items-center gap-2.5 py-1"
                >
                  {m.avatarUrl ? (
                    <img
                      src={m.avatarUrl}
                      alt={m.memberName}
                      className="w-9 h-9 rounded-full object-cover border border-white/[0.14] shrink-0"
                    />
                  ) : (
                    <div
                      className={`w-9 h-9 rounded-full bg-gradient-to-br border flex items-center justify-center text-xs font-bold shrink-0 ${avatarTone}`}
                    >
                      {initials}
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white truncate leading-tight">
                      {m.memberName}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px] text-[#9CA3AF] tabular-nums shrink-0 w-[68px] truncate">
                        {subtitleText}
                      </span>

                      {/* Horizontal gold progress bar */}
                      <div className="flex-1 h-2 bg-white/[0.08] rounded-full overflow-hidden min-w-[60px]">
                        <div
                          className="h-full bg-gradient-to-r from-[#D3AE55] to-[#F0D78C] rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(211,174,85,0.35)]"
                          style={{ width: `${occupancyPct}%` }}
                        />
                      </div>

                      <span className="text-[11px] font-semibold text-[#A6ADB9] tabular-nums w-8 text-right shrink-0">
                        {occupancyPct}%
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
