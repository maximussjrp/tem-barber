"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { NavIcon } from "@/components/admin/navigation/NavIcon";

interface MarketingStats {
  sweepstakesCount: number;
  activeSweepstakesCount: number;
  vitrineSlug: string | null;
}

export default function MarketingHubPage() {
  const [stats, setStats] = useState<MarketingStats>({
    sweepstakesCount: 0,
    activeSweepstakesCount: 0,
    vitrineSlug: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        const [swRes, shopRes] = await Promise.all([
          fetch("/api/admin/marketing/sorteios"),
          fetch("/api/admin/barbershop"),
        ]);

        let swCount = 0;
        let activeSwCount = 0;
        if (swRes.ok) {
          const swData = await swRes.json();
          const list = swData.sweepstakes || [];
          swCount = list.length;
          activeSwCount = list.filter((s: any) => s.status === "ACTIVE" || s.status === "FROZEN").length;
        }

        let slug = null;
        if (shopRes.ok) {
          const shopData = await shopRes.json();
          slug = shopData.barbershop?.slug || null;
        }

        setStats({
          sweepstakesCount: swCount,
          activeSweepstakesCount: activeSwCount,
          vitrineSlug: slug,
        });
      } catch (err) {
        console.error("Erro ao carregar dados do marketing:", err);
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16 px-4 sm:px-6 lg:px-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/[0.08] pb-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#D3AE55]/20 text-[#E8C76E] border border-[#D3AE55]/40">
              Central Comercial
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold font-serif text-white tracking-tight break-words">
            Marketing & Campanhas
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl leading-relaxed">
            Gestão de campanhas comerciais, fidelização de clientes e presença pública da barbearia.
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
          <span className="truncate">Criar Sorteio de Clientes</span>
        </Link>
      </div>

      {/* Grid de Ferramentas do Marketing */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4 sm:gap-5">
        {/* Card 1: Sorteios de Clientes (V1) */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#16181F] to-[#101217] border border-white/[0.08] p-4 sm:p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4)] flex flex-col justify-between group hover:border-[#D3AE55]/40 transition-all min-w-0">
          <div className="absolute top-0 right-0 w-48 h-48 bg-[#D3AE55]/[0.05] rounded-full blur-3xl pointer-events-none" />

          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-[#D3AE55]/15 border border-[#D3AE55]/30 flex items-center justify-center text-[#E8C76E] shrink-0">
                <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                V1 • Operacional
              </span>
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-white mb-2 group-hover:text-[#E8C76E] transition-colors break-words">
              Sorteios de Clientes
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed mb-5">
              Incentive a frequência da barbearia com sorteios promocionais baseados no histórico real de atendimentos.
              Suporta sorteio por cliente único, por visita ou por serviço realizado, com apuração auditável e rastreabilidade total.
            </p>

            <div className="grid grid-cols-2 gap-2 sm:gap-3 py-3 px-3 sm:px-4 rounded-xl bg-white/[0.03] border border-white/[0.05] mb-5">
              <div className="min-w-0">
                <span className="text-[11px] text-zinc-400 block truncate">Total Campanhas</span>
                <span className="text-base sm:text-lg font-bold text-white block mt-0.5">
                  {loading ? "..." : stats.sweepstakesCount}
                </span>
              </div>
              <div className="min-w-0 border-l border-white/[0.08] pl-2.5 sm:pl-3">
                <span className="text-[11px] text-zinc-400 block truncate">Ativas / Congeladas</span>
                <span className="text-base sm:text-lg font-bold text-[#E8C76E] block mt-0.5">
                  {loading ? "..." : stats.activeSweepstakesCount}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col xs:flex-row items-stretch sm:items-center gap-2 pt-2">
            <Link
              href="/admin/marketing/sorteios"
              className="flex-1 text-center py-2.5 px-3 rounded-xl bg-[#D3AE55]/15 hover:bg-[#D3AE55]/25 text-[#E8C76E] font-semibold text-xs sm:text-sm border border-[#D3AE55]/30 transition-all cursor-pointer"
            >
              Gerenciar Sorteios
            </Link>
            <Link
              href="/admin/marketing/sorteios/novo"
              className="xs:w-auto text-center py-2.5 px-3 sm:px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 font-semibold text-xs sm:text-sm border border-white/[0.1] transition-all cursor-pointer"
            >
              Novo Sorteio
            </Link>
          </div>
        </div>

        {/* Card 2: Vitrine Pública */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#16181F] to-[#101217] border border-white/[0.08] p-4 sm:p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4)] flex flex-col justify-between group hover:border-[#D3AE55]/40 transition-all">
          <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/[0.04] rounded-full blur-3xl pointer-events-none" />

          <div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold uppercase tracking-wider bg-blue-500/15 text-blue-400 border border-blue-500/30 shrink-0">
                Ativo • Online
              </span>
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-white mb-2 group-hover:text-blue-400 transition-colors break-words">
              Vitrine Pública
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed mb-5">
              Página de apresentação institucional da sua barbearia para o público. Gerencie logotipo, capa, fotos de trabalhos,
              endereço, telefones e o link público de agendamentos.
            </p>

            <div className="py-3 px-3 sm:px-4 rounded-xl bg-white/[0.03] border border-white/[0.05] mb-5 overflow-hidden">
              <span className="text-[11px] text-zinc-400 block mb-0.5">Link Público Atual</span>
              <span className="text-xs font-mono text-zinc-200 truncate block">
                {stats.vitrineSlug ? `https://app.tembarber.com.br/${stats.vitrineSlug}` : "Carregando..."}
              </span>
            </div>
          </div>

          <div className="flex flex-col xs:flex-row items-stretch sm:items-center gap-2 pt-2">
            <Link
              href="/admin/marketing/vitrine"
              className="flex-1 text-center py-2.5 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 font-semibold text-xs sm:text-sm border border-white/[0.1] transition-all cursor-pointer"
            >
              Configurar Vitrine Pública
            </Link>
            {stats.vitrineSlug && (
              <a
                href={`https://app.tembarber.com.br/${stats.vitrineSlug}`}
                target="_blank"
                rel="noreferrer"
                className="py-2.5 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-white border border-white/[0.08] transition-all flex items-center justify-center shrink-0"
                title="Abrir em nova aba"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}
          </div>
        </div>

        {/* Card 3: Reativação Inteligente (CRM) */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#16181F] to-[#101217] border border-white/[0.08] p-4 sm:p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4)] flex flex-col justify-between group hover:border-[#D3AE55]/40 transition-all min-w-0">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-bold uppercase tracking-wider bg-purple-500/15 text-purple-400 border border-purple-500/30 shrink-0">
                Smart CRM
              </span>
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-white mb-2 group-hover:text-purple-400 transition-colors break-words">
              Reativação de Clientes
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed mb-5">
              Recupere clientes inativos utilizando a inteligência preditiva do Smart CRM. Identifique clientes que ultrapassaram o ciclo médio de retorno e envie mensagens direcionadas via WhatsApp.
            </p>
          </div>

          <div className="pt-2">
            <Link
              href="/admin/clientes/reativacao"
              className="block w-full text-center py-2.5 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 font-semibold text-xs sm:text-sm border border-white/[0.1] transition-all cursor-pointer"
            >
              Acessar Campanhas de Reativação
            </Link>
          </div>
        </div>

        {/* Card 4: Rifas por Números (V2) - Planejamento & Conformidade Legal */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#14151B] to-[#0D0F13] border border-white/[0.05] p-4 sm:p-6 shadow-[0_8px_32px_rgba(0,0,0,0.2)] flex flex-col justify-between opacity-85 min-w-0">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500/70 shrink-0">
                <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400/80 border border-amber-500/20 shrink-0">
                V2 • Planejamento
              </span>
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-zinc-300 mb-2 break-words">
              Rifas por Números
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed mb-4">
              Planejamento arquitetural para comercialização de cotas e sorteio por números de 00 a 99 / 000 a 999.
            </p>

            <div className="p-3 sm:p-3.5 rounded-xl bg-amber-500/[0.05] border border-amber-500/15 mb-4">
              <p className="text-xs text-amber-300/90 leading-normal">
                <strong>Salvaguarda Regulatória:</strong> A venda onerosa de rifas no Brasil é regulada pela Lei 5.768/71 e Ministério da Fazenda (SPA/MF). O módulo operacional permanece desativado até enquadramento em modalidade autorizada.
              </p>
            </div>
          </div>

          <div className="pt-2">
            <button
              disabled
              className="w-full text-center py-2.5 px-3 rounded-xl bg-white/[0.02] text-zinc-500 font-semibold text-xs sm:text-sm border border-white/[0.05] cursor-not-allowed"
            >
              Módulo em Planejamento (V2)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
