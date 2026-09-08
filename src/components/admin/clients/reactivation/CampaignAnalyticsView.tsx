/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  CampaignAttributionSummary,
  RecipientAttributionSummaryItem,
} from "@/lib/clients/reactivation/attribution-engine";
import { RecipientAttributionDrawer } from "./RecipientAttributionDrawer";
import { CustomerAttributionHistoryModal } from "./CustomerAttributionHistoryModal";

interface CampaignListItem {
  id: string;
  name: string;
  channel: string;
  status: string;
  totalRecipients: number;
  contacts: number;
  reactivatedCustomers: number;
  recoveredRevenue: number;
  createdAt: string;
  bookingAttributionWindowDays: number;
  directReturnWindowDays: number;
}

interface CampaignAnalyticsViewProps {
  onGoToOpportunities: () => void;
}

function formatCurrency(val?: number | null) {
  return (val ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return "—";
  if (dateStr.length === 10 && dateStr.includes("-")) {
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y}`;
  }
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

function formatRate(rate?: number | null, contacts?: number) {
  if (contacts === 0 || rate === undefined || rate === null) return "—";
  if (rate < 0 || rate > 1 || !Number.isFinite(rate)) {
    return `Inválida (${(rate * 100).toFixed(1)}%)`;
  }
  return `${(rate * 100).toFixed(1)}%`;
}

function formatPhone(phone?: string | null) {
  if (!phone) return "Sem telefone";
  const d = phone.replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

const CONVERSION_STATUS_MAP: Record<string, { label: string; color: string }> = {
  NONE: { label: "Não convertido", color: "bg-stone-800 text-stone-400 border-stone-700" },
  BOOKED: { label: "Agendou (Pendente)", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  ATTENDED: { label: "Compareceu", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  DIRECT_RETURN: { label: "Retorno direto (Walk-in)", color: "bg-teal-500/20 text-teal-300 border-teal-500/30" },
  REVENUE_ATTRIBUTED: { label: "Reativado com receita", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
};

export function CampaignAnalyticsView({ onGoToOpportunities }: CampaignAnalyticsViewProps) {
  // Campaign List State
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);

  // Selected Campaign Detail & Attribution State
  const [summary, setSummary] = useState<CampaignAttributionSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileSuccessMsg, setReconcileSuccessMsg] = useState<string | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  // Recipient Filters in Selected Campaign
  const [recipientFilterStatus, setRecipientFilterStatus] = useState<string>("ALL");
  const [recipientSearch, setRecipientSearch] = useState<string>("");

  // Drawer / Modal States
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [customerHistoryModal, setCustomerHistoryModal] = useState<{ id: string; name: string } | null>(null);

  // 1. Fetch Campaign List
  const fetchCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    setCampaignsError(null);
    try {
      const res = await fetch("/api/admin/clients/reactivation/manual-campaigns?limit=50");
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || payload.error || "Erro ao carregar histórico de campanhas.");
      }
      const data = await res.json();
      const items: CampaignListItem[] = data.items || [];
      setCampaigns(items);

      if (items.length > 0 && !selectedCampaignId) {
        setSelectedCampaignId(items[0].id);
      }
    } catch (err: any) {
      setCampaignsError(err.message || "Falha ao buscar campanhas.");
    } finally {
      setLoadingCampaigns(false);
    }
  }, [selectedCampaignId]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  // 2. Fetch Selected Campaign Attribution Summary
  const fetchSummary = useCallback(async (campaignId: string) => {
    setLoadingSummary(true);
    setSummaryError(null);
    try {
      const res = await fetch(`/api/admin/clients/reactivation/manual-campaigns/${campaignId}/attribution`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || payload.error || "Erro ao carregar sumário de atribuição.");
      }
      const data = await res.json();
      setSummary(data.summary);
    } catch (err: any) {
      setSummaryError(err.message || "Falha ao carregar métricas da campanha.");
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCampaignId) {
      fetchSummary(selectedCampaignId);
    } else {
      setSummary(null);
    }
  }, [selectedCampaignId, fetchSummary]);

  // 3. Explicit Manual Attribution Reconciliation Mutation
  const handleReconcileAttribution = async () => {
    if (!selectedCampaignId || reconciling) return;
    setReconciling(true);
    setReconcileSuccessMsg(null);
    setReconcileError(null);
    try {
      const res = await fetch(
        `/api/admin/clients/reactivation/manual-campaigns/${selectedCampaignId}/reconcile-attribution`,
        {
          method: "POST",
        }
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || payload.error || "Erro ao reconciliar atribuição.");
      }
      const data = await res.json();
      setSummary(data.summary);
      setReconcileSuccessMsg("Resultados e conversões reconciliados com sucesso!");
      setTimeout(() => setReconcileSuccessMsg(null), 4000);
      fetchCampaigns();
    } catch (err: any) {
      setReconcileError(err.message || "Erro ao atualizar resultados.");
      setTimeout(() => setReconcileError(null), 5000);
    } finally {
      setReconciling(false);
    }
  };

  // Filtered Recipients for the Selected Campaign Table
  const filteredRecipients = useMemo(() => {
    if (!summary?.recipients) return [];
    let list: RecipientAttributionSummaryItem[] = summary.recipients;

    if (recipientFilterStatus === "REACTIVATED") {
      list = list.filter(
        (r) =>
          r.conversionStatus === "REVENUE_ATTRIBUTED" ||
          r.conversionStatus === "ATTENDED" ||
          r.conversionStatus === "DIRECT_RETURN"
      );
    } else if (recipientFilterStatus === "BOOKED") {
      list = list.filter((r) => r.conversionStatus === "BOOKED");
    } else if (recipientFilterStatus === "NONE") {
      list = list.filter((r) => r.conversionStatus === "NONE");
    }

    if (recipientSearch.trim()) {
      const q = recipientSearch.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.customerName.toLowerCase().includes(q) ||
          (r.customerPhone && r.customerPhone.includes(q))
      );
    }

    return list;
  }, [summary, recipientFilterStatus, recipientSearch]);

  if (loadingCampaigns && campaigns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-stone-500 gap-3">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs">Carregando histórico de campanhas e resultados...</p>
      </div>
    );
  }

  if (campaignsError) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center space-y-3">
        <p className="text-red-400 font-semibold text-sm">{campaignsError}</p>
        <button
          onClick={fetchCampaigns}
          className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg text-xs font-semibold transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="bg-stone-900/60 border border-stone-800 rounded-2xl p-10 text-center space-y-4 max-w-xl mx-auto">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
            <path d="M22 12A10 10 0 0 0 12 2v10z" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-stone-200">Nenhuma campanha realizada ainda</h3>
        <p className="text-stone-400 text-xs leading-relaxed max-w-md mx-auto">
          Inicie seu primeiro lote de contatos na aba &quot;Oportunidades&quot; para começar a acompanhar o retorno
          e a receita atribuída à reativação.
        </p>
        <button
          onClick={onGoToOpportunities}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-stone-950 rounded-xl text-xs font-bold transition-colors"
        >
          Ir para Oportunidades
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Campaign Selector Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-stone-900/60 border border-stone-800 rounded-2xl p-4">
        <div className="flex items-center gap-3">
          <label htmlFor="campaign-select" className="text-xs font-bold text-stone-400 uppercase tracking-wider whitespace-nowrap">
            Selecionar Campanha:
          </label>
          <select
            id="campaign-select"
            value={selectedCampaignId || ""}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            className="bg-stone-950 border border-stone-800 text-stone-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:border-amber-500/80 max-w-xs sm:max-w-md truncate"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({formatDate(c.createdAt)}) — {c.contacts} contato(s)
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          {reconcileError && (
            <span className="text-xs text-red-400 font-semibold bg-red-500/10 px-3 py-1.5 rounded-lg border border-red-500/20 animate-in fade-in">
              {reconcileError}
            </span>
          )}
          {reconcileSuccessMsg && (
            <span className="text-xs text-emerald-400 font-semibold bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20 animate-in fade-in">
              {reconcileSuccessMsg}
            </span>
          )}
          <button
            type="button"
            onClick={handleReconcileAttribution}
            disabled={reconciling || loadingSummary}
            className="px-3.5 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 border border-amber-500/40 text-amber-400 text-xs font-bold flex items-center gap-2 disabled:opacity-50 transition-colors shadow-sm"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={reconciling ? "animate-spin" : ""}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>{reconciling ? "Reconciliando..." : "Atualizar resultados"}</span>
          </button>
        </div>
      </div>

      {loadingSummary ? (
        <div className="flex flex-col items-center justify-center py-20 text-stone-500 gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs">Consolidando receita atribuída e conversões...</p>
        </div>
      ) : summaryError ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center space-y-3">
          <p className="text-red-400 font-semibold text-sm">{summaryError}</p>
          <button
            onClick={() => selectedCampaignId && fetchSummary(selectedCampaignId)}
            className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-lg text-xs font-semibold"
          >
            Tentar novamente
          </button>
        </div>
      ) : summary ? (
        <>
          {/* Campaign Header Details */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-800/80 pb-3">
            <div>
              <h2 className="text-xl font-bold text-stone-100">{summary.name}</h2>
              <p className="text-xs text-stone-400 mt-0.5">
                Janela de agendamento: <strong>{summary.bookingAttributionWindowDays} dias</strong> • Janela retorno direto: <strong>{summary.directReturnWindowDays} dias</strong>
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full font-bold bg-stone-900 border border-stone-800 text-stone-300">
                Status: {summary.status}
              </span>
              <span className="px-2.5 py-1 rounded-full font-mono text-[10px] text-stone-400 bg-stone-950 border border-stone-800">
                {summary.attributionVersion}
              </span>
            </div>
          </div>

          {/* PRIMARY KPI CARDS */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* 1. Contatos confirmados */}
            <div className="bg-stone-900/90 border border-stone-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  Contatos confirmados
                </span>
                <span className="w-2 h-2 rounded-full bg-blue-400" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-stone-100 mt-2">
                {summary.contacts}
              </p>
              <span className="text-[11px] text-stone-400 mt-1">Disparos manuais enviados</span>
            </div>

            {/* 2. Agendamentos atribuídos */}
            <div className="bg-stone-900/90 border border-stone-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
                  Agendamentos atribuídos
                </span>
                <span className="w-2 h-2 rounded-full bg-blue-400" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-stone-100 mt-2">
                {summary.attributedBookings}
              </p>
              <span className="text-[11px] text-stone-400 mt-1">
                {summary.customersWithAttributedBooking} cliente(s) que agendaram
              </span>
            </div>

            {/* 3. Clientes que retornaram */}
            <div className="bg-stone-900/90 border border-amber-500/30 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                  Clientes que retornaram
                </span>
                <span className="w-2 h-2 rounded-full bg-amber-400" />
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-amber-300 mt-2">
                {summary.reactivatedCustomers}
              </p>
              <span className="text-[11px] text-stone-400 mt-1">Visitas canônicas realizadas</span>
            </div>

            {/* 4. Receita atribuída à reativação */}
            <div className="bg-stone-900/90 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                  Receita atribuída à reativação
                </span>
                <span className="text-emerald-400 text-xs font-bold">BRL</span>
              </div>
              <p className="text-2xl sm:text-3xl font-bold text-emerald-300 mt-2">
                {formatCurrency(summary.recoveredRevenue)}
              </p>
              <span className="text-[11px] text-stone-400 mt-1" title="Soma das comandas pagas da 1ª visita canônica elegível">
                Soma das comandas pagas do 1º retorno
              </span>
            </div>
          </div>

          {/* SECONDARY KPIS & ZERO-COST ECONOMICS */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
            <div className="bg-stone-950/60 border border-stone-800/80 rounded-xl p-3.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                Taxa de agendamento
              </span>
              <p className="text-xl font-bold text-stone-200 mt-1">
                {formatRate(summary.bookingRate, summary.contacts)}
              </p>
              <span className="text-[10px] text-stone-400">Agendamentos / Contatos</span>
            </div>

            <div className="bg-stone-950/60 border border-stone-800/80 rounded-xl p-3.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                Taxa de retorno
              </span>
              <p className="text-xl font-bold text-stone-200 mt-1">
                {formatRate(summary.attendanceRate, summary.contacts)}
              </p>
              <span className="text-[10px] text-stone-400">Retornos / Contatos</span>
            </div>

            <div className="bg-stone-950/60 border border-stone-800/80 rounded-xl p-3.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-orange-400">
                Cancelamentos
              </span>
              <p className="text-xl font-bold text-orange-300 mt-1">
                {summary.cancelledBookings}
              </p>
              <span className="text-[10px] text-stone-400">Cancelados antes da visita</span>
            </div>

            <div className="bg-stone-950/60 border border-stone-800/80 rounded-xl p-3.5 flex flex-col justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-400">
                Não compareceram (No-show)
              </span>
              <p className="text-xl font-bold text-red-300 mt-1">
                {summary.noShows}
              </p>
              <span className="text-[10px] text-stone-400">Agendados sem presença</span>
            </div>

            {/* Zero-Cost Manual WhatsApp Economics Indicator */}
            <div className="bg-stone-950/60 border border-stone-800/80 rounded-xl p-3.5 flex flex-col justify-between col-span-2 lg:col-span-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Custo de mídia / ROI
                </span>
                <span className="text-[10px] text-stone-400 font-mono">WhatsApp Web</span>
              </div>
              <p className="text-lg font-bold text-stone-300 mt-1">
                — <span className="text-xs font-normal text-stone-400">(Não aplicável)</span>
              </p>
              <span className="text-[10px] text-stone-400" title="Disparo manual via WhatsApp Web não possui custo de mídia por mensagem.">
                Custo de mídia R$ 0,00
              </span>
            </div>
          </div>

          {/* RECIPIENT ATTRIBUTION TABLE */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-800 pb-3">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0" role="tablist">
                <button
                  type="button"
                  onClick={() => setRecipientFilterStatus("ALL")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                    recipientFilterStatus === "ALL"
                      ? "bg-stone-100 text-stone-950"
                      : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
                  }`}
                >
                  Todos ({summary.recipients.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRecipientFilterStatus("REACTIVATED")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                    recipientFilterStatus === "REACTIVATED"
                      ? "bg-emerald-500 text-stone-950"
                      : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
                  }`}
                >
                  Retornaram ({summary.reactivatedCustomers})
                </button>
                <button
                  type="button"
                  onClick={() => setRecipientFilterStatus("BOOKED")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                    recipientFilterStatus === "BOOKED"
                      ? "bg-blue-500 text-stone-950"
                      : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
                  }`}
                >
                  Agendados Pendentes
                </button>
                <button
                  type="button"
                  onClick={() => setRecipientFilterStatus("NONE")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                    recipientFilterStatus === "NONE"
                      ? "bg-stone-700 text-stone-200"
                      : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
                  }`}
                >
                  Não convertidos
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={recipientSearch}
                  onChange={(e) => setRecipientSearch(e.target.value)}
                  placeholder="Filtrar por nome ou telefone..."
                  className="bg-stone-950 border border-stone-800 rounded-lg px-3 py-1.5 text-stone-200 placeholder-stone-600 focus:border-amber-500/80 focus:outline-none text-xs w-full sm:w-60"
                />
              </div>
            </div>

            {filteredRecipients.length === 0 ? (
              <div className="p-8 text-center bg-stone-900/40 border border-stone-800 rounded-2xl text-stone-500 text-xs">
                Nenhum destinatário encontrado com os filtros selecionados.
              </div>
            ) : (
              <div className="border border-stone-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-stone-950 text-stone-400 border-b border-stone-800 text-[11px]">
                        <th className="p-3.5 font-semibold">Cliente</th>
                        <th className="p-3.5 font-semibold">Horário do Contato</th>
                        <th className="p-3.5 font-semibold">Agendamento</th>
                        <th className="p-3.5 font-semibold">Retorno Canônico</th>
                        <th className="p-3.5 font-semibold text-right">Receita Atribuída</th>
                        <th className="p-3.5 font-semibold">Status de Atribuição</th>
                        <th className="p-3.5 font-semibold text-center">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-800/60 bg-stone-900/40">
                      {filteredRecipients.map((r) => {
                        const statusBadge = CONVERSION_STATUS_MAP[r.conversionStatus] || {
                          label: r.conversionStatus,
                          color: "bg-stone-800 text-stone-300 border-stone-700",
                        };

                        return (
                          <tr key={r.recipientId} className="hover:bg-stone-800/40 transition-colors">
                            <td className="p-3.5">
                              <span className="font-semibold text-stone-200 block">{r.customerName}</span>
                              <span className="text-[11px] text-stone-400">{formatPhone(r.customerPhone)}</span>
                            </td>
                            <td className="p-3.5 font-mono text-[11px] text-stone-300 whitespace-nowrap">
                              {formatDateTime(r.sentConfirmedAt)}
                            </td>
                            <td className="p-3.5">
                              {r.attributedAppointment ? (
                                <div>
                                  <span className="font-medium text-stone-200 block">
                                    {r.attributedAppointment.serviceName || "Agendado"}
                                  </span>
                                  <span className="text-[10px] text-stone-400 font-mono">
                                    {formatDateTime(r.attributedAppointment.dateTime)} ({r.attributedAppointment.status})
                                  </span>
                                </div>
                              ) : (
                                <span className="text-stone-500">—</span>
                              )}
                            </td>
                            <td className="p-3.5 font-mono text-[11px] text-stone-300 whitespace-nowrap">
                              {r.canonicalReturnDate ? formatDate(r.canonicalReturnDate) : "—"}
                            </td>
                            <td className="p-3.5 text-right font-bold text-emerald-300 whitespace-nowrap">
                              {r.canonicalReturnDate ? formatCurrency(r.revenueAttributed) : "—"}
                            </td>
                            <td className="p-3.5">
                              <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${statusBadge.color}`}>
                                {statusBadge.label}
                              </span>
                            </td>
                            <td className="p-3.5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSelectedRecipientId(r.recipientId)}
                                  className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[11px] font-semibold transition-colors whitespace-nowrap"
                                  title="Ver auditoria detalhada de evidências"
                                >
                                  Ver detalhes
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCustomerHistoryModal({
                                      id: r.customerId,
                                      name: r.customerName,
                                    })
                                  }
                                  className="p-1 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors"
                                  title="Ver histórico consolidado deste cliente"
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" />
                                    <polyline points="12 6 12 12 16 14" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* Recipient Explainability Drawer */}
      {selectedRecipientId && selectedCampaignId && (
        <RecipientAttributionDrawer
          campaignId={selectedCampaignId}
          recipientId={selectedRecipientId}
          onClose={() => setSelectedRecipientId(null)}
          onOpenCustomerHistory={(customerId, customerName) => {
            setCustomerHistoryModal({ id: customerId, name: customerName });
          }}
        />
      )}

      {/* Customer Attribution History Modal */}
      {customerHistoryModal && (
        <CustomerAttributionHistoryModal
          customerId={customerHistoryModal.id}
          customerName={customerHistoryModal.name}
          onClose={() => setCustomerHistoryModal(null)}
        />
      )}
    </div>
  );
}
