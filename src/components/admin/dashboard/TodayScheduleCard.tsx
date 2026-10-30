import React from "react";
import Link from "next/link";
import { DashboardCard, SectionHeader, DashboardEmptyState } from "./DashboardPrimitives";

export interface DashboardAppointmentItem {
  id: string;
  customerName: string;
  customerAvatarUrl?: string | null;
  timeFormatted: string;
  servicesFormatted: string;
  status: string;
}

const STATUS_MAP: Record<
  string,
  { label: string; dot: string; badge: string }
> = {
  COMPLETED: {
    label: "Concluído",
    dot: "bg-[#8B5CF6] shadow-[0_0_8px_rgba(139,92,246,0.85)]",
    badge:
      "text-[#C4B5FD] bg-[#8B5CF6]/15 border-[#8B5CF6]/35",
  },
  CONFIRMED: {
    label: "Confirmado",
    dot: "bg-[#16C784] shadow-[0_0_8px_rgba(22,199,132,0.8)]",
    badge:
      "text-[#34D399] bg-[#16C784]/15 border-[#16C784]/35",
  },
  PENDING: {
    label: "Aguardando",
    dot: "bg-[#E8C76E] shadow-[0_0_8px_rgba(232,199,110,0.85)]",
    badge:
      "text-[#E8C76E] bg-[#D3AE55]/15 border-[#D3AE55]/40",
  },
  IN_PROGRESS: {
    label: "Em atendimento",
    dot: "bg-[#E8C76E] shadow-[0_0_8px_rgba(232,199,110,0.85)]",
    badge:
      "text-[#E8C76E] bg-[#D3AE55]/15 border-[#D3AE55]/40",
  },
  SCHEDULED: {
    label: "Agendado",
    dot: "bg-zinc-400",
    badge: "text-zinc-300 bg-white/[0.06] border-white/[0.12]",
  },
  CANCELLED: {
    label: "Cancelado",
    dot: "bg-rose-400",
    badge: "text-rose-300 bg-rose-500/15 border-rose-500/30",
  },
  NO_SHOW: {
    label: "Não compareceu",
    dot: "bg-zinc-500",
    badge: "text-zinc-400 bg-zinc-500/15 border-zinc-500/25",
  },
};

const AVATAR_GRADIENTS = [
  "from-[#3B3022] to-[#1E1912] text-[#E8C76E] border-[#D3AE55]/35",
  "from-[#1F2D3A] to-[#131B24] text-[#93C5FD] border-sky-500/30",
  "from-[#2C223E] to-[#181324] text-[#C4B5FD] border-violet-500/30",
  "from-[#1D332B] to-[#11201B] text-[#6EE7B7] border-emerald-500/30",
];

function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export function TodayScheduleCard({
  appointments,
  compact = false,
}: {
  appointments: DashboardAppointmentItem[];
  compact?: boolean;
}) {
  return (
    <DashboardCard className="p-4 sm:p-5 h-full flex flex-col justify-between">
      <div>
        <SectionHeader
          title="Agenda de hoje"
          subtitle={
            compact
              ? undefined
              : `${appointments.length} agendamento${
                  appointments.length !== 1 ? "s" : ""
                } programado${appointments.length !== 1 ? "s" : ""}`
          }
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
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          }
          action={
            <Link
              href="/admin/agendamentos"
              className="text-xs font-semibold text-[#E8C76E] hover:text-[#F4DC92] transition-colors flex items-center gap-1 cursor-pointer whitespace-nowrap"
            >
              <span>Ver agenda</span>
              <span className={compact ? "sr-only sm:not-sr-only" : ""}>
                {" "}
                completa
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          }
        />

        {appointments.length === 0 ? (
          <DashboardEmptyState
            title="Nenhum agendamento para hoje"
            description="Quando clientes agendarem serviços, eles aparecerão aqui ordenados por horário."
            action={
              <Link
                href="/admin/agendamentos"
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#D3AE55] text-black hover:bg-[#E8C76E] transition-colors"
              >
                Novo agendamento
              </Link>
            }
          />
        ) : (
          <div className="relative pl-3">
            {/* Continuous vertical timeline line */}
            <div
              className="absolute left-[15px] top-4 bottom-4 w-[1.5px] bg-gradient-to-b from-[#8B5CF6]/50 via-[#D3AE55]/40 to-white/[0.10]"
              aria-hidden="true"
            />

            <div className="divide-y divide-white/[0.05]">
              {appointments.slice(0, compact ? 4 : 6).map((appt, idx) => {
                const st = STATUS_MAP[appt.status] ?? STATUS_MAP.PENDING;
                const avatarTone =
                  AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length];

                if (compact) {
                  return (
                    <div
                      key={appt.id}
                      className="relative flex items-start gap-2.5 py-2.5 first:pt-1 last:pb-1 group"
                    >
                      {/* Glowing Timeline Dot */}
                      <span
                        className={`relative z-10 w-2.5 h-2.5 rounded-full shrink-0 mt-3 ${st.dot}`}
                      />

                      {/* Client Avatar */}
                      {appt.customerAvatarUrl ? (
                        <img
                          src={appt.customerAvatarUrl}
                          alt={appt.customerName}
                          className="w-8 h-8 rounded-full object-cover border border-white/[0.14] shrink-0 mt-0.5"
                        />
                      ) : (
                        <div
                          className={`w-8 h-8 rounded-full bg-gradient-to-br border flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${avatarTone}`}
                        >
                          {getInitials(appt.customerName)}
                        </div>
                      )}

                      {/* Two-line responsive stack for mobile/320px so customer names are never truncated to 2 letters */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-[13px] font-bold text-white truncate">
                            {appt.customerName}
                          </p>
                          <span className="text-xs tabular-nums text-[#E8C76E] font-semibold shrink-0">
                            {appt.timeFormatted}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <p className="text-[11px] text-[#8E95A2] truncate">
                            {appt.servicesFormatted}
                          </p>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${st.badge}`}
                          >
                            {st.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={appt.id}
                    className="relative flex items-center gap-2.5 sm:gap-3 py-3 first:pt-1 last:pb-1 group"
                  >
                    {/* Glowing Timeline Dot */}
                    <span
                      className={`relative z-10 w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`}
                    />

                    {/* Time */}
                    <span className="text-xs tabular-nums text-[#9CA3AF] w-10 shrink-0 font-medium">
                      {appt.timeFormatted}
                    </span>

                    {/* Client Avatar */}
                    {appt.customerAvatarUrl ? (
                      <img
                        src={appt.customerAvatarUrl}
                        alt={appt.customerName}
                        className="w-9 h-9 rounded-full object-cover border border-white/[0.14] shrink-0"
                      />
                    ) : (
                      <div
                        className={`w-9 h-9 rounded-full bg-gradient-to-br border flex items-center justify-center text-xs font-bold shrink-0 ${avatarTone}`}
                      >
                        {getInitials(appt.customerName)}
                      </div>
                    )}

                    {/* Client & Service */}
                    <div className="flex-1 min-w-0 pr-1">
                      <p className="text-xs sm:text-[13px] font-bold text-white truncate">
                        {appt.customerName}
                      </p>
                      <p className="text-[11px] text-[#8E95A2] truncate">
                        {appt.servicesFormatted}
                      </p>
                    </div>

                    {/* Status Pill */}
                    <span
                      className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border shrink-0 ${st.badge}`}
                    >
                      {st.label}
                    </span>

                    <Link
                      href="/admin/agendamentos"
                      aria-label={`Detalhes de ${appt.customerName}`}
                      className="text-zinc-500 hover:text-zinc-200 px-1 text-sm select-none shrink-0"
                    >
                      ⋮
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
