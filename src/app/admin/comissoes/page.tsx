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
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-stone-100">Comissões</h1>
          <p className="text-sm text-stone-500">Relatório auditável de comissões por período ou data.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/comissoes/configuracoes" className="px-3 py-2 rounded-lg border border-amber-800 text-amber-300 text-sm hover:bg-amber-950/20">
            Configurações
          </Link>
          <Link href="/admin/comissoes/periodos" className="px-3 py-2 rounded-lg border border-stone-700 text-stone-200 text-sm hover:bg-stone-800">
            Períodos Mensais
          </Link>
        </div>
      </div>

      {/* Controles de Filtro */}
      <div className="bg-stone-900/40 border border-stone-850 p-4 rounded-xl space-y-3">
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
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                filterType === type
                  ? "bg-amber-500 text-stone-950"
                  : "bg-stone-950 border border-stone-850 text-stone-300 hover:bg-stone-900"
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
                className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-stone-100 text-sm focus:outline-none focus:border-amber-500"
              />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-stone-100 text-sm focus:outline-none focus:border-amber-500"
              >
                <option value="">Todos os status</option>
                <option value="OPEN">Aberto</option>
                <option value="CLOSED">Fechado</option>
                <option value="PAID">Pago</option>
              </select>
            </>
          )}

          {filterType === "WEEKLY" && (
            <div className="text-xs text-stone-400 font-medium">
              Mostrando semana atual: <span className="text-amber-400 font-bold">{getWeekRange().start}</span> até <span className="text-amber-400 font-bold">{getWeekRange().end}</span>
            </div>
          )}

          {filterType === "BIWEEKLY" && (
            <div className="flex gap-2 items-center">
              <input
                type="month"
                value={competence}
                onChange={(e) => setCompetence(e.target.value)}
                className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-stone-100 text-sm focus:outline-none"
              />
              <select
                value={fortnight}
                onChange={(e) => setFortnight(e.target.value as any)}
                className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-stone-100 text-sm focus:outline-none focus:border-amber-500"
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
                className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-stone-100 text-sm focus:outline-none focus:border-amber-500"
              />
              <span className="text-stone-500 text-xs">até</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-stone-100 text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          ["Gerado (Serviços + Produtos)", totals.generated],
          ["Liberado proporcional", totals.released],
          ["Pago no período", totals.paid],
          ["Revertido por estorno", totals.reversed],
          ["Saldo Líquido", totals.balance],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-stone-800 bg-stone-950 p-4">
            <p className="text-xs text-stone-500">{label}</p>
            <p className="text-lg text-stone-100 font-bold">{brl(value)}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <p className="text-stone-500">Carregando...</p>
      ) : periods.length === 0 ? (
        <div className="rounded-xl border border-stone-800 bg-stone-950 p-8 text-center text-stone-500">
          Nenhuma comissão encontrada para os filtros aplicados.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-800">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-950 text-stone-500">
              <tr>
                {["Profissional", "Período / Filtro", "Gerado", "Liberado", "Pago", "Revertido", "Saldo a Pagar", "Status"].map((head) => (
                  <th key={head} className="px-4 py-3 text-left font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800 bg-stone-950/60">
              {periods.map((period) => (
                <tr key={period.id} className="text-stone-200">
                  <td className="px-4 py-3 font-medium">{period.member.user.name}</td>
                  <td className="px-4 py-3 text-xs text-stone-400">{period.competence}</td>
                  <td className="px-4 py-3">{brl(period.generatedAmount)}</td>
                  <td className="px-4 py-3 text-emerald-400 font-medium">{brl(period.releasedAmount)}</td>
                  <td className="px-4 py-3">{brl(period.paidAmount)}</td>
                  <td className="px-4 py-3 text-red-400">{brl(period.reversedAmount)}</td>
                  <td className="px-4 py-3 text-amber-400 font-bold">{brl(period.balanceAmount)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xxs font-bold ${
                      period.status === "PAID" ? "bg-emerald-500/10 text-emerald-400" :
                      period.status === "CLOSED" ? "bg-stone-800 text-stone-400" :
                      period.status === "REPORT" ? "bg-amber-500/10 text-amber-400" :
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
    </div>
  );
}
