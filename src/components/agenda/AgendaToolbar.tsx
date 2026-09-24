"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Member } from "./types";
import { formatDateFull, getTodayStr, getWeekDays } from "./utils";
import WhatsAppShareSlots from "@/components/admin/WhatsAppShareSlots";

export function AgendaToolbar({
  currentDate,
  mode = "admin",
  members = [],
  filterMember = "",
  onFilterMemberChange,
  stats,
  onOpenNewAppointment,
  onOpenOptions,
  onOpenScheduleBlock,
  shareMembersData = [],
  barbershopName = "",
  barbershopSlug = "",
  basePath = "/admin/agendamentos",
}: {
  currentDate: string;
  mode?: "admin" | "member";
  members?: Member[];
  filterMember?: string;
  onFilterMemberChange?: (memberId: string) => void;
  stats: {
    totalServices: number;
    confirmed: number;
    pending: number;
    revenue: number;
  };
  onOpenNewAppointment: () => void;
  onOpenOptions?: () => void;
  onOpenScheduleBlock?: () => void;
  shareMembersData?: Array<{
    id: string;
    name: string;
    startTime?: string;
    endTime?: string;
    freeSlots?: number[];
  }>;
  barbershopName?: string;
  barbershopSlug?: string;
  basePath?: string;
}) {
  const router = useRouter();
  const today = getTodayStr();

  const navigate = (days: number) => {
    const [y, m, d] = currentDate.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    const nextIso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    router.push(`${basePath}?date=${nextIso}`);
  };

  return (
    <div className="shrink-0 border-b border-stone-800 bg-stone-950 px-4 md:px-6 py-3 space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Row 1 on mobile: Date Nav & Hoje */}
        <div className="flex items-center justify-between md:justify-start gap-3 w-full md:w-auto">
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition-colors"
              title="Dia anterior"
            >
              ←
            </button>
            <div className="relative text-center min-w-[140px] xs:min-w-[180px] md:min-w-[200px]">
              <input
                type="date"
                value={currentDate}
                onChange={(e) =>
                  e.target.value && router.push(`${basePath}?date=${e.target.value}`)
                }
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                title="Selecionar data no calendário"
              />
              <p className="text-sm font-semibold text-stone-100 capitalize truncate hover:text-amber-400 transition-colors cursor-pointer flex items-center justify-center gap-1">
                <span>{formatDateFull(currentDate)}</span>
                <span className="text-xs text-stone-500">📅</span>
              </p>
            </div>
            <button
              onClick={() => navigate(1)}
              className="p-2 rounded-lg text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition-colors"
              title="Próximo dia"
            >
              →
            </button>
          </div>

          {currentDate !== today && (
            <button
              onClick={() => router.push(basePath)}
              className="text-xs text-amber-500 hover:text-amber-400 font-semibold transition-colors px-2 py-1.5 rounded border border-amber-800/50 hover:border-amber-600/50 shrink-0"
            >
              Hoje
            </button>
          )}
        </div>

        {/* Row 2 on mobile: Barber select (Admin only) */}
        {mode === "admin" && (
          <div className="w-full md:w-auto">
            <select
              value={filterMember}
              onChange={(e) => onFilterMemberChange?.(e.target.value)}
              title="Filtrar por barbeiro"
              className="w-full md:w-auto bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm text-stone-300 focus:border-amber-500/80 focus:outline-none transition-colors"
            >
              <option value="">Todos os barbeiros</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.user?.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Row 3 on mobile: Stats & Actions */}
        <div className="flex items-center justify-between md:justify-start gap-3 w-full md:w-auto md:ml-auto flex-wrap">
          <div className="flex items-center gap-2 text-stone-500 text-xs">
            <span>{stats.totalServices} tot.</span>
            {stats.confirmed > 0 && <span className="text-sky-400">{stats.confirmed} conf.</span>}
            {stats.pending > 0 && <span className="text-amber-400">{stats.pending} pend.</span>}
            <span className="text-emerald-400 font-semibold">
              {stats.revenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
          </div>

          <div className="flex items-center gap-2 ml-auto md:ml-0">
            {mode === "admin" && shareMembersData.length > 0 && (
              <WhatsAppShareSlots
                members={shareMembersData.map((m) => ({
                  memberName: m.name || "",
                  startTime: m.startTime || "09:00",
                  endTime: m.endTime || "19:00",
                  freeSlots: m.freeSlots || [],
                }))}
                barbershopName={barbershopName}
                barbershopSlug={barbershopSlug}
                todayStr={currentDate}
              />
            )}

            <button
              onClick={onOpenNewAppointment}
              className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm px-3.5 py-2 rounded-lg transition-colors shrink-0"
            >
              + Novo
            </button>

            {mode === "admin" && onOpenOptions && (
              <button
                onClick={onOpenOptions}
                className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 border border-orange-500/30 font-bold text-sm px-3.5 py-2 rounded-lg transition-colors shrink-0"
              >
                + Opções
              </button>
            )}

            {mode === "member" && onOpenScheduleBlock && (
              <button
                onClick={onOpenScheduleBlock}
                className="bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 font-bold text-sm px-3.5 py-2 rounded-lg transition-colors shrink-0"
              >
                🔒 Bloquear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Faixa Horizontal de Navegação por Dias da Semana */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
        {getWeekDays(currentDate).map((day) => {
          const isSelected = day.iso === currentDate;
          const isToday = day.iso === today;
          return (
            <button
              key={day.iso}
              type="button"
              onClick={() => router.push(`${basePath}?date=${day.iso}`)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                isSelected
                  ? "bg-amber-500/20 border-amber-500/60 text-amber-200 shadow-sm"
                  : "bg-stone-900/60 border-stone-800 text-stone-400 hover:text-stone-200 hover:bg-stone-800"
              }`}
              title={`${day.weekday}, ${day.dayNum}`}
            >
              <span>{day.label}</span>
              {isToday && (
                <span
                  className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-amber-400" : "bg-amber-500/70"}`}
                  title="Hoje"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
