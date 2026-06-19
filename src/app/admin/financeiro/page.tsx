"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { formatBRL } from "@/lib/operations/money";

type Movement = {
  id: string;
  time: string;
  description: string;
  type: string;
  method: string;
  amount: number;
  status: string;
};

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
  movements: Movement[];
};

export default function FinanceiroPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/financial/daily-summary?date=${date}`);
      const data = await res.json();
      setSummary(data);
    } catch {
      setError("Erro ao carregar financeiro.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const [manualDialog, setManualDialog] = useState<{ isOpen: boolean; type: "MANUAL_IN" | "MANUAL_OUT" | null; amount: string; description: string }>({ isOpen: false, type: null, amount: "", description: "" });
  const [savingManual, setSavingManual] = useState(false);

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualDialog.type || !manualDialog.amount) return;
    setSavingManual(true);
    try {
      await fetch("/api/admin/financial/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: manualDialog.type, amount: manualDialog.amount, description: manualDialog.description, category: "Manual" }),
      });
      await load();
      setManualDialog({ isOpen: false, type: null, amount: "", description: "" });
    } finally {
      setSavingManual(false);
    }
  }

  function openManual(type: "MANUAL_IN" | "MANUAL_OUT") {
    setManualDialog({ isOpen: true, type, amount: "", description: type === "MANUAL_IN" ? "Entrada manual" : "Saída manual" });
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <Dialog isOpen={manualDialog.isOpen} onClose={() => setManualDialog((prev) => ({ ...prev, isOpen: false }))} title={manualDialog.type === "MANUAL_IN" ? "Nova Entrada" : "Nova Saída"} className="max-w-md">
        <form onSubmit={handleManualSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Valor (R$)</label>
            <input type="number" step="0.01" min="0" value={manualDialog.amount} onChange={(e) => setManualDialog((p) => ({ ...p, amount: e.target.value }))} className="w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)]" autoFocus required />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Descrição</label>
            <input type="text" value={manualDialog.description} onChange={(e) => setManualDialog((p) => ({ ...p, description: e.target.value }))} className="w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)]" required />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={() => setManualDialog((prev) => ({ ...prev, isOpen: false }))} disabled={savingManual} className="px-4 py-2 rounded-lg border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors text-sm font-semibold">Cancelar</button>
            <button type="submit" disabled={savingManual} className="px-4 py-2 rounded-lg bg-[var(--gold)] text-stone-950 font-bold transition-colors text-sm hover:brightness-110">Confirmar</button>
          </div>
        </form>
      </Dialog>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-stone-100">Financeiro</h1>
          <p className="text-sm text-stone-500">Resumo e composição do período.</p>
        </div>
        <div className="flex gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-amber-500" />
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      {loading ? (
        <p className="text-stone-500">Carregando...</p>
      ) : summary ? (
        <div className="space-y-6">
          <section className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            <div className="col-span-2 md:col-span-1 rounded-xl border border-amber-900/30 bg-gradient-to-br from-stone-900 to-stone-950 p-5 shadow-lg relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <svg className="w-16 h-16 text-amber-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/></svg>
              </div>
              <p className="text-sm font-semibold text-amber-500/80 tracking-wide">Saldo Líquido</p>
              <p className="text-3xl font-bold text-stone-100 mt-1 tracking-tight">{formatBRL(summary.net)}</p>
            </div>

            <div className="rounded-xl border border-stone-800 bg-stone-950 p-5 flex flex-col justify-between">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Recebido</p>
              <p className="text-xl font-bold text-emerald-400 mt-2">{formatBRL(summary.totalReceived + summary.manualIn)}</p>
            </div>

            <div className="rounded-xl border border-stone-800 bg-stone-950 p-5 flex flex-col justify-between">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Saídas</p>
              <p className="text-xl font-bold text-red-400 mt-2">{formatBRL(summary.refunds + summary.manualOut)}</p>
            </div>
          </section>

          <div className="grid md:grid-cols-2 gap-6">
            <section className="rounded-xl border border-stone-800 bg-stone-950/50 p-4">
              <h2 className="text-sm font-bold text-stone-300 uppercase tracking-widest mb-4">Composição dos recebimentos</h2>
              <div className="space-y-3">
                {[
                  { label: "Dinheiro", value: summary.cash },
                  { label: "Pix", value: summary.pix },
                  { label: "Débito", value: summary.debit },
                  { label: "Crédito", value: summary.credit },
                  { label: "Outras", value: summary.other },
                ].map((item) => {
                  const pct = summary.totalReceived > 0 ? ((item.value / summary.totalReceived) * 100).toFixed(1) : "0.0";
                  return (
                    <div key={item.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-stone-300">{item.label}</span>
                        {summary.totalReceived > 0 && <span className="text-[10px] bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded">{pct}%</span>}
                      </div>
                      <span className="text-sm font-medium text-stone-100">{formatBRL(item.value)}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-stone-800 bg-stone-950/50 p-4">
              <h2 className="text-sm font-bold text-stone-300 uppercase tracking-widest mb-4">Ajustes manuais</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stone-300">Entradas avulsas</span>
                  <span className="text-sm font-medium text-emerald-400">{formatBRL(summary.manualIn)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stone-300">Saídas avulsas</span>
                  <span className="text-sm font-medium text-red-400">{formatBRL(summary.manualOut)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stone-300">Estornos (Sistemas)</span>
                  <span className="text-sm font-medium text-red-400">{formatBRL(summary.refunds)}</span>
                </div>
              </div>

              <div className="mt-6 flex gap-2">
                <button onClick={() => openManual("MANUAL_IN")} className="flex-1 px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-950/30 text-emerald-400 border border-emerald-900/50 hover:bg-emerald-900/40 transition-colors">Nova Entrada</button>
                <button onClick={() => openManual("MANUAL_OUT")} className="flex-1 px-3 py-2 text-xs font-semibold rounded-lg bg-red-950/30 text-red-400 border border-red-900/50 hover:bg-red-900/40 transition-colors">Nova Saída</button>
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-stone-800 bg-stone-950 overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-800 text-sm font-bold text-stone-300 uppercase tracking-widest">
              Movimentações do Período
            </div>
            {summary.movements.length === 0 ? (
              <div className="p-8 text-center text-stone-500">
                <p className="font-semibold text-stone-400 mb-1">Nenhuma movimentação neste período</p>
                <p className="text-sm">Os recebimentos e lançamentos aparecerão aqui.</p>
              </div>
            ) : (
              <div className="divide-y divide-stone-800/50">
                {summary.movements.map((mov) => {
                  const isPositive = mov.type === "RECEBIMENTO" || mov.type === "MANUAL_IN";
                  return (
                    <div key={mov.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-900/30 transition-colors">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-stone-200">{mov.description}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-stone-500">{new Date(mov.time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-800 text-stone-400 uppercase">{mov.method}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isPositive ? "bg-emerald-950/30 text-emerald-500" : "bg-red-950/30 text-red-500"} uppercase`}>
                            {mov.type === "RECEBIMENTO" ? "Recebimento" : mov.type === "ESTORNO" ? "Estorno" : mov.type === "MANUAL_IN" ? "Entrada" : "Saída"}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`font-bold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                          {isPositive ? "+" : "-"}{formatBRL(mov.amount)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
