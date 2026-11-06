"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { formatDateBR } from "@/lib/time-utils";

interface Prize {
  id: string;
  position: number;
  title: string;
}

interface SweepstakeItem {
  id: string;
  title: string;
  description: string | null;
  startDateCivil: string;
  endDateCivil: string;
  status: "DRAFT" | "REGULATION_PENDING" | "ACTIVE" | "FROZEN" | "DRAWN" | "AUDITED" | "CANCELLED";
  participationMode: "ONE_PER_CUSTOMER" | "ONE_PER_APPOINTMENT" | "ONE_PER_SERVICE";
  targetSegment: "ALL_CUSTOMERS" | "CLUB_ONLY" | "REGULAR_ONLY";
  drawMethod: "ELECTRONIC_DETERMINISTIC" | "FEDERAL_LOTTERY";
  totalEligibleCustomers: number;
  totalChancesAssigned: number;
  createdAt: string;
  prizes: Prize[];
  _count: {
    participants: number;
    tickets: number;
    winners: number;
  };
}

const STATUS_BADGES: Record<string, { label: string; bg: string; text: string; border: string }> = {
  DRAFT: {
    label: "Rascunho",
    bg: "bg-zinc-800/80",
    text: "text-zinc-300",
    border: "border-zinc-700",
  },
  REGULATION_PENDING: {
    label: "Aguardando Regulamento",
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    border: "border-amber-500/30",
  },
  ACTIVE: {
    label: "Ativo",
    bg: "bg-blue-500/15",
    text: "text-blue-400",
    border: "border-blue-500/30",
  },
  FROZEN: {
    label: "Congelado",
    bg: "bg-[#D3AE55]/20",
    text: "text-[#E8C76E]",
    border: "border-[#D3AE55]/40",
  },
  DRAWN: {
    label: "Apurado",
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
  },
  AUDITED: {
    label: "Auditado",
    bg: "bg-emerald-500/20",
    text: "text-emerald-300",
    border: "border-emerald-500/40",
  },
  CANCELLED: {
    label: "Cancelado",
    bg: "bg-rose-500/15",
    text: "text-rose-400",
    border: "border-rose-500/30",
  },
};

const MODE_LABELS: Record<string, string> = {
  ONE_PER_CUSTOMER: "1 chance por cliente",
  ONE_PER_APPOINTMENT: "1 chance por visita",
  ONE_PER_SERVICE: "1 chance por serviço",
};

const SEGMENT_LABELS: Record<string, string> = {
  ALL_CUSTOMERS: "Todos os clientes",
  CLUB_ONLY: "Apenas Clube",
  REGULAR_ONLY: "Apenas Comuns",
};

export default function SweepstakesListPage() {
  const [sweepstakes, setSweepstakes] = useState<SweepstakeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  useEffect(() => {
    async function fetchSweepstakes() {
      try {
        const res = await fetch("/api/admin/marketing/sorteios");
        if (res.ok) {
          const data = await res.json();
          setSweepstakes(data.sweepstakes || []);
        }
      } catch (err) {
        console.error("Erro ao carregar sorteios:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchSweepstakes();
  }, []);

  const filtered = sweepstakes.filter((s) => {
    if (statusFilter === "ALL") return true;
    return s.status === statusFilter;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16 px-4 sm:px-6 lg:px-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/admin/marketing"
              className="text-xs text-zinc-400 hover:text-white transition-colors flex items-center gap-1"
            >
              <span>Marketing</span>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
            <span className="text-xs text-[#E8C76E] font-medium">Sorteios de Clientes</span>
          </div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold font-serif text-white tracking-tight break-words">
            Campanhas de Sorteios
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl leading-relaxed">
            Crie campanhas promocionais, calcule elegibilidade de clientes e realize apurações oficiais auditáveis.
          </p>
        </div>

        <Link
          href="/admin/marketing/sorteios/novo"
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#D3AE55] to-[#B8933A] text-stone-950 font-bold text-xs sm:text-sm shadow-[0_4px_20px_rgba(211,174,85,0.25)] hover:brightness-110 transition-all select-none cursor-pointer shrink-0 text-center"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span className="truncate">Nova Campanha</span>
        </Link>
      </div>

      {/* Filtros de Status */}
      <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto pb-2 border-b border-white/[0.05] max-w-full">
        {[
          { id: "ALL", label: "Todas" },
          { id: "DRAFT", label: "Rascunho" },
          { id: "FROZEN", label: "Congeladas" },
          { id: "DRAWN", label: "Apuradas" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              statusFilter === tab.id
                ? "bg-[#D3AE55]/20 text-[#E8C76E] border border-[#D3AE55]/40"
                : "bg-white/[0.03] text-zinc-400 hover:text-white border border-white/[0.06]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Lista de Campanhas */}
      {loading ? (
        <div className="py-16 text-center text-zinc-500 text-xs sm:text-sm">Carregando campanhas de sorteio...</div>
      ) : filtered.length === 0 ? (
        <div className="p-8 sm:p-12 text-center rounded-2xl bg-[#14161C] border border-white/[0.06] space-y-3">
          <div className="w-12 h-12 rounded-xl bg-[#D3AE55]/10 border border-[#D3AE55]/20 flex items-center justify-center text-[#E8C76E] mx-auto">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <h3 className="text-base font-bold text-white">Nenhum sorteio encontrado</h3>
          <p className="text-xs text-zinc-400 max-w-sm mx-auto">
            Crie sua primeira campanha para fidelizar seus clientes com base nos atendimentos realizados.
          </p>
          <div className="pt-2">
            <Link
              href="/admin/marketing/sorteios/novo"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#D3AE55]/20 hover:bg-[#D3AE55]/30 text-[#E8C76E] text-xs font-bold border border-[#D3AE55]/40 transition-all cursor-pointer"
            >
              Criar Primeiro Sorteio
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filtered.map((item) => {
            const badge = STATUS_BADGES[item.status] || STATUS_BADGES.DRAFT;
            return (
              <div
                key={item.id}
                className="rounded-2xl bg-gradient-to-br from-[#16181F] to-[#111317] border border-white/[0.08] p-4 sm:p-5 shadow-[0_4px_24px_rgba(0,0,0,0.3)] flex flex-col justify-between hover:border-[#D3AE55]/30 transition-all"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.bg} ${badge.text} border ${badge.border} shrink-0`}
                    >
                      {badge.label}
                    </span>
                    <span className="text-[11px] text-zinc-500 font-mono truncate">
                      {formatDateBR(item.createdAt)}
                    </span>
                  </div>

                  <h3 className="text-sm sm:text-base font-bold text-white mb-1 line-clamp-1 break-words">{item.title}</h3>
                  {item.description && (
                    <p className="text-xs text-zinc-400 line-clamp-2 mb-3">{item.description}</p>
                  )}

                  {/* Informações da Campanha */}
                  <div className="space-y-2 py-3 border-y border-white/[0.06] my-3 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-zinc-500 text-[11px] uppercase tracking-wider shrink-0">Período:</span>
                      <span className="text-zinc-200 font-medium text-right text-xs">
                        {formatDateBR(item.startDateCivil)} a {formatDateBR(item.endDateCivil)}
                      </span>
                    </div>

                    <div className="flex items-start justify-between gap-2">
                      <span className="text-zinc-500 text-[11px] uppercase tracking-wider shrink-0">Chances:</span>
                      <span className="text-[#E8C76E] font-medium text-right text-xs truncate">
                        {MODE_LABELS[item.participationMode] || item.participationMode}
                      </span>
                    </div>

                    <div className="flex items-start justify-between gap-2">
                      <span className="text-zinc-500 text-[11px] uppercase tracking-wider shrink-0">Público:</span>
                      <span className="text-zinc-300 font-medium text-right text-xs truncate">
                        {SEGMENT_LABELS[item.targetSegment] || item.targetSegment}
                      </span>
                    </div>

                    {item.prizes.length > 0 && (
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-zinc-500 text-[11px] uppercase tracking-wider shrink-0">1º Prêmio:</span>
                        <span className="text-zinc-200 font-medium text-right text-xs truncate max-w-[150px]">
                          {item.prizes[0].title}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Métricas do Snapshot */}
                  <div className="grid grid-cols-2 gap-2 text-center my-3 bg-white/[0.02] p-2 sm:p-2.5 rounded-xl border border-white/[0.04]">
                    <div className="min-w-0">
                      <span className="text-[10px] text-zinc-500 block uppercase tracking-wider truncate">Clientes</span>
                      <span className="text-xs sm:text-sm font-bold text-white block mt-0.5">
                        {item.status === "DRAFT" ? "Prévia" : item.totalEligibleCustomers}
                      </span>
                    </div>
                    <div className="min-w-0 border-l border-white/[0.08] pl-2">
                      <span className="text-[10px] text-zinc-500 block uppercase tracking-wider truncate">Chances</span>
                      <span className="text-xs sm:text-sm font-bold text-[#E8C76E] block mt-0.5">
                        {item.status === "DRAFT" ? "Prévia" : item.totalChancesAssigned}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <Link
                    href={`/admin/marketing/sorteios/${item.id}`}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-[#D3AE55]/20 text-zinc-200 hover:text-[#E8C76E] font-semibold text-xs border border-white/[0.08] hover:border-[#D3AE55]/40 transition-all cursor-pointer"
                  >
                    <span>Acessar Painel da Campanha</span>
                    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
