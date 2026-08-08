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
  executorId?: string | null;
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

type ClubBenefit = {
  id: string;
  benefitType: string;
  serviceId?: string | null;
  productId?: string | null;
  isUnlimited?: boolean;
  availableQty?: number | null;
  includedQty?: number | null;
  discountPercent?: number | string | null;
  canUse?: boolean;
};

type ClubBalance = {
  benefits?: ClubBenefit[];
};

interface Props {
  item: Item;
  busy: boolean;
  comandaClosed: boolean;
  onConclude: (id: string) => void;
  onCancel: (id: string) => void;
  onUpdate?: (id: string, body: { clubBenefitRequested: boolean; requestedClubPlanBenefitId: string | null }) => void;
  onAddDuplicate?: (item: Item) => void;
  clubBalance?: ClubBalance | null;
}

export function ComandaItemCard({ item, busy, comandaClosed, onConclude, onCancel, onUpdate, onAddDuplicate, clubBalance }: Props) {
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
  let simulatedBenefit: ClubBenefit | null = null;
  if (!isClubApplied && item.clubBenefitRequested && clubBalance && clubBalance.benefits) {
    simulatedBenefit = clubBalance.benefits.find(
      (b) => b.id === item.requestedClubPlanBenefitId
    ) ?? null;
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
  const matchingBenefits = clubBalance?.benefits?.filter((b) => {
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
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-text-secondary">
                {Number(item.quantity)}x {brl(item.unitPrice)}
                {clubCovered && <span className="text-emerald-400 font-bold ml-1">(Coberto pelo Clube)</span>}
                {clubDiscount > 0 && <span className="text-emerald-400 font-bold ml-1">(-{brl(clubDiscount)} Desconto Clube)</span>}
              </p>
              {!comandaClosed && !isCancelled && onAddDuplicate && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAddDuplicate(item)}
                  title={item.type === "SERVICE" ? "Adicionar mais um deste serviço" : "Adicionar mais um deste produto"}
                  className="w-5 h-5 flex items-center justify-center text-xs font-bold rounded-full bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-[var(--text-inverse)] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  +
                </button>
              )}
            </div>
          )}
          
          {!comandaClosed && !isCancelled && (item.type === "SERVICE" || item.type === "PRODUCT") && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {matchingBenefits.map((b) => {
                const isIncluded = b.benefitType === "INCLUDED_SERVICE";
                const label = isIncluded
                  ? (b.isUnlimited ? "Usar pelo Clube (Ilimitado)" : `Usar pelo Clube (${b.availableQty} / ${b.includedQty} restantes)`)
                  : `Aplicar Desconto Clube (${b.discountPercent}%)`;
                const canUse = b.canUse !== undefined ? b.canUse : (b.isUnlimited || (b.availableQty && b.availableQty > 0));
                const isDisabled = isIncluded && !canUse && !item.clubBenefitRequested;
                const isSelected = !!(item.clubBenefitRequested && item.requestedClubPlanBenefitId === b.id);

                return (
                  <div key={b.id} className="flex items-center gap-2 rounded border border-[var(--gold-border)] bg-[var(--brand-subtle)] px-2 py-1.5">
                    <label className={`flex items-center gap-2 text-xs font-semibold text-[var(--gold)] ${isDisabled ? "opacity-50" : "cursor-pointer"}`}>
                      <input
                        type="checkbox"
                        disabled={isDisabled || busy}
                        checked={isSelected}
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
                    {!isSelected && !isDisabled && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (onUpdate) {
                            onUpdate(item.id, {
                              clubBenefitRequested: true,
                              requestedClubPlanBenefitId: b.id,
                            });
                          }
                        }}
                        className="rounded bg-[var(--gold)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-inverse)] disabled:opacity-50"
                      >
                        Aplicar benefício do clube
                      </button>
                    )}
                    {isSelected && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                        Benefício aplicado
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
