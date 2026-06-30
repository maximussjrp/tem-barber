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
  serviceId?: string | null;
  productId?: string | null;
  executor?: { id: string; user: { name: string } } | null;
  clubBenefitRequested?: boolean;
  requestedClubPlanBenefitId?: string | null;
  clubBenefitUsage?: {
    id: string;
    benefitType: string;
    coveredAmount: string | null;
    discountAmount: string | null;
    status: string;
  } | null;
};

interface Props {
  item: Item;
  busy: boolean;
  comandaClosed: boolean;
  onConclude: (id: string) => void;
  onCancel: (id: string) => void;
  onUpdate?: (id: string, body: any) => void;
  clubBalance?: any;
}

export function ComandaItemCard({ item, busy, comandaClosed, onConclude, onCancel, onUpdate, clubBalance }: Props) {
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

  const isClubApplied = item.clubBenefitUsage && item.clubBenefitUsage.status === "APPLIED";
  
  // Find simulated benefit from clubBalance if requested and not closed
  let simulatedBenefit = null;
  if (!isClubApplied && item.clubBenefitRequested && clubBalance && clubBalance.benefits) {
    simulatedBenefit = clubBalance.benefits.find(
      (b: any) => b.id === item.requestedClubPlanBenefitId
    );
  }

  const clubCovered = 
    (isClubApplied && item.clubBenefitUsage?.benefitType === "INCLUDED_SERVICE") ||
    (simulatedBenefit && simulatedBenefit.benefitType === "INCLUDED_SERVICE");

  let clubDiscount = 0;
  if (isClubApplied && item.clubBenefitUsage?.benefitType !== "INCLUDED_SERVICE") {
    clubDiscount = Number(item.clubBenefitUsage?.discountAmount || 0);
  } else if (simulatedBenefit && simulatedBenefit.benefitType !== "INCLUDED_SERVICE") {
    const pct = Number(simulatedBenefit.discountPercent || 0);
    const original = Number(item.total);
    clubDiscount = Number(((original * pct) / 100).toFixed(2));
  }

  // Find matching benefits to allow toggle
  const matchingBenefits = clubBalance?.benefits?.filter((b: any) => {
    if (item.type === "SERVICE" && b.serviceId === item.serviceId) return true;
    if (item.type === "PRODUCT" && b.productId === item.productId) return true;
    return false;
  }) || [];

  return (
    <>
      <div className={`p-4 border-b border-border-subtle flex flex-col md:flex-row md:items-center justify-between gap-4 ${isCancelled ? 'opacity-50' : ''}`}>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-text-primary">{item.description}</h3>
            {item.clubBenefitRequested && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--brand-subtle)] text-[var(--gold)] font-bold border border-[var(--gold-border)]">
                Plano Clube
              </span>
            )}
          </div>
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
              {clubCovered && <span className="text-emerald-400 font-bold ml-1">(Coberto pelo Clube)</span>}
              {clubDiscount > 0 && <span className="text-emerald-400 font-bold ml-1">(-{brl(clubDiscount)} Desconto Clube)</span>}
            </p>
          )}
          
          {!comandaClosed && !isCancelled && (item.type === "SERVICE" || item.type === "PRODUCT") && matchingBenefits.map((b: any) => {
            const isIncluded = b.benefitType === "INCLUDED_SERVICE";
            const label = isIncluded 
              ? `Usar pelo Clube (${b.availableQty} / ${b.includedQty} restantes)`
              : `Aplicar Desconto Clube (${b.discountPercent}%)`;
            const isDisabled = isIncluded && b.availableQty <= 0 && !item.clubBenefitRequested;

            return (
              <label key={b.id} className={`flex items-center gap-2 mt-2 text-xs font-semibold text-[var(--gold)] ${isDisabled ? "opacity-50" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  disabled={isDisabled || busy}
                  checked={!!(item.clubBenefitRequested && item.requestedClubPlanBenefitId === b.id)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (onUpdate) {
                      onUpdate(item.id, {
                        clubBenefitRequested: checked,
                        requestedClubPlanBenefitId: checked ? b.id : null,
                      });
                    }
                  }}
                  className="rounded border-[var(--border-subtle)] focus:ring-[var(--gold)]"
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
        <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto">
          <span className="font-bold text-text-primary">
            {item.type === "DISCOUNT" ? "-" : ""}
            {clubCovered ? brl(0) : brl(Number(item.total) - clubDiscount)}
          </span>
          
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
