"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ClientFilter =
  | "all"
  | "with_appointment"
  | "without_appointment"
  | "upcoming"
  | "open_comanda"
  | "club"
  | "blocked"
  | "never_contacted"
  | "no_contact_30"
  | "no_contact_60"
  | "no_contact_90"
  | "recently_contacted";

interface ClientStats {
  total: number;
  completed: number;
  cancelled: number;
  noShows: number;
  totalSpent: number;
  lastVisit: string | null;
  nextAppointmentAt: string | null;
  openComandas: number;
  closedComandas: number;
  hasClubSubscription: boolean;
  isBlocked: boolean;
  lastContactedAt: string | null;
  contactLogCount: number;
}

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  createdAt: string;
  stats: ClientStats;
  sources: {
    link: boolean;
    appointment: boolean;
    comanda: boolean;
    club: boolean;
  };
}

const PAGE_SIZE = 30;

const FILTERS: Array<{ value: ClientFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "with_appointment", label: "Com agendamento" },
  { value: "without_appointment", label: "Sem agendamento" },
  { value: "upcoming", label: "Próximo agendamento" },
  { value: "open_comanda", label: "Comanda aberta" },
  { value: "club", label: "Clube" },
  { value: "blocked", label: "Bloqueados" },
  { value: "never_contacted", label: "Nunca contatados" },
  { value: "no_contact_30", label: "Sem contato há 30 dias" },
  { value: "no_contact_60", label: "Sem contato há 60 dias" },
  { value: "no_contact_90", label: "Sem contato há 90 dias" },
  { value: "recently_contacted", label: "Contatados recentemente" },
];

interface ContactMetrics {
  neverContacted: number;
  noContact30: number;
  recentlyContacted: number;
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

function buildWhatsappMessage(client: Client) {
  return `Oi, ${client.name}, aqui e da barbearia. Quer agendar seu horario?`;
}

function whatsappLink(phone: string, message: string) {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

export default function ClientesPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [contactMetrics, setContactMetrics] = useState<ContactMetrics>({
    neverContacted: 0,
    noContact30: 0,
    recentlyContacted: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ClientFilter>("all");
  const [page, setPage] = useState(1);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [createError, setCreateError] = useState("");
  const [submittingCreate, setSubmittingCreate] = useState(false);

  const fetchClients = useCallback(async (q: string, p: number, f: ClientFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE), filter: f });
      if (q) params.set("search", q);
      const res = await fetch(`/api/admin/clients?${params}`);
      const data = await res.json();
      setClients(data.clients ?? []);
      setTotal(data.total ?? 0);
      setContactMetrics(data.contactMetrics ?? { neverContacted: 0, noContact30: 0, recentlyContacted: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchClients(search, page, filter);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, page, filter, fetchClients]);

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const metrics = useMemo(() => ({
    total,
    manual: clients.filter((client) => !client.sources.appointment).length,
    upcoming: clients.filter((client) => client.stats.nextAppointmentAt).length,
    openComandas: clients.filter((client) => client.stats.openComandas > 0).length,
    neverContacted: contactMetrics.neverContacted,
    noContact30: contactMetrics.noContact30,
    recentlyContacted: contactMetrics.recentlyContacted,
  }), [clients, contactMetrics, total]);

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmittingCreate(true);
    setCreateError("");
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          phone: newPhone,
          email: newEmail || undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.message ?? payload.error ?? "Erro ao cadastrar cliente.");
      }
      setShowCreateModal(false);
      setNewName("");
      setNewPhone("");
      setNewEmail("");
      await fetchClients(search, page, filter);
      router.push(`/admin/clientes/${payload.id}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Erro ao cadastrar cliente.");
    } finally {
      setSubmittingCreate(false);
    }
  };


  return (
    <div className="p-6 md:p-8 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Clientes</h1>
          <p className="text-stone-500 text-sm mt-1">
            CRM base com clientes vinculados, legados e cadastro manual.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 text-sm font-bold hover:bg-amber-400 transition-colors"
        >
          Novo cliente
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Clientes</p>
          <p className="text-xl font-bold text-stone-100">{metrics.total}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Sem agendamento</p>
          <p className="text-xl font-bold text-amber-400">{metrics.manual}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Futuros</p>
          <p className="text-xl font-bold text-blue-400">{metrics.upcoming}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Comanda aberta</p>
          <p className="text-xl font-bold text-emerald-400">{metrics.openComandas}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Nunca contatados</p>
          <p className="text-xl font-bold text-red-300">{metrics.neverContacted}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Sem contato há 30 dias</p>
          <p className="text-xl font-bold text-orange-300">{metrics.noContact30}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-lg p-4">
          <p className="text-[10px] uppercase text-stone-500 font-bold">Contatados recentemente</p>
          <p className="text-xl font-bold text-cyan-300">{metrics.recentlyContacted}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, telefone ou e-mail..."
          title="Buscar clientes"
          className="w-full max-w-md bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-2.5 text-stone-100 placeholder-stone-600 focus:border-amber-500/80 focus:outline-none transition-colors text-sm"
        />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                filter === item.value
                  ? "bg-amber-500 text-stone-950 border-amber-500"
                  : "bg-stone-900 text-stone-400 border-stone-800 hover:text-stone-200"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>


      <div className="bg-stone-900 border border-stone-800 rounded-lg overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-stone-600 text-sm">
            Carregando...
          </div>
        ) : clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center px-4">
            <p className="text-stone-400 font-semibold">Nenhum cliente encontrado.</p>
            <p className="text-xs text-stone-600">
              Cadastre um cliente manualmente ou ajuste a busca e os filtros.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden lg:grid grid-cols-[1fr_130px_120px_110px_110px_230px] gap-3 px-5 py-3 border-b border-stone-800 text-[10px] uppercase tracking-wider text-stone-600 font-semibold">
              <span>Cliente</span>
              <span>Última visita</span>
              <span>Próximo</span>
              <span className="text-right">Total gasto</span>
              <span>Status</span>
              <span className="text-right">Ações</span>
            </div>
            <div className="divide-y divide-stone-800/60">
              {clients.map((client) => {
                const message = buildWhatsappMessage(client);
                const wa = whatsappLink(client.phone, message);
                const contactLabel = client.stats.lastContactedAt
                  ? `Último contato: ${formatDate(client.stats.lastContactedAt)}`
                  : "Nunca contatado";
                return (
                  <div
                    key={client.id}
                    className="px-5 py-4 flex flex-col lg:grid lg:grid-cols-[1fr_130px_120px_110px_110px_230px] gap-3 lg:items-center hover:bg-stone-800/20 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => router.push(`/admin/clientes/${client.id}`)}
                      className="text-left flex items-center gap-3 min-w-0"
                    >
                      <div className="shrink-0 w-8 h-8 rounded-full bg-stone-800 flex items-center justify-center text-xs font-bold text-amber-400">
                        {client.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-stone-200 truncate">{client.name}</p>
                        <p className="text-xs text-stone-500">{formatPhone(client.phone)}</p>
                        <p className={`text-[11px] ${client.stats.lastContactedAt ? "text-cyan-400" : "text-red-300"}`}>
                          {contactLabel}
                        </p>
                        {client.email && <p className="text-[11px] text-stone-600 truncate">{client.email}</p>}
                      </div>
                    </button>

                    <p className="text-xs text-stone-500">{formatDate(client.stats.lastVisit)}</p>
                    <p className="text-xs text-stone-500">{formatDate(client.stats.nextAppointmentAt)}</p>
                    <p className="text-sm font-semibold text-amber-400 lg:text-right">
                      {formatCurrency(client.stats.totalSpent)}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {!client.sources.appointment && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-800 text-stone-400">
                          Manual
                        </span>
                      )}
                      {client.stats.openComandas > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                          Comanda
                        </span>
                      )}
                      {client.stats.hasClubSubscription && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400">
                          Clube
                        </span>
                      )}
                      {client.stats.isBlocked && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400">
                          Bloqueado
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap justify-start lg:justify-end gap-2">
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/20 text-xs font-bold hover:bg-[#25D366]/20"
                      >
                        WhatsApp
                      </a>
                      <button
                        type="button"
                        onClick={() => router.push(`/admin/clientes/${client.id}`)}
                        className="px-3 py-1.5 rounded-lg bg-stone-950 text-stone-300 border border-stone-800 text-xs font-bold hover:bg-stone-800"
                      >
                        Ficha
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-stone-800">
                <p className="text-xs text-stone-600">
                  Página {page} de {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 rounded-lg border border-stone-800 text-stone-400 hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-stone-800 text-stone-400 hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-lg p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold text-stone-100">Novo cliente</h3>
            <form onSubmit={submitCreate} className="space-y-4">
              <div>
                <label htmlFor="new-client-name" className="block text-xs font-semibold text-stone-400 mb-1">Nome</label>
                <input
                  id="new-client-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label htmlFor="new-client-phone" className="block text-xs font-semibold text-stone-400 mb-1">WhatsApp</label>
                <input
                  id="new-client-phone"
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="Ex: (17) 99108-9190"
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label htmlFor="new-client-email" className="block text-xs font-semibold text-stone-400 mb-1">E-mail opcional</label>
                <input
                  id="new-client-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-800 rounded-lg p-3 text-stone-100 text-sm focus:border-amber-500 focus:outline-none"
                />
              </div>

              {createError && (
                <p className="text-xs text-red-400 bg-red-950/30 p-2.5 rounded-lg border border-red-900/50">
                  {createError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-lg bg-stone-800 text-stone-300 text-sm font-semibold hover:bg-stone-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingCreate}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 text-sm font-bold hover:bg-amber-400 disabled:opacity-50"
                >
                  {submittingCreate ? "Salvando..." : "Salvar cliente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
