"use client";

import { useState } from "react";
import { Appointment } from "./types";
import { formatDateTime } from "./utils";
import { extractServiceQuantities } from "@/lib/appointments/notes-metadata";

export function DeleteAppointmentModal({
  appointment,
  onClose,
  onDeleted,
}: {
  appointment: Appointment;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDelete = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/appointments/${appointment.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        onDeleted(appointment.id);
      } else {
        setErrorMsg(data.message ?? data.error ?? "Erro ao excluir agendamento.");
      }
    } catch {
      setErrorMsg("Erro de conexão ao excluir agendamento.");
    } finally {
      setLoading(false);
    }
  };

  const quantitiesMap = extractServiceQuantities(appointment.notes);
  const serviceNames = appointment.services
    .map((s) => {
      const qty = quantitiesMap[s.serviceId ?? s.service?.id] ?? 1;
      return qty > 1 ? `${s.service.name} x${qty}` : s.service.name;
    })
    .join(", ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[var(--surface-1)] border border-red-500/30 w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-red-400">Excluir agendamento?</h3>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded-lg text-stone-400 hover:bg-stone-800 transition-colors"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
          Esta ação remove definitivamente o agendamento da agenda e do histórico. Use Cancelar quando desejar manter o registro do cancelamento.
        </p>

        <div className="bg-[var(--surface-2)] border border-[var(--border-subtle)] rounded-xl p-4 space-y-2 text-xs">
          <div>
            <span className="text-[var(--text-muted)] font-semibold">Cliente: </span>
            <span className="text-[var(--text-primary)] font-bold">{appointment.customer.name}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)] font-semibold">Profissional: </span>
            <span className="text-[var(--text-primary)]">{appointment.barber.user.name}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)] font-semibold">Data/Hora: </span>
            <span className="text-[var(--text-primary)]">{formatDateTime(appointment.dateTime)}</span>
          </div>
          {serviceNames && (
            <div>
              <span className="text-[var(--text-muted)] font-semibold">Serviços: </span>
              <span className="text-[var(--text-primary)]">{serviceNames}</span>
            </div>
          )}
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-red-300 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="py-3 px-4 rounded-xl border border-[var(--border-subtle)] text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-colors disabled:opacity-50 flex items-center justify-center"
          >
            {loading ? "Excluindo..." : "Excluir definitivamente"}
          </button>
        </div>
      </div>
    </div>
  );
}
