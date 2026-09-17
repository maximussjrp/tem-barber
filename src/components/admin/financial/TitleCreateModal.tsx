"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/Dialog";
import {
  LeafCategoryOption,
  PAYABLE_CLASSIFICATIONS,
  RECEIVABLE_CLASSIFICATIONS,
} from "@/lib/financial/accounts-client";
import { todayIsoBR } from "@/lib/time-utils";

interface TitleCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  leafCategories: LeafCategoryOption[];
}

export function TitleCreateModal({
  isOpen,
  onClose,
  onSuccess,
  leafCategories,
}: TitleCreateModalProps) {
  const [kind, setKind] = useState<"PAYABLE" | "RECEIVABLE">("PAYABLE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [originalAmount, setOriginalAmount] = useState("");
  const [issuedOn, setIssuedOn] = useState(() => todayIsoBR());
  const [dueOn, setDueOn] = useState(() => todayIsoBR());

  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!isOpen) return null;

  // Filter categories by selected kind classification
  const availableCategories = leafCategories.filter((cat) => {
    if (kind === "PAYABLE") {
      return PAYABLE_CLASSIFICATIONS.includes(cat.classification);
    }
    return RECEIVABLE_CLASSIFICATIONS.includes(cat.classification);
  });

  const handleKindSelect = (selectedKind: "PAYABLE" | "RECEIVABLE") => {
    setKind(selectedKind);
    // Clear category if current category is incompatible with the new kind
    if (categoryId) {
      const allowedClassifications =
        selectedKind === "PAYABLE" ? PAYABLE_CLASSIFICATIONS : RECEIVABLE_CLASSIFICATIONS;
      const currentCat = leafCategories.find((c) => c.id === categoryId);
      if (currentCat && !allowedClassifications.includes(currentCat.classification)) {
        setCategoryId("");
      }
    }
  };

  const handleResetAndClose = () => {
    setKind("PAYABLE");
    setTitle("");
    setDescription("");
    setCategoryId("");
    setOriginalAmount("");
    setIssuedOn(todayIsoBR());
    setDueOn(todayIsoBR());
    setError("");
    onClose();
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!title.trim()) {
      setError("Título é obrigatório.");
      return;
    }
    if (!categoryId) {
      setError("Selecione uma categoria financeira.");
      return;
    }
    const numAmount = parseFloat(originalAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Valor original deve ser maior que zero.");
      return;
    }
    if (!issuedOn) {
      setError("Data de emissão é obrigatória.");
      return;
    }
    if (!dueOn) {
      setError("Data de vencimento é obrigatória.");
      return;
    }
    if (dueOn < issuedOn) {
      setError("Data de vencimento não pode ser anterior à data de emissão.");
      return;
    }

    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/financial/titles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            categoryId,
            title: title.trim(),
            description: description.trim() || undefined,
            originalAmount: numAmount,
            issuedOn,
            dueOn,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          setError(errJson.error || "Erro ao criar título financeiro.");
          return;
        }

        onSuccess();
        handleResetAndClose();
      } catch {
        setError("Não foi possível conectar ao servidor.");
      }
    });
  }

  return (
    <Dialog isOpen={isOpen} onClose={handleResetAndClose} title="Nova Conta / Título" className="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Kind Toggle */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Tipo de conta
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleKindSelect("PAYABLE")}
              className={`px-3 py-2 text-xs font-bold rounded-lg border transition-colors ${
                kind === "PAYABLE"
                  ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                  : "bg-[var(--surface-raised)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              Conta a pagar
            </button>
            <button
              type="button"
              onClick={() => handleKindSelect("RECEIVABLE")}
              className={`px-3 py-2 text-xs font-bold rounded-lg border transition-colors ${
                kind === "RECEIVABLE"
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "bg-[var(--surface-raised)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              Conta a receber
            </button>
          </div>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Título / Descrição curta *
          </label>
          <input
            type="text"
            required
            placeholder="Ex: Aluguel da barbearia, Conta de Energia..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
          />
        </div>

        {/* Category */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Categoria Financeira *
          </label>
          <select
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
          >
            <option value="">Selecione uma categoria...</option>
            {availableCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        {/* Amount */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Valor Original (R$) *
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="0,00"
            value={originalAmount}
            onChange={(e) => setOriginalAmount(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
          />
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Data de Emissão *
            </label>
            <input
              type="date"
              required
              value={issuedOn}
              onChange={(e) => setIssuedOn(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Data de Vencimento *
            </label>
            <input
              type="date"
              required
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
            />
          </div>
        </div>

        {/* Description optional */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Observações (Opcional)
          </label>
          <textarea
            rows={2}
            placeholder="Detalhes adicionais da conta..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={handleResetAndClose}
            disabled={isPending}
            className="px-4 py-2 text-xs font-bold rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 text-xs font-bold rounded-lg bg-[var(--brand)] text-black hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Salvando..." : "Salvar Conta"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
