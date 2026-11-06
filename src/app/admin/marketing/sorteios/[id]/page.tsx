"use client";

import React, { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateBR } from "@/lib/time-utils";

interface Prize {
  id: string;
  position: number;
  title: string;
  description: string | null;
}

interface Winner {
  id: string;
  prizePosition: number;
  winningTicketNumber: number;
  customerNameSnapshot: string;
  customerPhoneSnapshot: string;
  prizeDelivered: boolean;
  deliveredAt: string | null;
}

interface DrawAudit {
  id: string;
  drawnAt: string;
  drawMethod: string;
  seedUsed: string;
  ticketsSha256Snapshot: string;
  auditLogJson: any;
}

interface SweepstakeDetail {
  id: string;
  title: string;
  description: string | null;
  startDateCivil: string;
  endDateCivil: string;
  drawDateScheduled: string;
  status: "DRAFT" | "REGULATION_PENDING" | "ACTIVE" | "FROZEN" | "DRAWN" | "AUDITED" | "CANCELLED";
  participationMode: "ONE_PER_CUSTOMER" | "ONE_PER_APPOINTMENT" | "ONE_PER_SERVICE";
  targetSegment: "ALL_CUSTOMERS" | "CLUB_ONLY" | "REGULAR_ONLY";
  drawMethod: "ELECTRONIC_DETERMINISTIC" | "FEDERAL_LOTTERY";
  isRegulatedPromotion: boolean;
  authorizationCode: string | null;
  regulationsSummary: string | null;
  ticketsSha256Digest: string | null;
  precommittedSeed: string | null;
  totalEligibleCustomers: number;
  totalEligibleVisits: number;
  totalEligibleServices: number;
  totalChancesAssigned: number;
  frozenAt: string | null;
  drawnAt: string | null;
  prizes: Prize[];
  winners: Winner[];
  drawAudit: DrawAudit | null;
  _count: {
    participants: number;
    tickets: number;
    winners: number;
    chanceOrigins: number;
  };
}

interface ParticipantItem {
  id: string;
  customerId: string;
  chancesCount: number;
  eligibleVisitsCount: number;
  eligibleServicesCount: number;
  isClubMemberSnapshot: boolean;
  customer: {
    id: string;
    name: string;
    phone: string;
  };
  tickets: Array<{ ticketNumber: number }>;
  chanceOrigins: Array<{
    performedAt: string;
    serviceName: string;
    chancesGranted: number;
    justification: string;
  }>;
}

export default function SweepstakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [sweepstake, setSweepstake] = useState<SweepstakeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estados de Ação
  const [actionLoading, setActionLoading] = useState(false);
  const [showFreezeModal, setShowFreezeModal] = useState(false);
  const [showDrawModal, setShowDrawModal] = useState(false);
  const [calculatingPreview, setCalculatingPreview] = useState(false);
  const [previewMetrics, setPreviewMetrics] = useState<{
    totalEligibleCustomers: number;
    totalEligibleVisits: number;
    totalEligibleServices: number;
    totalChances: number;
  } | null>(null);

  // Loteria Federal Inputs
  const [lotteryConcurso, setLotteryConcurso] = useState("");
  const [lotteryPremios, setLotteryPremios] = useState(["", "", "", "", ""]);

  // Participantes & Auditoria
  const [activeTab, setActiveTab] = useState<"overview" | "participants" | "audit">("overview");
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [participantsTotal, setParticipantsTotal] = useState(0);
  const [participantsPage, setParticipantsPage] = useState(1);
  const [participantsSearch, setParticipantsSearch] = useState("");
  const [loadingParticipants, setLoadingParticipants] = useState(false);

  // Modal de Detalhes da Origem de Chance
  const [selectedParticipantForOrigins, setSelectedParticipantForOrigins] = useState<ParticipantItem | null>(null);

  const loadSweepstake = async () => {
    try {
      const res = await fetch(`/api/admin/marketing/sorteios/${id}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao carregar dados da campanha.");
      }
      const data = await res.json();
      setSweepstake(data.sweepstake);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadParticipants = async (page = 1, search = "") => {
    setLoadingParticipants(true);
    try {
      const res = await fetch(
        `/api/admin/marketing/sorteios/${id}/participantes?page=${page}&limit=30&search=${encodeURIComponent(search)}`
      );
      if (res.ok) {
        const data = await res.json();
        setParticipants(data.participants || []);
        setParticipantsTotal(data.total || 0);
        setParticipantsPage(data.page || 1);
      }
    } catch (err) {
      console.error("Erro ao carregar participantes:", err);
    } finally {
      setLoadingParticipants(false);
    }
  };

  useEffect(() => {
    loadSweepstake();
  }, [id]);

  useEffect(() => {
    if (activeTab === "participants") {
      loadParticipants(1, participantsSearch);
    }
  }, [activeTab]);

  // Calcular Prévia de Participantes
  const handleCalculatePreview = async () => {
    setCalculatingPreview(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/admin/marketing/sorteios/${id}/previa`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao calcular prévia.");
      setPreviewMetrics({
        totalEligibleCustomers: data.preview.totalEligibleCustomers,
        totalEligibleVisits: data.preview.totalEligibleVisits,
        totalEligibleServices: data.preview.totalEligibleServices,
        totalChances: data.preview.totalChances,
      });
      setSuccessMsg(`Prévia calculada: ${data.preview.totalEligibleCustomers} clientes elegíveis, ${data.preview.totalChances} chances identificadas.`);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setCalculatingPreview(false);
    }
  };

  // Congelar Campanha
  const handleFreeze = async () => {
    setActionLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/admin/marketing/sorteios/${id}/congelar`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao congelar campanha.");
      setSuccessMsg("Snapshot congelado com sucesso! Bilhetes emitidos e semente imutável registrada.");
      setShowFreezeModal(false);
      await loadSweepstake();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Executar Apuração
  const handleExecuteDraw = async () => {
    setActionLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const bodyPayload = {
        federalLotteryConcurso:
          sweepstake?.drawMethod === "FEDERAL_LOTTERY" ? lotteryConcurso : null,
        federalLotteryPremios:
          sweepstake?.drawMethod === "FEDERAL_LOTTERY" ? lotteryPremios : null,
        isTechnicalSimulation: true,
      };

      const res = await fetch(`/api/admin/marketing/sorteios/${id}/apurar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao realizar apuração.");
      setSuccessMsg("Apuração em modo simulação técnica concluída com sucesso! Ganhadores apurados.");
      setShowDrawModal(false);
      await loadSweepstake();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="py-20 text-center text-zinc-500">Carregando painel do sorteio...</div>;
  }

  if (!sweepstake) {
    return (
      <div className="p-8 text-center text-rose-400">
        <p>{errorMsg || "Campanha não encontrada."}</p>
        <Link href="/admin/marketing/sorteios" className="mt-4 inline-block text-xs text-[#E8C76E] underline">
          Voltar para lista de sorteios
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6 max-w-6xl mx-auto pb-20 px-4 sm:px-6 lg:px-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Link
              href="/admin/marketing/sorteios"
              className="text-xs text-zinc-400 hover:text-white transition-colors flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <span>Sorteios</span>
            </Link>
            <span className="text-zinc-600">/</span>
            <span className="text-xs text-[#E8C76E] font-medium truncate max-w-[180px] sm:max-w-xs">
              {sweepstake.title}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold font-serif text-white tracking-tight break-words">
              {sweepstake.title}
            </h1>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                sweepstake.status === "DRAWN"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : sweepstake.status === "FROZEN"
                  ? "bg-[#D3AE55]/20 text-[#E8C76E] border border-[#D3AE55]/40"
                  : "bg-zinc-800 text-zinc-300 border border-zinc-700"
              }`}
            >
              {sweepstake.status}
            </span>
          </div>

          <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
            Período Elegível:{" "}
            <strong className="text-zinc-200">
              {formatDateBR(sweepstake.startDateCivil)} até {formatDateBR(sweepstake.endDateCivil)}
            </strong>{" "}
            • Apuração: <strong className="text-zinc-200">{formatDateBR(sweepstake.drawDateScheduled)}</strong>
          </p>
        </div>

        {/* Botão de Impressão de Ata se DRAWN */}
        {sweepstake.status === "DRAWN" && (
          <button
            onClick={() => window.print()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 font-semibold text-xs border border-white/[0.1] transition-all cursor-pointer no-print shrink-0"
          >
            <svg className="w-4 h-4 text-[#E8C76E] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            <span>Imprimir Ata da Simulação</span>
          </button>
        )}
      </div>

      {/* Alertas */}
      {errorMsg && (
        <div className="p-3.5 sm:p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs sm:text-sm break-words">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="p-3.5 sm:p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs sm:text-sm break-words">
          {successMsg}
        </div>
      )}

      {/* Métricas Principais */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4">
        <div className="p-3 sm:p-4 rounded-2xl bg-[#15171D] border border-white/[0.08] min-w-0">
          <span className="text-[10px] sm:text-[11px] text-zinc-500 block uppercase tracking-wider truncate">Clientes Únicos</span>
          <span className="text-xl sm:text-2xl font-bold font-serif text-white mt-1 block">
            {sweepstake.status === "DRAFT"
              ? (previewMetrics ? previewMetrics.totalEligibleCustomers : "Prévia")
              : sweepstake.totalEligibleCustomers}
          </span>
        </div>
        <div className="p-3 sm:p-4 rounded-2xl bg-[#15171D] border border-white/[0.08] min-w-0">
          <span className="text-[10px] sm:text-[11px] text-zinc-500 block uppercase tracking-wider truncate">Visitas Elegíveis</span>
          <span className="text-xl sm:text-2xl font-bold font-serif text-zinc-200 mt-1 block">
            {sweepstake.status === "DRAFT"
              ? (previewMetrics ? previewMetrics.totalEligibleVisits : "Prévia")
              : sweepstake.totalEligibleVisits}
          </span>
        </div>
        <div className="p-3 sm:p-4 rounded-2xl bg-[#15171D] border border-white/[0.08] min-w-0">
          <span className="text-[10px] sm:text-[11px] text-zinc-500 block uppercase tracking-wider truncate">Serviços DONE</span>
          <span className="text-xl sm:text-2xl font-bold font-serif text-zinc-200 mt-1 block">
            {sweepstake.status === "DRAFT"
              ? (previewMetrics ? previewMetrics.totalEligibleServices : "Prévia")
              : sweepstake.totalEligibleServices}
          </span>
        </div>
        <div className="p-3 sm:p-4 rounded-2xl bg-[#15171D] border border-[#D3AE55]/30 bg-gradient-to-br from-[#1A1915] to-[#121317] min-w-0">
          <span className="text-[10px] sm:text-[11px] text-[#D3AE55] block uppercase tracking-wider font-semibold truncate">Total de Chances</span>
          <span className="text-xl sm:text-2xl font-bold font-serif text-[#E8C76E] mt-1 block">
            {sweepstake.status === "DRAFT"
              ? (previewMetrics ? previewMetrics.totalChances : "Prévia")
              : sweepstake.totalChancesAssigned}
          </span>
        </div>
      </div>

      {/* Seção dos Ganhadores se DRAWN */}
      {sweepstake.status === "DRAWN" && sweepstake.winners.length > 0 && (
        <div className="rounded-2xl bg-gradient-to-br from-[#1A1915] via-[#14151B] to-[#101217] border border-[#D3AE55]/40 p-4 sm:p-6 shadow-[0_8px_32px_rgba(211,174,85,0.15)] space-y-4">
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300 leading-relaxed">
            <strong>Identificação Inequívoca de Simulação Técnica (V1):</strong> Os contemplados abaixo foram apurados em ensaio técnico interno determinístico. Na versão V1, a apuração comercial oficial permanece travada sob a Lei 5.768/71 e normativas SPA/MF.
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#D3AE55]/20 border border-[#D3AE55]/40 flex items-center justify-center text-[#E8C76E] shrink-0">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="7" />
                  <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
                </svg>
              </div>
              <h2 className="text-base sm:text-lg font-bold font-serif text-[#E8C76E] break-words">
                Ganhadores da Simulação Técnica (V1)
              </h2>
            </div>
            <span className="text-[11px] sm:text-xs text-zinc-400">
              Simulado em: {sweepstake.drawnAt ? new Date(sweepstake.drawnAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "-"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
            {sweepstake.winners.map((win) => {
              const prize = sweepstake.prizes.find((p) => p.position === win.prizePosition);
              return (
                <div
                  key={win.id}
                  className="p-3.5 sm:p-4 rounded-xl bg-stone-950/80 border border-[#D3AE55]/30 space-y-2 relative"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[#D3AE55]/20 text-[#E8C76E] border border-[#D3AE55]/40 shrink-0">
                      {win.prizePosition}º Lugar
                    </span>
                    <span className="text-xs font-mono font-bold text-[#E8C76E] shrink-0">
                      Bilhete nº {String(win.winningTicketNumber).padStart(4, "0")}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white truncate">{win.customerNameSnapshot}</h3>
                    <p className="text-[11px] text-zinc-400 font-mono mt-0.5">{win.customerPhoneSnapshot}</p>
                  </div>

                  {prize && (
                    <div className="pt-2 border-t border-white/[0.06] text-xs text-zinc-300">
                      <span className="text-zinc-500 block text-[10px] uppercase">Prêmio:</span>
                      <span className="font-semibold text-[#E8C76E] line-clamp-1">{prize.title}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Ata Criptográfica */}
          {sweepstake.drawAudit && (
            <div className="p-3 sm:p-3.5 rounded-xl bg-black/50 border border-white/[0.08] text-[11px] font-mono text-zinc-400 space-y-1.5 overflow-hidden">
              <div className="break-all">
                <strong className="text-zinc-300 block mb-0.5">Hash SHA-256 do Snapshot (Lacrado):</strong>
                <span className="text-[#E8C76E] select-all block text-[10px] sm:text-[11px]">
                  {sweepstake.drawAudit.ticketsSha256Snapshot || "-"}
                </span>
              </div>
              <div className="break-all pt-1 border-t border-white/[0.05]">
                <strong className="text-zinc-300 block mb-0.5">Semente Utilizada na Apuração:</strong>
                <span className="text-zinc-300 select-all block text-[10px] sm:text-[11px]">
                  {sweepstake.drawAudit.seedUsed}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Barra de Ações para DRAFT ou FROZEN */}
      {sweepstake.status === "DRAFT" && (
        <div className="p-4 sm:p-5 rounded-2xl bg-[#181920] border border-white/[0.08] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h3 className="text-sm font-bold text-white">Etapa de Homologação: Prévia e Congelamento</h3>
            <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
              Calcule a simulação de participantes ou congele o snapshot para emitir os bilhetes sequenciais de 1 a N.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={calculatingPreview || actionLoading}
              onClick={handleCalculatePreview}
              className="px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 font-semibold text-xs border border-white/[0.1] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 text-center"
            >
              <svg className="w-4 h-4 text-[#E8C76E] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>{calculatingPreview ? "Calculando..." : "Simular Prévia de Participantes"}</span>
            </button>

            <button
              type="button"
              disabled={actionLoading || calculatingPreview}
              onClick={() => setShowFreezeModal(true)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#D3AE55] to-[#B8933A] text-stone-950 font-bold text-xs uppercase tracking-wider shadow-[0_4px_16px_rgba(211,174,85,0.2)] hover:brightness-110 transition-all cursor-pointer disabled:opacity-50 text-center"
            >
              Congelar e Emitir Bilhetes
            </button>
          </div>
        </div>
      )}

      {sweepstake.status === "FROZEN" && (
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-[#1C1A14] to-[#121318] border border-[#D3AE55]/30 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-bold text-[#E8C76E]">Campanha Congelada — Pronta para Simulação Técnica</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Modo Ensaio V1
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
              Bilhetes emitidos ({sweepstake.totalChancesAssigned}). Semente imutável registrada. Na versão V1, apurações oficiais estão bloqueadas; execute a simulação técnica interna para auditoria.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowDrawModal(true)}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#D3AE55] via-[#E8C76E] to-[#B8933A] text-stone-950 font-bold text-xs uppercase tracking-wider shadow-[0_4px_20px_rgba(211,174,85,0.3)] hover:brightness-110 transition-all cursor-pointer text-center shrink-0"
          >
            Executar Simulação Técnica (V1)
          </button>
        </div>
      )}

      {/* Abas: Visão Geral vs. Participantes */}
      <div className="border-b border-white/[0.08] flex items-center gap-2 sm:gap-4 overflow-x-auto pb-1 max-w-full">
        <button
          onClick={() => setActiveTab("overview")}
          className={`pb-3 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
            activeTab === "overview"
              ? "border-[#D3AE55] text-[#E8C76E]"
              : "border-transparent text-zinc-400 hover:text-white"
          }`}
        >
          Visão Geral & Prêmios ({sweepstake.prizes.length})
        </button>
        <button
          onClick={() => setActiveTab("participants")}
          className={`pb-3 text-xs font-bold transition-all border-b-2 cursor-pointer whitespace-nowrap ${
            activeTab === "participants"
              ? "border-[#D3AE55] text-[#E8C76E]"
              : "border-transparent text-zinc-400 hover:text-white"
          }`}
        >
          Participantes & Bilhetes ({sweepstake._count.participants})
        </button>
      </div>

      {/* Conteúdo da Aba: Visão Geral */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Prêmios Cadastrados */}
          <div className="rounded-2xl bg-[#15171D] border border-white/[0.08] p-5 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#E8C76E]">
              Prêmios Configurados
            </h3>
            <div className="divide-y divide-white/[0.06]">
              {sweepstake.prizes.map((pz) => (
                <div key={pz.id} className="py-2.5 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-[#D3AE55]/20 text-[#E8C76E] text-xs font-bold flex items-center justify-center">
                      {pz.position}
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-white">{pz.title}</h4>
                      {pz.description && <p className="text-xs text-zinc-400">{pz.description}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Dados Técnicos e Regulatórios */}
          <div className="rounded-2xl bg-[#15171D] border border-white/[0.08] p-5 space-y-2 text-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
              Regras e Métodos
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-zinc-400">
              <div>
                <strong className="text-zinc-300">Regra de Participação:</strong> {sweepstake.participationMode}
              </div>
              <div>
                <strong className="text-zinc-300">Segmento Alvo:</strong> {sweepstake.targetSegment}
              </div>
              <div>
                <strong className="text-zinc-300">Método de Apuração:</strong> {sweepstake.drawMethod}
              </div>
              <div>
                <strong className="text-zinc-300">Promoção Regulamentada:</strong> {sweepstake.isRegulatedPromotion ? "Sim" : "Não"}
              </div>
              {sweepstake.authorizationCode && (
                <div className="col-span-2">
                  <strong className="text-zinc-300">Certificado SPA/MF:</strong> {sweepstake.authorizationCode}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo da Aba: Participantes */}
      {activeTab === "participants" && (
        <div className="rounded-2xl bg-[#15171D] border border-white/[0.08] p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Lista de Clientes Elegíveis ({participantsTotal})
            </h3>
            <input
              type="text"
              placeholder="Buscar por nome ou telefone..."
              value={participantsSearch}
              onChange={(e) => {
                setParticipantsSearch(e.target.value);
                loadParticipants(1, e.target.value);
              }}
              className="w-full sm:w-64 bg-stone-950 border border-stone-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-stone-600 focus:outline-none focus:border-[#D3AE55]"
            />
          </div>

          {loadingParticipants ? (
            <div className="py-12 text-center text-zinc-500 text-xs">Carregando participantes...</div>
          ) : participants.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-xs">Nenhum participante encontrado.</div>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="w-full text-left text-xs min-w-[620px]">
                <thead>
                  <tr className="border-b border-white/[0.08] text-zinc-400">
                    <th className="py-2.5 px-3">Cliente</th>
                    <th className="py-2.5 px-3">Telefone</th>
                    <th className="py-2.5 px-3">Segmento</th>
                    <th className="py-2.5 px-3 text-center">Visitas</th>
                    <th className="py-2.5 px-3 text-center">Serviços</th>
                    <th className="py-2.5 px-3 text-center">Chances</th>
                    <th className="py-2.5 px-3">Números da Sorte</th>
                    <th className="py-2.5 px-3 text-right">Auditoria</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {participants.map((part) => (
                    <tr key={part.id} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-semibold text-white">{part.customer.name}</td>
                      <td className="py-2.5 px-3 text-zinc-400 font-mono">{part.customer.phone}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            part.isClubMemberSnapshot
                              ? "bg-purple-500/20 text-purple-300"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {part.isClubMemberSnapshot ? "Clube" : "Comum"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center text-zinc-300">{part.eligibleVisitsCount}</td>
                      <td className="py-2.5 px-3 text-center text-zinc-300">{part.eligibleServicesCount}</td>
                      <td className="py-2.5 px-3 text-center font-bold text-[#E8C76E]">{part.chancesCount}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-zinc-300">
                        {part.tickets.map((t) => String(t.ticketNumber).padStart(4, "0")).join(", ")}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedParticipantForOrigins(part)}
                          className="px-2.5 py-1 rounded bg-white/[0.04] hover:bg-[#D3AE55]/20 text-zinc-300 hover:text-[#E8C76E] text-[11px] transition-colors cursor-pointer whitespace-nowrap"
                        >
                          Ver Origens ({part.chanceOrigins?.length || 0})
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal: Congelar Campanha */}
      {showFreezeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-[#16181F] border border-white/[0.1] p-4 sm:p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">Confirmar Congelamento do Snapshot</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              O congelamento é uma operação definitiva que auditará os atendimentos e emitirá os bilhetes sequenciais de 1 a N.
              A lista de participantes e a semente criptográfica se tornarão <strong>imutáveis</strong>.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowFreezeModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleFreeze}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#D3AE55] to-[#B8933A] text-stone-950 font-bold text-xs cursor-pointer disabled:opacity-50 text-center"
              >
                {actionLoading ? "Congelando..." : "Sim, Congelar e Emitir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Simulação Técnica */}
      {showDrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-[#16181F] border border-[#D3AE55]/40 p-4 sm:p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-bold text-[#E8C76E]">Executar Simulação Técnica de Apuração (V1)</h3>

            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300 leading-relaxed">
              <strong>Aviso de Conformidade Regulatória (V1):</strong> Na versão V1, a realização de sorteios comerciais com distribuição de prêmios permanece bloqueada pelo servidor até validação jurídica/SPA-ME. Esta operação executa um <em>ensaio técnico determinístico interno</em> para validação de integridade.
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Esta simulação utilizará a semente pré-comprometida combinada com entropia segura de tempo de execução e registrará os bilhetes contemplados na ata de auditoria técnica.
            </p>

            {sweepstake.drawMethod === "FEDERAL_LOTTERY" && (
              <div className="space-y-3 p-3.5 rounded-xl bg-black/50 border border-white/[0.08]">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1">
                    Número do Concurso da Loteria Federal (CEF) *
                  </label>
                  <input
                    type="text"
                    required
                    value={lotteryConcurso}
                    onChange={(e) => setLotteryConcurso(e.target.value)}
                    placeholder="Ex: Concurso 5998"
                    className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-zinc-300 mb-1">
                    Dezenas do 1º ao {sweepstake.prizes.length}º Prêmio
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {sweepstake.prizes.map((pz, idx) => (
                      <input
                        key={pz.id}
                        type="text"
                        placeholder={`${idx + 1}º Prêmio (ex: 84920)`}
                        value={lotteryPremios[idx] || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLotteryPremios((prev) => {
                            const arr = [...prev];
                            arr[idx] = val;
                            return arr;
                          });
                        }}
                        className="bg-stone-900 border border-stone-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowDrawModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleExecuteDraw}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#D3AE55] to-[#B8933A] text-stone-950 font-bold text-xs uppercase cursor-pointer disabled:opacity-50 text-center"
              >
                {actionLoading ? "Simulando..." : "Confirmar e Executar Simulação"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Origens da Chance (Rastreabilidade Forense) */}
      {selectedParticipantForOrigins && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-[#16181F] border border-white/[0.1] p-4 sm:p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-white truncate">
                Rastreabilidade: {selectedParticipantForOrigins.customer.name}
              </h3>
              <button
                onClick={() => setSelectedParticipantForOrigins(null)}
                className="text-zinc-400 hover:text-white p-1 text-sm shrink-0"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-zinc-400">
              Total de chances:{" "}
              <strong className="text-[#E8C76E]">{selectedParticipantForOrigins.chancesCount}</strong> • Bilhetes:{" "}
              <span className="font-mono text-zinc-200 break-all">
                {selectedParticipantForOrigins.tickets.map((t) => t.ticketNumber).join(", ")}
              </span>
            </p>

            <div className="space-y-2 max-h-64 sm:max-h-72 overflow-y-auto pr-1">
              {selectedParticipantForOrigins.chanceOrigins?.map((orig, i) => (
                <div key={i} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05] text-xs space-y-1">
                  <div className="flex items-center justify-between text-zinc-300 gap-2">
                    <span className="font-semibold truncate">{orig.serviceName}</span>
                    <span className="text-[#E8C76E] font-bold shrink-0">+{orig.chancesGranted} chance(s)</span>
                  </div>
                  <div className="flex flex-col xs:flex-row xs:items-center justify-between text-[11px] text-zinc-500 gap-0.5">
                    <span className="truncate">{orig.justification}</span>
                    <span className="shrink-0">{new Date(orig.performedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 text-right">
              <button
                type="button"
                onClick={() => setSelectedParticipantForOrigins(null)}
                className="w-full sm:w-auto px-4 py-2 rounded-xl bg-white/[0.06] text-xs text-zinc-200 font-semibold"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
