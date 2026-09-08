/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ClientNav } from "@/components/admin/clients/ClientNav";
import {
  ReactivationCandidateItem,
  CandidateSummary,
  CandidateQueryResponse,
} from "@/lib/clients/reactivation/types";
import {
  WHATSAPP_TEMPLATES,
} from "@/lib/customer-whatsapp-templates";
import { CampaignAnalyticsView } from "@/components/admin/clients/reactivation/CampaignAnalyticsView";

type MainTab = "oportunidades" | "resultados";
type PipelineTab = "hoje" | "em_breve" | "no_prazo" | "todos";

const RECURRENCE_SOURCE_LABELS: Record<string, string> = {
  INDIVIDUAL_CADENCE: "Cadência individual",
  DOMINANT_SERVICE_CADENCE: "Cadência do serviço",
  SHOP_BENCHMARK: "Média da barbearia",
  SYSTEM_FALLBACK: "Padrão (30d)",
};

function formatPhone(phone?: string | null) {
  if (!phone) return "Sem telefone";
  const d = phone.replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

function formatDate(iso?: string | Date | null) {
  if (!iso) return "Nunca";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

function formatCurrency(val?: number | null) {
  return (val ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ReactivationPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const userRole = (session?.user as any)?.role as string | undefined;

  // Main Page Tabs
  const [mainTab, setMainTab] = useState<MainTab>("oportunidades");

  // Candidate Data State
  const [candidates, setCandidates] = useState<ReactivationCandidateItem[]>([]);
  const [summary, setSummary] = useState<CandidateSummary>({
    recommendedCount: 0,
    dueSoonCount: 0,
    dueCount: 0,
    overdueCount: 0,
    inactiveCount: 0,
    potentialRevenue: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PipelineTab>("hoje");
  const [searchFilter, setSearchFilter] = useState("");

  // Selection & Campaign State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPreparing, setIsPreparing] = useState(false);
  const [activeCampaign, setActiveCampaign] = useState<any | null>(null);
  const [preparedRecipients, setPreparedRecipients] = useState<any[]>([]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string>("RETURN_REMINDER");
  const [showPreparationModal, setShowPreparationModal] = useState(false);
  const [preparationNotice, setPreparationNotice] = useState<string | null>(null);

  // Explainability Drawer State
  const [explainCandidate, setExplainCandidate] = useState<ReactivationCandidateItem | null>(null);

  // Consent Modal State
  const [consentModalCandidate, setConsentModalCandidate] = useState<ReactivationCandidateItem | null>(null);
  const [consentChoice, setConsentChoice] = useState<"OPTED_IN" | "OPTED_OUT">("OPTED_IN");
  const [consentConfirmationChecked, setConsentConfirmationChecked] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  // Escape key handler for modals/drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (explainCandidate) setExplainCandidate(null);
        if (consentModalCandidate) setConsentModalCandidate(null);
        if (showPreparationModal) setShowPreparationModal(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [explainCandidate, consentModalCandidate, showPreparationModal]);

  // Fetch Candidates from Canonical R3 API
  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/clients/reactivation?limit=100&includeSuppressed=true");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.status === 403) {
        router.push("/admin/clientes");
        return;
      }
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || payload.error || "Erro ao carregar oportunidades de reativação.");
      }

      const data: CandidateQueryResponse = await res.json();
      setCandidates(data.items || []);
      setSummary(
        data.summary || {
          recommendedCount: 0,
          dueSoonCount: 0,
          dueCount: 0,
          overdueCount: 0,
          inactiveCount: 0,
          potentialRevenue: 0,
        }
      );
    } catch (err: any) {
      setError(err.message || "Falha na conexão.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  // Filtered Candidates according to Pipeline Tab & Search
  const filteredCandidates = useMemo(() => {
    let list: ReactivationCandidateItem[] = [];
    switch (activeTab) {
      case "hoje":
        list = candidates.filter(
          (c) =>
            c.recommendationEligible &&
            (c.timingState === "DUE" || c.timingState === "OVERDUE" || c.timingState === "INACTIVE")
        );
        break;
      case "em_breve":
        list = candidates.filter((c) => c.recommendationEligible && c.timingState === "DUE_SOON");
        break;
      case "no_prazo":
        list = candidates.filter((c) => c.timingState === "NOT_DUE");
        break;
      case "todos":
      default:
        list = candidates;
        break;
    }

    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase().trim();
      list = list.filter(
        (c) =>
          c.customer.name.toLowerCase().includes(q) ||
          (c.customer.phone && c.customer.phone.includes(q))
      );
    }

    return list;
  }, [candidates, activeTab, searchFilter]);

  const handleSelectAllVisible = () => {
    const next = new Set(selectedIds);
    const allSelected = filteredCandidates.every((c) => next.has(c.customer.id));
    if (allSelected) {
      filteredCandidates.forEach((c) => next.delete(c.customer.id));
    } else {
      filteredCandidates.forEach((c) => {
        if (next.size < 50) {
          next.add(c.customer.id);
        }
      });
    }
    setSelectedIds(next);
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      if (next.size >= 50) {
        alert("Limite máximo de 50 clientes por lote de contato.");
        return;
      }
      next.add(id);
    }
    setSelectedIds(next);
  };

  const openConsentModal = (candidate: ReactivationCandidateItem) => {
    setConsentModalCandidate(candidate);
    setConsentChoice("OPTED_IN");
    setConsentConfirmationChecked(false);
    setConsentError(null);
  };

  const handleSaveConsent = async () => {
    if (!consentModalCandidate) return;
    if (consentChoice === "OPTED_IN" && !consentConfirmationChecked) {
      setConsentError("Confirme que o cliente de fato autorizou o recebimento de mensagens.");
      return;
    }

    setSavingConsent(true);
    setConsentError(null);

    const eventKey = `evt-consent-${consentModalCandidate.customer.id}-${Date.now()}`;

    try {
      const res = await fetch(`/api/admin/clients/${consentModalCandidate.customer.id}/marketing-consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: consentChoice,
          source: "CUSTOMER_REQUEST_WHATSAPP",
          reason: consentChoice === "OPTED_IN" ? "Consentimento registrado pelo operador no CRM" : "Opt-out registrado pelo operador",
          eventKey,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.message || payload.error || "Erro ao registrar consentimento.");
      }

      setConsentModalCandidate(null);
      await fetchCandidates();
    } catch (err: any) {
      setConsentError(err.message || "Erro ao salvar consentimento.");
    } finally {
      setSavingConsent(false);
    }
  };

  const handlePrepareSelected = async (customIds?: string[]) => {
    const ids = customIds || Array.from(selectedIds);
    if (ids.length === 0) return;

    setIsPreparing(true);
    setPreparationNotice(null);

    const requestKey = `req-prep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    try {
      const res = await fetch("/api/admin/clients/reactivation/manual-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestKey,
          selectedCustomerIds: ids,
          templateKey: selectedTemplateKey,
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.message || payload.error || "Erro ao preparar contatos.");
      }

      setActiveCampaign(payload.campaign);
      setPreparedRecipients(payload.accepted || []);

      if (payload.rejected && payload.rejected.length > 0) {
        setPreparationNotice(
          `${payload.rejected.length} cliente(s) foram desconsiderados por restrições ativas (ex: opt-out, sem consentimento, telefone inválido ou contato recente).`
        );
      }

      setShowPreparationModal(true);
    } catch (err: any) {
      alert(err.message || "Falha ao preparar lote de contatos.");
    } finally {
      setIsPreparing(false);
    }
  };

  const handleOpenWhatsApp = async (recipient: any) => {
    if (!activeCampaign) return;

    const newWindow = window.open("about:blank", "_blank");
    if (!newWindow) {
      alert("Pop-up bloqueado pelo navegador. Por favor, autorize pop-ups para abrir o WhatsApp.");
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/clients/reactivation/manual-campaigns/${activeCampaign.id}/recipients/${recipient.recipientId}/opened`,
        {
          method: "POST",
        }
      );

      const payload = await res.json();
      if (!res.ok || !payload.whatsappUrl) {
        newWindow.close();
        throw new Error(payload.message || payload.error || "Não foi possível validar e preparar o WhatsApp para este cliente.");
      }

      newWindow.location.href = payload.whatsappUrl;

      setPreparedRecipients((prev) =>
        prev.map((r) =>
          r.recipientId === recipient.recipientId
            ? { ...r, dispatchStatus: "WHATSAPP_OPENED" }
            : r
        )
      );
    } catch (err: any) {
      if (newWindow && !newWindow.closed) {
        newWindow.close();
      }
      alert(err.message || "Erro ao abrir WhatsApp.");
    }
  };

  const handleConfirmSend = async (recipient: any) => {
    if (!activeCampaign) return;

    try {
      const res = await fetch(
        `/api/admin/clients/reactivation/manual-campaigns/${activeCampaign.id}/recipients/${recipient.recipientId}/sent-confirmed`,
        {
          method: "POST",
        }
      );

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.message || payload.error || "Erro ao confirmar envio.");
      }

      setPreparedRecipients((prev) =>
        prev.map((r) =>
          r.recipientId === recipient.recipientId
            ? { ...r, dispatchStatus: "SENT_CONFIRMED" }
            : r
        )
      );

      fetchCandidates();
    } catch (err: any) {
      alert(err.message || "Falha ao registrar confirmação de envio.");
    }
  };

  const confirmedCount = preparedRecipients.filter((r) => r.dispatchStatus === "SENT_CONFIRMED").length;

  if (userRole === "BARBER") {
    return (
      <div className="p-8 max-w-xl mx-auto text-center space-y-4">
        <h2 className="text-xl font-bold text-stone-100">Acesso Restrito</h2>
        <p className="text-sm text-stone-400">
          A área de Reativação Smart CRM é restrita a gestores e proprietários da barbearia.
        </p>
        <button
          onClick={() => router.push("/admin/clientes")}
          className="px-4 py-2 bg-stone-800 text-stone-200 rounded-lg text-sm font-semibold"
        >
          Voltar para Clientes
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Reativação de clientes</h1>
          <p className="text-stone-400 text-sm mt-1 max-w-2xl">
            Qual cliente vale a pena chamar hoje? Priorize os contatos com base em retorno inteligente e consentimento.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchCandidates}
            disabled={loading}
            className="px-3.5 py-2 rounded-lg bg-stone-900 border border-stone-700 text-stone-300 text-sm font-semibold hover:bg-stone-800 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={loading ? "animate-spin" : ""}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            <span>Atualizar</span>
          </button>
        </div>
      </div>

      <ClientNav />

      {/* Main Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-stone-800 pb-3" role="tablist" aria-label="Abas de Reativação">
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "oportunidades"}
          onClick={() => setMainTab("oportunidades")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            mainTab === "oportunidades"
              ? "bg-amber-500 text-stone-950 font-bold shadow-sm"
              : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
          }`}
        >
          Oportunidades
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "resultados"}
          onClick={() => setMainTab("resultados")}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            mainTab === "resultados"
              ? "bg-amber-500 text-stone-950 font-bold shadow-sm"
              : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
          }`}
        >
          Campanhas / Resultados
        </button>
      </div>

      {mainTab === "resultados" ? (
        <CampaignAnalyticsView onGoToOpportunities={() => setMainTab("oportunidades")} />
      ) : (
        <>
          {/* Primary KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="bg-stone-900/90 border border-amber-500/30 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
              Clientes recomendados hoje
            </span>
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-stone-100 mt-2">
            {summary.recommendedCount}
          </p>
          <span className="text-[11px] text-stone-400 mt-1">No momento ideal de retorno</span>
        </div>

        <div className="bg-stone-900/90 border border-emerald-500/30 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
              Receita potencial
            </span>
            <span className="text-emerald-400 text-xs font-bold">BRL</span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-emerald-300 mt-2">
            {formatCurrency(summary.potentialRevenue)}
          </p>
          <span className="text-[11px] text-stone-400 mt-1" title="Soma do ticket médio dos clientes recomendados hoje">
            Soma dos tickets recomendados
          </span>
        </div>

        <div className="bg-stone-900/80 border border-stone-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
            Em breve
          </span>
          <p className="text-2xl sm:text-3xl font-bold text-stone-100 mt-2">
            {summary.dueSoonCount}
          </p>
          <span className="text-[11px] text-stone-500 mt-1">Próximos do vencimento</span>
        </div>

        <div className="bg-stone-900/80 border border-stone-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-orange-400">
            Atrasados
          </span>
          <p className="text-2xl sm:text-3xl font-bold text-stone-100 mt-2">
            {summary.overdueCount}
          </p>
          <span className="text-[11px] text-stone-500 mt-1">Passaram da cadência esperada</span>
        </div>

        <div className="bg-stone-900/80 border border-stone-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between col-span-2 lg:col-span-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">
            Inativos
          </span>
          <p className="text-2xl sm:text-3xl font-bold text-stone-100 mt-2">
            {summary.inactiveCount}
          </p>
          <span className="text-[11px] text-stone-500 mt-1">Sem retorno há 2x cadência</span>
        </div>
      </div>

      {/* Primary Pipeline Tabs & Filter Bar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-800 pb-3">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "hoje"}
              onClick={() => setActiveTab("hoje")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                activeTab === "hoje"
                  ? "bg-amber-500 text-stone-950 font-bold"
                  : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
              }`}
            >
              Hoje ({summary.recommendedCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "em_breve"}
              onClick={() => setActiveTab("em_breve")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                activeTab === "em_breve"
                  ? "bg-blue-500 text-stone-950 font-bold"
                  : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
              }`}
            >
              Em breve ({summary.dueSoonCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "no_prazo"}
              onClick={() => setActiveTab("no_prazo")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                activeTab === "no_prazo"
                  ? "bg-emerald-500 text-stone-950 font-bold"
                  : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
              }`}
            >
              No prazo
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "todos"}
              onClick={() => setActiveTab("todos")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                activeTab === "todos"
                  ? "bg-stone-100 text-stone-950 font-bold"
                  : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
              }`}
            >
              Todos ({candidates.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filtrar por nome ou telefone..."
              className="bg-stone-950/70 border border-stone-800 rounded-lg px-3 py-1.5 text-stone-200 placeholder-stone-600 focus:border-amber-500/80 focus:outline-none text-xs w-full sm:w-60"
            />
          </div>
        </div>

        {/* Batch Selection Action Bar */}
        {filteredCandidates.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-stone-900/50 border border-stone-800/80 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSelectAllVisible}
                className="text-xs font-semibold text-stone-400 hover:text-stone-200 flex items-center gap-1.5"
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={
                    filteredCandidates.length > 0 &&
                    filteredCandidates.every((c) => selectedIds.has(c.customer.id))
                  }
                  className="rounded border-stone-700 bg-stone-950 text-amber-500 pointer-events-none"
                />
                <span>Selecionar visíveis</span>
              </button>
              {selectedIds.size > 0 && (
                <span className="text-xs text-amber-400 font-bold">
                  {selectedIds.size} selecionado(s) (máx 50)
                </span>
              )}
            </div>

            {selectedIds.size > 0 && (
              <button
                type="button"
                disabled={isPreparing}
                onClick={() => handlePrepareSelected()}
                className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 text-xs font-bold hover:bg-amber-400 disabled:opacity-50 transition-colors shadow-sm self-end sm:self-auto"
              >
                {isPreparing ? "Preparando..." : `Iniciar lote (${selectedIds.size})`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main Candidate List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-stone-500 gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs">Calculando cadências e oportunidades de retorno...</p>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-center space-y-3">
          <p className="text-red-400 font-semibold text-sm">{error}</p>
          <button
            type="button"
            onClick={fetchCandidates}
            className="px-4 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm font-semibold hover:bg-stone-700"
          >
            Tentar novamente
          </button>
        </div>
      ) : filteredCandidates.length === 0 ? (
        <div className="bg-stone-900/60 border border-stone-800 rounded-2xl p-12 text-center max-w-xl mx-auto space-y-3">
          <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center mx-auto text-stone-400">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 14 14" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-stone-200">Nenhum cliente prioritário nesta aba.</h3>
          <p className="text-xs text-stone-400 leading-relaxed">
            Isso significa que a sua base de clientes está com os retornos em dia ou não há clientes para os filtros selecionados.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCandidates.map((candidate) => {
            const isSelected = selectedIds.has(candidate.customer.id);
            const isOptedIn = candidate.consentStatus === "OPTED_IN";
            const isOptedOut = candidate.consentStatus === "OPTED_OUT";

            let timingText = "No prazo";
            if (candidate.daysOverdue !== null && candidate.daysOverdue > 0) {
              timingText = `${candidate.daysOverdue} dias atrasado`;
            } else if (candidate.daysOverdue !== null && candidate.daysOverdue < 0) {
              timingText = `retorno esperado em ${Math.abs(candidate.daysOverdue)} dias`;
            } else if (candidate.timingState === "DUE") {
              timingText = "Retorno previsto para hoje";
            } else if (candidate.timingState === "OVERDUE") {
              timingText = `${candidate.daysOverdue ?? 0} dias atrasado`;
            } else if (candidate.timingState === "DUE_SOON") {
              timingText = `retorno em breve (${Math.abs(candidate.daysOverdue ?? 0)} dias)`;
            } else if (candidate.timingState === "INACTIVE") {
              timingText = "Inativo (sem retorno prolongado)";
            }

            const cadenceLabel = candidate.expectedReturnDays
              ? `${candidate.expectedReturnDays} dias`
              : "30 dias";

            const recurrenceSource = RECURRENCE_SOURCE_LABELS[candidate.expectedReturnSource] || "Padrão";

            let dispatchTooltip = "Preparar mensagem WhatsApp";
            if (!candidate.dispatchEligible) {
              if (candidate.dispatchSuppressions && candidate.dispatchSuppressions.includes("CONSENT_OPTED_OUT")) {
                dispatchTooltip = "Contato indisponível: cliente solicitou opt-out";
              } else if (candidate.dispatchSuppressions && candidate.dispatchSuppressions.includes("CONSENT_UNKNOWN")) {
                dispatchTooltip = "Contato indisponível: consentimento de marketing pendente";
              } else if (candidate.dispatchSuppressions && candidate.dispatchSuppressions.includes("RECENT_CONTACT")) {
                dispatchTooltip = "Contato indisponível: contatado recentemente nos últimos 14 dias";
              } else if (candidate.dispatchSuppressions && candidate.dispatchSuppressions.includes("UPCOMING_APPOINTMENT")) {
                dispatchTooltip = "Contato indisponível: cliente já possui agendamento futuro";
              } else if (candidate.dispatchSuppressions && candidate.dispatchSuppressions.includes("BLOCKED")) {
                dispatchTooltip = "Contato indisponível: cliente bloqueado";
              } else if (candidate.dispatchSuppressions && candidate.dispatchSuppressions.includes("INVALID_PHONE")) {
                dispatchTooltip = "Contato indisponível: número de telefone celular inválido";
              } else {
                dispatchTooltip = "Contato indisponível por restrição operacional";
              }
            }

            return (
              <div
                key={candidate.customer.id}
                className={`bg-stone-900/80 border transition-all rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                  isSelected
                    ? "border-amber-500/60 bg-stone-900"
                    : "border-stone-800 hover:border-stone-700"
                }`}
              >
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleSelect(candidate.customer.id)}
                    aria-label={`Selecionar ${candidate.customer.name}`}
                    className="mt-1 h-4 w-4 rounded border-stone-700 bg-stone-950 text-amber-500 focus:ring-amber-500/50 cursor-pointer shrink-0"
                  />

                  <div className="min-w-0 space-y-1.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-stone-100 text-base truncate">
                        {candidate.customer.name}
                      </p>
                      <span className="text-xs text-stone-400 font-mono">
                        {formatPhone(candidate.customer.phone)}
                      </span>

                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Score {candidate.score}/100
                      </span>

                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          candidate.timingState === "OVERDUE"
                            ? "bg-red-500/10 text-red-400 border border-red-500/20"
                            : candidate.timingState === "DUE"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                            : candidate.timingState === "DUE_SOON"
                            ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                            : candidate.timingState === "INACTIVE"
                            ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        }`}
                      >
                        {timingText}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-400">
                      <span>
                        Última visita: <strong className="text-stone-300">{formatDate(candidate.lastVisitLocalDate)}</strong>
                      </span>
                      <span>
                        Cadência: <strong className="text-stone-300">{cadenceLabel}</strong> ({recurrenceSource})
                      </span>
                      <span>
                        Ticket médio: <strong className="text-stone-300">{formatCurrency(candidate.averageTicket)}</strong>
                      </span>
                      {candidate.dominantService && (
                        <span>
                          Serviço: <strong className="text-stone-300">{candidate.dominantService.name}</strong>
                        </span>
                      )}
                      {candidate.favoriteProfessional && (
                        <span>
                          Profissional: <strong className="text-stone-300">{candidate.favoriteProfessional.name}</strong>
                        </span>
                      )}
                    </div>

                    {candidate.scoreReasons && candidate.scoreReasons.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {candidate.scoreReasons.map((r, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center px-2 py-0.5 rounded text-[11px] bg-stone-800/80 text-stone-400 border border-stone-800"
                          >
                            {r.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end justify-between lg:justify-center gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-stone-800">
                  <div className="text-left lg:text-right">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500 block">
                      Receita potencial
                    </span>
                    <span className="text-lg font-bold text-emerald-400">
                      {formatCurrency(candidate.potentialRevenue)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isOptedIn ? (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Consentimento OK
                      </span>
                    ) : isOptedOut ? (
                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                        Opt-out
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openConsentModal(candidate)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
                      >
                        Registrar consentimento
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setExplainCandidate(candidate)}
                      className="px-2.5 py-1.5 rounded-lg bg-stone-950 text-stone-300 border border-stone-800 text-xs font-semibold hover:bg-stone-800 transition-colors"
                      title="Ver detalhes do cálculo de score e histórico"
                    >
                      Detalhes
                    </button>

                    <button
                      type="button"
                      disabled={!candidate.dispatchEligible}
                      title={dispatchTooltip}
                      onClick={() => {
                        setSelectedIds(new Set([candidate.customer.id]));
                        handlePrepareSelected([candidate.customer.id]);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#25D366]/10 text-[#25D366] border border-[#25D366]/20 text-xs font-bold hover:bg-[#25D366]/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      WhatsApp
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Explainability Drawer */}
      {explainCandidate && (
        <div className="fixed inset-0 z-50 bg-black/80 flex justify-end">
          <div className="bg-stone-900 border-l border-stone-800 max-w-md w-full h-full p-6 overflow-y-auto space-y-6 animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-stone-100">
                  {explainCandidate.customer.name}
                </h3>
                <p className="text-xs text-stone-400 font-mono">
                  {formatPhone(explainCandidate.customer.phone)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExplainCandidate(null)}
                className="text-stone-400 hover:text-stone-200 p-1"
                aria-label="Fechar detalhes"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                Pontuação Smart CRM ({explainCandidate.score}/100)
              </h4>
              <div className="bg-stone-950/60 border border-stone-800 rounded-xl p-4 space-y-2.5">
                <div className="flex justify-between text-xs">
                  <span className="text-stone-400">Timing do retorno</span>
                  <span className="font-bold text-stone-200">{explainCandidate.scoreComponents?.timing ?? 0} pts</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-stone-400">Volume / Histórico de visitas</span>
                  <span className="font-bold text-stone-200">{explainCandidate.scoreComponents?.confidence ?? 0} pts</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-stone-400">Valor financeiro (Ticket médio)</span>
                  <span className="font-bold text-stone-200">{explainCandidate.scoreComponents?.value ?? 0} pts</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-stone-400">Confiabilidade da cadência</span>
                  <span className="font-bold text-stone-200">{explainCandidate.scoreComponents?.reliability ?? 0} pts</span>
                </div>
                {explainCandidate.scoreComponents?.fatigue ? (
                  <div className="flex justify-between text-xs text-red-400 border-t border-stone-800 pt-2">
                    <span>Penalidade por contato repetido</span>
                    <span>-{explainCandidate.scoreComponents.fatigue} pts</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400">
                Histórico & Cadência
              </h4>
              <div className="bg-stone-950/60 border border-stone-800 rounded-xl p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-stone-400">Última visita registrada</span>
                  <span className="font-semibold text-stone-200">{formatDate(explainCandidate.lastVisitLocalDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">Cadência esperada</span>
                  <span className="font-semibold text-stone-200">{explainCandidate.expectedReturnDays} dias ({RECURRENCE_SOURCE_LABELS[explainCandidate.expectedReturnSource] || "Padrão"})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">Ticket médio apurado</span>
                  <span className="font-semibold text-stone-200">{formatCurrency(explainCandidate.averageTicket)}</span>
                </div>
                {explainCandidate.dominantService && (
                  <div className="flex justify-between">
                    <span className="text-stone-400">Serviço preferido</span>
                    <span className="font-semibold text-stone-200">{explainCandidate.dominantService.name}</span>
                  </div>
                )}
                {explainCandidate.favoriteProfessional && (
                  <div className="flex justify-between">
                    <span className="text-stone-400">Profissional favorito</span>
                    <span className="font-semibold text-stone-200">{explainCandidate.favoriteProfessional.name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-stone-400">
                Status Operacional
              </h4>
              <div className="bg-stone-950/60 border border-stone-800 rounded-xl p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-stone-400">Consentimento de marketing</span>
                  <span className="font-semibold text-stone-200">{explainCandidate.consentStatus}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">Elegível para recomendação</span>
                  <span className={explainCandidate.recommendationEligible ? "text-emerald-400 font-bold" : "text-stone-500"}>
                    {explainCandidate.recommendationEligible ? "SIM" : "NÃO"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-stone-400">Elegível para envio imediato</span>
                  <span className={explainCandidate.dispatchEligible ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                    {explainCandidate.dispatchEligible ? "SIM" : "NÃO"}
                  </span>
                </div>
                {explainCandidate.dispatchSuppressions && explainCandidate.dispatchSuppressions.length > 0 && (
                  <div className="pt-2 border-t border-stone-800">
                    <span className="text-stone-400 block mb-1">Restrições ativas:</span>
                    <div className="flex flex-wrap gap-1">
                      {explainCandidate.dispatchSuppressions.map((s, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-bold">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-stone-800 flex justify-end">
              <button
                type="button"
                onClick={() => setExplainCandidate(null)}
                className="px-4 py-2 rounded-lg bg-stone-800 text-stone-200 text-xs font-bold hover:bg-stone-700"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Consent Recording Modal */}
      {consentModalCandidate && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-stone-100">
              Registrar Consentimento de Marketing
            </h3>
            <p className="text-xs text-stone-400">
              Cliente: <strong className="text-stone-200">{consentModalCandidate.customer.name}</strong>
              <br />
              Telefone: {formatPhone(consentModalCandidate.customer.phone)}
            </p>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-stone-300 cursor-pointer">
                <input
                  type="radio"
                  name="consent"
                  checked={consentChoice === "OPTED_IN"}
                  onChange={() => setConsentChoice("OPTED_IN")}
                  className="text-amber-500"
                />
                <span>Cliente autorizou contato de marketing por WhatsApp (OPTED_IN)</span>
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-stone-300 cursor-pointer">
                <input
                  type="radio"
                  name="consent"
                  checked={consentChoice === "OPTED_OUT"}
                  onChange={() => setConsentChoice("OPTED_OUT")}
                  className="text-amber-500"
                />
                <span>Cliente solicitou NÃO receber mensagens (OPTED_OUT)</span>
              </label>
            </div>

            {consentChoice === "OPTED_IN" && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-2">
                <label className="flex items-start gap-2 text-xs text-stone-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentConfirmationChecked}
                    onChange={(e) => setConsentConfirmationChecked(e.target.checked)}
                    className="mt-0.5 text-amber-500 rounded"
                  />
                  <span>
                    Declaro expressamente que este cliente forneceu autorização prévia para receber mensagens de retorno/marketing da barbearia.
                  </span>
                </label>
              </div>
            )}

            {consentError && (
              <p className="text-xs text-red-400 font-semibold">{consentError}</p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-800">
              <button
                type="button"
                onClick={() => setConsentModalCandidate(null)}
                className="px-4 py-2 rounded-lg border border-stone-700 text-stone-300 text-xs font-semibold hover:bg-stone-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={savingConsent || (consentChoice === "OPTED_IN" && !consentConfirmationChecked)}
                onClick={handleSaveConsent}
                className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 text-xs font-bold hover:bg-amber-400 disabled:opacity-40 transition-colors"
              >
                {savingConsent ? "Gravando..." : "Salvar consentimento"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual WhatsApp Preparation Drawer / Modal */}
      {showPreparationModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-3xl w-full p-6 space-y-5 shadow-2xl my-auto">
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-stone-100">
                  Lote de Contato Manual WhatsApp
                </h3>
                <p className="text-xs text-stone-400 mt-0.5">
                  Progresso: <strong className="text-emerald-400">{confirmedCount} de {preparedRecipients.length} enviados confirmados</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPreparationModal(false)}
                className="text-stone-400 hover:text-stone-200 p-1"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            {preparationNotice && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                {preparationNotice}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-stone-400 uppercase tracking-wider block">
                Modelo de Mensagem
              </label>
              <select
                value={selectedTemplateKey}
                onChange={(e) => setSelectedTemplateKey(e.target.value)}
                className="w-full bg-stone-950 border border-stone-800 rounded-xl p-2.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
              >
                {WHATSAPP_TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>
                    [{t.category}] {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {preparedRecipients.map((recipient) => {
                const isOpened = recipient.dispatchStatus === "WHATSAPP_OPENED";
                const isSent = recipient.dispatchStatus === "SENT_CONFIRMED";

                return (
                  <div
                    key={recipient.recipientId}
                    className="p-3.5 bg-stone-950/70 border border-stone-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-stone-200 truncate">
                          {recipient.customerName}
                        </p>
                        <span className="text-xs text-stone-500 font-mono">
                          {formatPhone(recipient.customerPhone)}
                        </span>
                      </div>
                      <p className="text-xs text-stone-400 line-clamp-2">
                        {recipient.previewMessage || "Mensagem contextual de reativação."}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isSent ? (
                        <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                          ✓ Envio confirmado
                        </span>
                      ) : isOpened ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleConfirmSend(recipient)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500 text-stone-950 text-xs font-bold hover:bg-emerald-400 transition-colors shadow-sm"
                          >
                            Confirmar que enviei
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenWhatsApp(recipient)}
                            className="px-2.5 py-1.5 rounded-lg border border-stone-700 text-stone-400 text-xs hover:text-stone-200"
                            title="Reabrir WhatsApp"
                          >
                            Reabrir
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenWhatsApp(recipient)}
                          className="px-3.5 py-1.5 rounded-lg bg-[#25D366] text-stone-950 text-xs font-bold hover:bg-[#20ba59] transition-colors shadow-sm"
                        >
                          ABRIR WHATSAPP
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between border-t border-stone-800 pt-3">
              <span className="text-xs text-stone-500">
                O envio do WhatsApp é realizado manualmente pelo seu aplicativo.
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowPreparationModal(false);
                  fetchCandidates();
                }}
                className="px-4 py-2 rounded-lg bg-stone-800 text-stone-200 text-xs font-bold hover:bg-stone-700"
              >
                Concluir sessão
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
