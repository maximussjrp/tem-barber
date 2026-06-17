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

export default function AdminComissoesPage() {
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7));
  const [status, setStatus] = useState("");
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams({ competence });
    if (status) params.set("status", status);
    fetch(`/api/admin/commissions?${params}`)
      .then((res) => res.json())
      .then(setPeriods)
      .catch(() => setError("Erro ao carregar comissoes."))
      .finally(() => setLoading(false));
  }, [competence, status]);

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
          <h1 className="text-2xl font-serif font-bold text-stone-100">Comissoes</h1>
          <p className="text-sm text-stone-500">Gerado, liberado, pago e revertido por profissional.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/comissoes/configuracoes" className="px-3 py-2 rounded-lg border border-amber-800 text-amber-300 text-sm">
            Configuracoes
          </Link>
          <Link href="/admin/comissoes/periodos" className="px-3 py-2 rounded-lg border border-stone-700 text-stone-200 text-sm">
            Periodos
          </Link>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input type="month" value={competence} onChange={(e) => { setLoading(true); setCompetence(e.target.value); }} className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-stone-100" />
        <select value={status} onChange={(e) => { setLoading(true); setStatus(e.target.value); }} className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-stone-100">
          <option value="">Todos os status</option>
          <option value="OPEN">Aberto</option>
          <option value="CLOSED">Fechado</option>
          <option value="PAID">Pago</option>
        </select>
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          ["Gerado", totals.generated],
          ["Liberado", totals.released],
          ["Pago", totals.paid],
          ["Revertido", totals.reversed],
          ["Saldo", totals.balance],
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
          Nenhuma comissao encontrada para o filtro.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-800">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-950 text-stone-500">
              <tr>
                {["Profissional", "Periodo", "Gerado", "Liberado", "Pago", "Revertido", "Saldo", "Status"].map((head) => (
                  <th key={head} className="px-4 py-3 text-left font-medium">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800 bg-stone-950/60">
              {periods.map((period) => (
                <tr key={period.id} className="text-stone-200">
                  <td className="px-4 py-3">{period.member.user.name}</td>
                  <td className="px-4 py-3">{period.competence}</td>
                  <td className="px-4 py-3">{brl(period.generatedAmount)}</td>
                  <td className="px-4 py-3 text-emerald-300">{brl(period.releasedAmount)}</td>
                  <td className="px-4 py-3">{brl(period.paidAmount)}</td>
                  <td className="px-4 py-3 text-red-300">{brl(period.reversedAmount)}</td>
                  <td className="px-4 py-3 text-amber-300">{brl(period.balanceAmount)}</td>
                  <td className="px-4 py-3">{period.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
