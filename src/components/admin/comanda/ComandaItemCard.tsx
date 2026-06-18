"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Item = {
  id: string;
  type: string;
  status: string;
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  executor?: { id: string; user: { name: string } } | null;
};

interface Props {
  item: Item;
  busy: boolean;
  comandaClosed: boolean;
  onConclude: (id: string) => void;
  onCancel: (id: string) => void;
}

export function ComandaItemCard({ item, busy, comandaClosed, onConclude, onCancel }: Props) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  function brl(value: string | number) {
    return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  const isDone = item.status === "DONE";
  const isCancelled = item.status === "CANCELLED";

  const handleCancelClick = () => {
    setIsConfirmOpen(true);
  };

  const handleConfirmCancel = () => {
    setIsConfirmOpen(false);
    onCancel(item.id);
  };

  return (
    <>
      <div className={`p-4 border-b border-border-subtle flex flex-col md:flex-row md:items-center justify-between gap-4 ${isCancelled ? 'opacity-50' : ''}`}>
        <div className="flex-1">
          <h3 className="font-semibold text-text-primary">{item.description}</h3>
          <p className="text-xs text-text-muted mt-1">
            {item.type === "SERVICE" ? "Serviço" : item.type === "PRODUCT" ? "Produto" : item.type === "DISCOUNT" ? "Desconto" : "Acréscimo"} 
            {" • "}
            <span className={item.status === "DONE" ? "text-success" : item.status === "CANCELLED" ? "text-danger" : "text-warning"}>
              {item.status === "DONE" ? "Concluído" : item.status === "CANCELLED" ? "Cancelado" : "Pendente"}
            </span>
            {item.executor && ` • ${item.executor.user.name}`}
          </p>
          {(item.type === "SERVICE" || item.type === "PRODUCT") && (
            <p className="text-xs text-text-secondary mt-1">
              {Number(item.quantity)}x {brl(item.unitPrice)}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto">
          <span className="font-bold text-text-primary">{item.type === "DISCOUNT" ? "-" : ""}{brl(item.total)}</span>
          
          <div className="flex items-center gap-2">
            {!isDone && !isCancelled && !comandaClosed && item.type !== "DISCOUNT" && item.type !== "SURCHARGE" && (
              <button
                disabled={busy}
                onClick={() => onConclude(item.id)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-success-subtle text-success border border-success/20 hover:bg-success/20 transition-colors disabled:opacity-50"
              >
                Concluir
              </button>
            )}
            {!isCancelled && !comandaClosed && (
              <button
                disabled={busy}
                onClick={handleCancelClick}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-danger-subtle text-danger border border-danger/20 hover:bg-danger/20 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmCancel}
        title="Cancelar Item"
        description={`Tem certeza que deseja cancelar "${item.description}"?`}
        confirmLabel="Sim, cancelar item"
        cancelLabel="Voltar"
        variant="danger"
        isLoading={busy}
      />
    </>
  );
}
