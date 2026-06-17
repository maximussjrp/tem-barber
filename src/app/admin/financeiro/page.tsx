"use client";

import { useEffect, useState } from "react";

type Summary = {
  totalReceived: number;
  cash: number;
  pix: number;
  debit: number;
  credit: number;
  other: number;
  refunds: number;
  manualIn: number;
  manualOut: number;
  net: number;
  openCommands: number;
  pendingCommands: number;
  closedCommands: number;
  receivable: number;
};

function brl(value: number) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function FinanceiroPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/admin/financial/daily-summary?date=${date}`);
    const data = await res.json();
    setSummary(data);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setError("Erro ao carregar financeiro."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function manual(type: "MANUAL_IN" | "MANUAL_OUT") {
    const amount = window.prompt("Valor");
    if (!amount) return;
    const description = window.prompt("Descrição", type === "MANUAL_IN" ? "Entrada manual" : "Saída manual") ?? "";
    await fetch("/api/admin/financial/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, amount, description, category: "Manual" }),
    });
    await load();
  }

  const cards = summary ? [
    ["Recebido", summary.totalReceived],
    ["Dinheiro", summary.cash],
    ["Pix", summary.pix],
    ["Débito", summary.debit],
    ["Crédito", summary.credit],
    ["Outras", summary.other],
    ["Estornos", summary.refunds],
    ["Entradas", summary.manualIn],
    ["Saídas", summary.manualOut],
    ["Saldo líquido", summary.net],
    ["A receber", summary.receivable],
  ] as const : [];

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-stone-100">Financeiro diário</h1>
          <p className="text-sm text-stone-500">Resumo por pagamentos e lançamentos reais.</p>
        </div>
        <div className="flex gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-stone-100" />
          <button onClick={() => manual("MANUAL_IN")} className="px-3 py-2 rounded-lg border border-emerald-800 text-emerald-300 text-sm">Entrada</button>
          <button onClick={() => manual("MANUAL_OUT")} className="px-3 py-2 rounded-lg border border-red-800 text-red-300 text-sm">Saída</button>
        </div>
      </div>
      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      {loading || !summary ? <p className="text-stone-500">Carregando...</p> : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {cards.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-stone-800 bg-stone-950 p-4">
                <p className="text-xs text-stone-500">{label}</p>
                <p className="text-lg text-stone-100 font-bold">{brl(value)}</p>
              </div>
            ))}
          </div>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-stone-800 bg-stone-950 p-4"><p className="text-xs text-stone-500">Comandas abertas</p><p className="text-xl text-stone-100">{summary.openCommands}</p></div>
            <div className="rounded-xl border border-stone-800 bg-stone-950 p-4"><p className="text-xs text-stone-500">Pendentes</p><p className="text-xl text-amber-300">{summary.pendingCommands}</p></div>
            <div className="rounded-xl border border-stone-800 bg-stone-950 p-4"><p className="text-xs text-stone-500">Fechadas</p><p className="text-xl text-emerald-300">{summary.closedCommands}</p></div>
          </div>
        </>
      )}
    </div>
  );
}
