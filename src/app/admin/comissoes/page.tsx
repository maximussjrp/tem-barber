"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
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

type AnalyticalReportSummary = {
  grossServiceAmount: string;
  grossProductAmount: string;
  discountAmount: string;
  netBaseAmount: string;
  commandCount: number;
  serviceCount: number;
  productCount: number;
  averageTicket: string;
  effectiveCommissionRate: string;
};

type AnalyticalMember = {
  memberId: string;
  memberName: string;
  grossServiceAmount: string;
  grossProductAmount: string;
  discountAmount: string;
  netBaseAmount: string;
  commandCount: number;
  serviceCount: number;
  productCount: number;
};

function brl(value: string | number | undefined | null) {
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

export default function AdminCommissionsOverviewPage() {
  // Canonical Overview State
  const [overview, setOverview] = useState<MemberOverviewItem[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Secondary Sales Analytics State (Non-settlement operational metrics)
  const [reportData, setReportData] = useState<{
    summary: AnalyticalReportSummary;
    members: AnalyticalMember[];
  } | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [filterType, setFilterType] = useState<"MONTHLY" | "WEEKLY" | "CUSTOM">("MONTHLY");
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7));

  // Detail Modal State
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberDetail, setMemberDetail] = useState<any | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Load canonical overview without side-effects
  const loadOverview = useCallback(async () => {
    try {
      setOverviewError(null);
      const res = await fetch("/api/admin/commissions/overview");
      if (!res.ok) throw new Error("Erro ao carregar visão geral de comissões.");
      const data = await res.json();
      setOverview(data.overview || []);
    } catch (err: any) {
      setOverviewError(err.message || "Erro ao conectar à API de comissões.");
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  // Load secondary sales/production analytics
  const loadAnalytics = useCallback(async () => {
    try {
      setLoadingReport(true);
      const params = new URLSearchParams({ type: filterType, competence });
      const res = await fetch(`/api/admin/commissions/report?${params}`);
      if (res.ok) {
        const data = await res.json();
        setReportData(data);
      }
    } catch {
      // Non-blocking secondary report
    } finally {
      setLoadingReport(false);
    }
  }, [filterType, competence]);

  useEffect(() => {
    loadOverview();
    loadAnalytics();
  }, [loadOverview, loadAnalytics]);

  // Load member detail
  const handleOpenDetail = async (memberId: string) => {
    try {
      setSelectedMemberId(memberId);
      setLoadingDetail(true);
      const res = await fetch(`/api/admin/commissions/members/${memberId}`);
      if (res.ok) {
        setMemberDetail(await res.json());
      }
    } catch {
      // Detail load failure
    } finally {
      setLoadingDetail(false);
    }
  };

  // Compute canonical KPI card totals across current cycles
  const totalAccrued = overview.reduce(
    (sum, m) => sum + (m.currentCycle?.grossCommission || 0),
    0
  );
  const totalAdvances = overview.reduce(
    (sum, m) => sum + (m.currentCycle?.advancesTotal || 0),
    0
  );
  const totalRemaining = overview.reduce(
    (sum, m) => sum + (m.currentCycle?.remainingBalance || 0),
    0
  );
  // Total pago can be calculated from historical payouts or summary
  const totalPaid = overview.reduce(
    (sum, m) => sum + ((m.currentCycle?.status === "PAID" ? m.currentCycle.grossCommission : 0) || 0),
    0
  );

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">
            Comissões
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Painel geral de comissões acumuladas, adiantamentos e liquidação por ciclo.
          </p>
        </div>
        <div>
          <Link
            href="/admin/comissoes/pagamentos"
            className="px-4 py-2 rounded-lg bg-[var(--gold)] text-[var(--text-inverse)] text-xs font-semibold hover:bg-[var(--gold-light)] transition-colors inline-block"
          >
            Ir para Pagamentos
          </Link>
        </div>
      </div>

      <CommissionNav />

      {overviewError && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300">
          {overviewError}
        </div>
      )}

      {/* Primary KPI Cards (Canonical Terminology) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Comissões acumuladas
          </span>
          <div className="text-2xl font-bold text-[var(--text-primary)] mt-1">
            {brl(totalAccrued)}
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">Ciclos em apuração</span>
        </div>

        <div className="p-4 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Adiantamentos
          </span>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {brl(totalAdvances)}
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">Valores antecipados</span>
        </div>

        <div className="p-4 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Saldo a pagar
          </span>
          <div className="text-2xl font-bold text-emerald-400 mt-1">
            {brl(totalRemaining)}
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">Disponível para liquidação</span>
        </div>

        <div className="p-4 bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-sm">
          <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Total pago
          </span>
          <div className="text-2xl font-bold text-blue-400 mt-1">
            {brl(totalPaid)}
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">Ciclos liquidados</span>
        </div>
      </div>

      {/* Canonical Professionals List */}
      <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-md overflow-hidden">
        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Profissionais e Ciclos Atuais
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {overview.length} membro(s)
          </span>
        </div>

        {loadingOverview ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)] animate-pulse">
            Carregando comissões dos profissionais...
          </div>
        ) : overview.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">
            Nenhum profissional cadastrado com ciclo de comissão.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface-raised)] text-[var(--text-secondary)] text-xs uppercase border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Profissional</th>
                  <th className="px-4 py-3 font-semibold">Status do Ciclo</th>
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

                  return (
                    <tr key={item.member.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-[var(--text-primary)]">{item.member.name}</div>
                        <div className="text-xs text-[var(--text-muted)]">
                          {cycle ? `Ciclo #${cycle.cycleNumber}` : "Sem ciclo ativo"}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {cycle ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                            Em apuração
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                            Sem ciclo
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-[var(--text-primary)]">
                        {brl(cycle?.grossCommission || 0)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-medium text-amber-400">
                        {brl(cycle?.advancesTotal || 0)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-emerald-400">
                        {brl(remaining)}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleOpenDetail(item.member.id)}
                            className="px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                          >
                            Ver detalhes
                          </button>
                          <Link
                            href="/admin/comissoes/pagamentos"
                            className="px-2.5 py-1.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--gold)] hover:bg-[var(--surface-hover)] transition-colors"
                          >
                            Revisar pagamento
                          </Link>
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

      {/* Secondary Section: Non-settlement Operational Analytics */}
      <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Análise por Período
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Métricas comerciais e de faturamento operacional. Não substituem o saldo autoritativo do ciclo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="px-3 py-1.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none"
            >
              <option value="MONTHLY">Mensal</option>
              <option value="WEEKLY">Semanal</option>
            </select>
            <input
              type="month"
              value={competence}
              onChange={(e) => setCompetence(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] focus:outline-none"
            />
          </div>
        </div>

        {loadingReport ? (
          <div className="p-6 text-center text-xs text-[var(--text-muted)] animate-pulse">
            Carregando dados analíticos...
          </div>
        ) : reportData?.summary ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <span className="text-[var(--text-muted)]">Faturamento Serviços</span>
              <div className="text-sm font-bold text-[var(--text-primary)] mt-1">
                {brl(reportData.summary.grossServiceAmount)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <span className="text-[var(--text-muted)]">Faturamento Produtos</span>
              <div className="text-sm font-bold text-[var(--text-primary)] mt-1">
                {brl(reportData.summary.grossProductAmount)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <span className="text-[var(--text-muted)]">Descontos Aplicados</span>
              <div className="text-sm font-bold text-rose-400 mt-1">
                {brl(reportData.summary.discountAmount)}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
              <span className="text-[var(--text-muted)]">Ticket Médio</span>
              <div className="text-sm font-bold text-[var(--text-primary)] mt-1">
                {brl(reportData.summary.averageTicket)}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-[var(--text-muted)] p-2">
            Nenhuma movimentação comercial registrada no período selecionado.
          </div>
        )}
      </div>

      {/* Member Detail Modal */}
      {selectedMemberId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="overview-detail-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[var(--border-subtle)] pb-3">
              <h2 id="overview-detail-title" className="text-lg font-bold text-[var(--text-primary)]">
                Extrato do Profissional
              </h2>
              <button
                onClick={() => setSelectedMemberId(null)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                Fechar
              </button>
            </div>

            {loadingDetail ? (
              <div className="p-6 text-center text-xs text-[var(--text-muted)] animate-pulse">
                Carregando extrato...
              </div>
            ) : memberDetail ? (
              <div className="space-y-4 text-xs">
                <div className="bg-[var(--surface-raised)] p-3 rounded-lg border border-[var(--border-subtle)] flex justify-between">
                  <div>
                    <span className="text-[var(--text-muted)]">Profissional:</span>
                    <div className="font-bold text-sm text-[var(--text-primary)]">{memberDetail.member?.name}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-[var(--text-muted)]">Saldo Atual a Pagar:</span>
                    <div className="font-bold text-sm text-emerald-400">
                      {brl(memberDetail.currentCycle?.remainingBalance || 0)}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-[var(--text-secondary)] mb-2">Últimos itens liberados</h3>
                  <div className="border border-[var(--border-subtle)] rounded-lg overflow-hidden">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-[var(--surface-raised)] text-[var(--text-muted)]">
                        <tr>
                          <th className="p-2">Data</th>
                          <th className="p-2">Tipo</th>
                          <th className="p-2 text-right">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {memberDetail.currentCycle?.payableItems?.slice(0, 10).map((item: any) => (
                          <tr key={item.id}>
                            <td className="p-2">{formatDate(item.createdAt)}</td>
                            <td className="p-2">{item.type}</td>
                            <td className="p-2 text-right font-semibold">
                              {item.type === "RELEASE" ? "+" : "-"}{brl(item.amount)}
                            </td>
                          </tr>
                        ))}
                        {(!memberDetail.currentCycle?.payableItems || memberDetail.currentCycle.payableItems.length === 0) && (
                          <tr>
                            <td colSpan={3} className="p-3 text-center text-[var(--text-muted)]">
                              Nenhum item comissionado no ciclo atual.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Link
                    href="/admin/comissoes/pagamentos"
                    className="px-3 py-2 rounded-lg bg-[var(--gold)] text-[var(--text-inverse)] text-xs font-semibold"
                  >
                    Gerenciar Pagamentos e Adiantamentos
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
