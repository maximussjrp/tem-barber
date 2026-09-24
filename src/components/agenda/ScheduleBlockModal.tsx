"use client";

import { useState } from "react";
import { Member } from "./types";
import { formatTime, INPUT_CLASS, LABEL_INPUT } from "./utils";

export function ScheduleBlockModal({
  members,
  currentDate,
  initialMemberId,
  initialStartTime,
  scopedMemberId,
  mode = "admin",
  onClose,
  onCreated,
}: {
  members: Member[];
  currentDate: string;
  initialMemberId?: string;
  initialStartTime?: string;
  scopedMemberId?: string;
  mode?: "admin" | "member";
  onClose: () => void;
  onCreated: () => void;
}) {
  const isMemberMode = mode === "member" || !!scopedMemberId;
  const targetMemberId = scopedMemberId ?? initialMemberId ?? members[0]?.id ?? "";
  const [memberId, setMemberId] = useState(targetMemberId);
  const [date, setDate] = useState(currentDate);
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState(initialStartTime ?? "10:00");
  const [endTime, setEndTime] = useState(() => {
    if (!initialStartTime) return "11:00";
    const [h, m] = initialStartTime.split(":").map(Number);
    const endH = (h + 1) % 24;
    return `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  });
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ appointmentId: string; start: string; end: string; customerName: string }> | null>(null);

  const REASON_SUGGESTIONS = [
    "Compromisso pessoal",
    "Consulta médica",
    "Saída externa",
    "Intervalo",
    "Reunião",
    "Outro",
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setConflicts(null);

    const activeMemberId = isMemberMode ? targetMemberId : memberId;
    if (!activeMemberId) {
      setErrorMsg("Selecione o profissional.");
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      setErrorMsg("Informe o motivo do bloqueio (mínimo 3 caracteres).");
      return;
    }

    let startDateIso: string;
    let endDateIso: string;

    if (allDay) {
      startDateIso = `${date}T00:00:00.000Z`;
      endDateIso = `${date}T23:59:59.999Z`;
    } else {
      if (!startTime || !endTime) {
        setErrorMsg("Horários de início e fim são obrigatórios.");
        return;
      }
      if (endTime <= startTime) {
        setErrorMsg("Horário final deve ser maior que o inicial.");
        return;
      }
      startDateIso = `${date}T${startTime}:00.000Z`;
      endDateIso = `${date}T${endTime}:00.000Z`;
    }

    setLoading(true);
    try {
      const endpoint = isMemberMode ? "/api/member/schedule-blocks" : "/api/admin/schedule-blocks";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: activeMemberId,
          startDate: startDateIso,
          endDate: endDateIso,
          reason: trimmedReason,
          allDay,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        onCreated();
        onClose();
      } else {
        if (data.conflicts && Array.isArray(data.conflicts)) {
          setConflicts(data.conflicts);
        }
        setErrorMsg(data.message ?? data.error ?? "Erro ao criar bloqueio de agenda.");
      }
    } catch {
      setErrorMsg("Erro de conexão ao criar bloqueio.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
            <span>🔒</span> Bloquear Agenda
          </h3>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded-lg text-stone-400 hover:bg-stone-800 transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isMemberMode ? (
            <div>
              <label className={LABEL_INPUT}>Profissional *</label>
              <select
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                className={INPUT_CLASS}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.user.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className={LABEL_INPUT}>Profissional</label>
              <div className="py-2 text-sm font-semibold text-[var(--text-primary)]">
                {members.find((m) => m.id === targetMemberId)?.user?.name ?? "Meu usuário"}
              </div>
            </div>
          )}

          <div>
            <label className={LABEL_INPUT}>Data *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={INPUT_CLASS}
              required
            />
          </div>

          <div className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              id="allDayCheck"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
            />
            <label
              htmlFor="allDayCheck"
              className="text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
            >
              Dia inteiro
            </label>
          </div>

          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_INPUT}>Início *</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={INPUT_CLASS}
                  required={!allDay}
                />
              </div>
              <div>
                <label className={LABEL_INPUT}>Fim *</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={INPUT_CLASS}
                  required={!allDay}
                />
              </div>
            </div>
          )}

          <div>
            <label className={LABEL_INPUT}>Motivo do bloqueio *</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Consulta médica, Almoço..."
              className={INPUT_CLASS}
              required
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {REASON_SUGGESTIONS.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setReason(sug)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:border-[var(--gold)] hover:text-[var(--gold)] transition-colors"
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-red-300 text-xs font-medium space-y-2">
              <p>{errorMsg}</p>
              {conflicts && conflicts.length > 0 && (
                <div className="border-t border-red-800/40 pt-2 space-y-1">
                  <p className="font-bold text-[11px] text-red-200">Agendamentos conflitantes:</p>
                  {conflicts.map((c) => (
                    <div key={c.appointmentId} className="text-[11px] text-red-300">
                      • {c.customerName} ({formatTime(c.start)} - {formatTime(c.end)})
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="py-3 px-4 rounded-xl border border-[var(--border-subtle)] text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-bold transition-colors disabled:opacity-50"
            >
              {loading ? "Bloqueando..." : "Bloquear agenda"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
