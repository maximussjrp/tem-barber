"use client";

import React from "react";
import {
  CategoryNode,
  ClientFinancialRoutine,
  RecurringExpensePreset,
} from "@/lib/financial/routines-client";

export interface RecurringExpenseCardProps {
  preset: RecurringExpensePreset;
  category: CategoryNode | null;
  routines: ClientFinancialRoutine[];
  onConfigureNew: () => void;
  onEditRoutine: (routine: ClientFinancialRoutine) => void;
  onDeactivateRoutine: (routine: ClientFinancialRoutine) => void;
  onReactivateRoutine: (routine: ClientFinancialRoutine) => void;
}

function formatCurrency(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return "R$ 0,00";
  const num = typeof val === "number" ? val : parseFloat(String(val));
  if (isNaN(num)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(num);
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function RecurringExpenseCard({
  preset,
  category,
  routines,
  onConfigureNew,
  onEditRoutine,
  onDeactivateRoutine,
  onReactivateRoutine,
}: RecurringExpenseCardProps) {
  const isCategoryUnavailable = !category;
  const count = routines.length;

  let countText = "Configurar";
  if (count === 1) {
    countText = "1 conta configurada";
  } else if (count > 1) {
    countText = `${count} contas configuradas`;
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 space-y-4 flex flex-col justify-between">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-[var(--text-primary)]">
                {preset.name}
              </h2>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface-raised)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                {preset.code}
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
                {preset.suggestedAmountMode === "FIXED" ? "Sugerido: Fixa" : "Sugerido: Variável"}
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
              {preset.description}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
          <span className="text-xs text-[var(--text-muted)] font-medium">
            {countText}
          </span>
          <button
            type="button"
            onClick={onConfigureNew}
            disabled={isCategoryUnavailable}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Configurar nova conta
          </button>
        </div>

        {isCategoryUnavailable && (
          <p className="text-[11px] text-red-400 italic">
            Categoria financeira indisponível
          </p>
        )}
      </div>

      {routines.length > 0 && (
        <div className="border-t border-[var(--border-subtle)] pt-3 space-y-2">
          <p className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            Contas Cadastradas
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {routines.map((routine) => {
              const startDisplay = routine.startDateCivil || routine.startDate;
              const endDisplay = routine.endDateCivil !== undefined ? routine.endDateCivil : routine.endDate;

              return (
                <div
                  key={routine.id}
                  className="p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[var(--text-primary)] truncate">
                      {routine.title}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium">
                        {routine.amountMode === "FIXED" ? "FIXA" : "VARIÁVEL"}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${
                          routine.isActive
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                        }`}
                      >
                        {routine.isActive ? "Ativa" : "Inativa"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                    <span>{formatCurrency(routine.baseAmount)}</span>
                    <span>Dia {routine.dueDay}</span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]/50">
                    <span>
                      Início: {formatDate(startDisplay)}
                      {endDisplay ? ` | Fim: ${formatDate(endDisplay)}` : ""}
                    </span>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onEditRoutine(routine)}
                        className="text-amber-500 hover:underline font-medium"
                      >
                        Editar
                      </button>
                      {routine.isActive ? (
                        <button
                          type="button"
                          onClick={() => onDeactivateRoutine(routine)}
                          className="text-red-400 hover:underline font-medium"
                        >
                          Desativar
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onReactivateRoutine(routine)}
                          className="text-emerald-400 hover:underline font-medium"
                        >
                          Reativar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
