"use client";

import { useEffect, useState } from "react";
import { ClubStatusBadge } from "@/components/admin/clube/ClubStatusBadge";

type UsageEntry = {
  id: string;
  barbershopId: string;
  subscriptionId: string;
  competence: string;
  benefitType: string;
  status: string;
  usedAt: string;
  originalAmount: string | null;
  coveredAmount: string | null;
  discountAmount: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  subscription?: {
    customer?: { name: string };
    clubPlan?: { name: string };
  };
};

const BENEFIT_TYPE_LABELS: Record<string, string> = {
  INCLUDED_SERVICE: "Serviço incluso",
  SERVICE_DISCOUNT: "Desconto em serviço",
  PRODUCT_DISCOUNT: "Desconto em produto",
};

function brl(v: string | number | null | undefined) {
  if (v == null) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function currentCompetence() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function downloadCsv(rows: UsageEntry[]) {
  const header = "ID,Assinante,Plano,Competência,Tipo,Status,Valor Original,Cobertura,Desconto,Aplicado em,Revertido em\n";
  const lines = rows.map((r) =>
    [
      r.id,
      r.subscription?.customer?.name ?? "",
      r.subscription?.clubPlan?.name ?? "",
      r.competence,
      BENEFIT_TYPE_LABELS[r.benefitType] ?? r.benefitType,
      r.status,
      r.originalAmount ?? "",
      r.coveredAmount ?? "",
      r.discountAmount ?? "",
      r.usedAt ? fmt(r.usedAt) : "",
      r.reversedAt ? fmt(r.reversedAt) : "",
    ].join(",")
  );
  const csv = header + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `club-usage-${currentCompetence()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function RelatoriosPage() {
  const [usages, setUsages] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [competence, setCompetence] = useState(currentCompetence());
  const [statusFilter, setStatusFilter] = useState("");

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (competence) params.set("competence", competence);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/admin/clube/usage?${params}`);
      const data = await res.json();
      setUsages(Array.isArray(data) ? data : []);
    } catch {
      setError("Erro ao carregar relatório de uso.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [competence, statusFilter]);

  const inputCls =
    "px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--brand)] transition-colors";

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">Relatório de Uso</h1>
          <p className="text-sm text-[var(--text-muted)]">Histórico de utilização de benefícios do clube.</p>
        </div>
        {usages.length > 0 && (
          <button
            onClick={() => downloadCsv(usages)}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            Exportar CSV
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">Competência</label>
          <input
            type="month"
            value={competence}
            onChange={(e) => setCompetence(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1.5">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={inputCls}
          >
            <option value="">Todos</option>
            <option value="APPLIED">Aplicado</option>
            <option value="REVERSED">Revertido</option>
          </select>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      {loading ? (
        <p className="text-[var(--text-muted)]">Carregando...</p>
      ) : usages.length === 0 ? (
        <div className="py-16 text-center border border-[var(--border-subtle)] rounded-xl bg-[var(--surface)]">
          <span className="text-4xl">📋</span>
          <p className="font-bold text-[var(--text-primary)] mt-4 mb-1">Nenhum uso encontrado</p>
          <p className="text-sm text-[var(--text-muted)]">Ajuste os filtros ou aguarde registros de utilização do clube.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--surface)]">
                {["Assinante", "Plano", "Tipo", "Competência", "Status", "Original", "Cobertura/Desconto", "Data"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usages.map((u) => (
                <tr key={u.id} className="border-b border-[var(--border-subtle)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] transition-colors">
                  <td className="px-4 py-3 text-[var(--text-primary)] font-medium">
                    {u.subscription?.customer?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {u.subscription?.clubPlan?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {BENEFIT_TYPE_LABELS[u.benefitType] ?? u.benefitType}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{u.competence}</td>
                  <td className="px-4 py-3">
                    <ClubStatusBadge status={u.status} type="usage" />
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{brl(u.originalAmount)}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {u.coveredAmount ? brl(u.coveredAmount) : brl(u.discountAmount)}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{fmt(u.usedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      {!loading && usages.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: "Total de registros", value: usages.length },
            { label: "Aplicados", value: usages.filter((u) => u.status === "APPLIED").length },
            { label: "Revertidos", value: usages.filter((u) => u.status === "REVERSED").length },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3">
              <p className="text-xs text-[var(--text-muted)]">{item.label}</p>
              <p className="font-bold text-[var(--text-primary)] text-lg">{item.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
