"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface MetricProfessional {
  id: string;
  name: string;
}

interface MetricService {
  id: string;
  name: string;
}

interface ClientData {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  isBlocked?: boolean;
  blockRecord?: {
    id: string;
    reason: string;
    blockedAt: string;
  } | null;
  metrics: {
    totalAppointments: number;
    completedVisits: number;
    cancelledCount: number;
    noShowCount: number;
    upcomingAppointments: number;
    totalSpent: number;
    averageTicket: number;
    firstCompletedVisitAt: string | null;
    lastCompletedVisitAt: string | null;
    nextAppointmentAt: string | null;
    customerSinceAt: string | null;
    averageReturnDays: number | null;
    favoriteProfessional: MetricProfessional | null;
    favoriteService: MetricService | null;
    averageRatingGiven: number | null;
    noShowRate: number;
    returnStatus: "INSUFFICIENT_DATA" | "IN_CYCLE" | "DUE_SOON" | "LATE" | "AT_RISK";
    reliabilityLabel: "INSUFFICIENT_DATA" | "HIGH" | "WARNING" | "RISK";
  };
  history: Array<{
    id: string;
    dateTime: string;
    status: string;
    bookingMode: "NORMAL" | "FIT_IN";
    professional: string;
    services: string[];
    totalPrice: number;
  }>;
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
  const timeStr = d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
  return `${dateStr} às ${timeStr}`;
}

function whatsappLink(phone: string) {
  const d = phone.replace(/\D/g, "");
  const intl = d.startsWith("55") ? d : `55${d}`;
  return `https://wa.me/${intl}`;
}

const RETURN_STATUS_LABELS: Record<ClientData["metrics"]["returnStatus"], string> = {
  INSUFFICIENT_DATA: "Dados Insuficientes",
  IN_CYCLE: "No Ciclo",
  DUE_SOON: "Retorno Próximo",
  LATE: "Atrasado",
  AT_RISK: "Em Risco",
};

const RETURN_STATUS_COLORS: Record<ClientData["metrics"]["returnStatus"], string> = {
  INSUFFICIENT_DATA: "bg-stone-800 text-stone-400 border-stone-700",
  IN_CYCLE: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  DUE_SOON: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  LATE: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  AT_RISK: "bg-red-500/10 text-red-400 border-red-500/20",
};

const RELIABILITY_LABELS: Record<ClientData["metrics"]["reliabilityLabel"], string> = {
  INSUFFICIENT_DATA: "Dados Insuficientes",
  HIGH: "Alta Confiabilidade",
  WARNING: "Atenção",
  RISK: "Risco de No-Show",
};

const RELIABILITY_COLORS: Record<ClientData["metrics"]["reliabilityLabel"], string> = {
  INSUFFICIENT_DATA: "bg-stone-800 text-stone-400",
  HIGH: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  WARNING: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20",
  RISK: "bg-red-500/10 text-red-400 border border-red-500/20",
};

const APPOINTMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  CONFIRMED: "Confirmado",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  NO_SHOW: "Faltou",
};

const APPOINTMENT_STATUS_BG: Record<string, string> = {
  PENDING: "bg-amber-500/10 text-amber-400",
  CONFIRMED: "bg-blue-500/10 text-blue-400",
  COMPLETED: "bg-emerald-500/10 text-emerald-400",
  CANCELLED: "bg-stone-800 text-stone-500",
  NO_SHOW: "bg-red-500/10 text-red-400",
};

export default function Cliente360Page() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [blockError, setBlockError] = useState("");
  const [submittingBlock, setSubmittingBlock] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/clients/${id}`);
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error ?? "Erro ao carregar dados do cliente.");
      }
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  const handleBlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockReason || blockReason.trim().length < 5) {
      setBlockError("O motivo deve ter no mínimo 5 caracteres.");
      return;
    }
    setSubmittingBlock(true);
    setBlockError("");
    try {
      const res = await fetch("/api/admin/customers/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id, phone: data?.phone, reason: blockReason }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || payload.error || "Erro ao bloquear cliente.");
      setShowBlockModal(false);
      setBlockReason("");
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao bloquear cliente.";
      setBlockError(msg);
    } finally {
      setSubmittingBlock(false);
    }
  };

  const handleUnblock = async () => {
    if (!data?.blockRecord?.id) return;
    const reason = prompt("Motivo do desbloqueio (mínimo 5 caracteres):");
    if (!reason || reason.trim().length < 5) return;

    try {
      const res = await fetch("/api/admin/customers/unblock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockId: data.blockRecord.id, reason }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || payload.error || "Erro ao desbloquear cliente.");
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao desbloquear cliente.";
      alert(msg);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6 text-center py-24 text-stone-500">
        Carregando perfil 360 do cliente...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <Link href="/admin/clientes" className="text-sm text-stone-400 hover:text-stone-200 transition-colors">
          ← Voltar para Clientes
        </Link>
        <div className="bg-red-950/20 border border-red-900 rounded-2xl p-6 text-red-400 text-sm">
          {error || "Cliente não encontrado."}
        </div>
      </div>
    );
  }

  const lastApptId = data.history.length > 0 ? data.history[0].id : null;

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div>
        <Link href="/admin/clientes" className="text-sm text-stone-400 hover:text-stone-200 transition-colors flex items-center gap-1.5">
          ← Clientes
        </Link>
      </div>

      {/* Profile Header */}
      <div className="bg-stone-900 border border-stone-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-stone-800 border border-stone-700 flex items-center justify-center text-xl font-bold text-amber-400 shrink-0">
            {data.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-stone-100">{data.name}</h1>
              {data.isBlocked && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                  Bloqueado
                </span>
              )}
            </div>
            <p className="text-sm text-stone-500 mt-0.5">{formatPhone(data.phone)}</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/admin/agendamentos?customerId=${data.id}`}
            className="px-4 py-2.5 rounded-xl bg-amber-500 text-stone-950 font-bold hover:bg-amber-400 transition-colors text-sm"
          >
            Agendar
          </Link>
          {lastApptId && (
            <Link
              href={`/admin/agendamentos?customerId=${data.id}&sourceAppointmentId=${lastApptId}`}
              className="px-4 py-2.5 rounded-xl bg-stone-800 border border-stone-700 text-stone-200 font-semibold hover:bg-stone-700 transition-colors text-sm"
            >
              Repetir Último
            </Link>
          )}
          <a
            href={whatsappLink(data.phone)}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2.5 rounded-xl bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/20 font-semibold hover:bg-[#25D366]/20 transition-colors text-sm flex items-center gap-1.5"
          >
            WhatsApp
          </a>
          {data.isBlocked ? (
            <button
              type="button"
              onClick={handleUnblock}
              className="px-4 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold hover:bg-emerald-500/20 transition-colors text-sm"
            >
              Desbloquear
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowBlockModal(true)}
              className="px-4 py-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 font-semibold hover:bg-red-500/20 transition-colors text-sm"
            >
              Bloquear Cliente
            </button>
          )}
        </div>
      </div>

      {/* Main KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-stone-900 border border-stone-800 rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-1">Total gasto</p>
          <p className="text-xl font-bold text-emerald-400">{formatCurrency(data.metrics.totalSpent)}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-1">Ticket médio</p>
          <p className="text-xl font-bold text-stone-200">{formatCurrency(data.metrics.averageTicket)}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-1">Atendimentos concluídos</p>
          <p className="text-xl font-bold text-amber-400">{data.metrics.completedVisits}</p>
        </div>
        <div className="bg-stone-900 border border-stone-800 rounded-2xl p-4">
          <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-1">Última visita</p>
          <p className="text-base font-bold text-stone-200 mt-1">{formatDate(data.metrics.lastCompletedVisitAt)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Retorno Inteligência Card */}
        <div className="bg-stone-900 border border-stone-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-base font-bold text-stone-200">Inteligência de Retorno</h2>
          <div className="flex items-center gap-3">
            <span className={`px-3 py-1 text-xs font-bold rounded-full border ${RETURN_STATUS_COLORS[data.metrics.returnStatus]}`}>
              {RETURN_STATUS_LABELS[data.metrics.returnStatus]}
            </span>
            {data.metrics.averageReturnDays !== null && (
              <span className="text-xs text-stone-400 font-medium">
                Frequência: {data.metrics.averageReturnDays} {data.metrics.averageReturnDays === 1 ? "dia" : "dias"}
              </span>
            )}
          </div>
          <div className="text-xs text-stone-500 space-y-1.5 pt-2 border-t border-stone-800/60">
            {data.metrics.nextAppointmentAt && (
              <p className="text-stone-300">
                <span className="font-semibold">Próximo agendamento:</span> {formatDateTime(data.metrics.nextAppointmentAt)}
              </p>
            )}
            <p>
              <span className="font-semibold text-stone-400">Cliente desde:</span> {formatDate(data.metrics.customerSinceAt)}
            </p>
          </div>
        </div>

        {/* Confiabilidade / No-Show Card */}
        <div className="bg-stone-900 border border-stone-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-base font-bold text-stone-200">Confiabilidade & No-Show</h2>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className={`px-3 py-1 text-xs font-bold rounded-full ${RELIABILITY_COLORS[data.metrics.reliabilityLabel]}`}>
              {RELIABILITY_LABELS[data.metrics.reliabilityLabel]}
            </span>
            <span className="text-sm font-bold text-stone-200">
              Taxa de falta: {data.metrics.noShowRate.toFixed(1)}%
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-stone-800/60 text-center">
            <div className="bg-stone-950/40 rounded-lg p-2 border border-stone-800/50">
              <p className="text-[10px] text-stone-500 font-semibold uppercase">Concluídos</p>
              <p className="text-sm font-bold text-emerald-400 mt-0.5">{data.metrics.completedVisits}</p>
            </div>
            <div className="bg-stone-950/40 rounded-lg p-2 border border-stone-800/50">
              <p className="text-[10px] text-stone-500 font-semibold uppercase">Faltas</p>
              <p className="text-sm font-bold text-red-400 mt-0.5">{data.metrics.noShowCount}</p>
            </div>
            <div className="bg-stone-950/40 rounded-lg p-2 border border-stone-800/50">
              <p className="text-[10px] text-stone-500 font-semibold uppercase">Cancelados</p>
              <p className="text-sm font-bold text-stone-400 mt-0.5">{data.metrics.cancelledCount}</p>
            </div>
          </div>
        </div>

        {/* Preferências Card */}
        <div className="bg-stone-900 border border-stone-800 rounded-2xl p-6 space-y-4 md:col-span-2">
          <h2 className="text-base font-bold text-stone-200 font-serif">Preferências & Histórico Geral</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-stone-950/30 border border-stone-800/60 rounded-xl p-4">
              <p className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Profissional Favorito</p>
              <p className="text-sm font-bold text-stone-200 mt-1">{data.metrics.favoriteProfessional?.name ?? "Nenhum"}</p>
            </div>
            <div className="bg-stone-950/30 border border-stone-800/60 rounded-xl p-4">
              <p className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Serviço Favorito</p>
              <p className="text-sm font-bold text-stone-200 mt-1">{data.metrics.favoriteService?.name ?? "Nenhum"}</p>
            </div>
            <div className="bg-stone-950/30 border border-stone-800/60 rounded-xl p-4">
              <p className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider">Avaliação Média</p>
              <p className="text-sm font-bold text-amber-400 mt-1">
                {data.metrics.averageRatingGiven !== null ? `★ ${data.metrics.averageRatingGiven.toFixed(1)} / 5.0` : "Nenhuma dada"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Chronological History */}
      <div className="bg-stone-900 border border-stone-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-800">
          <h2 className="text-base font-bold text-stone-200">Histórico de Atendimentos (Últimos 20)</h2>
        </div>

        {data.history.length === 0 ? (
          <div className="p-8 text-center text-stone-600 text-sm">
            Nenhum agendamento registrado para este cliente.
          </div>
        ) : (
          <div className="divide-y divide-stone-800/50">
            {data.history.map((h) => (
              <div key={h.id} className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-800/10 transition-colors">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-stone-200">{formatDateTime(h.dateTime)}</span>
                    <span className={`text-[10px] px-2 py-0.5 font-bold rounded-full uppercase tracking-wider ${APPOINTMENT_STATUS_BG[h.status]}`}>
                      {APPOINTMENT_STATUS_LABEL[h.status] ?? h.status}
                    </span>
                    {h.bookingMode === "FIT_IN" && (
                      <span className="text-[9px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-bold border border-amber-500/30 uppercase tracking-widest">
                        Encaixe
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-stone-500">
                    <span className="font-semibold text-stone-400">Barbeiro:</span> {h.professional}
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-6">
                  <div className="text-left sm:text-right">
                    <p className="text-xs text-stone-300 truncate max-w-[200px] sm:max-w-xs">{h.services.join(", ")}</p>
                    <p className="text-[10px] text-stone-500 font-semibold">{formatCurrency(h.totalPrice)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Block Modal */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-bold text-stone-100">Bloquear Cliente</h3>
            <p className="text-xs text-stone-400">
              Ao bloquear, o cliente e seu número não conseguirão realizar agendamentos públicos nesta barbearia.
              Agendamentos futuros ativos serão cancelados automaticamente.
            </p>
            <form onSubmit={handleBlockSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-stone-400 mb-1">
                  Motivo do bloqueio <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Informe o motivo (mínimo 5 caracteres)..."
                  rows={3}
                  className="w-full bg-stone-950 border border-stone-800 rounded-xl p-3 text-stone-100 text-sm focus:border-red-500 focus:outline-none"
                  required
                />
              </div>
              {blockError && (
                <p className="text-xs text-red-400 bg-red-950/30 p-2.5 rounded-lg border border-red-900/50">
                  {blockError}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBlockModal(false)}
                  className="px-4 py-2 rounded-xl bg-stone-800 text-stone-300 text-sm font-semibold hover:bg-stone-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submittingBlock}
                  className="px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 disabled:opacity-50 transition-colors"
                >
                  {submittingBlock ? "Bloqueando..." : "Confirmar Bloqueio"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
