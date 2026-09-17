"use client";

import { useState, useEffect, useRef, useTransition, useCallback } from "react";
import { Dialog } from "@/components/ui/Dialog";
import {
  FinancialTitleDetail,
  LeafCategoryOption,
  PAYABLE_CLASSIFICATIONS,
  RECEIVABLE_CLASSIFICATIONS,
  PAYMENT_METHODS,
  generateUUIDv4,
  formatCurrencyBRL,
  getDerivedStatusBadge,
  getKindBadge,
  getPaymentMethodLabel,
} from "@/lib/financial/accounts-client";

interface TitleDetailModalProps {
  isOpen: boolean;
  titleId: string | null;
  onClose: () => void;
  onSuccess: () => void;
  leafCategories: LeafCategoryOption[];
}

export function TitleDetailModal({
  isOpen,
  titleId,
  onClose,
  onSuccess,
  leafCategories,
}: TitleDetailModalProps) {
  const [detail, setDetail] = useState<FinancialTitleDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");

  const [activeTab, setActiveTab] = useState<"details" | "settle" | "edit" | "cancel">("details");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [isPending, startTransition] = useTransition();

  // Double submit ref locks
  const isSubmittingRef = useRef(false);

  // Settlement Form State
  const [settlePrincipal, setSettlePrincipal] = useState("");
  const [settleDiscount, setSettleDiscount] = useState("0");
  const [settleInterest, setSettleInterest] = useState("0");
  const [settleFine, setSettleFine] = useState("0");
  const [settleMethod, setSettleMethod] = useState("PIX");
  const [settleNotes, setSettleNotes] = useState("");

  // Edit Form State
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editOriginalAmount, setEditOriginalAmount] = useState("");
  const [editIssuedOn, setEditIssuedOn] = useState("");
  const [editDueOn, setEditDueOn] = useState("");

  // Cancel Form State
  const [cancelReason, setCancelReason] = useState("");

  const loadDetail = useCallback(async (signal?: AbortSignal) => {
    if (!titleId) return;
    setIsLoading(true);
    setFetchError("");
    try {
      const res = await fetch(`/api/admin/financial/titles/${titleId}`, { signal });
      if (signal?.aborted) return;
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        if (signal?.aborted) return;
        setFetchError(errJson.error || "Não foi possível carregar os detalhes do título.");
        setDetail(null);
        return;
      }
      const data: FinancialTitleDetail = await res.json();
      if (signal?.aborted) return;
      setDetail(data);

      // Pre-fill forms
      setSettlePrincipal(data.outstandingPrincipal || data.originalAmount);
      setSettleDiscount("0");
      setSettleInterest("0");
      setSettleFine("0");
      setSettleMethod("PIX");
      setSettleNotes("");

      setEditTitle(data.title);
      setEditDescription(data.description || "");
      setEditCategoryId(data.category?.id || "");
      setEditOriginalAmount(data.originalAmount);
      setEditIssuedOn(data.issuedOn.slice(0, 10));
      setEditDueOn(data.dueOn.slice(0, 10));

      setCancelReason("");
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError" || signal?.aborted) return;
      setFetchError("Erro de conexão ao carregar detalhes.");
      setDetail(null);
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [titleId]);

  useEffect(() => {
    const controller = new AbortController();
    if (isOpen && titleId) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) {
          setActiveTab("details");
          setActionError("");
          setActionSuccess("");
          void loadDetail(controller.signal);
        }
      });
    } else if (!isOpen) {
      queueMicrotask(() => {
        if (!controller.signal.aborted) {
          setDetail(null);
        }
      });
    }
    return () => {
      controller.abort();
    };
  }, [isOpen, titleId, loadDetail]);

  if (!isOpen) return null;

  // Available categories for edit based on detail.kind
  const availableCategories = leafCategories.filter((cat) => {
    if (!detail) return true;
    if (detail.kind === "PAYABLE") {
      return PAYABLE_CLASSIFICATIONS.includes(cat.classification);
    }
    return RECEIVABLE_CLASSIFICATIONS.includes(cat.classification);
  });

  // Calculate netCash dynamically
  const parsedPrincipal = parseFloat(settlePrincipal) || 0;
  const parsedDiscount = parseFloat(settleDiscount) || 0;
  const parsedInterest = parseFloat(settleInterest) || 0;
  const parsedFine = parseFloat(settleFine) || 0;
  const calculatedNetCash = parsedPrincipal - parsedDiscount + parsedInterest + parsedFine;

  // Settlement submission
  const handleSettle = (e: React.FormEvent) => {
    e.preventDefault();
    setActionError("");
    setActionSuccess("");

    if (isSubmittingRef.current) return;

    if (isNaN(parsedPrincipal) || parsedPrincipal <= 0) {
      setActionError("O valor principal da baixa deve ser maior que zero.");
      return;
    }

    if (parsedDiscount > parsedPrincipal) {
      setActionError("O valor do desconto não pode exceder o valor principal.");
      return;
    }

    isSubmittingRef.current = true;

    startTransition(async () => {
      try {
        const idempotencyKey = generateUUIDv4();
        const payloadMethod = calculatedNetCash === 0 ? null : settleMethod;

        const res = await fetch(`/api/admin/financial/titles/${titleId}/settlements`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            principalAmount: parsedPrincipal,
            discountAmount: parsedDiscount,
            interestAmount: parsedInterest,
            fineAmount: parsedFine,
            method: payloadMethod,
            notes: settleNotes.trim() || undefined,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          setActionError(errJson.error || "Erro ao efetuar baixa do título.");
          return;
        }

        setActionSuccess("Baixa realizada com sucesso!");
        await loadDetail();
        onSuccess();
        setTimeout(() => {
          setActiveTab("details");
          setActionSuccess("");
        }, 1200);
      } catch {
        setActionError("Falha na conexão com o servidor ao dar baixa.");
      } finally {
        isSubmittingRef.current = false;
      }
    });
  };

  // Edit submission (PATCH without `kind`, description: null if empty)
  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    setActionError("");
    setActionSuccess("");

    if (isSubmittingRef.current) return;

    if (!editTitle.trim()) {
      setActionError("Título é obrigatório.");
      return;
    }
    if (!editCategoryId) {
      setActionError("Selecione uma categoria financeira.");
      return;
    }
    const amount = parseFloat(editOriginalAmount);
    if (isNaN(amount) || amount <= 0) {
      setActionError("Valor original deve ser maior que zero.");
      return;
    }
    if (editDueOn < editIssuedOn) {
      setActionError("Data de vencimento não pode ser anterior à data de emissão.");
      return;
    }

    isSubmittingRef.current = true;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/financial/titles/${titleId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editTitle.trim(),
            description: editDescription.trim() ? editDescription.trim() : null,
            categoryId: editCategoryId,
            originalAmount: amount,
            issuedOn: editIssuedOn,
            dueOn: editDueOn,
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          setActionError(errJson.error || "Erro ao atualizar título financeiro.");
          return;
        }

        setActionSuccess("Título atualizado com sucesso!");
        await loadDetail();
        onSuccess();
        setTimeout(() => {
          setActiveTab("details");
          setActionSuccess("");
        }, 1200);
      } catch {
        setActionError("Falha de conexão ao atualizar título.");
      } finally {
        isSubmittingRef.current = false;
      }
    });
  };

  // Cancel submission
  const handleCancel = (e: React.FormEvent) => {
    e.preventDefault();
    setActionError("");
    setActionSuccess("");

    if (isSubmittingRef.current) return;

    if (!cancelReason.trim()) {
      setActionError("Motivo do cancelamento é obrigatório.");
      return;
    }

    isSubmittingRef.current = true;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/financial/titles/${titleId}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: cancelReason.trim(),
          }),
        });

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          setActionError(errJson.error || "Erro ao cancelar título.");
          return;
        }

        setActionSuccess("Título cancelado com sucesso!");
        await loadDetail();
        onSuccess();
        setTimeout(() => {
          setActiveTab("details");
          setActionSuccess("");
        }, 1200);
      } catch {
        setActionError("Falha de conexão ao cancelar título.");
      } finally {
        isSubmittingRef.current = false;
      }
    });
  };

  const statusBadge = detail ? getDerivedStatusBadge(detail.derivedStatus) : null;
  const kindBadge = detail ? getKindBadge(detail.kind) : null;
  const isCancelledOrPaid = detail?.derivedStatus === "CANCELLED" || detail?.derivedStatus === "PAID";
  const hasActiveSettlements = Boolean(detail?.activeSettlements && detail.activeSettlements.length > 0);
  const canCancel = !isCancelledOrPaid && !hasActiveSettlements;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={detail ? detail.title : "Detalhes da Conta"}
      className="max-w-2xl"
    >
      {isLoading ? (
        <div className="p-8 text-center text-sm text-[var(--text-muted)]">
          Carregando informações do título...
        </div>
      ) : fetchError ? (
        <div className="p-4 rounded-lg border border-red-500/30 bg-red-950/40 text-xs text-red-300">
          {fetchError}
        </div>
      ) : detail ? (
        <div className="space-y-4 pt-1">
          {/* Header Badges & Basic Summary */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
            <div className="flex items-center gap-2">
              {kindBadge && (
                <span className={`px-2 py-0.5 text-xs font-bold rounded-full border ${kindBadge.className}`}>
                  {kindBadge.label}
                </span>
              )}
              {statusBadge && (
                <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full border ${statusBadge.className}`}>
                  {statusBadge.label}
                </span>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                Valor Saldo Restante
              </div>
              <div className="text-lg font-extrabold text-[var(--text-primary)]">
                {formatCurrencyBRL(detail.outstandingPrincipal)}
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-[var(--border-subtle)]">
            <button
              type="button"
              onClick={() => {
                setActiveTab("details");
                setActionError("");
                setActionSuccess("");
              }}
              className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors ${
                activeTab === "details"
                  ? "border-[var(--brand)] text-[var(--brand)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              }`}
            >
              Detalhes
            </button>
            {!isCancelledOrPaid && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab("settle");
                  setActionError("");
                  setActionSuccess("");
                }}
                className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors ${
                  activeTab === "settle"
                    ? "border-emerald-500 text-emerald-400"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Dar Baixa / Quitar
              </button>
            )}
            {!isCancelledOrPaid && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab("edit");
                  setActionError("");
                  setActionSuccess("");
                }}
                className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors ${
                  activeTab === "edit"
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Editar
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab("cancel");
                  setActionError("");
                  setActionSuccess("");
                }}
                className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors ${
                  activeTab === "cancel"
                    ? "border-red-500 text-red-400"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Cancelar
              </button>
            )}
          </div>

          {/* Global Action Alerts */}
          {actionError && (
            <div className="rounded-lg border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300">
              {actionError}
            </div>
          )}
          {actionSuccess && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/40 p-3 text-xs text-emerald-300">
              {actionSuccess}
            </div>
          )}

          {/* TAB 1: DETAILS */}
          {activeTab === "details" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 text-xs">
                <div>
                  <span className="text-[var(--text-muted)] font-semibold uppercase tracking-wider block">
                    Categoria
                  </span>
                  <span className="font-bold text-[var(--text-primary)] text-sm">
                    {detail.category ? `${detail.category.code} - ${detail.category.name}` : "Não informada"}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] font-semibold uppercase tracking-wider block">
                    Valor Original
                  </span>
                  <span className="font-bold text-[var(--text-primary)] text-sm">
                    {formatCurrencyBRL(detail.originalAmount)}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] font-semibold uppercase tracking-wider block">
                    Data de Emissão
                  </span>
                  <span className="font-medium text-[var(--text-secondary)]">
                    {new Date(detail.issuedOn).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] font-semibold uppercase tracking-wider block">
                    Data de Vencimento
                  </span>
                  <span className="font-medium text-[var(--text-secondary)]">
                    {new Date(detail.dueOn).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] font-semibold uppercase tracking-wider block">
                    Total Já Quitado
                  </span>
                  <span className="font-bold text-emerald-400">
                    {formatCurrencyBRL(detail.settledPrincipal)}
                  </span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] font-semibold uppercase tracking-wider block">
                    Criado Por
                  </span>
                  <span className="font-medium text-[var(--text-secondary)]">
                    {detail.createdBy?.name || "Sistema"}
                  </span>
                </div>
              </div>

              {detail.description && (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-3 text-xs">
                  <span className="text-[var(--text-muted)] font-semibold uppercase tracking-wider block mb-1">
                    Observações / Descrição
                  </span>
                  <p className="text-[var(--text-primary)] whitespace-pre-line">{detail.description}</p>
                </div>
              )}

              {detail.cancelledAt && (
                <div className="rounded-lg border border-red-500/20 bg-red-950/20 p-3 text-xs space-y-1">
                  <span className="text-red-400 font-bold uppercase tracking-wider block">
                    Título Cancelado
                  </span>
                  <p className="text-[var(--text-secondary)]">
                    Data: {new Date(detail.cancelledAt).toLocaleString("pt-BR")}
                  </p>
                  {detail.cancelReason && (
                    <p className="text-red-300">Motivo: {detail.cancelReason}</p>
                  )}
                </div>
              )}

              {/* Settlement History */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Histórico de Baixas ({detail.activeSettlements?.length || 0})
                </h3>
                {!detail.activeSettlements || detail.activeSettlements.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] italic">Nenhuma baixa efetuada ainda.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {detail.activeSettlements.map((st) => (
                      <div
                        key={st.id}
                        className="p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-xs space-y-1"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-[var(--text-primary)]">
                            {formatCurrencyBRL(st.netCash)} ({getPaymentMethodLabel(st.method)})
                          </span>
                          <span className="text-[var(--text-muted)] text-[11px]">
                            {new Date(st.settledAt).toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-[11px] text-[var(--text-secondary)] pt-1">
                          <div>Principal: {formatCurrencyBRL(st.principalAmount)}</div>
                          <div>Desconto: {formatCurrencyBRL(st.discountAmount)}</div>
                          <div>Juros: {formatCurrencyBRL(st.interestAmount)}</div>
                          <div>Multa: {formatCurrencyBRL(st.fineAmount)}</div>
                        </div>
                        {st.notes && (
                          <div className="text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)] mt-1">
                            Notas: {st.notes}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: SETTLE */}
          {activeTab === "settle" && !isCancelledOrPaid && (
            <form onSubmit={handleSettle} className="space-y-4">
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-300 font-medium">
                Insira os valores correspondentes ao pagamento/recebimento desta conta.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                    Valor Principal a Quitar (R$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={settlePrincipal}
                    onChange={(e) => setSettlePrincipal(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                    Forma de Pagamento {calculatedNetCash === 0 ? "(Sem Movimento)" : "*"}
                  </label>
                  {calculatedNetCash === 0 ? (
                    <input
                      type="text"
                      disabled
                      value="Sem movimento financeiro (R$ 0,00)"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-sm text-[var(--text-muted)]"
                    />
                  ) : (
                    <select
                      value={settleMethod}
                      onChange={(e) => setSettleMethod(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                    >
                      {PAYMENT_METHODS.map((pm) => (
                        <option key={pm.value} value={pm.value}>
                          {pm.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                    Desconto (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={settleDiscount}
                    onChange={(e) => setSettleDiscount(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                    Juros (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={settleInterest}
                    onChange={(e) => setSettleInterest(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                    Multa (R$)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={settleFine}
                    onChange={(e) => setSettleFine(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                  Observações da Baixa (Opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Número de comprovante, notas adicionais..."
                  value={settleNotes}
                  onChange={(e) => setSettleNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setActiveTab("details")}
                  disabled={isPending}
                  className="px-4 py-2 text-xs font-bold rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-50"
                >
                  {isPending ? "Efetuando Baixa..." : "Confirmar Baixa"}
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: EDIT */}
          {activeTab === "edit" && !isCancelledOrPaid && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                  Título / Nome da conta *
                </label>
                <input
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                  Categoria Financeira *
                </label>
                <select
                  required
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                >
                  <option value="">Selecione...</option>
                  {availableCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                  Valor Original (R$) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={editOriginalAmount}
                  onChange={(e) => setEditOriginalAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                    Data de Emissão *
                  </label>
                  <input
                    type="date"
                    required
                    value={editIssuedOn}
                    onChange={(e) => setEditIssuedOn(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                    Data de Vencimento *
                  </label>
                  <input
                    type="date"
                    required
                    value={editDueOn}
                    onChange={(e) => setEditDueOn(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                  Observações (Opcional)
                </label>
                <textarea
                  rows={2}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setActiveTab("details")}
                  disabled={isPending}
                  className="px-4 py-2 text-xs font-bold rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {isPending ? "Salvando..." : "Salvar Alterações"}
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: CANCEL */}
          {activeTab === "cancel" && canCancel && (
            <form onSubmit={handleCancel} className="space-y-4">
              <div className="rounded-lg border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-300">
                Atenção: O cancelamento anula esta conta. Informe o motivo do cancelamento abaixo.
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
                  Motivo do Cancelamento *
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="Explique o motivo do cancelamento desta conta..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setActiveTab("details")}
                  disabled={isPending}
                  className="px-4 py-2 text-xs font-bold rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {isPending ? "Cancelando..." : "Confirmar Cancelamento"}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
