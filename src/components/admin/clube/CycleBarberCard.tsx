"use client";

import { CycleBarberShare } from "@/lib/operations/club-current-cycle";

interface CycleBarberCardProps {
  barber: CycleBarberShare;
}

function brl(v: string | number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pts(v: string | number) {
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export function CycleBarberCard({ barber }: CycleBarberCardProps) {
  const isZero = Number(barber.points) === 0;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 flex flex-col justify-between gap-3">
      {/* Barbeiro Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center font-bold text-sm text-[var(--brand-hover)] shrink-0">
          {barber.name.substring(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm text-[var(--text-primary)] truncate">
            {barber.name}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {barber.servicesCount} {barber.servicesCount === 1 ? "serviço realizado" : "serviços realizados"}
          </p>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-2 border-t border-[var(--border-subtle)] pt-3 text-center">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Pontos</p>
          <p className="text-xs font-bold text-[var(--text-primary)]">
            {pts(barber.points)}
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Rateio (%)</p>
          <p className={`text-xs font-bold ${isZero ? "text-[var(--text-muted)]" : "text-amber-400"}`}>
            {barber.sharePercent}%
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Estimado</p>
          <p className={`text-xs font-bold ${isZero ? "text-[var(--text-muted)]" : "text-green-400"}`}>
            {brl(barber.estimatedAmount)}
          </p>
        </div>
      </div>
    </div>
  );
}
