"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useEffect, useState, useCallback } from "react";

type PayableItem = {
  id: string;
  type: "RELEASE" | "REVERSAL";
  amount: number;
  sourceKind: string;
  isHistoricalCorrection?: boolean;
  createdAt: string;
  description: string;
  customerName: string | null;
  baseAmount: number | null;
  rateLabel: string | null;
};

type CycleAdjustment = {
  id: string;
  type: string;
  amount: number;
  reason: string;
  createdAt: string;
};

type CurrentCycle = {
  id: string;
  cycleNumber: number;
  status: "OPEN" | "PAID";
  accumulatedCommission: number;
  netAdvances: number;
  remainingPayable: number;
  openedAt: string;
  payableItems: PayableItem[];
  adjustments?: CycleAdjustment[];
};

type AwaitingItem = {
  id: string;
  description: string;
  customerName: string | null;
  baseAmount: number;
  estimatedCommission: number;
  rateLabel: string | null;
  completedAt: string;
};

type AdvanceReversal = {
  id: string;
  amount: number;
  returnedAt: string;
  reason: string;
};

type AdvanceItem = {
  id: string;
  cycleId: string;
  amount: number;
  reversalsTotal: number;
  netAmount: number;
  paymentMethod: string;
  disbursedAt: string;
  notes: string | null;
  reversals: AdvanceReversal[];
};

type HistoricalCycle = {
  id: string;
  cycleNumber: number;
  status: string;
  grossCommission: number;
  advancesTotal: number;
  adjustmentsTotal: number;
  finalPayoutAmount: number;
  closedAt: string | null;
  paidAt: string | null;
};

type MemberCommissionsResponse = {
  currentCycle: CurrentCycle | null;
  accumulatedCommission: number;
  netAdvances: number;
  remainingPayable: number;
  paidTotal: number;
  awaitingCustomerPayment?: AwaitingItem[];
  historicalCycles: HistoricalCycle[];
  advances: AdvanceItem[];
};

function brl(value: number | string | null | undefined) {
  const n = Number(value || 0);
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

function formatMethod(method: string | null | undefined) {
  if (!method) return "Não informado";
  switch (method) {
    case "PIX":
      return "PIX";
    case "CASH":
      return "Dinheiro";
    case "BANK_TRANSFER":
      return "Transferência";
    default:
      return method;
  }
}

export default function MemberComissoesPage() {
  const [data, setData] = useState<MemberCommissionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCommissions = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/member/commissions");
      if (!res.ok) {
        throw new Error("Não foi possível carregar as informações de comissão.");
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "Erro ao conectar ao servidor.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCommissions();
  }, [loadCommissions]);

  if (loading) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
        <div className="h-8 w-48 bg-[var(--surface-raised)] rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
        <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">Minhas comissões</h1>
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={loadCommissions}
            className="px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 rounded-lg text-xs font-semibold text-rose-200 transition-colors cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const currentCycle = data?.currentCycle;
  const accumulated = data?.accumulatedCommission ?? 0;
  const netAdvances = data?.netAdvances ?? 0;
  const remaining = data?.remainingPayable ?? 0;
  const totalPaid = data?.paidTotal ?? 0;
  const awaitingItems = data?.awaitingCustomerPayment || [];
  const advances = data?.advances || [];
  const historicalCycles = data?.historicalCycles || [];

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">
          Minhas comissões
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Acompanhe seus valores acumulados, adiantamentos e histórico de pagamentos.
        </p>
      </div>

      {/* Primary KPI Cards (Canonical Terminology) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Comissões acumuladas
          </span>
          <div className="text-2xl font-bold text-[var(--text-primary)] mt-1">
            {brl(accumulated)}
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">
            Liberadas no ciclo atual
          </span>
        </div>

        <div className="p-4 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Adiantamentos
          </span>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {brl(netAdvances)}
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">
            Adiantamentos líquidos
          </span>
        </div>

        <div className="p-4 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Saldo a receber
          </span>
          <div
            className={`text-2xl font-bold mt-1 ${
              remaining < 0
                ? "text-amber-300"
                : remaining === 0
                ? "text-[var(--text-secondary)]"
                : "text-emerald-400"
            }`}
          >
            {brl(remaining)}
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">
            {remaining < 0 ? "A compensar" : "Disponível para próximo pagamento"}
          </span>
        </div>

        <div className="p-4 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Total pago
          </span>
          <div className="text-2xl font-bold text-blue-400 mt-1">
            {brl(totalPaid)}
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">
            Recebido em ciclos encerrados
          </span>
        </div>
      </div>

      {/* Negative Balance Informational Box */}
      {remaining < 0 && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm space-y-1">
          <div className="font-semibold text-amber-300">
            Saldo a compensar em próximas comissões
          </div>
          <p className="text-xs text-amber-200/80">
            Você possui um ajuste pendente decorrente de estorno ou adiantamento. Suas próximas comissões acumuladas irão compensar este valor automaticamente.
          </p>
        </div>
      )}

      {/* Current State Section: EM APURAÇÃO */}
      <section aria-labelledby="current-cycle-heading" className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-md overflow-hidden">
        <div className="p-4 border-b border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h2 id="current-cycle-heading" className="text-base font-semibold text-[var(--text-primary)]">
              Ciclo Atual
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              EM APURAÇÃO
            </span>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            {currentCycle?.openedAt ? `Iniciado em ${formatDate(currentCycle.openedAt)}` : "Sem ciclo ativo"}
          </span>
        </div>

        {(!currentCycle || currentCycle.payableItems.length === 0) ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">
            Você ainda não possui comissões acumuladas neste ciclo.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label="Comissões do ciclo atual">
              <thead className="bg-[var(--surface-raised)] text-[var(--text-secondary)] text-xs uppercase border-b border-[var(--border-subtle)]">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Data</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Item / Serviço</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Cliente</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-right">Base</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-center">Regra</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Efeito Econômico</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-right">Valor da Comissão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {currentCycle.payableItems.map((item) => {
                  const isRelease = item.type === "RELEASE";

                  return (
                    <tr key={item.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap">
                        {formatDate(item.createdAt)}
                      </td>
                      <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                        <div>{item.description}</div>
                        {item.isHistoricalCorrection && (
                          <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                            Ajuste de ciclo anterior
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                        {item.customerName || "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-right text-[var(--text-secondary)] whitespace-nowrap">
                        {item.baseAmount !== null ? brl(item.baseAmount) : "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-center text-[var(--text-muted)] whitespace-nowrap">
                        {item.rateLabel || "-"}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {isRelease ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                            Comissão adicionada
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/10 text-rose-300 border border-rose-500/20">
                            Comissão ajustada
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-sm font-bold text-right whitespace-nowrap ${
                          isRelease ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {isRelease ? `+${brl(item.amount)}` : `-${brl(item.amount)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Secondary Section: Awaiting Customer Payment */}
      {awaitingItems.length > 0 && (
        <section aria-labelledby="awaiting-heading" className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-3 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-[var(--border-subtle)] pb-3">
            <h2 id="awaiting-heading" className="text-base font-semibold text-[var(--text-primary)]">
              Aguardando pagamento do cliente
            </h2>
            <span className="text-xs text-[var(--text-muted)]">
              {awaitingItems.length} item(ns)
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            O serviço já foi realizado, mas a comissão entra no seu saldo somente após a confirmação do pagamento do cliente.
          </p>

          <div className="overflow-x-auto pt-1">
            <table className="w-full text-left text-xs" aria-label="Itens aguardando pagamento">
              <thead className="bg-[var(--surface-raised)] text-[var(--text-muted)] uppercase border-b border-[var(--border-subtle)]">
                <tr>
                  <th scope="col" className="p-2.5 font-semibold">Data</th>
                  <th scope="col" className="p-2.5 font-semibold">Serviço / Item</th>
                  <th scope="col" className="p-2.5 font-semibold">Cliente</th>
                  <th scope="col" className="p-2.5 font-semibold text-right">Valor Base</th>
                  <th scope="col" className="p-2.5 font-semibold text-center">Regra</th>
                  <th scope="col" className="p-2.5 font-semibold text-right">Comissão Estimada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {awaitingItems.map((item) => (
                  <tr key={item.id} className="hover:bg-[var(--surface-hover)]">
                    <td className="p-2.5 text-[var(--text-muted)]">{formatDate(item.completedAt)}</td>
                    <td className="p-2.5 font-medium text-[var(--text-primary)]">{item.description}</td>
                    <td className="p-2.5 text-[var(--text-secondary)]">{item.customerName || "-"}</td>
                    <td className="p-2.5 text-right text-[var(--text-secondary)]">{brl(item.baseAmount)}</td>
                    <td className="p-2.5 text-center text-[var(--text-muted)]">{item.rateLabel || "-"}</td>
                    <td className="p-2.5 text-right font-semibold text-[var(--text-secondary)]">
                      {brl(item.estimatedCommission)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Read-Only Advances Section */}
      <section aria-labelledby="advances-heading" className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-3 shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <h2 id="advances-heading" className="text-base font-semibold text-[var(--text-primary)]">
            Adiantamentos
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {advances.length} adiantamento(s)
          </span>
        </div>

        {advances.length === 0 ? (
          <div className="py-4 text-center text-xs text-[var(--text-muted)]">
            Nenhum adiantamento registrado.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" aria-label="Histórico de adiantamentos">
              <thead className="bg-[var(--surface-raised)] text-[var(--text-muted)] uppercase border-b border-[var(--border-subtle)]">
                <tr>
                  <th scope="col" className="p-2.5 font-semibold">Data</th>
                  <th scope="col" className="p-2.5 font-semibold">Tipo</th>
                  <th scope="col" className="p-2.5 font-semibold">Forma de Pagamento</th>
                  <th scope="col" className="p-2.5 font-semibold">Observações</th>
                  <th scope="col" className="p-2.5 font-semibold text-right">Valor Original</th>
                  <th scope="col" className="p-2.5 font-semibold text-right">Estorno</th>
                  <th scope="col" className="p-2.5 font-semibold text-right">Valor Líquido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {advances.map((adv) => (
                  <tr key={adv.id} className="hover:bg-[var(--surface-hover)]">
                    <td className="p-2.5 text-[var(--text-muted)]">{formatDate(adv.disbursedAt)}</td>
                    <td className="p-2.5 font-medium text-[var(--text-primary)]">Adiantamento</td>
                    <td className="p-2.5 text-[var(--text-secondary)]">{formatMethod(adv.paymentMethod)}</td>
                    <td className="p-2.5 text-[var(--text-muted)]">{adv.notes || "-"}</td>
                    <td className="p-2.5 text-right font-medium text-[var(--text-secondary)]">{brl(adv.amount)}</td>
                    <td className="p-2.5 text-right font-medium text-rose-400">
                      {adv.reversalsTotal > 0 ? `-${brl(adv.reversalsTotal)}` : "-"}
                    </td>
                    <td className="p-2.5 text-right font-bold text-amber-400">{brl(adv.netAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Payment History Section */}
      <section aria-labelledby="history-heading" className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-3 shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <h2 id="history-heading" className="text-base font-semibold text-[var(--text-primary)]">
            Histórico de pagamentos
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {historicalCycles.length} ciclo(s) encerrado(s)
          </span>
        </div>

        {historicalCycles.length === 0 ? (
          <div className="py-4 text-center text-xs text-[var(--text-muted)]">
            Nenhum histórico de pagamento disponível.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" aria-label="Histórico de pagamentos liquidados">
              <thead className="bg-[var(--surface-raised)] text-[var(--text-muted)] uppercase border-b border-[var(--border-subtle)]">
                <tr>
                  <th scope="col" className="p-2.5 font-semibold">Data da Liquidação</th>
                  <th scope="col" className="p-2.5 font-semibold">Ciclo</th>
                  <th scope="col" className="p-2.5 font-semibold text-center">Status</th>
                  <th scope="col" className="p-2.5 font-semibold text-right">Comissões Acumuladas</th>
                  <th scope="col" className="p-2.5 font-semibold text-right">Adiantamentos Deduzidos</th>
                  <th scope="col" className="p-2.5 font-semibold text-right">Valor Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {historicalCycles.map((cycle) => {
                  const isZeroClose = cycle.finalPayoutAmount === 0;

                  return (
                    <tr key={cycle.id} className="hover:bg-[var(--surface-hover)]">
                      <td className="p-2.5 text-[var(--text-muted)]">
                        {formatDate(cycle.paidAt || cycle.closedAt)}
                      </td>
                      <td className="p-2.5 font-medium text-[var(--text-primary)]">
                        Ciclo #{cycle.cycleNumber}
                      </td>
                      <td className="p-2.5 text-center">
                        {isZeroClose ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-500/10 text-zinc-300 border border-zinc-500/20">
                            Encerrado sem valor a pagar
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                            PAGO
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 text-right text-[var(--text-secondary)]">
                        {brl(cycle.grossCommission)}
                      </td>
                      <td className="p-2.5 text-right text-amber-400">
                        {cycle.advancesTotal > 0 ? `-${brl(cycle.advancesTotal)}` : "-"}
                      </td>
                      <td className="p-2.5 text-right font-bold text-emerald-400">
                        {isZeroClose ? "R$ 0,00" : brl(cycle.finalPayoutAmount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
