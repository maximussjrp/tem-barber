"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientStats {
  total: number;
  completed: number;
  cancelled: number;
  totalSpent: number;
  lastVisit: string | null;
}

interface Client {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  stats: ClientStats;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientesPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;

  const fetchClients = useCallback(async (q: string, p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
      if (q) params.set("search", q);
      const res = await fetch(`/api/admin/clients?${params}`);
      const data = await res.json();
      setClients(data.clients ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchClients(search, 1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, fetchClients]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchClients(search, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Clientes</h1>
          <p className="text-stone-500 text-sm mt-1">
            {total > 0 ? `${total} cliente${total !== 1 ? "s" : ""} cadastrado${total !== 1 ? "s" : ""}` : "Nenhum cliente ainda"}
          </p>
        </div>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou telefone..."
          title="Buscar clientes"
          className="w-full max-w-sm bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-2.5 text-stone-100 placeholder-stone-600 focus:border-amber-500/80 focus:outline-none transition-colors text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-stone-600 text-sm">
            Carregando clientes...
          </div>
        ) : clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <p className="text-stone-500">
              {search ? "Nenhum cliente encontrado para essa busca." : "Nenhum cliente ainda."}
            </p>
            {!search && (
              <p className="text-xs text-stone-600">
                Os clientes aparecem aqui automaticamente quando fazem um agendamento.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Header row */}
            <div className="hidden sm:grid grid-cols-[1fr_140px_100px_160px_100px_44px] gap-3 px-5 py-3 border-b border-stone-800 text-[10px] uppercase tracking-wider text-stone-600 font-semibold">
              <span>Cliente</span>
              <span>Último agendamento</span>
              <span className="text-right">Agendamentos</span>
              <span className="text-right">Atendimentos concluídos</span>
              <span className="text-right">Total gasto</span>
              <span />
            </div>

            {/* Rows */}
            <div className="divide-y divide-stone-800/60">
              {clients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => router.push(`/admin/clientes/${c.id}`)}
                  className="w-full text-left px-5 py-4 hover:bg-stone-800/30 transition-colors"
                >
                  <div className="flex items-center gap-3 sm:grid sm:grid-cols-[1fr_140px_100px_160px_100px_44px]">
                    {/* Name + phone */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="shrink-0 w-8 h-8 rounded-full bg-stone-800 flex items-center justify-center text-xs font-bold text-amber-400">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-stone-200 truncate">{c.name}</p>
                        <p className="text-xs text-stone-500">{formatPhone(c.phone)}</p>
                      </div>
                    </div>

                    {/* Last visit */}
                    <p className="hidden sm:block text-xs text-stone-500">
                      {c.stats.lastVisit ? formatDate(c.stats.lastVisit) : "—"}
                    </p>

                    {/* Total Appointments (renamed to Agendamentos) */}
                    <p className="hidden sm:block text-sm font-semibold text-stone-300 text-right">
                      {c.stats.total}
                    </p>

                    {/* Completed Visits (renamed to Atendimentos Concluídos) */}
                    <p className="hidden sm:block text-sm font-semibold text-emerald-400 text-right">
                      {c.stats.completed}
                    </p>

                    {/* Spent */}
                    <p className="hidden sm:block text-sm font-semibold text-amber-400 text-right">
                      {formatCurrency(c.stats.totalSpent)}
                    </p>

                    {/* Arrow */}
                    <p className="hidden sm:block text-stone-600 text-right">›</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-stone-800">
                <p className="text-xs text-stone-600">
                  Página {page} de {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg border border-stone-800 text-stone-400 hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    ←
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-stone-800 text-stone-400 hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
