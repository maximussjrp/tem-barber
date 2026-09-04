"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/purity, react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback, useRef } from "react";
import { CommissionNav } from "@/components/admin/commissions/CommissionNav";

type MemberOverviewItem = {
  member: {
    id: string;
    name: string;
    role: string;
  };
  currentCycle: {
    id: string;
    cycleNumber: number;
    status: "OPEN" | "PAID";
    grossCommission: number;
    adjustmentsTotal: number;
    advancesTotal: number;
    remainingBalance: number;
    openedAt: string;
  } | null;
};

type MemberDetail = {
  member: { id: string; name: string; role: string };
  currentCycle: {
    id: string;
    cycleNumber: number;
    status: string;
    grossCommission: number;
    adjustmentsTotal: number;
    advancesTotal: number;
    remainingBalance: number;
    openedAt: string;
    payableItems: Array<{
      id: string;
      type: "RELEASE" | "REVERSAL";
      amount: number;
      sourceKind: string;
      createdAt: string;
    }>;
    adjustments: Array<{
      id: string;
      type: "CREDIT" | "DEBIT";
      amount: number;
      reason: string;
      createdAt: string;
    }>;
  } | null;
  historicalCycles: Array<{
    id: string;
    cycleNumber: number;
    status: string;
    grossCommission: number;
    adjustmentsTotal: number;
    advancesTotal: number;
    finalPayoutAmount: number;
    remainingBalance: number;
    openedAt: string;
    closedAt: string | null;
    paidAt: string | null;
  }>;
  advances: Array<{
    id: string;
    cycleId: string;
    amount: number;
    paymentMethod: string;
    disbursedAt: string;
    notes: string | null;
    reversals: Array<{
      id: string;
      amount: number;
      returnMethod: string;
      reason: string;
      returnedAt: string;
    }>;
  }>;
  payouts: Array<{
    id: string;
    cycleId: string;
    amount: number;
    paymentMethod: string;
    paidAt: string;
    notes: string | null;
  }>;
};

function brl(val: number | string | undefined | null) {
  const n = Number(val || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(isoStr: string | null | undefined) {
  if (!isoStr) return "-";
  try {
    return new Date(isoStr).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return isoStr;
  }
}

export default function CommissionPaymentsPage() {
  const [overview, setOverview] = useState<MemberOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Detail Modal
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberDetail, setMemberDetail] = useState<MemberDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Advance Modal State
  const [advanceModal, setAdvanceModal] = useState<{
    isOpen: boolean;
    memberId: string;
    memberName: string;
    availableForAdvance: number;
    alreadyAdvanced: number;
    grossAccrued: number;
    idempotencyKey: string;
  } | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceMethod, setAdvanceMethod] = useState("PIX");
  const [advanceNotes, setAdvanceNotes] = useState("");
  const [submittingAdvance, setSubmittingAdvance] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  // Advance Reversal Modal State
  const [reversalModal, setReversalModal] = useState<{
    isOpen: boolean;
    advanceId: string;
    originalAmount: number;
    alreadyReversed: number;
    maxReversible: number;
    idempotencyKey: string;
  } | null>(null);
  const [reversalAmount, setReversalAmount] = useState("");
  const [reversalMethod, setReversalMethod] = useState("PIX");
  const [reversalReason, setReversalReason] = useState("");
  const [submittingReversal, setSubmittingReversal] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);

  // Payout Modal State
  const [payoutModal, setPayoutModal] = useState<{
    isOpen: boolean;
    memberId: string;
    memberName: string;
    grossCommission: number;
    advancesTotal: number;
    adjustmentsTotal: number;
    remainingBalance: number;
    idempotencyKey: string;
  } | null>(null);
  const [payoutMethod, setPayoutMethod] = useState("PIX");
  const [payoutNotes, setPayoutNotes] = useState("");
  const [submittingPayout, setSubmittingPayout] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);

  // Focus trap ref
  const modalCancelRef = useRef<HTMLButtonElement>(null);

  const loadOverview = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/commissions/overview");
      if (!res.ok) {
        throw new Error("Falha ao carregar visão geral de comissões.");
      }
      const data = await res.json();
      setOverview(data.overview || []);
    } catch (err: any) {
      setError(err.message || "Erro de conexão ao buscar comissões.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const loadMemberDetail = useCallback(async (memberId: string) => {
    try {
      setLoadingDetail(true);
      const res = await fetch(`/api/admin/commissions/members/${memberId}`);
      if (!res.ok) throw new Error("Falha ao carregar detalhes do profissional.");
      const data = await res.json();
      setMemberDetail(data);
    } catch (err: any) {
      setError(err.message || "Erro ao carregar detalhes.");
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  function handleOpenDetail(memberId: string) {
    setSelectedMemberId(memberId);
    loadMemberDetail(memberId);
  }

  function handleCloseDetail() {
    setSelectedMemberId(null);
    setMemberDetail(null);
  }

  // Open Advance Modal
  function handleOpenAdvance(item: MemberOverviewItem) {
    const cycle = item.currentCycle;
    const grossAccrued = cycle?.grossCommission || 0;
    const alreadyAdvanced = cycle?.advancesTotal || 0;
    const remaining = cycle?.remainingBalance || 0;
    const availableForAdvance = Math.max(0, remaining);

    setAdvanceModal({
      isOpen: true,
      memberId: item.member.id,
      memberName: item.member.name,
      availableForAdvance,
      alreadyAdvanced,
      grossAccrued,
      idempotencyKey: `adv-${item.member.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    });
    setAdvanceAmount("");
    setAdvanceMethod("PIX");
    setAdvanceNotes("");
    setAdvanceError(null);
  }

  async function handleConfirmAdvance() {
    if (!advanceModal) return;
    const numAmount = Number(advanceAmount.replace(",", "."));
    if (isNaN(numAmount) || numAmount <= 0) {
      setAdvanceError("Informe um valor válido maior que zero.");
      return;
    }
    if (numAmount > advanceModal.availableForAdvance) {
      setAdvanceError(`O valor excede o saldo disponível para adiantamento (${brl(advanceModal.availableForAdvance)}).`);
      return;
    }

    try {
      setSubmittingAdvance(true);
      setAdvanceError(null);
      const res = await fetch("/api/admin/commissions/advances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": advanceModal.idempotencyKey,
        },
        body: JSON.stringify({
          memberId: advanceModal.memberId,
          amount: numAmount,
          paymentMethod: advanceMethod,
          notes: advanceNotes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao processar adiantamento.");
      }

      setFeedback(`Adiantamento de ${brl(numAmount)} realizado com sucesso!`);
      setAdvanceModal(null);
      await loadOverview();
      if (selectedMemberId === advanceModal.memberId) {
        await loadMemberDetail(advanceModal.memberId);
      }
    } catch (err: any) {
      setAdvanceError(err.message || "Erro inesperado ao registrar adiantamento.");
    } finally {
      setSubmittingAdvance(false);
    }
  }

  // Open Reversal Modal
  function handleOpenReversal(adv: { id: string; amount: number; reversals: Array<{ amount: number }> }) {
    const alreadyReversed = adv.reversals.reduce((sum, r) => sum + r.amount, 0);
    const maxReversible = Math.max(0, adv.amount - alreadyReversed);

    setReversalModal({
      isOpen: true,
      advanceId: adv.id,
      originalAmount: adv.amount,
      alreadyReversed,
      maxReversible,
      idempotencyKey: `rev-${adv.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    });
    setReversalAmount(maxReversible.toFixed(2));
    setReversalMethod("PIX");
    setReversalReason("");
    setReversalError(null);
  }

  async function handleConfirmReversal() {
    if (!reversalModal) return;
    const numAmount = Number(reversalAmount.replace(",", "."));
    if (isNaN(numAmount) || numAmount <= 0) {
      setReversalError("Informe um valor de estorno válido maior que zero.");
      return;
    }
    if (numAmount > reversalModal.maxReversible) {
      setReversalError(`O valor excede o saldo estornável do adiantamento (${brl(reversalModal.maxReversible)}).`);
      return;
    }
    if (!reversalReason.trim()) {
      setReversalError("O motivo do estorno é obrigatório.");
      return;
    }

    try {
      setSubmittingReversal(true);
      setReversalError(null);
      const res = await fetch(`/api/admin/commissions/advances/${reversalModal.advanceId}/reversals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": reversalModal.idempotencyKey,
        },
        body: JSON.stringify({
          amount: numAmount,
          returnMethod: reversalMethod,
          reason: reversalReason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao estornar adiantamento.");
      }

      setFeedback(`Estorno de adiantamento no valor de ${brl(numAmount)} concluído!`);
      setReversalModal(null);
      await loadOverview();
      if (selectedMemberId) {
        await loadMemberDetail(selectedMemberId);
      }
    } catch (err: any) {
      setReversalError(err.message || "Erro inesperado ao registrar estorno.");
    } finally {
      setSubmittingReversal(false);
    }
  }

  // Open Payout Modal
  function handleOpenPayout(item: MemberOverviewItem) {
    const cycle = item.currentCycle;
    if (!cycle) return;

    setPayoutModal({
      isOpen: true,
      memberId: item.member.id,
      memberName: item.member.name,
      grossCommission: cycle.grossCommission,
      advancesTotal: cycle.advancesTotal,
      adjustmentsTotal: cycle.adjustmentsTotal,
      remainingBalance: cycle.remainingBalance,
      idempotencyKey: `payout-${cycle.id}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    });
    setPayoutMethod("PIX");
    setPayoutNotes("");
    setPayoutError(null);
  }

  async function handleConfirmPayout() {
    if (!payoutModal) return;

    try {
      setSubmittingPayout(true);
      setPayoutError(null);
      const res = await fetch("/api/admin/commissions/payouts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": payoutModal.idempotencyKey,
        },
        body: JSON.stringify({
          memberId: payoutModal.memberId,
          paymentMethod: payoutModal.remainingBalance > 0 ? payoutMethod : undefined,
          notes: payoutNotes.trim() || undefined,
          expectedAmount: payoutModal.remainingBalance,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao liquidar comissões.");
      }

      setFeedback(
        payoutModal.remainingBalance > 0
          ? `Pagamento de ${brl(payoutModal.remainingBalance)} confirmado! Novo ciclo aberto.`
          : "Ciclo encerrado administrativamente com sucesso! Novo ciclo aberto."
      );
      setPayoutModal(null);
      await loadOverview();
      if (selectedMemberId === payoutModal.memberId) {
        await loadMemberDetail(payoutModal.memberId);
      }
    } catch (err: any) {
      setPayoutError(err.message || "Erro ao registrar liquidação.");
    } finally {
      setSubmittingPayout(false);
    }
  }

  // Escape key handler
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (payoutModal && !submittingPayout) setPayoutModal(null);
        else if (advanceModal && !submittingAdvance) setAdvanceModal(null);
        else if (reversalModal && !submittingReversal) setReversalModal(null);
        else if (selectedMemberId) handleCloseDetail();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [payoutModal, submittingPayout, advanceModal, submittingAdvance, reversalModal, submittingReversal, selectedMemberId]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">
            Pagamento de Comissões
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Gestão operacional de ciclos abertos, adiantamentos e liquidação de comissões.
          </p>
        </div>
      </div>

      <CommissionNav />

      {feedback && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center justify-between">
          <span>{feedback}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs text-emerald-400 hover:underline cursor-pointer ml-4"
          >
            Fechar
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300">
          {error}
        </div>
      )}

      {/* Main Table of Professionals / Current Cycles */}
      <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-md overflow-hidden">
        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Ciclos de Comissão em Aberto
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {overview.length} profissional(is)
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)] animate-pulse">
            Carregando ciclos operacionais...
          </div>
        ) : overview.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">
            Nenhum profissional com ciclo aberto no momento.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface-raised)] text-[var(--text-secondary)] text-xs uppercase border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Profissional</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Comissões acumuladas</th>
                  <th className="px-4 py-3 font-semibold text-right">Adiantamentos</th>
                  <th className="px-4 py-3 font-semibold text-right">Saldo a pagar</th>
                  <th className="px-4 py-3 font-semibold text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {overview.map((item) => {
                  const cycle = item.currentCycle;
                  const remaining = cycle?.remainingBalance || 0;
                  const isNegative = remaining < 0;

                  return (
                    <tr key={item.member.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-[var(--text-primary)]">{item.member.name}</div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {cycle ? `Ciclo #${cycle.cycleNumber} aberto em ${formatDate(cycle.openedAt)}` : "Sem ciclo ativo"}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {cycle ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                            EM APURAÇÃO
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                            SEM CICLO
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-[var(--text-primary)]">
                        {brl(cycle?.grossCommission || 0)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-amber-400">
                        {brl(cycle?.advancesTotal || 0)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold">
                        <span className={isNegative ? "text-rose-400" : remaining === 0 ? "text-[var(--text-muted)]" : "text-emerald-400"}>
                          {brl(remaining)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          <button
                            onClick={() => handleOpenDetail(item.member.id)}
                            className="px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                          >
                            Detalhes
                          </button>
                          {cycle && (
                            <>
                              <button
                                onClick={() => handleOpenAdvance(item)}
                                className="px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs font-medium hover:bg-amber-500/20 transition-colors cursor-pointer"
                              >
                                Adiantamento
                              </button>
                              <button
                                onClick={() => handleOpenPayout(item)}
                                className="px-2.5 py-1.5 rounded-lg bg-[var(--gold)] text-[var(--text-inverse)] text-xs font-semibold hover:bg-[var(--gold-light)] transition-colors cursor-pointer"
                              >
                                Revisar pagamento
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Advance Dialog */}
      {advanceModal?.isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="advance-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h2 id="advance-modal-title" className="text-lg font-bold text-[var(--text-primary)]">
              Novo Adiantamento de Comissão
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Profissional: <strong className="text-[var(--text-primary)]">{advanceModal.memberName}</strong>
            </p>

            <div className="bg-[var(--surface-raised)] p-3 rounded-lg text-xs space-y-1.5 border border-[var(--border-subtle)]">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Comissões acumuladas:</span>
                <span className="font-semibold text-[var(--text-primary)]">{brl(advanceModal.grossAccrued)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Já adiantado no ciclo:</span>
                <span className="font-semibold text-amber-400">{brl(advanceModal.alreadyAdvanced)}</span>
              </div>
              <div className="flex justify-between border-t border-[var(--border-subtle)] pt-1.5 font-bold">
                <span className="text-[var(--text-primary)]">Disponível para novo adiantamento:</span>
                <span className="text-emerald-400">{brl(advanceModal.availableForAdvance)}</span>
              </div>
            </div>

            {advanceError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded-lg">
                {advanceError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Valor do adiantamento (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={advanceModal.availableForAdvance}
                  value={advanceAmount}
                  onChange={(e) => setAdvanceAmount(e.target.value)}
                  placeholder="0,00"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Forma de pagamento
                </label>
                <select
                  value={advanceMethod}
                  onChange={(e) => setAdvanceMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
                >
                  <option value="PIX">PIX</option>
                  <option value="CASH">Dinheiro (Caixa)</option>
                  <option value="TRANSFER">Transferência Bancária</option>
                  <option value="OTHER">Outro</option>
                </select>
                {advanceMethod === "CASH" && (
                  <p className="text-xs text-amber-400 mt-1">
                    Atenção: saídas em dinheiro exigem uma sessão de caixa aberta no sistema.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Observações (opcional)
                </label>
                <input
                  type="text"
                  value={advanceNotes}
                  onChange={(e) => setAdvanceNotes(e.target.value)}
                  placeholder="Ex: Adiantamento semanal"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
              <button
                ref={modalCancelRef}
                type="button"
                onClick={() => setAdvanceModal(null)}
                disabled={submittingAdvance}
                className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmAdvance}
                disabled={submittingAdvance}
                className="px-4 py-2 rounded-lg bg-[var(--gold)] text-[var(--text-inverse)] text-xs font-semibold hover:bg-[var(--gold-light)] transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submittingAdvance ? "Processando..." : "Confirmar adiantamento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Advance Reversal Dialog */}
      {reversalModal?.isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reversal-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h2 id="reversal-modal-title" className="text-lg font-bold text-[var(--text-primary)]">
              Estorno de Adiantamento
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              O estorno registra o retorno dos recursos de forma auditável e restaura o saldo do ciclo.
            </p>

            <div className="bg-[var(--surface-raised)] p-3 rounded-lg text-xs space-y-1.5 border border-[var(--border-subtle)]">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Valor original do adiantamento:</span>
                <span className="font-semibold text-[var(--text-primary)]">{brl(reversalModal.originalAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Já estornado:</span>
                <span className="font-semibold text-amber-400">{brl(reversalModal.alreadyReversed)}</span>
              </div>
              <div className="flex justify-between border-t border-[var(--border-subtle)] pt-1.5 font-bold">
                <span className="text-[var(--text-primary)]">Máximo estornável:</span>
                <span className="text-emerald-400">{brl(reversalModal.maxReversible)}</span>
              </div>
            </div>

            {reversalError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded-lg">
                {reversalError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Valor a estornar (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={reversalModal.maxReversible}
                  value={reversalAmount}
                  onChange={(e) => setReversalAmount(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Forma de devolução
                </label>
                <select
                  value={reversalMethod}
                  onChange={(e) => setReversalMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
                >
                  <option value="PIX">PIX</option>
                  <option value="CASH">Dinheiro (Caixa)</option>
                  <option value="TRANSFER">Transferência Bancária</option>
                  <option value="OTHER">Outro</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Motivo do estorno (obrigatório)
                </label>
                <input
                  type="text"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  placeholder="Ex: Devolução de adiantamento não utilizado"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setReversalModal(null)}
                disabled={submittingReversal}
                className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmReversal}
                disabled={submittingReversal}
                className="px-4 py-2 rounded-lg bg-[var(--gold)] text-[var(--text-inverse)] text-xs font-semibold hover:bg-[var(--gold-light)] transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submittingReversal ? "Processando..." : "Confirmar estorno"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Payment Dialog */}
      {payoutModal?.isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="payout-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl">
            <h2 id="payout-modal-title" className="text-lg font-bold text-[var(--text-primary)]">
              Revisão e Liquidação de Ciclo
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Profissional: <strong className="text-[var(--text-primary)]">{payoutModal.memberName}</strong>
            </p>

            {/* Exact authoritative reconciliation breakdown */}
            <div className="bg-[var(--surface-raised)] p-4 rounded-xl space-y-2 border border-[var(--border-subtle)] text-sm">
              <div className="flex justify-between text-[var(--text-secondary)]">
                <span>Comissões acumuladas</span>
                <span className="font-semibold text-[var(--text-primary)]">{brl(payoutModal.grossCommission)}</span>
              </div>
              <div className="flex justify-between text-[var(--text-secondary)]">
                <span>Adiantamentos líquidos</span>
                <span className="font-semibold text-amber-400">-{brl(payoutModal.advancesTotal)}</span>
              </div>
              {payoutModal.adjustmentsTotal !== 0 && (
                <div className="flex justify-between text-[var(--text-secondary)]">
                  <span>Ajustes manuais</span>
                  <span className={payoutModal.adjustmentsTotal > 0 ? "font-semibold text-emerald-400" : "font-semibold text-rose-400"}>
                    {payoutModal.adjustmentsTotal > 0 ? "+" : ""}{brl(payoutModal.adjustmentsTotal)}
                  </span>
                </div>
              )}
              <div className="border-t border-[var(--border-subtle)] pt-2.5 flex justify-between items-baseline">
                <span className="font-bold text-base text-[var(--text-primary)]">Saldo final (a pagar)</span>
                <span className={`text-xl font-bold ${payoutModal.remainingBalance < 0 ? "text-rose-400" : payoutModal.remainingBalance === 0 ? "text-[var(--text-muted)]" : "text-emerald-400"}`}>
                  {brl(payoutModal.remainingBalance)}
                </span>
              </div>
            </div>

            {payoutError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs rounded-lg">
                {payoutError}
              </div>
            )}

            {payoutModal.remainingBalance < 0 ? (
              <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs space-y-1">
                <p className="font-bold">Ciclo com saldo negativo.</p>
                <p>Saldo negativo a compensar em próximas comissões. O ciclo permanecerá aberto até que novas produções ou créditos compensem o saldo.</p>
              </div>
            ) : payoutModal.remainingBalance === 0 ? (
              <div className="p-4 rounded-lg bg-zinc-500/10 border border-zinc-500/20 text-[var(--text-secondary)] text-xs space-y-1">
                <p className="font-bold text-[var(--text-primary)]">Encerrar ciclo sem pagamento</p>
                <p>O saldo a pagar é R$ 0,00. Nenhuma movimentação financeira será gerada no caixa ou relatório. O ciclo atual será marcado como PAGO e um novo ciclo em aberto será criado automaticamente.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Forma de pagamento da liquidação
                  </label>
                  <select
                    value={payoutMethod}
                    onChange={(e) => setPayoutMethod(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
                  >
                    <option value="PIX">PIX</option>
                    <option value="CASH">Dinheiro (Caixa)</option>
                    <option value="TRANSFER">Transferência Bancária</option>
                    <option value="OTHER">Outro</option>
                  </select>
                  {payoutMethod === "CASH" && (
                    <p className="text-xs text-amber-400 mt-1">
                      Atenção: pagamentos em dinheiro físico exigem uma sessão de caixa aberta.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Observações de encerramento (opcional)
                  </label>
                  <input
                    type="text"
                    value={payoutNotes}
                    onChange={(e) => setPayoutNotes(e.target.value)}
                    placeholder="Ex: Liquidação quinzenal"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
              <button
                type="button"
                onClick={() => setPayoutModal(null)}
                disabled={submittingPayout}
                className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              {payoutModal.remainingBalance >= 0 && (
                <button
                  type="button"
                  onClick={handleConfirmPayout}
                  disabled={submittingPayout}
                  className="px-4 py-2 rounded-lg bg-[var(--gold)] text-[var(--text-inverse)] text-xs font-semibold hover:bg-[var(--gold-light)] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {submittingPayout
                    ? "Processando..."
                    : payoutModal.remainingBalance === 0
                    ? "Encerrar ciclo sem pagamento"
                    : "Confirmar pagamento"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Member Detail Drawer / Modal */}
      {selectedMemberId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div>
                <h2 id="detail-modal-title" className="text-lg font-bold text-[var(--text-primary)]">
                  Detalhamento de Comissões e Histórico
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Profissional: <strong className="text-[var(--text-primary)]">{memberDetail?.member.name || "..."}</strong>
                </p>
              </div>
              <button
                onClick={handleCloseDetail}
                className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
              {loadingDetail ? (
                <div className="p-8 text-center text-[var(--text-muted)] animate-pulse">
                  Carregando extrato auditável...
                </div>
              ) : memberDetail ? (
                <>
                  {/* Current Cycle Summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg">
                      <div className="text-xs text-[var(--text-muted)]">Comissões acumuladas</div>
                      <div className="text-base font-bold text-[var(--text-primary)]">
                        {brl(memberDetail.currentCycle?.grossCommission || 0)}
                      </div>
                    </div>
                    <div className="p-3 bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg">
                      <div className="text-xs text-[var(--text-muted)]">Adiantamentos</div>
                      <div className="text-base font-bold text-amber-400">
                        {brl(memberDetail.currentCycle?.advancesTotal || 0)}
                      </div>
                    </div>
                    <div className="p-3 bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg">
                      <div className="text-xs text-[var(--text-muted)]">Ajustes manuais</div>
                      <div className="text-base font-bold text-[var(--text-primary)]">
                        {brl(memberDetail.currentCycle?.adjustmentsTotal || 0)}
                      </div>
                    </div>
                    <div className="p-3 bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg">
                      <div className="text-xs text-[var(--text-muted)]">Saldo a pagar</div>
                      <div className="text-base font-bold text-emerald-400">
                        {brl(memberDetail.currentCycle?.remainingBalance || 0)}
                      </div>
                    </div>
                  </div>

                  {/* Traceability: Payable Items */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase text-[var(--text-secondary)] tracking-wider">
                      Itens comissionados no ciclo atual ({memberDetail.currentCycle?.payableItems.length || 0})
                    </h3>
                    <div className="border border-[var(--border-subtle)] rounded-lg overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[var(--surface-raised)] text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                          <tr>
                            <th className="p-2.5">Data</th>
                            <th className="p-2.5">Tipo</th>
                            <th className="p-2.5">Origem</th>
                            <th className="p-2.5 text-right">Valor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {memberDetail.currentCycle?.payableItems.map((item) => (
                            <tr key={item.id} className="hover:bg-[var(--surface-hover)]">
                              <td className="p-2.5">{formatDate(item.createdAt)}</td>
                              <td className="p-2.5 font-medium">
                                <span className={item.type === "RELEASE" ? "text-emerald-400" : "text-rose-400"}>
                                  {item.type}
                                </span>
                              </td>
                              <td className="p-2.5 text-[var(--text-muted)]">{item.sourceKind}</td>
                              <td className="p-2.5 text-right font-bold">
                                {item.type === "RELEASE" ? "+" : "-"}{brl(item.amount)}
                              </td>
                            </tr>
                          ))}
                          {(!memberDetail.currentCycle?.payableItems || memberDetail.currentCycle.payableItems.length === 0) && (
                            <tr>
                              <td colSpan={4} className="p-4 text-center text-[var(--text-muted)]">
                                Nenhum item liberado até o momento.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Advances in this cycle */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase text-[var(--text-secondary)] tracking-wider">
                      Adiantamentos no ciclo ({memberDetail.advances.length})
                    </h3>
                    <div className="border border-[var(--border-subtle)] rounded-lg overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[var(--surface-raised)] text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                          <tr>
                            <th className="p-2.5">Data</th>
                            <th className="p-2.5">Método</th>
                            <th className="p-2.5 text-right">Valor</th>
                            <th className="p-2.5 text-right">Estornado</th>
                            <th className="p-2.5 text-center">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {memberDetail.advances.map((adv) => {
                            const reversed = adv.reversals.reduce((sum, r) => sum + r.amount, 0);
                            const unreversed = adv.amount - reversed;

                            return (
                              <tr key={adv.id} className="hover:bg-[var(--surface-hover)]">
                                <td className="p-2.5">{formatDate(adv.disbursedAt)}</td>
                                <td className="p-2.5">{adv.paymentMethod}</td>
                                <td className="p-2.5 text-right font-bold text-amber-400">{brl(adv.amount)}</td>
                                <td className="p-2.5 text-right text-[var(--text-muted)]">{brl(reversed)}</td>
                                <td className="p-2.5 text-center">
                                  {unreversed > 0 && (
                                    <button
                                      onClick={() => handleOpenReversal(adv)}
                                      className="px-2 py-1 rounded border border-amber-500/30 text-[10px] font-semibold text-amber-300 hover:bg-amber-500/10 cursor-pointer"
                                    >
                                      Estornar adiantamento
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {memberDetail.advances.length === 0 && (
                            <tr>
                              <td colSpan={5} className="p-4 text-center text-[var(--text-muted)]">
                                Nenhum adiantamento realizado.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Historical PAID Cycles */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase text-[var(--text-secondary)] tracking-wider">
                      Histórico de Ciclos Pagos ({memberDetail.historicalCycles.length})
                    </h3>
                    <div className="border border-[var(--border-subtle)] rounded-lg overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[var(--surface-raised)] text-[var(--text-muted)] border-b border-[var(--border-subtle)]">
                          <tr>
                            <th className="p-2.5">Ciclo</th>
                            <th className="p-2.5">Data de Liquidação</th>
                            <th className="p-2.5 text-right">Comissões</th>
                            <th className="p-2.5 text-right">Adiantamentos</th>
                            <th className="p-2.5 text-right">Valor Pago</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {memberDetail.historicalCycles.map((c) => (
                            <tr key={c.id} className="hover:bg-[var(--surface-hover)]">
                              <td className="p-2.5 font-medium text-[var(--text-primary)]">Ciclo #{c.cycleNumber}</td>
                              <td className="p-2.5">{formatDate(c.paidAt)}</td>
                              <td className="p-2.5 text-right">{brl(c.grossCommission)}</td>
                              <td className="p-2.5 text-right text-amber-400">-{brl(c.advancesTotal)}</td>
                              <td className="p-2.5 text-right font-bold text-emerald-400">{brl(c.finalPayoutAmount)}</td>
                            </tr>
                          ))}
                          {memberDetail.historicalCycles.length === 0 && (
                            <tr>
                              <td colSpan={5} className="p-4 text-center text-[var(--text-muted)]">
                                Nenhum ciclo pago histórico registrado.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
