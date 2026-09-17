"use client";

import React, { useRef, useState } from "react";
import {
  CategoryNode,
  ClientFinancialRoutine,
  createRoutineClient,
  endDateToMonth,
  getCurrentCivilMonth,
  monthToEndDate,
  monthToStartDate,
  RecurringExpensePreset,
  startDateToMonth,
  updateRoutineClient,
} from "@/lib/financial/routines-client";

export interface RoutineConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  preset: RecurringExpensePreset;
  category: CategoryNode | null;
  routineToEdit?: ClientFinancialRoutine | null;
  onSuccess: () => void;
}

export function RoutineConfigModal({
  isOpen,
  onClose,
  preset,
  category,
  routineToEdit,
  onSuccess,
}: RoutineConfigModalProps) {
  const isEditing = Boolean(routineToEdit);
  const submitLockRef = useRef(false);

  const [title, setTitle] = useState(() => (routineToEdit ? routineToEdit.title : preset.name));
  const [amountMode, setAmountMode] = useState<"FIXED" | "VARIABLE">(() =>
    routineToEdit ? routineToEdit.amountMode : preset.suggestedAmountMode
  );
  const [baseAmount, setBaseAmount] = useState(() =>
    routineToEdit?.baseAmount ? String(routineToEdit.baseAmount) : ""
  );
  const [dueDay, setDueDay] = useState(() => (routineToEdit ? routineToEdit.dueDay : 10));
  const [startMonth, setStartMonth] = useState(() => {
    if (routineToEdit) {
      const src = routineToEdit.startDateCivil || routineToEdit.startDate;
      return startDateToMonth(src) || getCurrentCivilMonth();
    }
    return getCurrentCivilMonth();
  });
  const [endMonth, setEndMonth] = useState(() => {
    if (routineToEdit) {
      const src = routineToEdit.endDateCivil !== undefined ? routineToEdit.endDateCivil : routineToEdit.endDate;
      return endDateToMonth(src);
    }
    return "";
  });
  const [notes, setNotes] = useState(() => (routineToEdit?.notes ? routineToEdit.notes : ""));

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current) return;

    setErrorMessage(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMessage("Informe o nome da conta.");
      return;
    }

    const numAmount = parseFloat(baseAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setErrorMessage(
        amountMode === "FIXED"
          ? "Informe um valor mensal maior que zero."
          : "Informe um valor estimado maior que zero."
      );
      return;
    }

    const numDueDay = Number(dueDay);
    if (!numDueDay || numDueDay < 1 || numDueDay > 31) {
      setErrorMessage("Informe um dia de vencimento válido (entre 1 e 31).");
      return;
    }

    if (!startMonth) {
      setErrorMessage("Informe o mês inicial.");
      return;
    }

    const formattedStartDate = monthToStartDate(startMonth);
    if (!formattedStartDate) {
      setErrorMessage("Mês inicial inválido.");
      return;
    }

    const formattedEndDate = monthToEndDate(endMonth);

    if (endMonth && formattedEndDate && formattedEndDate < formattedStartDate) {
      setErrorMessage("O mês final não pode ser anterior ao mês inicial.");
      return;
    }

    try {
      submitLockRef.current = true;
      setIsSubmitting(true);

      if (isEditing && routineToEdit) {
        await updateRoutineClient(routineToEdit.id, {
          title: trimmedTitle,
          amountMode,
          baseAmount: String(numAmount),
          dueDay: numDueDay,
          startDate: formattedStartDate,
          endDate: formattedEndDate,
          notes: notes.trim() || null,
        });
      } else {
        if (!category) {
          setErrorMessage("Categoria financeira indisponível.");
          setIsSubmitting(false);
          submitLockRef.current = false;
          return;
        }

        await createRoutineClient({
          categoryId: category.id,
          title: trimmedTitle,
          kind: "PAYABLE",
          amountMode,
          baseAmount: String(numAmount),
          frequency: "MONTHLY",
          dueDay: numDueDay,
          startDate: formattedStartDate,
          endDate: formattedEndDate,
          notes: notes.trim() || null,
        });
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Erro ao salvar rotina financeira.");
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div
      aria-modal="true"
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-6 shadow-xl space-y-5 text-[var(--text-primary)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <h2 className="text-lg font-bold">
            {isEditing ? `Editar Rotina — ${preset.name}` : `Configurar Conta — ${preset.name}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-sm font-medium"
          >
            Fechar
          </button>
        </div>

        {errorMessage && (
          <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 text-xs leading-relaxed">
            {errorMessage}
          </div>
        )}

        <form noValidate onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Nome da conta
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Aluguel da Barbearia"
              className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] focus:outline-none focus:border-amber-500"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                Tipo de valor
              </label>
              <select
                value={amountMode}
                onChange={(e) => setAmountMode(e.target.value as "FIXED" | "VARIABLE")}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] focus:outline-none focus:border-amber-500"
              >
                <option value="FIXED">Fixa (valor recorrente exato)</option>
                <option value="VARIABLE">Variável (valor estimado)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                {amountMode === "FIXED" ? "Valor mensal (R$)" : "Valor estimado (R$)"}
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={baseAmount}
                onChange={(e) => setBaseAmount(e.target.value)}
                placeholder="0,00"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] focus:outline-none focus:border-amber-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                Dia de vencimento
              </label>
              <input
                type="number"
                min="1"
                max="31"
                value={dueDay}
                onChange={(e) => setDueDay(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div>
              <label htmlFor="startMonth-input" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                Mês inicial
              </label>
              <input
                id="startMonth-input"
                type="month"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] focus:outline-none focus:border-amber-500"
                required
              />
            </div>

            <div>
              <label htmlFor="endMonth-input" className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
                Mês final (opcional)
              </label>
              <input
                id="endMonth-input"
                type="month"
                value={endMonth}
                onChange={(e) => setEndMonth(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1 text-[var(--text-secondary)]">
              Observações (opcional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anotações adicionais..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] focus:outline-none focus:border-amber-500 resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-lg border border-[var(--border-subtle)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-black bg-amber-500 hover:bg-amber-400 transition-colors rounded-lg font-semibold disabled:opacity-50"
            >
              {isSubmitting ? "Salvando..." : isEditing ? "Salvar Alterações" : "Criar Rotina"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
