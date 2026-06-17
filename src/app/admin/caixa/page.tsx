"use client";

import { useEffect, useState } from "react";

type CashSession = {
  id: string;
  status: string;
  openingAmount: string;
  expectedAmount: string;
  openedAt: string;
  movements: { id: string; amount: string; description: string; createdAt: string }[];
};

function brl(value: string | number) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function CaixaPage() {
  const [session, setSession] = useState<CashSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/cash-sessions/current");
    const data = await res.json();
    setSession(data.session ?? null);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setError("Erro ao carregar caixa."));
  }, []);

  async function open() {
    const openingAmount = window.prompt("Valor inicial", "0");
    if (openingAmount === null) return;
    const res = await fetch("/api/admin/cash-sessions/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openingAmount }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.message ?? data.error ?? "Erro ao abrir caixa.");
    await load();
  }

  async function close() {
    if (!session) return;
    const closingAmount = window.prompt("Valor contado no fechamento", session.expectedAmount);
    if (closingAmount === null) return;
    const res = await fetch(`/api/admin/cash-sessions/${session.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closingAmount }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.message ?? data.error ?? "Erro ao fechar caixa.");
    await load();
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-stone-100">Caixa</h1>
          <p className="text-sm text-stone-500">Controle básico do dinheiro físico.</p>
        </div>
        {session ? <button onClick={close} className="px-4 py-2 rounded-lg bg-stone-100 text-stone-950 font-bold">Fechar caixa</button> : <button onClick={open} className="btn-gold px-4 py-2">Abrir caixa</button>}
      </div>
      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      {loading ? <p className="text-stone-500">Carregando...</p> : session ? (
        <>
          <div className="grid md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-stone-800 bg-stone-950 p-4"><p className="text-xs text-stone-500">Valor inicial</p><p className="text-xl text-stone-100 font-bold">{brl(session.openingAmount)}</p></div>
            <div className="rounded-xl border border-stone-800 bg-stone-950 p-4"><p className="text-xs text-stone-500">Esperado</p><p className="text-xl text-amber-300 font-bold">{brl(session.expectedAmount)}</p></div>
            <div className="rounded-xl border border-stone-800 bg-stone-950 p-4"><p className="text-xs text-stone-500">Aberto em</p><p className="text-sm text-stone-200">{new Date(session.openedAt).toLocaleString("pt-BR")}</p></div>
          </div>
          <section className="rounded-xl border border-stone-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-800 text-stone-100 font-semibold">Movimentos</div>
            {session.movements.length === 0 ? <p className="p-4 text-sm text-stone-500">Sem movimentos em dinheiro.</p> : session.movements.map((movement) => (
              <div key={movement.id} className="px-4 py-3 border-b border-stone-900 flex justify-between">
                <p className="text-sm text-stone-300">{movement.description}</p>
                <p className={Number(movement.amount) >= 0 ? "text-emerald-300" : "text-red-300"}>{brl(movement.amount)}</p>
              </div>
            ))}
          </section>
        </>
      ) : (
        <div className="py-16 text-center border border-stone-800 rounded-xl text-stone-500">Nenhum caixa aberto.</div>
      )}
    </div>
  );
}
