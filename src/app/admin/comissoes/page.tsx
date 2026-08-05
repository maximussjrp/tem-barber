"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

type Period = {
  id: string;
  memberId?: string;
  competence: string;
  status: string;
  generatedAmount: string;
  releasedAmount: string;
  paidAmount: string;
  reversedAmount: string;
  balanceAmount: string;
  member: { id?: string; user: { name: string } };
};

type ReportSummary = {
  grossServiceAmount: string;
  grossProductAmount: string;
  discountAmount: string;
  netBaseAmount: string;
  generatedCommission: string;
  releasedCommission: string;
  paidCommission: string;
  reversedCommission: string;
  balanceAmount: string;
  barbershopNetAmount: string;
  commandCount: number;
  serviceCount: number;
  productCount: number;
  averageTicket: string;
  effectiveCommissionRate: string;
};

type ReportMember = ReportSummary & {
  memberId: string;
  memberName: string;
};

type ReportData = {
  summary: ReportSummary;
  members: ReportMember[];
  period: { startDate: string; endDate: string; type: string };
};

function brl(value: string | number) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(value: string | number) {
  const n = Number(value);
  return isNaN(n) || n === 0 ? "0%" : `${n.toFixed(1)}%`;
}

function getWeekRangeFromRef(refDateStr: string) {
  const [y, m, d] = refDateStr.split("-").map(Number);
  const ref = new Date(y, m - 1, d);
  const day = ref.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(y, m - 1, d + diffToMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  return { start: fmt(monday), end: fmt(sunday) };
}

function shiftWeek(refDateStr: string, weeks: number) {
  const [y, m, d] = refDateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + weeks * 7);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
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

function formatDateBR(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

const WEEKDAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function weekLabel(startStr: string, endStr: string) {
  return `${formatDateBR(startStr)} — ${formatDateBR(endStr)}`;
}

export default function AdminComissoesPage() {
  const [filterType, setFilterType] = useState<"MONTHLY" | "WEEKLY" | "BIWEEKLY" | "CUSTOM">("MONTHLY");
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7));
  const [fortnight, setFortnight] = useState<"first" | "second">("first");
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [weekRefDate, setWeekRefDate] = useState(todayStr);

  const [customStart, setCustomStart] = useState(todayStr);
  const [customEnd, setCustomEnd] = useState(todayStr);

  const [status, setStatus] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [availableMembers, setAvailableMembers] = useState<{ id: string; name: string }[]>([]);

  const [reportData, setReportData] = useState<ReportData | null>(null);
  // Keep periods for MONTHLY backward compat (period management uses the old endpoint)
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedMember, setSelectedMember] = useState<{ id: string; name: string } | null>(null);
  const [auditData, setAuditData] = useState<any | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [activeTab, setActiveTab] = useState<"ENTRIES" | "OPEN_COMANDAS" | "CLOSED_COMANDAS" | "ADJUSTMENTS">("ENTRIES");

  // Build date params for current filter
  const getDateParams = useCallback(() => {
    const params: Record<string, string> = {};
    if (filterType === "MONTHLY") {
      params.type = "MONTHLY";
      params.competence = competence;
      if (status) params.status = status;
    } else if (filterType === "WEEKLY") {
      params.type = "WEEKLY";
      params.weekRefDate = weekRefDate;
    } else if (filterType === "BIWEEKLY") {
      const range = getBiweeklyRange(fortnight, competence);
      params.type = "BIWEEKLY";
      params.competence = competence;
      params.startDate = range.start;
      params.endDate = range.end;
    } else if (filterType === "CUSTOM") {
      params.type = "CUSTOM";
      params.startDate = customStart;
      params.endDate = customEnd;
    }
    if (memberFilter) params.memberId = memberFilter;
    return params;
  }, [filterType, competence, fortnight, weekRefDate, customStart, customEnd, status, memberFilter]);

  // Fetch report data from new endpoint
  useEffect(() => {
    setLoading(true);
    setError("");
    const dateParams = getDateParams();
    const params = new URLSearchParams(dateParams);

    fetch(`/api/admin/commissions/report?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error("Erro ao carregar relatório");
        return res.json();
      })
      .then((data: ReportData) => {
        setReportData(data);
        // Build available members for filter dropdown
        const members = data.members.map((m) => ({ id: m.memberId, name: m.memberName }));
        setAvailableMembers((prev) => {
          // Merge with previous to keep full list even when filtered
          const map = new Map(prev.map((p) => [p.id, p]));
          members.forEach((m) => map.set(m.id, m));
          return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
        });
      })
      .catch(() => setError("Erro ao carregar relatório de comissões."))
      .finally(() => setLoading(false));
  }, [getDateParams]);

  // Fetch audit data when member selected (uses existing detail endpoint)
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
      const range = getWeekRangeFromRef(weekRefDate);
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
  }, [selectedMember, filterType, competence, fortnight, weekRefDate, customStart, customEnd]);

  const summary = reportData?.summary;
  const members = reportData?.members || [];

  const openEntries = auditData?.entries?.filter((e: any) => e.comandaStatus === "OPEN") || [];
  const closedEntries = auditData?.entries?.filter((e: any) => e.comandaStatus === "CLOSED") || [];

  const weekRange = filterType === "WEEKLY" ? getWeekRangeFromRef(weekRefDate) : null;

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

          {filterType === "WEEKLY" && weekRange && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setWeekRefDate(shiftWeek(weekRefDate, -1))}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
              >
                Semana anterior
              </button>
              <div className="text-xs text-[var(--text-secondary)] font-medium px-2">
                <span className="text-[var(--gold)] font-bold">{weekLabel(weekRange.start, weekRange.end)}</span>
              </div>
              <button
                onClick={() => setWeekRefDate(shiftWeek(weekRefDate, 1))}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
              >
                Próxima semana
              </button>
              <button
                onClick={() => setWeekRefDate(todayStr)}
                className="px-2.5 py-1.5 rounded-lg bg-[var(--brand-subtle)] border border-[var(--gold-border)] text-[var(--gold)] text-xs font-semibold hover:bg-[var(--gold)] hover:text-[var(--text-inverse)] transition-colors cursor-pointer"
              >
                Semana atual
              </button>
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

          {/* Barber filter */}
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
          >
            <option value="">Todos os barbeiros</option>
            {availableMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-3.5 rounded-xl">
            <p className="text-xs text-[var(--text-muted)]">Produção Total</p>
            <p className="text-lg font-serif font-bold text-[var(--text-primary)] mt-1">
              {brl(Number(summary.grossServiceAmount) + Number(summary.grossProductAmount))}
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              {Number(summary.commandCount)} comandas · {Number(summary.serviceCount)} serviços
              {Number(summary.productCount) > 0 && ` · ${Number(summary.productCount)} produtos`}
            </p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-3.5 rounded-xl">
            <p className="text-xs text-[var(--text-muted)]">Comissão Gerada</p>
            <p className="text-lg font-serif font-bold text-[var(--text-primary)] mt-1">{brl(summary.generatedCommission)}</p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">% efetivo: {pct(summary.effectiveCommissionRate)}</p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-3.5 rounded-xl">
            <p className="text-xs text-[var(--text-muted)]">Liberado</p>
            <p className="text-lg font-serif font-bold text-emerald-400 mt-1">{brl(summary.releasedCommission)}</p>
            {Number(summary.paidCommission) > 0 && (
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Pago: {brl(summary.paidCommission)}</p>
            )}
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-3.5 rounded-xl">
            <p className="text-xs text-[var(--text-muted)]">Saldo a Pagar</p>
            <p className="text-lg font-serif font-bold text-[var(--gold)] mt-1">{brl(summary.balanceAmount)}</p>
            {Number(summary.reversedCommission) > 0 && (
              <p className="text-[10px] text-red-400 mt-0.5">Revertido: {brl(summary.reversedCommission)}</p>
            )}
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-3.5 rounded-xl">
            <p className="text-xs text-[var(--text-muted)]">Líquido estimado da barbearia</p>
            <p className="text-lg font-serif font-bold text-[var(--text-primary)] mt-1">{brl(summary.barbershopNetAmount)}</p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-3.5 rounded-xl">
            <p className="text-xs text-[var(--text-muted)]">Ticket Médio</p>
            <p className="text-lg font-serif font-bold text-[var(--text-primary)] mt-1">{brl(summary.averageTicket)}</p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-3.5 rounded-xl">
            <p className="text-xs text-[var(--text-muted)]">Descontos</p>
            <p className="text-lg font-serif font-bold text-[var(--text-primary)] mt-1">{brl(summary.discountAmount)}</p>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-3.5 rounded-xl">
            <p className="text-xs text-[var(--text-muted)]">Pago aos Barbeiros</p>
            <p className="text-lg font-serif font-bold text-[var(--text-primary)] mt-1">{brl(summary.paidCommission)}</p>
          </div>
        </div>
      )}

      {/* Members Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-[var(--text-muted)] text-sm">Carregando comissões...</div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-center text-red-400 text-sm">{error}</div>
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)]">
          Nenhuma comissão encontrada para os filtros aplicados.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)]">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--surface-raised)] text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
              <tr>
                {["Profissional", "Comandas", "Serviços", "Produção", "Base Líquida", "Gerado", "Liberado", "Saldo", "Ticket Médio", "% Efetivo", ""].map((head) => (
                  <th key={head || "action"} className="px-3 py-3 text-left font-medium text-xs whitespace-nowrap">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--surface)]/40">
              {members.map((m) => (
                <tr
                  key={m.memberId}
                  className="text-[var(--text-primary)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
                  onClick={() => setSelectedMember({ id: m.memberId, name: m.memberName })}
                >
                  <td className="px-3 py-3 font-medium whitespace-nowrap">{m.memberName}</td>
                  <td className="px-3 py-3 text-center">{m.commandCount}</td>
                  <td className="px-3 py-3 text-center">{m.serviceCount}</td>
                  <td className="px-3 py-3 font-serif whitespace-nowrap">
                    {brl(Number(m.grossServiceAmount) + Number(m.grossProductAmount))}
                  </td>
                  <td className="px-3 py-3 font-serif whitespace-nowrap">{brl(m.netBaseAmount)}</td>
                  <td className="px-3 py-3 font-serif whitespace-nowrap">{brl(m.generatedCommission)}</td>
                  <td className="px-3 py-3 text-emerald-400 font-serif font-medium whitespace-nowrap">{brl(m.releasedCommission)}</td>
                  <td className="px-3 py-3 text-[var(--gold)] font-serif font-bold whitespace-nowrap">{brl(m.balanceAmount)}</td>
                  <td className="px-3 py-3 font-serif whitespace-nowrap">{brl(m.averageTicket)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{pct(m.effectiveCommissionRate)}</td>
                  <td className="px-3 py-3">
                    <span className="text-[10px] text-[var(--text-muted)] font-normal hover:text-[var(--gold)]">🔍 Auditar</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit Drawer */}
      {selectedMember && (
        <div className="fixed inset-0 z-[100] flex justify-end">
          <div
            className="absolute inset-0 bg-[var(--backdrop)] backdrop-blur-sm transition-opacity"
            onClick={() => setSelectedMember(null)}
          />
          <div className="relative w-full sm:w-[620px] h-full bg-[var(--surface)] border-l border-[var(--border-strong)] shadow-2xl flex flex-col z-10 animate-in slide-in-from-right duration-250">
            <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                  <span>Auditoria: {selectedMember.name}</span>
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Filtro: {filterType === "MONTHLY" ? `Competência ${competence}` : filterType === "WEEKLY" && weekRange ? weekLabel(weekRange.start, weekRange.end) : "Intervalo personalizado"}
                </p>
              </div>
              <button
                onClick={() => setSelectedMember(null)}
                className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg hover:bg-[var(--surface-raised)] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loadingAudit ? (
                <div className="flex items-center justify-center py-20 text-[var(--text-muted)] text-sm">Carregando lançamentos...</div>
              ) : !auditData ? (
                <div className="flex items-center justify-center py-20 text-[var(--text-muted)] text-sm">Nenhum registro encontrado.</div>
              ) : (
                <>
                  {/* Drawer mini summary from report data */}
                  {(() => {
                    const memberReport = members.find((m) => m.memberId === selectedMember.id);
                    if (!memberReport) return null;
                    return (
                      <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                        <div className="bg-[var(--surface-raised)] p-2 rounded-lg border border-[var(--border-subtle)]">
                          <p className="text-[var(--text-muted)]">Produção</p>
                          <p className="font-semibold font-serif">{brl(Number(memberReport.grossServiceAmount) + Number(memberReport.grossProductAmount))}</p>
                        </div>
                        <div className="bg-[var(--surface-raised)] p-2 rounded-lg border border-[var(--border-subtle)]">
                          <p className="text-[var(--text-muted)]">Comandas</p>
                          <p className="font-semibold">{memberReport.commandCount}</p>
                        </div>
                        <div className="bg-[var(--surface-raised)] p-2 rounded-lg border border-[var(--border-subtle)]">
                          <p className="text-[var(--text-muted)]">Serviços</p>
                          <p className="font-semibold">{memberReport.serviceCount}</p>
                        </div>
                        <div className="bg-[var(--surface-raised)] p-2 rounded-lg border border-[var(--border-subtle)]">
                          <p className="text-[var(--text-muted)]">Ticket Médio</p>
                          <p className="font-semibold font-serif">{brl(memberReport.averageTicket)}</p>
                        </div>
                        <div className="bg-[var(--surface-raised)] p-2 rounded-lg border border-[var(--border-subtle)]">
                          <p className="text-[var(--text-muted)]">% Efetivo</p>
                          <p className="font-semibold">{pct(memberReport.effectiveCommissionRate)}</p>
                        </div>
                        <div className="bg-[var(--surface-raised)] p-2 rounded-lg border border-[var(--gold-border)]">
                          <p className="text-[var(--text-muted)]">Saldo</p>
                          <p className="font-semibold font-serif text-[var(--gold)]">{brl(memberReport.balanceAmount)}</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Existing audit detail cards */}
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
                      <p className="text-[var(--text-muted)]">Descontos</p>
                      <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(auditData.summary.discount)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-2.5 rounded-lg border border-[var(--border-subtle)]">
                      <p className="text-[var(--text-muted)]">Comissão Gerada</p>
                      <p className="font-semibold text-[var(--text-primary)] mt-0.5 font-serif">{brl(auditData.summary.generated)}</p>
                    </div>
                    <div className="bg-[var(--surface-raised)] p-3.5 rounded-xl border border-[var(--gold-border)] col-span-2 flex items-center justify-between">
                      <div>
                        <p className="text-[var(--text-primary)] font-bold text-sm">Saldo Líquido</p>
                      </div>
                      <p className="text-xl font-bold text-[var(--gold)] font-serif">{brl(auditData.summary.balance)}</p>
                    </div>
                  </div>

                  <div className="flex border-b border-[var(--border-subtle)] text-xs font-semibold overflow-x-auto">
                    <button onClick={() => setActiveTab("ENTRIES")} className={`py-2 px-3 transition-colors border-b-2 cursor-pointer whitespace-nowrap ${activeTab === "ENTRIES" ? "border-[var(--brand)] text-[var(--gold)]" : "border-transparent text-[var(--text-secondary)]"}`}>Lançamentos ({auditData.entries.length})</button>
                    <button onClick={() => setActiveTab("OPEN_COMANDAS")} className={`py-2 px-3 transition-colors border-b-2 cursor-pointer whitespace-nowrap ${activeTab === "OPEN_COMANDAS" ? "border-[var(--brand)] text-[var(--gold)]" : "border-transparent text-[var(--text-secondary)]"}`}>Abertas ({openEntries.length})</button>
                    <button onClick={() => setActiveTab("CLOSED_COMANDAS")} className={`py-2 px-3 transition-colors border-b-2 cursor-pointer whitespace-nowrap ${activeTab === "CLOSED_COMANDAS" ? "border-[var(--brand)] text-[var(--gold)]" : "border-transparent text-[var(--text-secondary)]"}`}>Fechadas ({closedEntries.length})</button>
                    <button onClick={() => setActiveTab("ADJUSTMENTS")} className={`py-2 px-3 transition-colors border-b-2 cursor-pointer whitespace-nowrap ${activeTab === "ADJUSTMENTS" ? "border-[var(--brand)] text-[var(--gold)]" : "border-transparent text-[var(--text-secondary)]"}`}>Estornos ({auditData.adjustments.length})</button>
                  </div>

                  {activeTab === "ENTRIES" || activeTab === "OPEN_COMANDAS" || activeTab === "CLOSED_COMANDAS" ? (
                    <div className="space-y-3">
                      {(() => {
                        const list = activeTab === "OPEN_COMANDAS" ? openEntries : activeTab === "CLOSED_COMANDAS" ? closedEntries : auditData.entries;
                        if (list.length === 0) return <p className="text-xs text-[var(--text-muted)] text-center py-10">Nenhum lançamento.</p>;
                        return list.map((entry: any) => (
                          <div key={entry.id} className="bg-[var(--surface-raised)]/40 p-3.5 rounded-xl border border-[var(--border-subtle)] space-y-2 text-xs">
                            <div className="flex justify-between items-start">
                              <div>
                                <p className="font-bold text-[var(--text-primary)] text-sm">{entry.description}</p>
                                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Cliente: {entry.customerName}</p>
                                {entry.comandaId && (
                                  <p className="text-[10px] mt-1">Comanda: <Link href="/admin/comandas" className="text-[var(--gold)] font-mono hover:underline">#{entry.comandaId.slice(0, 8)}</Link></p>
                                )}
                              </div>
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-[var(--brand-subtle)] text-[var(--gold)]">{entry.type}</span>
                            </div>
                            <div className="bg-[var(--surface-raised)]/60 p-2 rounded-lg border border-[var(--border-subtle)] text-[10px] flex justify-between">
                              <span>Regra: <strong>{entry.ruleOriginLabel || "Padrão"}</strong></span>
                              <span className="text-[var(--gold)]">{entry.ruleValue}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 pt-2 text-[10px]">
                              <div><p className="text-[var(--text-muted)]">Base</p><p className="font-serif">{brl(entry.baseAmount)}</p></div>
                              <div><p className="text-[var(--text-muted)]">Gerada</p><p className="font-serif">{brl(entry.generatedAmount)}</p></div>
                              <div><p className="text-[var(--text-muted)]">Status</p><p className="font-bold">{entry.status}</p></div>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {auditData.adjustments.length === 0 ? (
                        <p className="text-xs text-[var(--text-muted)] text-center py-10">Nenhum ajuste ou estorno.</p>
                      ) : (
                        auditData.adjustments.map((adj: any) => (
                          <div key={adj.id} className="bg-[var(--surface-raised)]/40 p-3.5 rounded-xl border border-[var(--border-subtle)]">
                            <p className="text-xs font-bold">{adj.description}</p>
                            <p className="text-sm font-serif font-bold text-[var(--gold)]">{brl(adj.amount)}</p>
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
