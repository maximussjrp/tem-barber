"use client";

import { useState } from "react";
import { ScheduleBlock } from "./types";
import { formatTime } from "./utils";

export function ScheduleBlockDetailsModal({
  block,
  memberName,
  mode = "admin",
  onClose,
  onDeleted,
}: {
  block: ScheduleBlock;
  memberName: string;
  mode?: "admin" | "member";
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDelete = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const endpoint =
        mode === "member"
          ? `/api/member/schedule-blocks/${block.id}`
          : `/api/admin/schedule-blocks/${block.id}`;
      const res = await fetch(endpoint, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        onDeleted(block.id);
        onClose();
      } else {
        setErrorMsg(data.message ?? data.error ?? "Erro ao excluir bloqueio.");
      }
    } catch {
      setErrorMsg("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  };

  const periodStr = block.allDay
    ? "Dia inteiro"
    : `${formatTime(block.startDate)} - ${formatTime(block.endDate)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[var(--surface-1)] border border-[var(--border-subtle)] w-full max-w-md rounded-2xl p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <h3 className="text-base font-bold text-stone-200 flex items-center gap-2">
            <span>🔒</span> Agenda bloqueada
          </h3>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded-lg text-stone-400 hover:bg-stone-800 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="bg-stone-900/90 border border-stone-800 rounded-xl p-4 space-y-2 text-xs">
          <div>
            <span className="text-stone-400 font-semibold">Profissional: </span>
            <span className="text-stone-200 font-bold">{memberName}</span>
          </div>
          <div>
            <span className="text-stone-400 font-semibold">Período: </span>
            <span className="text-amber-400 font-bold">{periodStr}</span>
          </div>
          <div>
            <span className="text-stone-400 font-semibold">Motivo: </span>
            <span className="text-stone-200">{block.reason || "Sem motivo especificado"}</span>
          </div>
        </div>

        {errorMsg && <p className="text-xs font-semibold text-red-400">{errorMsg}</p>}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="py-3 px-4 rounded-xl border border-stone-800 text-xs font-bold text-stone-300 hover:bg-stone-800 transition-colors disabled:opacity-50"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="py-3 px-4 rounded-xl bg-red-950/60 hover:bg-red-900/80 text-red-200 border border-red-800/60 text-xs font-bold transition-colors disabled:opacity-50"
          >
            {loading ? "Excluindo..." : "Excluir bloqueio"}
          </button>
        </div>
      </div>
    </div>
  );
}
