"use client";

import { useEffect, useState } from "react";

type Entry = {
  id: string;
  status: string;
  baseAmount: string;
  generatedAmount: string;
  releasedAmount: string;
  paidAmount: string;
  reversedAmount: string;
  comandaItem: { description: string; total: string; completedAt: string | null };
};
type Statement = {
  period: null | {
    status: string;
    generatedAmount: string;
    releasedAmount: string;
    paidAmount: string;
    reversedAmount: string;
    balanceAmount: string;
  };
  entries: Entry[];
  adjustments: { id: string; type: string; amount: string; description: string; createdAt: string }[];
};

function brl(value: string | number) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function MemberComissoesPage() {
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7));
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/member/commissions?competence=${competence}`)
      .then((res) => res.json())
      .then(setStatement)
      .catch(() => setError("Erro ao carregar extrato."))
      .finally(() => setLoading(false));
  }, [competence]);

  const period = statement?.period;
  const cards = [
    ["Gerada", period?.generatedAmount ?? 0],
    ["Liberada", period?.releasedAmount ?? 0],
    ["Paga", period?.paidAmount ?? 0],
    ["Pendente", period?.balanceAmount ?? 0],
  ];

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-stone-100">Meu extrato</h1>
          <p className="text-sm text-stone-500">Comissoes liberadas conforme recebimento da comanda.</p>
        </div>
        <input type="month" value={competence} onChange={(e) => { setLoading(true); setCompetence(e.target.value); }} className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-stone-100" />
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      {loading || !statement ? <p className="text-stone-500">Carregando...</p> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {cards.map(([label, value]) => (
              <div key={label} className="rounded-xl border border-stone-800 bg-stone-950 p-4">
                <p className="text-xs text-stone-500">{label}</p>
                <p className="text-lg text-stone-100 font-bold">{brl(value)}</p>
              </div>
            ))}
          </div>

          {statement.entries.length === 0 ? (
            <div className="rounded-xl border border-stone-800 bg-stone-950 p-8 text-center text-stone-500">Nenhum lancamento neste periodo.</div>
          ) : (
            <div className="space-y-3">
              {statement.entries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-stone-800 bg-stone-950 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-stone-100 font-semibold">{entry.comandaItem.description}</p>
                      <p className="text-xs text-stone-500">{entry.status}</p>
                    </div>
                    <p className="text-amber-300 font-bold">{brl(entry.releasedAmount)}</p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs text-stone-500">
                    <span>Base <b className="block text-stone-300">{brl(entry.baseAmount)}</b></span>
                    <span>Gerada <b className="block text-stone-300">{brl(entry.generatedAmount)}</b></span>
                    <span>Paga <b className="block text-stone-300">{brl(entry.paidAmount)}</b></span>
                    <span>Revertida <b className="block text-red-300">{brl(entry.reversedAmount)}</b></span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {statement.adjustments.length > 0 && (
            <div className="rounded-xl border border-stone-800 bg-stone-950 p-4">
              <p className="text-stone-100 font-semibold mb-3">Ajustes e reversoes</p>
              <div className="space-y-2">
                {statement.adjustments.map((adjustment) => (
                  <div key={adjustment.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-stone-400">{adjustment.description}</span>
                    <span className={Number(adjustment.amount) < 0 ? "text-red-300" : "text-emerald-300"}>{brl(adjustment.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
