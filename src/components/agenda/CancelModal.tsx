"use client";

import { useState } from "react";
import { Appointment } from "./types";
import { formatTime, INPUT_CLASS, LABEL_INPUT } from "./utils";

export function CancelModal({
  appointment,
  mode = "admin",
  onClose,
  onCancelled,
}: {
  appointment: Appointment;
  mode?: "admin" | "member";
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
      const cancelUrl =
        mode === "member"
          ? `/api/member/agenda/${appointment.id}/status`
          : `/api/admin/appointments/${appointment.id}`;
      const res = await fetch(cancelUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED", notes: reason || null }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? data.error ?? "Erro.");
      }
      onCancelled(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao cancelar.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[var(--surface-2)] border border-[var(--border-medium)] rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
        <h2 className="text-base font-bold text-[var(--text-primary)]">Cancelar agendamento</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          <span className="font-semibold text-[var(--text-primary)]">{appointment.customer.name}</span>
          {" · "}{formatTime(appointment.dateTime)}
        </p>
        <div className="space-y-1.5">
          <label className={LABEL_INPUT}>Motivo (opcional)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ex: cliente solicitou..."
            title="Motivo do cancelamento"
            className={`${INPUT_CLASS} resize-none`}
          />
        </div>
        {error && (
          <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors text-sm font-semibold"
          >
            Voltar
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="flex-1 py-3 rounded-lg bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white font-bold transition-colors text-sm"
          >
            {saving ? "Cancelando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
