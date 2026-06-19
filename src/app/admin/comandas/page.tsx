"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";

type Comanda = {
  id: string;
  customerName: string;
  customerPhone: string | null;
  status: string;
  total: string;
  paidTotal: string;
  remainingTotal: string;
  openedAt: string;
  items: { id: string }[];
};

const statusLabel: Record<string, string> = {
  OPEN: "Aberta",
  IN_SERVICE: "Em atendimento",
  PENDING_PAYMENT: "Aguardando pagamento",
  CLOSED: "Fechada",
  CANCELLED: "Cancelada",
};

function brl(value: string | number) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ComandasPage() {
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    try {
      const res = await fetch(`/api/admin/comandas?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Erro ao carregar comandas.");
      setComandas(data.comandas ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar comandas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const [walkInDialog, setWalkInDialog] = useState<{ isOpen: boolean; customerName: string; customerPhone: string }>({ isOpen: false, customerName: "", customerPhone: "" });

  async function handleWalkInSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!walkInDialog.customerName || !walkInDialog.customerPhone) return;
    setCreating(true);
    try {
      const res = await fetch("/api/admin/comandas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName: walkInDialog.customerName, customerPhone: walkInDialog.customerPhone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Erro ao criar comanda.");
      window.location.href = `/admin/comandas/${data.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar comanda.");
      setCreating(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <Dialog isOpen={walkInDialog.isOpen} onClose={() => setWalkInDialog((prev) => ({ ...prev, isOpen: false }))} title="Nova comanda (avulso)" className="max-w-md">
        <form onSubmit={handleWalkInSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Nome do cliente</label>
            <input type="text" value={walkInDialog.customerName} onChange={(e) => setWalkInDialog((p) => ({ ...p, customerName: e.target.value }))} className="w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)]" autoFocus required />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Telefone</label>
            <input type="tel" value={walkInDialog.customerPhone} onChange={(e) => setWalkInDialog((p) => ({ ...p, customerPhone: e.target.value }))} className="w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)]" required />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={() => setWalkInDialog((prev) => ({ ...prev, isOpen: false }))} disabled={creating} className="px-4 py-2 rounded-lg border border-[var(--border-medium)] text-[var(--text-secondary)] hover:bg-[var(--surface-3)] transition-colors text-sm font-semibold">Cancelar</button>
            <button type="submit" disabled={creating} className="px-4 py-2 rounded-lg bg-[var(--gold)] text-stone-950 font-bold transition-colors text-sm hover:brightness-110">Criar comanda</button>
          </div>
        </form>
      </Dialog>

      <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">Comandas</h1>
          <p className="text-sm text-[var(--text-muted)]">Atendimentos, consumo e recebimento.</p>
        </div>
        <button onClick={() => setWalkInDialog({ isOpen: true, customerName: "", customerPhone: "" })} disabled={creating} className="btn-gold px-4 py-2 disabled:opacity-50">
          Nova comanda
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Buscar cliente" className="bg-stone-950 border border-stone-800 rounded-lg px-4 py-2 text-sm text-stone-100" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-stone-950 border border-stone-800 rounded-lg px-4 py-2 text-sm text-stone-100">
          <option value="ALL">Todos os status</option>
          {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button onClick={load} className="px-4 py-2 rounded-lg border border-stone-700 text-stone-200 text-sm">Filtrar</button>
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      {loading ? (
        <div className="py-16 text-center text-stone-500">Carregando...</div>
      ) : comandas.length === 0 ? (
        <div className="py-16 text-center border border-stone-800 rounded-xl text-stone-500">Nenhuma comanda encontrada.</div>
      ) : (
        <div className="grid gap-3">
          {comandas.map((comanda) => (
            <Link key={comanda.id} href={`/admin/comandas/${comanda.id}`} className="block rounded-xl border border-stone-800 bg-stone-950/70 p-4 hover:border-amber-700/70 transition-colors">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-stone-100">{comanda.customerName}</p>
                  <p className="text-xs text-stone-500">{comanda.customerPhone ?? "Sem telefone"} · {new Date(comanda.openedAt).toLocaleString("pt-BR")}</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-right">
                  <div><p className="text-[10px] uppercase text-stone-500">Total</p><p className="text-sm text-stone-100">{brl(comanda.total)}</p></div>
                  <div><p className="text-[10px] uppercase text-stone-500">Pago</p><p className="text-sm text-emerald-300">{brl(comanda.paidTotal)}</p></div>
                  <div><p className="text-[10px] uppercase text-stone-500">Restante</p><p className="text-sm text-amber-300">{brl(comanda.remainingTotal)}</p></div>
                </div>
                <span className="text-xs font-semibold px-3 py-1 rounded-full border border-amber-700/50 text-amber-300 self-start md:self-auto">{statusLabel[comanda.status] ?? comanda.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
