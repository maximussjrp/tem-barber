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

function whatsappLink(phone: string) {
  const d = phone.replace(/\D/g, "");
  const intl = d.startsWith("55") ? d : `55${d}`;
  return `https://wa.me/${intl}`;
}

const LABEL_INPUT = "text-xs font-semibold uppercase tracking-wider text-stone-400";

// ─── Client Detail Modal ──────────────────────────────────────────────────────

function ClientModal({
  client,
  onClose,
}: {
  client: Client;
  onClose: () => void;
}) {
  const retention =
    client.stats.total > 0
      ? Math.round((client.stats.completed / client.stats.total) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-stone-900 border border-stone-800 rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center text-sm font-bold text-amber-400">
              {client.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-bold text-stone-100">{client.name}</p>
              <p className="text-xs text-stone-500">{formatPhone(client.phone)}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-200 transition-colors" title="Fechar">✕</button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Total de visitas", value: client.stats.total },
            { label: "Concluídos", value: client.stats.completed },
            { label: "Cancelados", value: client.stats.cancelled },
            { label: "Retorno", value: `${retention}%` },
          ].map((s) => (
            <div key={s.label} className="bg-stone-800/50 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">{s.label}</p>
              <p className="text-lg font-bold text-stone-100">{s.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-stone-800/50 rounded-lg p-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">Total gasto</p>
            <p className="text-lg font-bold text-emerald-400">{formatCurrency(client.stats.totalSpent)}</p>
          </div>
          {client.stats.lastVisit && (
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">Última visita</p>
              <p className="text-sm font-semibold text-stone-300">{formatDate(client.stats.lastVisit)}</p>
            </div>
          )}
        </div>

        <p className="text-xs text-stone-600">Cliente desde {formatDate(client.createdAt)}</p>

        {/* WhatsApp */}
        <a
          href={whatsappLink(client.phone)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-[#25D366]/15 text-[#25D366] border border-[#25D366]/30 hover:bg-[#25D366]/25 transition-colors font-semibold text-sm"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
          Enviar mensagem
        </a>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientesPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Client | null>(null);
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
    fetchClients(search, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      {selected && <ClientModal client={selected} onClose={() => setSelected(null)} />}

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

        {/* Summary stats */}
        {!loading && clients.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Clientes", value: total, color: "text-stone-100" },
              {
                label: "Visitas totais",
                value: clients.reduce((s, c) => s + c.stats.total, 0),
                color: "text-amber-400",
              },
              {
                label: "Concluídos",
                value: clients.reduce((s, c) => s + c.stats.completed, 0),
                color: "text-emerald-400",
              },
              {
                label: "Receita",
                value: formatCurrency(clients.reduce((s, c) => s + c.stats.totalSpent, 0)),
                color: "text-emerald-400",
              },
            ].map((s) => (
              <div key={s.label} className="bg-stone-900 border border-stone-800 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-stone-500 mb-1">{s.label}</p>
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}

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
              <div className="hidden sm:grid grid-cols-[1fr_140px_80px_80px_100px_44px] gap-3 px-5 py-3 border-b border-stone-800 text-[10px] uppercase tracking-wider text-stone-600 font-semibold">
                <span>Cliente</span>
                <span>Último agendamento</span>
                <span className="text-right">Visitas</span>
                <span className="text-right">Conclusões</span>
                <span className="text-right">Total gasto</span>
                <span />
              </div>

              {/* Rows */}
              <div className="divide-y divide-stone-800/60">
                {clients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="w-full text-left px-5 py-4 hover:bg-stone-800/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 sm:grid sm:grid-cols-[1fr_140px_80px_80px_100px_44px]">
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

                      {/* Visits */}
                      <p className="hidden sm:block text-sm font-semibold text-stone-300 text-right">
                        {c.stats.total}
                      </p>

                      {/* Completed */}
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
    </>
  );
}
