"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { todayIsoBR, formatHeaderDate } from "@/lib/time-utils";
import { formatWhatsAppPhone, generateWhatsAppMessage, generateWhatsAppLink } from "@/lib/whatsapp";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AppointmentService {
  service: { name: string; durationMin: number };
  priceApplied: string;
}

interface Appointment {
  id: string;
  dateTime: string;
  totalPrice: string;
  durationMin: number;
  status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  notes: string | null;
  customer: { name: string; phone: string };
  barbershop?: { name: string };
  services: AppointmentService[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<Appointment["status"], string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Não compareceu",
};

const STATUS_CLASS: Record<Appointment["status"], string> = {
  PENDING: "bg-amber-950/50 text-amber-400 border border-amber-800/60",
  CONFIRMED: "bg-sky-950/50 text-sky-400 border border-sky-800/60",
  COMPLETED: "bg-emerald-950/50 text-emerald-400 border border-emerald-800/60",
  CANCELLED: "bg-stone-800/60 text-stone-500 border border-stone-700/60",
  NO_SHOW: "bg-red-950/50 text-red-400 border border-red-800/60",
};

function formatTime(isoString: string) {
  const d = new Date(isoString);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

function formatDateDisplay(dateStr: string) {
  const todayStr = todayIsoBR();

  const [ty, tm, td] = todayStr.split("-").map(Number);
  const todayObj = new Date(Date.UTC(ty, tm - 1, td));

  const tomorrowObj = new Date(todayObj);
  tomorrowObj.setUTCDate(todayObj.getUTCDate() + 1);
  const tomorrowStr = `${tomorrowObj.getUTCFullYear()}-${String(tomorrowObj.getUTCMonth() + 1).padStart(2, "0")}-${String(tomorrowObj.getUTCDate()).padStart(2, "0")}`;

  const yesterdayObj = new Date(todayObj);
  yesterdayObj.setUTCDate(todayObj.getUTCDate() - 1);
  const yesterdayStr = `${yesterdayObj.getUTCFullYear()}-${String(yesterdayObj.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterdayObj.getUTCDate()).padStart(2, "0")}`;

  const header = formatHeaderDate(dateStr);
  const [weekday, ...rest] = header.split(", ");
  const formatted = rest.join(", ");

  if (dateStr === todayStr) return { label: "Hoje", sub: formatted };
  if (dateStr === tomorrowStr) return { label: "Amanhã", sub: formatted };
  if (dateStr === yesterdayStr) return { label: "Ontem", sub: formatted };
  return { label: weekday.charAt(0).toUpperCase() + weekday.slice(1), sub: formatted };
}

function getTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function shiftDate(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

// ─── Appointment Card ─────────────────────────────────────────────────────────

function AppointmentCard({
  appointment,
  onStatusChange,
}: {
  appointment: Appointment;
  onStatusChange: (id: string, status: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  const changeStatus = async (status: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/member/agenda/${appointment.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json();
        onStatusChange(appointment.id, updated.status);
      }
    } finally {
      setLoading(false);
    }
  };

  const serviceNames = appointment.services.map((s) => s.service.name).join(", ");
  const endTime = (() => {
    const start = new Date(appointment.dateTime);
    start.setUTCMinutes(start.getUTCMinutes() + appointment.durationMin);
    return start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  })();
  const price = parseFloat(appointment.totalPrice).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  const isTerminal = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status);

  // Lógica de Lembrete WhatsApp
  const now = new Date();
  const apptDate = new Date(appointment.dateTime);
  const diffMs = apptDate.getTime() - now.getTime();
  const diffMin = Math.ceil(diffMs / 60000);

  const formattedPhone = formatWhatsAppPhone(appointment.customer.phone);
  const message = generateWhatsAppMessage(
    appointment.customer.name,
    appointment.barbershop?.name || "Barbearia",
    formatTime(appointment.dateTime),
    serviceNames
  );
  const waLink = formattedPhone ? generateWhatsAppLink(appointment.customer.phone, message) : null;

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 transition-opacity ${
        isTerminal ? "opacity-60" : "border-stone-800 bg-stone-900/50"
      } ${isTerminal ? "border-stone-800/50 bg-stone-900/30" : ""}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Time pill */}
          <div className="shrink-0 text-center bg-stone-800 rounded-lg px-3 py-1.5 min-w-[64px]">
            <p className="text-sm font-bold text-stone-100 tabular-nums">{formatTime(appointment.dateTime)}</p>
            <p className="text-[10px] text-stone-500 tabular-nums">{endTime}</p>
          </div>
          {/* Client */}
          <div>
            <p className="text-sm font-semibold text-stone-100">{appointment.customer.name}</p>
            <p className="text-xs text-stone-500">{appointment.customer.phone}</p>
          </div>
        </div>
        <span className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_CLASS[appointment.status]}`}>
          {STATUS_LABEL[appointment.status]}
        </span>
      </div>

      {/* Services */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-stone-400 truncate">{serviceNames}</p>
        <p className="shrink-0 text-sm font-semibold text-amber-400">{price}</p>
      </div>

      {/* Duration */}
      <p className="text-xs text-stone-600">{appointment.durationMin} min</p>

      {/* Notes */}
      {appointment.notes && (
        <p className="text-xs text-stone-500 italic border-l-2 border-stone-700 pl-2">
          {appointment.notes}
        </p>
      )}

      {/* WhatsApp Reminder Section */}
      {appointment.status === "CONFIRMED" && (
        <div className="pt-2 border-t border-stone-800 space-y-2">
          {(diffMin <= 0 || (diffMin > 0 && diffMin <= 30)) && (
            <div className="flex">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${diffMin <= 0 ? "bg-stone-800/40 border-stone-700 text-stone-500" : "bg-amber-500/20 border-amber-500 text-amber-400 animate-pulse"}`}>
                {diffMin <= 0 ? "Horário já passou" : `Faltam ${diffMin} minutos`}
              </span>
            </div>
          )}

          {!formattedPhone ? (
            <p className="text-xs text-stone-600 italic">
              Cliente sem telefone cadastrado ou inválido
            </p>
          ) : (
            <a
              href={waLink || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className={`w-full text-center text-xs font-semibold px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                diffMin > 0 && diffMin <= 30
                  ? "bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold border border-amber-600 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.2)]"
                  : "bg-transparent text-stone-300 hover:bg-stone-800 border border-stone-800"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.706 1.459h.008c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Enviar Lembrete por WhatsApp
            </a>
          )}
        </div>
      )}

      {/* Actions */}
      {!isTerminal && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-stone-800">
          {appointment.status === "PENDING" && (
            <button
              onClick={() => changeStatus("CONFIRMED")}
              disabled={loading}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-sky-900/50 text-sky-400 hover:bg-sky-900 border border-sky-800/60 transition-colors disabled:opacity-50"
            >
              ✓ Confirmar
            </button>
          )}
          {appointment.status === "CONFIRMED" && (
            <button
              onClick={() => changeStatus("COMPLETED")}
              disabled={loading}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-900/50 text-emerald-400 hover:bg-emerald-900 border border-emerald-800/60 transition-colors disabled:opacity-50"
            >
              ✓ Finalizar
            </button>
          )}
          {["PENDING", "CONFIRMED"].includes(appointment.status) && (
            <>
              <button
                onClick={() => changeStatus("NO_SHOW")}
                disabled={loading}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-950/50 text-red-400 hover:bg-red-950 border border-red-800/60 transition-colors disabled:opacity-50"
              >
                Não compareceu
              </button>
              <button
                onClick={() => changeStatus("CANCELLED")}
                disabled={loading}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-stone-800/60 text-stone-400 hover:bg-stone-800 border border-stone-700 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Agenda Content (needs useSearchParams → wrapped in Suspense) ─────────────

function AgendaContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateParam = searchParams.get("date");
  const today = getTodayStr();
  const currentDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAppointments = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/member/agenda?date=${date}`);
      if (res.ok) {
        setAppointments(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAppointments(currentDate);
  }, [currentDate, fetchAppointments]);

  const navigate = (days: number) => {
    const newDate = shiftDate(currentDate, days);
    router.push(`/member/agenda?date=${newDate}`);
  };

  const handleStatusChange = (id: string, newStatus: string) => {
    setAppointments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: newStatus as Appointment["status"] } : a))
    );
  };

  const dateDisplay = formatDateDisplay(currentDate);
  const confirmed = appointments.filter((a) => a.status === "CONFIRMED").length;
  const pending = appointments.filter((a) => a.status === "PENDING").length;
  const completed = appointments.filter((a) => a.status === "COMPLETED").length;
  const revenue = appointments
    .filter((a) => a.status === "COMPLETED")
    .reduce((sum, a) => sum + parseFloat(a.totalPrice), 0);

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      {/* Day navigation */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-lg text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition-colors"
          title="Dia anterior"
        >
          ←
        </button>
        <div className="text-center">
          <h1 className="text-2xl font-serif font-bold text-stone-100">{dateDisplay.label}</h1>
          <p className="text-sm text-stone-500 mt-0.5">{dateDisplay.sub}</p>
          {currentDate !== today && (
            <button
              onClick={() => router.push("/member/agenda")}
              className="mt-1 text-xs text-amber-500 hover:text-amber-400 transition-colors"
            >
              Voltar a hoje
            </button>
          )}
        </div>
        <button
          onClick={() => navigate(1)}
          className="p-2 rounded-lg text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition-colors"
          title="Próximo dia"
        >
          →
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total", value: appointments.length, color: "text-stone-300" },
          { label: "Confirmados", value: confirmed, color: "text-sky-400" },
          { label: "Pendentes", value: pending, color: "text-amber-400" },
          {
            label: "Faturado",
            value: revenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
            color: "text-emerald-400",
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-stone-900/50 border border-stone-800 rounded-xl p-3 text-center">
            <p className={`text-lg font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-[10px] text-stone-600 mt-0.5">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-stone-900/40 border border-stone-800/50 animate-pulse" />
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-4">📅</p>
          <p className="text-stone-400 font-medium">Nenhum agendamento para este dia</p>
          <p className="text-stone-600 text-sm mt-1">Aproveite para descansar!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Active first */}
          {appointments
            .filter((a) => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status))
            .map((a) => (
              <AppointmentCard key={a.id} appointment={a} onStatusChange={handleStatusChange} />
            ))}
          {/* Completed / terminal */}
          {appointments.filter((a) => ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status))
            .length > 0 && (
            <div className="pt-2">
              <p className="text-xs font-semibold text-stone-600 uppercase tracking-wider mb-2">
                Finalizados ({completed})
              </p>
              <div className="space-y-3">
                {appointments
                  .filter((a) => ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status))
                  .map((a) => (
                    <AppointmentCard key={a.id} appointment={a} onStatusChange={handleStatusChange} />
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function AgendaPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 max-w-2xl mx-auto">
          <div className="h-12 rounded-xl bg-stone-900/40 animate-pulse mb-6" />
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-stone-900/40 animate-pulse" />
            ))}
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-stone-900/40 animate-pulse" />
            ))}
          </div>
        </div>
      }
    >
      <AgendaContent />
    </Suspense>
  );
}
