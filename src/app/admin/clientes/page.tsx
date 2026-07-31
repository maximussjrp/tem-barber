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

interface BlockedItem {
  id: string;
  nameSnapshot: string;
  phoneSanitized: string;
  reason: string;
  active: boolean;
  blockedAt: string;
  unblockedAt: string | null;
  unblockReason: string | null;
}

export default function ClientesPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"all" | "blocked">("all");
  const [clients, setClients] = useState<Client[]>([]);
  const [blockedList, setBlockedList] = useState<BlockedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;

  const [showManualModal, setShowManualModal] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualError, setManualError] = useState("");
  const [submittingManual, setSubmittingManual] = useState(false);

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

  const fetchBlocked = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/customers/blocked`);
      const data = await res.json();
      setBlockedList(data.blocks ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "all") {
      const timer = setTimeout(() => {
        fetchClients(search, page);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        fetchBlocked();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [search, page, fetchClients, fetchBlocked, tab]);

  const handleManualBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualPhone || !manualReason || manualReason.trim().length < 5) {
      setManualError("Informe o telefone e um motivo com no mínimo 5 caracteres.");
      return;
    }
    setSubmittingManual(true);
    setManualError("");
    try {
      const res = await fetch("/api/admin/customers/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: manualPhone, reason: manualReason }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || payload.error || "Erro ao bloquear número.");
      setShowManualModal(false);
      setManualPhone("");
      setManualReason("");
      if (tab === "blocked") fetchBlocked();
      else fetchClients(search, page);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao bloquear número.";
      setManualError(msg);
    } finally {
      setSubmittingManual(false);
    }
  };

  const handleUnblock = async (blockId: string) => {
    const reason = prompt("Motivo do desbloqueio (mínimo 5 caracteres):");
    if (!reason || reason.trim().length < 5) return;

    try {
      const res = await fetch("/api/admin/customers/unblock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId, reason }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || payload.error || "Erro ao desbloquear número.");
      fetchBlocked();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao desbloquear número.";
      alert(msg);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Clientes</h1>
          <p className="text-stone-500 text-sm mt-1">
            Gestão de clientes e controle de bloqueios de números suspeitos.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-stone-900 border border-stone-800 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setTab("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === "all" ? "bg-stone-800 text-stone-100" : "text-stone-400 hover:text-stone-200"
              }`}
            >
              Todos os Clientes
            </button>
            <button
              type="button"
              onClick={() => setTab("blocked")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === "blocked" ? "bg-red-500/20 text-red-300 border border-red-500/30" : "text-stone-400 hover:text-stone-200"
              }`}
            >
              Bloqueados ({blockedList.filter((b) => b.active).length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowManualModal(true)}
            className="px-4 py-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-bold hover:bg-red-500/20 transition-colors"
          >
            + Bloquear Telefone
          </button>
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
            Carregando...
          </div>
        ) : tab === "blocked" ? (
          blockedList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <p className="text-stone-500">Nenhum telefone ou cliente bloqueado nesta barbearia.</p>
            </div>
          ) : (
            <div className="divide-y divide-stone-800/60">
              <div className="hidden sm:grid grid-cols-[1fr_160px_1fr_120px_100px] gap-3 px-5 py-3 border-b border-stone-800 text-[10px] uppercase tracking-wider text-stone-600 font-semibold">
                <span>Cliente / Nome</span>
                <span>Telefone</span>
                <span>Motivo</span>
                <span>Status</span>
                <span className="text-right">Ação</span>
              </div>
              {blockedList.map((b) => (
                <div key={b.id} className="px-5 py-4 flex flex-col sm:grid sm:grid-cols-[1fr_160px_1fr_120px_100px] gap-3 items-center">
                  <div>
                    <p className="text-sm font-semibold text-stone-200">{b.nameSnapshot}</p>
                    <p className="text-[10px] text-stone-500">Bloqueado em {formatDate(b.blockedAt)}</p>
                  </div>
                  <p className="text-xs font-mono text-amber-400">{b.phoneSanitized}</p>
                  <p className="text-xs text-stone-400 truncate max-w-xs">{b.reason}</p>
                  <div>
                    {b.active ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                        Ativo
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-800 text-stone-500">
                        Desbloqueado
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    {b.active && (
                      <button
                        type="button"
                        onClick={() => handleUnblock(b.id)}
                        className="px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold hover:bg-emerald-500/20 transition-colors"
                      >
                        Desbloquear
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
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

                    {/* Total Appointments */}
                    <p className="hidden sm:block text-sm font-semibold text-stone-300 text-right">
                      {c.stats.total}
                    </p>

                    {/* Completed Visits */}
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

      {/* Manual Block Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold text-stone-100">Bloquear Telefone Suspeito</h3>
            <p className="text-xs text-stone-400">
              O número informado não conseguirá realizar novos agendamentos públicos nesta barbearia.
            </p>
            <form onSubmit={handleManualBlock} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-400 mb-1">
                  Telefone <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  placeholder="Ex: 1818999943"
                  className="w-full bg-stone-950 border border-stone-800 rounded-xl p-3 text-stone-100 text-sm focus:border-red-500 focus:outline-none font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-400 mb-1">
                  Motivo do bloqueio <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  placeholder="Motivo (mínimo 5 caracteres)..."
                  rows={3}
                  className="w-full bg-stone-950 border border-stone-800 rounded-xl p-3 text-stone-100 text-sm focus:border-red-500 focus:outline-none"
                  required
                />
              </div>

              {manualError && (
                <p className="text-xs text-red-400 bg-red-950/30 p-2.5 rounded-lg border border-red-900/50">
                  {manualError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 rounded-xl bg-stone-800 text-stone-300 text-sm font-semibold hover:bg-stone-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingManual}
                  className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  {submittingManual ? "Bloqueando..." : "Confirmar Bloqueio"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
