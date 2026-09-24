"use client";

import React, { useState } from "react";
import {
  Appointment,
  AppStatus,
  Member,
  NewAppointmentInitialState,
  ScheduleBlock,
} from "./types";
import {
  computeAppointmentLayouts,
  formatTime,
  getTodayStr,
  HOUR_END,
  HOUR_START,
  isoToMinutes,
  minutesToLocalInput,
  minutesToTop,
  nowBR,
  ROW_HEIGHT,
  SLOT_MIN,
} from "./utils";
import { AppointmentBlock } from "./AppointmentBlock";

export function CalendarGrid({
  appointments,
  scheduleBlocks,
  members,
  filterMember,
  onEdit,
  onCancel,
  onDelete,
  onSelectScheduleBlock,
  onStatusChange,
  onAppointmentUpdated,
  onOpenComanda,
  currentDate,
  onEmptySlotClick,
  barbershopName,
  mode = "admin",
}: {
  appointments: Appointment[];
  scheduleBlocks: ScheduleBlock[];
  members: Member[];
  filterMember: string;
  onEdit: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
  onDelete?: (a: Appointment) => void;
  onSelectScheduleBlock: (b: ScheduleBlock, memberName: string) => void;
  onStatusChange: (id: string, status: AppStatus) => void;
  onAppointmentUpdated: (a: Appointment) => void;
  onOpenComanda: (a: Appointment) => void;
  currentDate: string;
  onEmptySlotClick: (initialState: NewAppointmentInitialState) => void;
  barbershopName: string;
  mode?: "admin" | "member";
}) {
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const hours: number[] = [];
  for (let h = HOUR_START; h < HOUR_END; h++) hours.push(h);
  const slotMinutes: number[] = [];
  for (let minutes = HOUR_START * 60; minutes < HOUR_END * 60; minutes += SLOT_MIN) {
    slotMinutes.push(minutes);
  }
  const totalHeight = (((HOUR_END - HOUR_START) * 60) / SLOT_MIN) * ROW_HEIGHT;

  const visibleMembers = filterMember
    ? members.filter((m) => m.id === filterMember)
    : members;

  const byMember: Record<string, Appointment[]> = {};
  for (const a of appointments) {
    const barberId = a.barber?.id;
    if (barberId) {
      if (!byMember[barberId]) byMember[barberId] = [];
      byMember[barberId].push(a);
    }
  }

  const nowBRVal = nowBR();
  const showNowLine = currentDate === getTodayStr();
  const nowMinutes = nowBRVal.getUTCHours() * 60 + nowBRVal.getUTCMinutes();
  const nowTop = minutesToTop(nowMinutes);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[var(--background)]">
      {/* Header with barber names */}
      <div className="shrink-0 flex border-b border-[var(--border-subtle)] bg-[var(--surface-1)]">
        <div className="shrink-0 w-14 border-r border-[var(--border-subtle)]" />
        <div className="flex flex-1 border-l border-[var(--border-subtle)]">
          {visibleMembers.map((m) => (
            <div
              key={m.id}
              className="flex-1 min-w-[280px] lg:min-w-[320px] px-3 py-2.5 border-r border-[var(--border-subtle)] text-center"
            >
              <p className="text-sm font-bold text-[var(--text-primary)] truncate">
                {m.user?.name}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {m.startTime && m.endTime ? `${m.startTime} - ${m.endTime}` : "Sem horário"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Grid container */}
      <div className="flex-1 overflow-auto flex">
        {/* Time gutter */}
        <div
          className="shrink-0 w-14 relative select-none border-r border-[var(--border-subtle)] bg-[var(--background)]"
          style={{ height: totalHeight }}
        >
          {hours.map((h) => (
            <div
              key={h}
              className="absolute left-0 right-0 flex items-start justify-end pr-2"
              style={{ top: minutesToTop(h * 60), height: ROW_HEIGHT * 2 }}
            >
              <span className="text-[10px] text-[var(--text-muted)] tabular-nums -mt-1.5">
                {String(h).padStart(2, "0")}:00
              </span>
            </div>
          ))}
        </div>

        {/* Member columns */}
        <div className="flex flex-1 border-l border-[var(--border-subtle)]">
          {visibleMembers.map((m) => {
            const hasActiveBlock =
              activeBlockId && (byMember[m.id] ?? []).some((a) => a.id === activeBlockId);
            return (
              <div
                key={m.id}
                className={`flex-1 min-w-[280px] lg:min-w-[320px] relative border-r border-[var(--border-subtle)] ${hasActiveBlock ? "z-30" : "z-10"}`}
              >
                {/* Grid lines */}
                <div className="absolute inset-0 pointer-events-none">
                  {hours.map((h) => (
                    <div key={h}>
                      <div
                        className="absolute left-0 right-0 border-t border-[var(--border-subtle)]"
                        style={{ top: minutesToTop(h * 60) }}
                      />
                      <div
                        className="absolute left-0 right-0"
                        style={{
                          top: minutesToTop(h * 60 + 30),
                          borderTop: "1px solid rgba(255,255,255,0.03)",
                        }}
                      />
                    </div>
                  ))}
                  <div
                    className="absolute left-0 right-0 border-t border-[var(--border-subtle)]"
                    style={{ top: totalHeight }}
                  />
                </div>

                {/* Now line */}
                {showNowLine && (
                  <div
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: nowTop }}
                  >
                    <div className="h-0.5 bg-red-500/70" />
                    <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500" />
                  </div>
                )}

                {/* Appointments and Schedule Blocks */}
                <div className="relative" style={{ height: totalHeight }}>
                  {slotMinutes.map((minutes) => {
                    const startMinutes = m.startTime
                      ? (() => {
                          const [h, min] = m.startTime.split(":").map(Number);
                          return h * 60 + min;
                        })()
                      : null;

                    const endMinutes = m.endTime
                      ? (() => {
                          const [h, min] = m.endTime.split(":").map(Number);
                          return h * 60 + min;
                        })()
                      : null;

                    const isOutOfWorkHours =
                      startMinutes === null ||
                      endMinutes === null ||
                      minutes < startMinutes ||
                      minutes >= endMinutes;

                    if (isOutOfWorkHours) {
                      return (
                        <div
                          key={`${m.id}-${minutes}`}
                          className="absolute left-0 right-0 z-0 bg-stone-950/40 cursor-not-allowed bg-[repeating-linear-gradient(45deg,rgba(0,0,0,0.1),rgba(0,0,0,0.1)_6px,transparent_6px,transparent_12px)] flex items-center justify-center"
                          style={{ top: minutesToTop(minutes), height: ROW_HEIGHT }}
                          title="Fora do expediente"
                        >
                          <span className="text-[9px] font-semibold text-stone-600 uppercase tracking-wider select-none">
                            Fora de expediente
                          </span>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={`${m.id}-${minutes}`}
                        type="button"
                        onClick={() =>
                          onEmptySlotClick({
                            memberId: m.id,
                            dateTime: minutesToLocalInput(currentDate, minutes),
                          })
                        }
                        className="absolute left-0 right-0 z-0 text-left hover:bg-amber-500/5 focus:bg-amber-500/10 focus:outline-none focus:ring-1 focus:ring-amber-500/50 transition-colors"
                        style={{ top: minutesToTop(minutes), height: ROW_HEIGHT }}
                        title={`Novo agendamento ${m.user?.name} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`}
                        aria-label={`Novo agendamento ${m.user?.name} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`}
                      />
                    );
                  })}

                  {/* Schedule Blocks */}
                  {scheduleBlocks
                    .filter((b) => b.memberId === m.id)
                    .map((b) => {
                      const startMin = isoToMinutes(b.startDate);
                      const endMin = b.allDay ? HOUR_END * 60 : isoToMinutes(b.endDate);
                      const top = minutesToTop(Math.max(HOUR_START * 60, startMin));
                      const height = Math.max(
                        ROW_HEIGHT,
                        minutesToTop(Math.min(HOUR_END * 60, endMin)) - top
                      );
                      const periodStr = b.allDay
                        ? "Dia inteiro"
                        : `${formatTime(b.startDate)} - ${formatTime(b.endDate)}`;

                      return (
                        <div
                          key={b.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectScheduleBlock(b, m.user?.name || "Profissional");
                          }}
                          className="absolute left-1 right-1 z-20 rounded-xl p-2.5 cursor-pointer border border-stone-700/60 bg-[repeating-linear-gradient(45deg,rgba(41,37,36,0.9),rgba(41,37,36,0.9)_10px,rgba(28,25,23,0.95)_10px,rgba(28,25,23,0.95)_20px)] shadow-md hover:border-amber-500/50 transition-all flex flex-col justify-between select-none"
                          style={{ top, height }}
                          title={`Bloqueio: ${b.reason || "Agenda bloqueada"}`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[11px] font-bold text-stone-300 flex items-center gap-1">
                              <span>🔒</span> Agenda bloqueada
                            </span>
                            <span className="text-[10px] font-mono text-amber-400 font-bold">
                              {periodStr}
                            </span>
                          </div>
                          <p className="text-[11px] text-stone-400 truncate mt-0.5">
                            {b.reason || "Sem motivo especificado"}
                          </p>
                        </div>
                      );
                    })}

                  {computeAppointmentLayouts(byMember[m.id] ?? []).map(
                    ({ appointment: a, top, height, leftPct, widthPct }) => (
                      <AppointmentBlock
                        key={a.id}
                        appointment={a}
                        onEdit={onEdit}
                        onCancel={onCancel}
                        onDelete={onDelete}
                        onStatusChange={onStatusChange}
                        onAppointmentUpdated={onAppointmentUpdated}
                        onOpenComanda={onOpenComanda}
                        isOpen={activeBlockId === a.id}
                        onToggleOpen={(open) => setActiveBlockId(open ? a.id : null)}
                        barbershopName={barbershopName}
                        mode={mode}
                        style={{
                          top,
                          height,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                        }}
                      />
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
