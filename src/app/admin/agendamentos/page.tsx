"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

interface AppService {
  service: { name: string; durationMin: number };
  priceApplied: string;
}

interface Appointment {
  id: string;
  dateTime: string;
  totalPrice: string;
  durationMin: number;
  status: AppStatus;
  notes: string | null;
  customer: { id: string; name: string; phone: string };
  barber: { id: string; user: { name: string; avatarUrl: string | null } };
  services: AppService[];
}

interface Member {
  id: string;
  user: { name: string };
}

interface Service {
  id: string;
  name: string;
  price: string;
  durationMin: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<AppStatus, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Não compareceu",
};

const STATUS_BG: Record<AppStatus, string> = {
  PENDING:   "bg-amber-500/15 border-amber-500/30 text-amber-200",
  CONFIRMED: "bg-sky-500/15 border-sky-500/30 text-sky-100",
  COMPLETED: "bg-emerald-500/15 border-emerald-500/30 text-emerald-100",
  CANCELLED: "bg-[var(--surface-3)] border-[var(--border-subtle)] text-[var(--text-muted)]",
  NO_SHOW:   "bg-red-500/15 border-red-500/30 text-red-300",
};

const LABEL_INPUT = "text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]";
const INPUT_CLASS =
  "w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)] transition-colors text-sm";

// Calendar config
const HOUR_START = 7;
const HOUR_END = 22;
const SLOT_MIN = 30;
const ROW_HEIGHT = 48; // px per 30-min slot

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Brasil é fixo em UTC-3 desde a abolição do horário de verão em 2019
const BR_OFFSET_MS = -3 * 3600 * 1000;
function toBR(date: Date): Date {
  return new Date(date.getTime() + BR_OFFSET_MS);
}

function getTodayStr() {
  const br = toBR(new Date());
  return br.toISOString().slice(0, 10);
}

function shiftDate(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function formatDateFull(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function isoToMinutes(iso: string) {
  const br = toBR(new Date(iso));
  return br.getUTCHours() * 60 + br.getUTCMinutes();
}

function minutesToTop(minutes: number) {
  return ((minutes - HOUR_START * 60) / SLOT_MIN) * ROW_HEIGHT;
}

function minutesToHeight(durationMin: number) {
  return (durationMin / SLOT_MIN) * ROW_HEIGHT;
}

// ─── Appointment Modal ────────────────────────────────────────────────────────

function AppointmentModal({
  appointment,
  members,
  barbershopServices,
  currentDate,
  onClose,
  onSaved,
}: {
  appointment: Appointment | null;
  members: Member[];
  barbershopServices: Service[];
  currentDate: string;
  onClose: () => void;
  onSaved: (a: Appointment) => void;
}) {
  const isEdit = !!appointment;
  const [memberId, setMemberId] = useState(appointment?.barber.id ?? "");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(
    appointment
      ? appointment.services
          .map((s) => {
            const match = barbershopServices.find((bs) => bs.name === s.service.name);
            return match?.id ?? "";
          })
          .filter(Boolean)
      : []
  );
  const [dateTime, setDateTime] = useState(() => {
    if (appointment) {
      const d = new Date(appointment.dateTime);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }
    return `${currentDate}T09:00`;
  });
  const [customerName, setCustomerName] = useState(appointment?.customer.name ?? "");
  const [customerPhone, setCustomerPhone] = useState(appointment?.customer.phone ?? "");
  const [notes, setNotes] = useState(appointment?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggleService = (id: string) =>
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!memberId) { setError("Selecione um barbeiro."); return; }
    if (selectedServiceIds.length === 0) { setError("Selecione ao menos um serviço."); return; }
    if (!dateTime) { setError("Informe data e hora."); return; }
    if (!isEdit && !customerPhone.trim()) { setError("Informe o telefone do cliente."); return; }
    setSaving(true);
    try {
      let res: Response;
      if (isEdit) {
        res = await fetch(`/api/admin/appointments/${appointment!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId, serviceIds: selectedServiceIds, dateTime, notes }),
        });
      } else {
        res = await fetch("/api/admin/appointments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memberId,
            serviceIds: selectedServiceIds,
            dateTime,
            customerName: customerName.trim() || undefined,
            customerPhone: customerPhone.trim(),
            notes: notes || undefined,
          }),
        });
      }
      if (!res.ok) throw new Error((await res.json()).error ?? "Erro ao salvar.");
      onSaved(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--border-medium)] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-[var(--surface-2)] border-b border-[var(--border-subtle)] px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-base font-bold text-[var(--text-primary)]">
            {isEdit ? "Editar Agendamento" : "Novo Agendamento"}
          </h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" title="Fechar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-1.5">
            <label className={LABEL_INPUT}>Barbeiro</label>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} title="Barbeiro" className={INPUT_CLASS}>
              <option value="">Selecione...</option>
              {members.map((m) => (<option key={m.id} value={m.id}>{m.user.name}</option>))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={LABEL_INPUT}>Serviços</label>
            <div className="border border-stone-800 rounded-lg divide-y divide-stone-800 max-h-40 overflow-y-auto">
              {barbershopServices.length === 0 ? (
                <p className="px-4 py-3 text-sm text-stone-500">Nenhum serviço cadastrado.</p>
              ) : (
                barbershopServices.map((s) => {
                  const checked = selectedServiceIds.includes(s.id);
                  return (
                    <label key={s.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${checked ? "bg-amber-500/5" : "hover:bg-stone-800/40"}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleService(s.id)} title={s.name} className="accent-amber-500" />
                      <span className="flex-1 text-sm text-stone-300">{s.name}</span>
                      <span className="text-xs text-stone-500">{s.durationMin}min</span>
                      <span className="text-xs text-amber-400 font-semibold">
                        {Number(s.price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={LABEL_INPUT}>Data e hora</label>
            <input type="datetime-local" value={dateTime} onChange={(e) => setDateTime(e.target.value)} title="Data e hora" className={INPUT_CLASS} />
          </div>
          {!isEdit && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className={LABEL_INPUT}>Nome do cliente</label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nome" title="Nome do cliente" className={INPUT_CLASS} />
              </div>
              <div className="space-y-1.5">
                <label className={LABEL_INPUT}>Telefone</label>
                <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="(11) 99999-9999" title="Telefone do cliente" className={INPUT_CLASS} />
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <label className={LABEL_INPUT}>Observações</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Observações opcionais..." title="Observações" className={`${INPUT_CLASS} resize-none`} />
          </div>
          {error && <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-3 rounded-xl border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors text-sm font-semibold">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-gold flex-1 py-3">{saving ? "Salvando..." : isEdit ? "Salvar" : "Criar agendamento"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Cancel Modal ─────────────────────────────────────────────────────────────

function CancelModal({
  appointment,
  onClose,
  onCancelled,
}: {
  appointment: Appointment;
  onClose: () => void;
  onCancelled: (a: Appointment) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleCancel = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED", notes: reason || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Erro.");
      onCancelled(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao cancelar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--border-medium)] rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
        <h2 className="text-base font-bold text-[var(--text-primary)]">Cancelar agendamento</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">{appointment.customer.name}</span>
          {" · "}{formatTime(appointment.dateTime)}
        </p>
        <div className="space-y-1.5">
          <label className={LABEL_INPUT}>Motivo (opcional)</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Ex: cliente solicitou..." title="Motivo do cancelamento" className={`${INPUT_CLASS} resize-none`} />
        </div>
        {error && <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-400">{error}</div>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors text-sm font-semibold">Voltar</button>
          <button onClick={handleCancel} disabled={saving} className="flex-1 py-3 rounded-lg bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-bold transition-colors text-sm">
            {saving ? "Cancelando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Appointment Block (calendar cell) ───────────────────────────────────────

function AppointmentBlock({
  appointment,
  onEdit,
  onCancel,
  onStatusChange,
  onOpenComanda,
}: {
  appointment: Appointment;
  onEdit: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
  onStatusChange: (id: string, status: AppStatus) => void;
  onOpenComanda: (a: Appointment) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const startMin = isoToMinutes(appointment.dateTime);
  const top = minutesToTop(startMin);
  const height = Math.max(minutesToHeight(appointment.durationMin), ROW_HEIGHT);

  const isTerminal = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status);
  const serviceNames = appointment.services.map((s) => s.service.name).join(", ");
  const price = parseFloat(appointment.totalPrice).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const changeStatus = async (status: AppStatus) => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`/api/admin/appointments/${appointment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated: Appointment = await res.json();
        onStatusChange(updated.id, updated.status);
        setOpen(false);
      }
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="absolute left-1 right-1 z-10" style={{ top, height }}>
      {/* Block */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full h-full rounded-lg border px-2 py-1 text-left overflow-hidden transition-all shadow-sm ${STATUS_BG[appointment.status]} ${isTerminal ? "opacity-50" : "hover:brightness-110 cursor-pointer"}`}
      >
        <p className="text-[11px] font-bold tabular-nums leading-tight">
          {formatTime(appointment.dateTime)}
        </p>
        <p className="text-[11px] font-semibold leading-tight truncate">{appointment.customer.name}</p>
        {height >= 56 && (
          <p className="text-[10px] opacity-70 leading-tight truncate">{serviceNames}</p>
        )}
      </button>

      {/* Detail popup */}
      {open && (
        <div className="absolute left-full ml-2 top-0 z-50 w-64 bg-[var(--surface-2)] border border-[var(--border-medium)] rounded-2xl shadow-2xl p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-[var(--text-primary)]">{appointment.customer.name}</p>
              <p className="text-xs text-[var(--text-muted)]">{appointment.customer.phone}</p>
            </div>
            <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_BG[appointment.status]}`}>
              {STATUS_LABEL[appointment.status]}
            </span>
          </div>
          <div className="text-xs text-[var(--text-secondary)] space-y-1">
            <p className="flex items-center gap-1.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {formatTime(appointment.dateTime)} · {appointment.durationMin}min
            </p>
            <p className="flex items-center gap-1.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              {serviceNames}
            </p>
            <p className="font-bold text-[var(--gold)]">{price}</p>
          </div>
          {appointment.notes && (
            <p className="text-xs text-[var(--text-muted)] italic border-l-2 border-[var(--gold-border)] pl-2">{appointment.notes}</p>
          )}
          {!isTerminal && (
            <div className="space-y-1.5 border-t border-[var(--border-subtle)] pt-3">
              {appointment.status === "PENDING" && (
                <button onClick={() => changeStatus("CONFIRMED")} disabled={loadingStatus} className="w-full text-xs font-bold px-3 py-2 rounded-xl bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 border border-sky-500/20 transition-colors disabled:opacity-50">
                  ✓ Confirmar
                </button>
              )}
              {appointment.status === "CONFIRMED" && (
                <button onClick={() => changeStatus("COMPLETED")} disabled={loadingStatus} className="w-full text-xs font-bold px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors disabled:opacity-50">
                  ✓ Concluir
                </button>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => { setOpen(false); onOpenComanda(appointment); }} className="col-span-2 text-xs font-bold px-2 py-1.5 rounded-xl bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/20 transition-colors">
                  Abrir atendimento
                </button>
                <button onClick={() => { setOpen(false); onEdit(appointment); }} className="text-xs font-bold px-2 py-1.5 rounded-xl bg-[var(--surface-3)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] border border-[var(--border-subtle)] transition-colors">
                  ✏️ Editar
                </button>
                <button onClick={() => { setOpen(false); onCancel(appointment); }} disabled={loadingStatus} className="text-xs font-bold px-2 py-1.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-50">
                  Cancelar
                </button>
                <button onClick={() => changeStatus("NO_SHOW")} disabled={loadingStatus} className="col-span-2 text-xs font-bold px-2 py-1.5 rounded-xl bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[var(--surface-3)] border border-[var(--border-subtle)] transition-colors disabled:opacity-50">
                  Não compareceu
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Calendar Grid ────────────────────────────────────────────────────────────

function CalendarGrid({
  appointments,
  members,
  filterMember,
  onEdit,
  onCancel,
  onStatusChange,
  onOpenComanda,
  currentDate,
}: {
  appointments: Appointment[];
  members: Member[];
  filterMember: string;
  onEdit: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
  onStatusChange: (id: string, status: AppStatus) => void;
  onOpenComanda: (a: Appointment) => void;
  currentDate: string;
}) {
  const hours: number[] = [];
  for (let h = HOUR_START; h < HOUR_END; h++) hours.push(h);
  const totalHeight = ((HOUR_END - HOUR_START) * 60 / SLOT_MIN) * ROW_HEIGHT;

  const visibleMembers = filterMember
    ? members.filter((m) => m.id === filterMember)
    : members;

  const byMember: Record<string, Appointment[]> = {};
  for (const a of appointments) {
    if (!byMember[a.barber.id]) byMember[a.barber.id] = [];
    byMember[a.barber.id].push(a);
  }

  const now = new Date();
  const nowBR = toBR(now);
  const today = getTodayStr();
  const nowMinutes = nowBR.getUTCHours() * 60 + nowBR.getUTCMinutes();
  const showNowLine =
    currentDate === today && nowMinutes >= HOUR_START * 60 && nowMinutes < HOUR_END * 60;
  const nowTop = minutesToTop(nowMinutes);

  return (
    <div className="flex min-w-0">
      {/* Time gutter */}
      <div className="shrink-0 w-14 relative select-none" style={{ height: totalHeight }}>
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
        {showNowLine && (
          <div className="absolute right-0 left-0 flex items-center justify-end pr-1" style={{ top: nowTop - 8 }}>
            <span className="text-[9px] text-red-400 font-bold tabular-nums">
              {String(nowBR.getUTCHours()).padStart(2, "0")}:{String(nowBR.getUTCMinutes()).padStart(2, "0")}
            </span>
          </div>
        )}
      </div>

      {/* Member columns */}
      <div className="flex flex-1 border-l border-[var(--border-subtle)] overflow-x-auto">
        {visibleMembers.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm py-20">
            Nenhum barbeiro encontrado
          </div>
        ) : (
          visibleMembers.map((m) => (
            <div key={m.id} className="flex-1 min-w-[160px] relative border-r border-[var(--border-subtle)]">
              {/* Grid lines */}
              <div className="absolute inset-0 pointer-events-none">
                {hours.map((h) => (
                  <div key={h}>
                    <div className="absolute left-0 right-0 border-t border-[var(--border-subtle)]" style={{ top: minutesToTop(h * 60) }} />
                    <div className="absolute left-0 right-0" style={{ top: minutesToTop(h * 60 + 30), borderTop: "1px solid rgba(255,255,255,0.03)" }} />
                  </div>
                ))}
                <div className="absolute left-0 right-0 border-t border-[var(--border-subtle)]" style={{ top: totalHeight }} />
              </div>

              {/* Now line */}
              {showNowLine && (
                <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: nowTop }}>
                  <div className="h-0.5 bg-red-500/70" />
                  <div className="absolute -left-1 -top-1 w-2 h-2 rounded-full bg-red-500" />
                </div>
              )}

              {/* Appointments */}
              <div className="relative" style={{ height: totalHeight }}>
                {(byMember[m.id] ?? []).map((a) => (
                  <AppointmentBlock
                    key={a.id}
                    appointment={a}
                    onEdit={onEdit}
                    onCancel={onCancel}
                    onStatusChange={onStatusChange}
                    onOpenComanda={onOpenComanda}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Content ─────────────────────────────────────────────────────────────

function AgendamentosContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date");
  const today = getTodayStr();
  const currentDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [barbershopServices, setBarbershopServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMember, setFilterMember] = useState("");

  const [editTarget, setEditTarget] = useState<Appointment | null | "new">(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);

  const fetchData = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date });
      if (filterMember) params.set("memberId", filterMember);
      const [apptRes, svcRes] = await Promise.all([
        fetch(`/api/admin/appointments?${params}`),
        fetch("/api/admin/services"),
      ]);
      const apptData = await apptRes.json();
      const svcData = await svcRes.json();
      setAppointments(apptData.appointments ?? []);
      setMembers(apptData.members ?? []);
      setBarbershopServices(Array.isArray(svcData) ? svcData : (svcData.services ?? []));
    } finally {
      setLoading(false);
    }
  }, [filterMember]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData(currentDate);
  }, [currentDate, fetchData]);

  const navigate = (days: number) => {
    router.push(`/admin/agendamentos?date=${shiftDate(currentDate, days)}`);
  };

  const handleSaved = (a: Appointment) => {
    setAppointments((prev) => {
      const idx = prev.findIndex((x) => x.id === a.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = a; return next; }
      return [...prev, a];
    });
    setEditTarget(null);
  };

  const handleCancelled = (a: Appointment) => {
    setAppointments((prev) => prev.map((x) => (x.id === a.id ? a : x)));
    setCancelTarget(null);
  };

  const handleStatusChange = (id: string, status: AppStatus) => {
    setAppointments((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
  };

  const handleOpenComanda = async (appointment: Appointment) => {
    const res = await fetch("/api/admin/comandas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId: appointment.id }),
    });
    const data = await res.json();
    if (res.ok) {
      router.push(`/admin/comandas/${data.id}`);
    } else {
      alert(data.message ?? data.error ?? "Erro ao abrir atendimento.");
    }
  };

  const confirmed = appointments.filter((a) => a.status === "CONFIRMED").length;
  const pending = appointments.filter((a) => a.status === "PENDING").length;
  const revenue = appointments
    .filter((a) => a.status === "COMPLETED")
    .reduce((s, a) => s + parseFloat(a.totalPrice), 0);

  return (
    <>
      {editTarget !== null && (
        <AppointmentModal
          appointment={editTarget === "new" ? null : editTarget}
          members={members}
          barbershopServices={barbershopServices}
          currentDate={currentDate}
          onClose={() => setEditTarget(null)}
          onSaved={handleSaved}
        />
      )}
      {cancelTarget && (
        <CancelModal
          appointment={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={handleCancelled}
        />
      )}

      <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
        {/* ── Top bar ─────────────────────────────────────────────────── */}
        <div className="shrink-0 px-4 md:px-6 py-3 border-b border-stone-800 flex flex-wrap items-center gap-3 bg-stone-950">
          {/* Date nav */}
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)} className="p-2 rounded-lg text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition-colors" title="Dia anterior">←</button>
            <div className="text-center min-w-[200px]">
              <p className="text-sm font-semibold text-stone-100 capitalize">{formatDateFull(currentDate)}</p>
            </div>
            <button onClick={() => navigate(1)} className="p-2 rounded-lg text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition-colors" title="Próximo dia">→</button>
          </div>

          {currentDate !== today && (
            <button onClick={() => router.push("/admin/agendamentos")} className="text-xs text-amber-500 hover:text-amber-400 font-semibold transition-colors px-2 py-1 rounded border border-amber-800/50 hover:border-amber-600/50">
              Hoje
            </button>
          )}

          <select
            value={filterMember}
            onChange={(e) => setFilterMember(e.target.value)}
            title="Filtrar por barbeiro"
            className="bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm text-stone-300 focus:border-amber-500/80 focus:outline-none transition-colors"
          >
            <option value="">Todos os barbeiros</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}
          </select>

          {/* Stats */}
          <div className="flex items-center gap-3 ml-auto flex-wrap">
            <span className="text-xs text-stone-500">{appointments.length} total</span>
            {confirmed > 0 && <span className="text-xs text-sky-400">{confirmed} confirm.</span>}
            {pending > 0 && <span className="text-xs text-amber-400">{pending} pend.</span>}
            <span className="text-xs text-emerald-400 font-semibold">
              {revenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
            <button
              onClick={() => setEditTarget("new")}
              className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              + Novo
            </button>
          </div>
        </div>

        {/* ── Member column headers ──────────────────────────────────── */}
        {!loading && members.length > 0 && (
          <div className="shrink-0 flex border-b border-[var(--border-subtle)] bg-[var(--surface-1)]">
            <div className="shrink-0 w-14 border-r border-[var(--border-subtle)]" />
            <div className="flex flex-1 overflow-x-auto border-l border-[var(--border-subtle)]">
              {(filterMember ? members.filter((m) => m.id === filterMember) : members).map((m) => {
                const count = appointments.filter(
                  (a) => a.barber.id === m.id && !["CANCELLED", "NO_SHOW"].includes(a.status)
                ).length;
                return (
                  <div key={m.id} className="flex-1 min-w-[160px] px-3 py-2.5 border-r border-[var(--border-subtle)] flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-xl bg-[var(--gold-surface)] border border-[var(--gold-border)] flex items-center justify-center text-[11px] font-bold text-[var(--gold)] font-serif shrink-0">
                      {m.user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[var(--text-primary)] truncate">{m.user.name}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{count} agend.</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Calendar body ──────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-stone-600 text-sm">
              Carregando agenda...
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <p className="text-stone-500">Nenhum barbeiro ativo encontrado.</p>
            </div>
          ) : (
            <CalendarGrid
              appointments={appointments}
              members={members}
              filterMember={filterMember}
              onEdit={(a) => setEditTarget(a)}
              onCancel={(a) => setCancelTarget(a)}
              onStatusChange={handleStatusChange}
              onOpenComanda={handleOpenComanda}
              currentDate={currentDate}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgendamentosPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full py-20 text-stone-600 text-sm">
          Carregando...
        </div>
      }
    >
      <AgendamentosContent />
    </Suspense>
  );
}
