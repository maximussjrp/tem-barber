import React from "react";
import Link from "next/link";
import { DashboardCard, SectionHeader, DashboardEmptyState } from "./DashboardPrimitives";

export interface DashboardAppointmentItem {
  id: string;
  customerName: string;
  timeFormatted: string;
  servicesFormatted: string;
  status: string;
}

const STATUS_MAP: Record<
  string,
  { label: string; dot: string; badge: string }
> = {
  PENDING: {
    label: "Aguardando",
    dot: "bg-amber-400",
    badge: "text-amber-300 bg-amber-500/15 border-amber-500/25",
  },
  CONFIRMED: {
    label: "Confirmado",
    dot: "bg-emerald-400",
    badge: "text-emerald-300 bg-emerald-500/15 border-emerald-500/25",
  },
  COMPLETED: {
    label: "Concluído",
    dot: "bg-purple-400",
    badge: "text-purple-300 bg-purple-500/15 border-purple-500/25",
  },
  CANCELLED: {
    label: "Cancelado",
    dot: "bg-rose-400",
    badge: "text-rose-300 bg-rose-500/15 border-rose-500/25",
  },
  NO_SHOW: {
    label: "Não compareceu",
    dot: "bg-zinc-500",
    badge: "text-zinc-400 bg-zinc-500/15 border-zinc-500/25",
  },
};

export function TodayScheduleCard({
  appointments,
}: {
  appointments: DashboardAppointmentItem[];
}) {
  return (
    <DashboardCard className="p-5">
      <SectionHeader
        title="Agenda de hoje"
        subtitle={`${appointments.length} agendamento${
          appointments.length !== 1 ? "s" : ""
        } programado${appointments.length !== 1 ? "s" : ""}`}
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
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        }
        action={
          <Link
            href="/admin/agendamentos"
            className="text-xs font-semibold text-[#D3AE55] hover:text-[#E8C76E] transition-colors flex items-center gap-1 cursor-pointer"
          >
            Ver agenda completa
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
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
        <div className="divide-y divide-white/[0.06]">
          {appointments.slice(0, 7).map((appt) => {
            const st = STATUS_MAP[appt.status] ?? STATUS_MAP.PENDING;
            return (
              <div
                key={appt.id}
                className="flex items-center gap-3 py-3 hover:bg-white/[0.02] transition-colors rounded-lg px-2"
              >
                <span className="text-xs tabular-nums font-mono text-zinc-400 w-11 shrink-0 font-semibold">
                  {appt.timeFormatted}
                </span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                <div className="flex-1 min-w-0 pr-2">
                  <p className="text-sm font-medium text-white truncate">
                    {appt.customerName}
                  </p>
                  <p className="text-xs text-zinc-400 truncate">
                    {appt.servicesFormatted}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${st.badge}`}
                >
                  {st.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </DashboardCard>
  );
}
