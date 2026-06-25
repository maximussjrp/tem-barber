"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Period = {
  id: string;
  competence: string;
  status: string;
  generatedAmount: string;
  releasedAmount: string;
  paidAmount: string;
  reversedAmount: string;
  balanceAmount: string;
  member: { user: { name: string } };
};

function brl(value: string | number) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  // Segunda-feira como início da semana (0 para Domingo, 1 para Segunda, etc.)
  const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diffToMonday));
  const sunday = new Date(now.setDate(monday.getDate() + 6));
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

function getBiweeklyRange(fortnight: "first" | "second", monthString: string) {
  const [year, month] = monthString.split("-").map(Number);
  if (fortnight === "first") {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month - 1, 15));
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  } else {
    const start = new Date(Date.UTC(year, month - 1, 16));
    const end = new Date(Date.UTC(year, month, 0));
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }
}

export default function AdminComissoesPage() {
  const [filterType, setFilterType] = useState<"MONTHLY" | "WEEKLY" | "BIWEEKLY" | "CUSTOM">("MONTHLY");
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7));
  const [fortnight, setFortnight] = useState<"first" | "second">("first");
  
  // Custom date filters
  const [customStart, setCustomStart] = useState(new Date().toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));
  
  const [status, setStatus] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Audit state
  const [selectedMember, setSelectedMember] = useState<{ id: string; name: string } | null>(null);
  const [auditData, setAuditData] = useState<any | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [activeTab, setActiveTab] = useState<"ENTRIES" | "ADJUSTMENTS">("ENTRIES");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    
    if (filterType === "MONTHLY") {
      params.set("competence", competence);
      if (status) params.set("status", status);
    } else if (filterType === "WEEKLY") {
      const range = getWeekRange();
      params.set("startDate", range.start);
      params.set("endDate", range.end);
    } else if (filterType === "BIWEEKLY") {
      const range = getBiweeklyRange(fortnight, competence);
      params.set("startDate", range.start);
      params.set("endDate", range.end);
    } else if (filterType === "CUSTOM") {
      params.set("startDate", customStart);
      params.set("endDate", customEnd);
    }

    fetch(`/api/admin/commissions?${params}`)
      .then((res) => res.json())
      .then(setPeriods)
      .catch(() => setError("Erro ao carregar comissões."))
      .finally(() => setLoading(false));
  }, [filterType, competence, fortnight, customStart, customEnd, status]);

  // Fetch individual professional audit details
  useEffect(() => {
    if (!selectedMember) {
      setAuditData(null);
      return;
    }
    setLoadingAudit(true);
    const params = new URLSearchParams();
    params.set("memberId", selectedMember.id);
    
    if (filterType === "MONTHLY") {
      params.set("competence", competence);
    } else if (filterType === "WEEKLY") {
      const range = getWeekRange();
      params.set("startDate", range.start);
      params.set("endDate", range.end);
    } else if (filterType === "BIWEEKLY") {
      const range = getBiweeklyRange(fortnight, competence);
      params.set("startDate", range.start);
      params.set("endDate", range.end);
    } else if (filterType === "CUSTOM") {
      params.set("startDate", customStart);
      params.set("endDate", customEnd);
    }

    fetch(`/api/admin/commissions/detail?${params}`)
      .then((res) => res.json())
      .then(setAuditData)
      .catch(() => setError("Erro ao carregar auditoria."))
      .finally(() => setLoadingAudit(false));
  }, [selectedMember, filterType, competence, fortnight, customStart, customEnd]);

  const totals = periods.reduce(
    (acc, row) => ({
      generated: acc.generated + Number(row.generatedAmount),
      released: acc.released + Number(row.releasedAmount),
      paid: acc.paid + Number(row.paidAmount),
      reversed: acc.reversed + Number(row.reversedAmount),
      balance: acc.balance + Number(row.balanceAmount),
    }),
    { generated: 0, released: 0, paid: 0, reversed: 0, balance: 0 }
  );

  return (
    <div className="p-4 md:p-6 space-y-5 relative min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">Comissões</h1>
          <p className="text-sm text-[var(--text-muted)]">Relatório auditável de comissões por período ou data.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/comissoes/configuracoes" className="px-3 py-2 rounded-lg border border-[var(--gold-border)] text-[var(--gold)] text-sm hover:bg-[var(--brand-subtle)] transition-colors">
            Configurações
          </Link>
          <Link href="/admin/comissoes/periodos" className="px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm hover:bg-[var(--surface-hover)] transition-colors">
            Períodos Mensais
          </Link>
        </div>
      </div>

      {/* Controles de Filtro */}
      <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-4 rounded-xl space-y-3 shadow-md">
        <div className="flex flex-wrap gap-2">
          {[
            ["MONTHLY", "Mensal"],
            ["WEEKLY", "Semanal"],
            ["BIWEEKLY", "Quinzenal"],
            ["CUSTOM", "Personalizado"],
          ].map(([type, label]) => (
            <button
              key={type}
              onClick={() => setFilterType(type as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                filterType === type
                  ? "bg-[var(--gold)] text-[var(--text-inverse)] hover:bg-[var(--gold-light)]"
                  : "bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-center pt-1">
          {filterType === "MONTHLY" && (
            <>
              <input
                type="month"
                value={competence}
                onChange={(e) => setCompetence(e.target.value)}
                className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
              />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
              >
                <option value="">Todos os status</option>
                <option value="OPEN">Aberto</option>
                <option value="CLOSED">Fechado</option>
                <option value="PAID">Pago</option>
              </select>
            </>
          )}

          {filterType === "WEEKLY" && (
            <div className="text-xs text-[var(--text-secondary)] font-medium">
              Mostrando semana atual: <span className="text-[var(--gold)] font-bold">{getWeekRange().start}</span> até <span className="text-[var(--gold)] font-bold">{getWeekRange().end}</span>
            </div>
          )}

          {filterType === "BIWEEKLY" && (
            <div className="flex gap-2 items-center">
              <input
                type="month"
                value={competence}
                onChange={(e) => setCompetence(e.target.value)}
                className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none"
              />
              <select
                value={fortnight}
                onChange={(e) => setFortnight(e.target.value as any)}
                className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
              >
                <option value="first">1ª Quinzena (Dias 01 - 15)</option>
                <option value="second">2ª Quinzena (Dia 16 - Fim)</option>
              </select>
            </div>
          )}

          {filterType === "CUSTOM" && (
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
              />
              <span className="text-[var(--text-muted)] text-xs">até</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
              />
            </div>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-[var(--border-danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          ["Gerado (Serviços + Produtos)", totals.generated],
          ["Liberado proporcional", totals.released],
          ["Pago no período", totals.paid],
          ["Revertido por estorno", totals.reversed],
          ["Saldo Líquido", totals.balance],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm">
            <p className="text-xs text-[var(--text-muted)]">{label}</p>
            <p className="text-lg text-[var(--text-primary)] font-serif font-bold mt-1">{brl(value)}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <p className="text-[var(--text-muted)]">Carregando...</p>
      ) : periods.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)]">
          Nenhuma comissão encontrada para os filtros aplicados.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--surface-raised)] text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
              <tr>
                {["Profissional", "Período / Filtro", "Gerado", "Liberado", "Pago", "Revertido", "Saldo a Pagar", "Status"].map((head) => (
                  <th key={head} className="px-4 py-3 text-left font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]/40">
              {periods.map((period) => (
                <tr
                  key={period.id}
                  onClick={() => setSelectedMember({ id: period.id, name: period.member.user.name })}
                  className="text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-medium flex items-center gap-2">
                    {period.member.user.name}
                    <span className="text-[10px] text-[var(--text-muted)] font-normal hover:text-[var(--gold)]">🔍 Auditar</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{period.competence}</td>
                  <td className="px-4 py-3 font-serif">{brl(period.generatedAmount)}</td>
                  <td className="px-4 py-3 text-emerald-400 font-serif font-medium">{brl(period.releasedAmount)}</td>
                  <td className="px-4 py-3 font-serif">{brl(period.paidAmount)}</td>
                  <td className="px-4 py-3 text-red-400 font-serif">{brl(period.reversedAmount)}</td>
                  <td className="px-4 py-3 text-[var(--gold)] font-serif font-bold">{brl(period.balanceAmount)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xxs font-bold ${
                      period.status === "PAID" ? "bg-[var(--success-subtle)] text-emerald-400 border border-emerald-950/20" :
                      period.status === "CLOSED" ? "bg-[var(--surface-raised)] text-[var(--text-muted)]" :
                      period.status === "REPORT" ? "bg-[var(--brand-subtle)] text-[var(--gold)] border border-[var(--gold-border)]" :
                      "bg-blue-500/10 text-blue-400"
                    }`}>
                      {period.status === "PAID" ? "Pago" :
                       period.status === "CLOSED" ? "Fechado" :
                       period.status === "REPORT" ? "Relatório" :
                       "Aberto"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer de Auditoria Detalhada */}
      {selectedMember && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div
            className="absolute inset-0 bg-[var(--backdrop)] backdrop-blur-sm transition-opacity"
            onClick={() => setSelectedMember(null)}
          />
          <div className="relative w-full sm:w-[580px] h-full bg-[var(--surface)] border-l border-[var(--border-strong)] shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-250">
            {/* Header */}
            <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <span>Auditoria: {selectedMember.name}</span>
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Filtro: {filterType === "MONTHLY" ? `Competência ${competence}` : "Intervalo personalizado"}
                </p>
              </div>
              <button
                onClick={() => setSelectedMember(null)}
                className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--surface-raised)] transition-colors cursor-pointer"
                title="Fechar"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loadingAudit ? (
                <div className="flex items-center justify-center py-20 text-[var(--text-muted)] text-sm">
                  Carregando lançamentos detalhados...
                </div>
              ) : !auditData ? (
                <div className="flex items-center justify-center py-20 text-[var(--text-muted)] text-sm">
                  Nenhum registro encontrado no período.
                </div>
              ) : (
                <>
                  {/* Resumo Financeiro */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-[var(--surface-raised)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                      <p className="text-[var(--text-muted)]">Bruto Serviços</p>
                      <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(auditData.summary.grossService)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                      <p className="text-[var(--text-muted)]">Bruto Produtos</p>
                      <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(auditData.summary.grossProduct)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                      <p className="text-[var(--text-muted)]">Descontos Aplicados</p>
                      <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(auditData.summary.discount)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                      <p className="text-[var(--text-muted)]">Base Líquida Real</p>
                      <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(auditData.summary.netBase)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                      <p className="text-[var(--text-muted)]">Comissão Gerada</p>
                      <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(auditData.summary.generated)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                      <p className="text-[var(--text-muted)]">Comissão Liberada</p>
                      <p className="font-bold text-emerald-400 mt-0.5 font-serif">{brl(auditData.summary.released)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                      <p className="text-[var(--text-muted)]">Comissão Paga</p>
                      <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(auditData.summary.paid)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                      <p className="text-[var(--text-muted)]">Reversões / Estornos</p>
                      <p className="font-semibold text-red-400 mt-0.5 font-serif">{brl(auditData.summary.reversals)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                      <p className="text-[var(--text-muted)]">Rollover Devedor</p>
                      <p className="font-semibold text-amber-500 mt-0.5 font-serif">{brl(auditData.summary.rollover)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                      <p className="text-[var(--text-muted)]">Ajustes Manuais</p>
                      <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(auditData.summary.manualAdjustments)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-3.5 rounded-xl border border-[var(--gold-border)] col-span-2 flex items-center justify-between mt-1">
                      <div>
                        <p className="text-[var(--text-primary)] font-bold text-sm">Saldo Líquido a Pagar</p>
                        <p className="text-[var(--text-muted)] text-[10px] mt-0.5">Liberado - Pago + Ajustes</p>
                      </div>
                      <p className="text-xl font-bold text-[var(--gold)] font-serif">{brl(auditData.summary.balance)}</p>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex border-b border-[var(--border-subtle)] text-xs font-semibold">
                    <button
                      onClick={() => setActiveTab("ENTRIES")}
                      className={`flex-1 py-2 text-center transition-colors border-b-2 cursor-pointer ${
                        activeTab === "ENTRIES" ? "border-[var(--brand)] text-[var(--gold)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      Lançamentos ({auditData.entries.length})
                    </button>
                    <button
                      onClick={() => setActiveTab("ADJUSTMENTS")}
                      className={`flex-1 py-2 text-center transition-colors border-b-2 cursor-pointer ${
                        activeTab === "ADJUSTMENTS" ? "border-[var(--brand)] text-[var(--gold)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      Ajustes e Estornos ({auditData.adjustments.length})
                    </button>
                  </div>

                  {/* Tab Contents */}
                  {activeTab === "ENTRIES" ? (
                    <div className="space-y-3">
                      {auditData.entries.length === 0 ? (
                        <p className="text-xs text-[var(--text-muted)] text-center py-10">Nenhum lançamento no período.</p>
                      ) : (
                        auditData.entries.map((entry: any) => (
                          <div key={entry.id} className="bg-[var(--surface-raised)]/40 p-3.5 rounded-xl border border-[var(--border-subtle)] space-y-2 text-xs">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-bold text-[var(--text-primary)] text-sm">{entry.description}</p>
                                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Cliente: {entry.customerName}</p>
                              </div>
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${entry.type === "SERVICE" ? "bg-[var(--brand-subtle)] text-[var(--gold)] border border-[var(--gold-border)]" : "bg-sky-500/10 text-sky-400 border border-sky-500/20"}`}>
                                {entry.type === "SERVICE" ? "Serviço" : "Produto"}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-y-2 gap-x-1.5 pt-2.5 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-secondary)]">
                              <div>
                                <p className="text-[var(--text-muted)]">Base Líquida</p>
                                <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(entry.baseAmount)}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Gerada</p>
                                <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(entry.generatedAmount)}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Liberada</p>
                                <p className="font-bold text-emerald-400 mt-0.5 font-serif">{brl(entry.releasedAmount)}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Paga</p>
                                <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(entry.paidAmount)}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Estornada</p>
                                <p className="font-semibold text-red-400 mt-0.5 font-serif">{brl(entry.reversedAmount)}</p>
                              </div>
                              <div>
                                <p className="text-[var(--text-muted)]">Status</p>
                                <p className="font-bold text-[var(--gold)] mt-0.5">{entry.status}</p>
                              </div>
                            </div>
                            <p className="text-[9px] text-[var(--text-muted)] text-right mt-1">
                              {new Date(entry.date).toLocaleString("pt-BR")}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {auditData.adjustments.length === 0 ? (
                        <p className="text-xs text-[var(--text-muted)] text-center py-10">Nenhum ajuste ou estorno no período.</p>
                      ) : (
                        auditData.adjustments.map((adj: any) => (
                          <div key={adj.id} className="bg-[var(--surface-raised)]/40 p-3.5 rounded-xl border border-[var(--border-subtle)] space-y-2 text-xs">
                            <div className="flex justify-between items-center">
                              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${adj.type === "REVERSAL" ? "bg-[var(--danger-subtle)] text-[var(--danger)] border border-[var(--border-danger)]" : "bg-[var(--info-subtle)] text-[var(--info)] border border-[var(--border-strong)]"}`}>
                                {adj.type === "REVERSAL" ? "Estorno" : "Ajuste / Rollover"}
                              </span>
                              <span className={`font-bold text-sm font-serif ${adj.amount < 0 ? "text-red-400" : "text-emerald-400"}`}>
                                {adj.amount > 0 ? "+" : ""}{brl(adj.amount)}
                              </span>
                            </div>
                            <p className="text-[var(--text-primary)] text-xs font-medium leading-relaxed">{adj.description}</p>
                            <div className="flex justify-between text-[9px] text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]">
                              <span>Competência: {adj.competence}</span>
                              <span>{new Date(adj.createdAt).toLocaleString("pt-BR")}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
