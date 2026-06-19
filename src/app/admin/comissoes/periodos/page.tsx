"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

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

export default function CommissionPeriodsPage() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [competence, setCompetence] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch(`/api/admin/commissions/periods?competence=${competence}`);
    setPeriods(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch(() => setError("Erro ao carregar periodos."));
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competence]);

  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; id: string; kind: "close" | "pay" | null }>({ isOpen: false, id: "", kind: null });

  async function handleConfirm() {
    const { id, kind } = confirmDialog;
    if (!id || !kind) return;
    setBusy(`${kind}:${id}`);
    setConfirmDialog({ isOpen: false, id: "", kind: null });
    const res = await fetch(`/api/admin/commissions/periods/${id}/${kind}`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Erro na operacao.");
    }
    await load();
    setBusy("");
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-stone-100">Periodos de comissao</h1>
          <p className="text-sm text-stone-500">Revise, feche e pague apenas saldos liberados.</p>
        </div>
        <input type="month" value={competence} onChange={(e) => { setLoading(true); setCompetence(e.target.value); }} className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-stone-100" />
      </div>
      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      {loading ? <p className="text-stone-500">Carregando...</p> : periods.length === 0 ? (
        <div className="rounded-xl border border-stone-800 bg-stone-950 p-8 text-center text-stone-500">Nenhum periodo encontrado.</div>
      ) : (
        <div className="grid gap-3">
          {periods.map((period) => (
            <div key={period.id} className="rounded-xl border border-stone-800 bg-stone-950 p-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <p className="text-stone-100 font-semibold">{period.member.user.name}</p>
                  <p className="text-xs text-stone-500">{period.competence} / {period.status}</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                  <span className="text-stone-400">Gerado <b className="block text-stone-100">{brl(period.generatedAmount)}</b></span>
                  <span className="text-stone-400">Liberado <b className="block text-emerald-300">{brl(period.releasedAmount)}</b></span>
                  <span className="text-stone-400">Pago <b className="block text-stone-100">{brl(period.paidAmount)}</b></span>
                  <span className="text-stone-400">Reversoes <b className="block text-red-300">{brl(period.reversedAmount)}</b></span>
                  <span className="text-stone-400">Saldo <b className="block text-amber-300">{brl(period.balanceAmount)}</b></span>
                </div>
                <div className="flex gap-2">
                  <button disabled={period.status !== "OPEN" || busy !== ""} onClick={() => setConfirmDialog({ isOpen: true, id: period.id, kind: "close" })} className="px-3 py-2 rounded-lg border border-amber-800 text-amber-300 text-sm disabled:opacity-40">
                    {busy === `close:${period.id}` ? "Fechando..." : "Fechar"}
                  </button>
                  <button disabled={period.status === "PAID" || busy !== ""} onClick={() => setConfirmDialog({ isOpen: true, id: period.id, kind: "pay" })} className="px-3 py-2 rounded-lg bg-amber-600 text-stone-950 text-sm font-semibold disabled:opacity-40">
                    {busy === `pay:${period.id}` ? "Pagando..." : "Marcar pago"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ isOpen: false, id: "", kind: null })}
        onConfirm={handleConfirm}
        title={confirmDialog.kind === "close" ? "Fechar período" : "Marcar como pago"}
        description={`Tem certeza que deseja ${confirmDialog.kind === "close" ? "fechar" : "marcar como pago"} este período?`}
        confirmLabel="Confirmar"
      />
    </div>
  );
}
