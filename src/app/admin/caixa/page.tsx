"use client";

import { useEffect, useState } from "react";
import { PromptDialog } from "@/components/ui/PromptDialog";
import { formatBRL, isValidMoneyValue } from "@/lib/operations/money";

type CashSession = {
  id: string;
  status: string;
  openingAmount: string;
  expectedAmount: string;
  openedAt: string;
  movements: { id: string; amount: string; description: string; createdAt: string }[];
};

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

  const [promptData, setPromptData] = useState<{
    isOpen: boolean;
    title: string;
    defaultValue: string;
    action: "open" | "close" | null;
  }>({ isOpen: false, title: "", defaultValue: "", action: null });

  async function handlePromptSubmit(amount: string) {
    if (!amount) return;
    try {
      if (promptData.action === "open") {
        const res = await fetch("/api/admin/cash-sessions/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ openingAmount: amount }),
        });
        const data = await res.json();
        if (!res.ok) setError(data.message ?? data.error ?? "Erro ao abrir caixa.");
      } else if (promptData.action === "close" && session) {
        const res = await fetch(`/api/admin/cash-sessions/${session.id}/close`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ closingAmount: amount }),
        });
        const data = await res.json();
        if (!res.ok) setError(data.message ?? data.error ?? "Erro ao fechar caixa.");
      }
      await load();
    } finally {
      setPromptData((prev) => ({ ...prev, isOpen: false }));
    }
  }

  function open() {
    setPromptData({ isOpen: true, title: "Valor inicial (R$)", defaultValue: "", action: "open" });
  }

  function close() {
    if (!session) return;
    setPromptData({ isOpen: true, title: "Valor contado no fechamento (R$)", defaultValue: isValidMoneyValue(session.expectedAmount) ? session.expectedAmount : "", action: "close" });
  }

  const isCorrupted = session ? (!isValidMoneyValue(session.openingAmount) || !isValidMoneyValue(session.expectedAmount)) : false;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <PromptDialog
        isOpen={promptData.isOpen}
        onClose={() => setPromptData((prev) => ({ ...prev, isOpen: false }))}
        onSubmit={handlePromptSubmit}
        title={promptData.title}
        defaultValue={promptData.defaultValue}
        type="text"
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-stone-100">Caixa</h1>
          <p className="text-sm text-stone-500">Controle básico do dinheiro físico.</p>
        </div>
        {session ? (
          <button onClick={close} disabled={isCorrupted} className="px-4 py-2 rounded-lg bg-stone-100 text-stone-950 font-bold disabled:opacity-50 disabled:cursor-not-allowed">Fechar caixa</button>
        ) : (
          <button onClick={open} className="btn-gold px-4 py-2">Abrir caixa</button>
        )}
      </div>
      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      {loading ? <p className="text-stone-500">Carregando...</p> : session ? (
        <>
          {isCorrupted ? (
            <div className="rounded-xl border border-red-800 bg-red-950/30 p-6 text-center">
              <p className="text-red-300 font-semibold mb-2">Caixa corrompido</p>
              <p className="text-sm text-red-200">Não foi possível calcular os valores deste caixa.</p>
            </div>
          ) : (
            <>
              <div className="grid md:grid-cols-3 gap-3">
                <div className="rounded-xl border border-stone-800 bg-stone-950 p-4">
                  <p className="text-xs text-stone-500">Valor inicial</p>
                  <p className="text-xl text-stone-100 font-bold">{formatBRL(session.openingAmount)}</p>
                </div>
                <div className="rounded-xl border border-stone-800 bg-stone-950 p-4">
                  <p className="text-xs text-stone-500">Esperado</p>
                  <p className="text-xl text-amber-300 font-bold">{formatBRL(session.expectedAmount)}</p>
                </div>
                <div className="rounded-xl border border-stone-800 bg-stone-950 p-4">
                  <p className="text-xs text-stone-500">Aberto em</p>
                  <p className="text-sm text-stone-200">{new Date(session.openedAt).toLocaleString("pt-BR")}</p>
                </div>
              </div>
              <section className="rounded-xl border border-stone-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-stone-800 text-stone-100 font-semibold">Movimentos</div>
                {session.movements.length === 0 ? <p className="p-4 text-sm text-stone-500">Sem movimentos em dinheiro.</p> : session.movements.map((movement) => (
                  <div key={movement.id} className="px-4 py-3 border-b border-stone-900 flex justify-between">
                    <p className="text-sm text-stone-300">{movement.description}</p>
                    <p className={Number(movement.amount) >= 0 ? "text-emerald-300" : "text-red-300"}>{formatBRL(movement.amount)}</p>
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      ) : (
        <div className="py-16 text-center border border-stone-800 rounded-xl text-stone-500">Nenhum caixa aberto.</div>
      )}
    </div>
  );
}
