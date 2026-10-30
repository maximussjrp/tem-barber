import React from "react";
import { DashboardCard, SectionHeader, DashboardEmptyState } from "./DashboardPrimitives";

export interface ProfessionalSlotInfo {
  memberName: string;
  working: boolean;
  onTimeOff: boolean;
  startTime: string;
  endTime: string;
  totalSlots: number;
  bookedSlots: number;
  freeSlots: number[];
  blockedSlots: number[];
}

export function ProfessionalPerformanceCard({
  professionals,
}: {
  professionals: ProfessionalSlotInfo[];
}) {
  const workingMembers = professionals.filter((p) => p.working);

  return (
    <DashboardCard className="p-5">
      <SectionHeader
        title="Desempenho por profissional"
        subtitle="Disponibilidade e ocupação hoje"
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
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" />
            <path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
        }
      />

      {professionals.length === 0 ? (
        <DashboardEmptyState
          title="Nenhum colaborador ativo"
          description="Cadastre colaboradores na aba Equipe para acompanhar escalas e horários."
        />
      ) : (
        <div className="space-y-4">
          {workingMembers.map((m) => {
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

            return (
              <div
                key={m.memberName}
                className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06] space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[#22252B] border border-white/[0.08] flex items-center justify-center text-xs font-bold text-[#D3AE55] font-serif shrink-0">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {m.memberName}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {m.startTime} às {m.endTime}
                      </p>
                    </div>
                  </div>

                  <span className="text-xs font-semibold text-zinc-300 tabular-nums">
                    {occupancyPct}% ocupado
                  </span>
                </div>

                {/* Occupancy progress bar */}
                <div className="h-1.5 w-full bg-white/[0.08] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#D3AE55] to-[#E8C76E] rounded-full transition-all duration-500"
                    style={{ width: `${occupancyPct}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>
                    {m.freeSlots.length} horário{m.freeSlots.length !== 1 ? "s" : ""} livre{m.freeSlots.length !== 1 ? "s" : ""}
                  </span>
                  <span>
                    {m.bookedSlots} agendado{m.bookedSlots !== 1 ? "s" : ""}
                  </span>
                </div>
              </div>
            );
          })}

          {professionals
            .filter((p) => !p.working)
            .map((p) => (
              <div
                key={p.memberName}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.01] border border-white/[0.03] opacity-50"
              >
                <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400 shrink-0">
                  {p.memberName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-300 truncate">
                    {p.memberName}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {p.onTimeOff ? "Em folga" : "Não trabalha hoje"}
                  </p>
                </div>
              </div>
            ))}
        </div>
      )}
    </DashboardCard>
  );
}
