"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ServiceItem {
  id: string;
  name: string;
  price: string;
}

interface PrizeInput {
  title: string;
  description: string;
}

export default function NewSweepstakePage() {
  const router = useRouter();

  // Estados do Formulário
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDateCivil, setStartDateCivil] = useState(() => {
    const d = new Date();
    d.setDate(1); // Primeiro dia do mês atual
    return d.toISOString().slice(0, 10);
  });
  const [endDateCivil, setEndDateCivil] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10); // Hoje
  });
  const [drawDateScheduled, setDrawDateScheduled] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7); // Daqui a uma semana
    return d.toISOString().slice(0, 10);
  });

  const [participationMode, setParticipationMode] = useState<"ONE_PER_CUSTOMER" | "ONE_PER_APPOINTMENT" | "ONE_PER_SERVICE">("ONE_PER_CUSTOMER");
  const [targetSegment, setTargetSegment] = useState<"ALL_CUSTOMERS" | "CLUB_ONLY" | "REGULAR_ONLY">("ALL_CUSTOMERS");
  const [drawMethod, setDrawMethod] = useState<"ELECTRONIC_DETERMINISTIC" | "FEDERAL_LOTTERY">("ELECTRONIC_DETERMINISTIC");
  const [allowMultiplePrizesPerUser, setAllowMultiplePrizesPerUser] = useState(false);

  // Regulamento e Autorização
  const [isRegulatedPromotion, setIsRegulatedPromotion] = useState(false);
  const [authorizationCode, setAuthorizationCode] = useState("");
  const [regulationsSummary, setRegulationsSummary] = useState("");
  const [regulationsDocumentUrl, setRegulationsDocumentUrl] = useState("");
  const [federalLotteryContestNumber, setFederalLotteryContestNumber] = useState("");

  // Serviços e Prêmios
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [filterAllServices, setFilterAllServices] = useState(true);

  const [prizes, setPrizes] = useState<PrizeInput[]>([
    { title: "1º Prêmio: Corte de Cabelo Grátis por 1 Ano", description: "1 atendimento mensal durante 12 meses" },
  ]);

  // Prévia
  const [calculatingPreview, setCalculatingPreview] = useState(false);
  const [previewData, setPreviewData] = useState<{
    totalEligibleCustomers: number;
    totalEligibleVisits: number;
    totalEligibleServices: number;
    totalChances: number;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadServices() {
      try {
        const res = await fetch("/api/admin/services");
        if (res.ok) {
          const data = await res.json();
          setServices(data.services || []);
        }
      } catch (err) {
        console.error("Erro ao carregar serviços:", err);
      }
    }
    loadServices();
  }, []);

  const addPrize = () => {
    setPrizes((prev) => [
      ...prev,
      { title: `${prev.length + 1}º Prêmio: `, description: "" },
    ]);
  };

  const removePrize = (index: number) => {
    if (prizes.length <= 1) return;
    setPrizes((prev) => prev.filter((_, i) => i !== index));
  };

  const updatePrize = (index: number, field: "title" | "description", val: string) => {
    setPrizes((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: val } : p))
    );
  };

  const toggleService = (srvId: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(srvId) ? prev.filter((id) => id !== srvId) : [...prev, srvId]
    );
  };

  // Simular Prévia
  const handleSimulatePreview = async () => {
    setCalculatingPreview(true);
    setErrorMsg(null);

    try {
      // 1. Criar um rascunho temporário ou chamar a prévia
      // Como a rota /previa precisa de sweepstakeId, podemos salvar um rascunho rápido ou chamar endpoint direto
      // Vamos criar o rascunho e redirecionar para a página da campanha
      const payload = {
        title: title.trim() || "Rascunho de Campanha",
        description,
        startDateCivil,
        endDateCivil,
        drawDateScheduled,
        participationMode,
        targetSegment,
        serviceIds: filterAllServices ? null : selectedServiceIds,
        allowMultiplePrizesPerUser,
        drawMethod,
        isRegulatedPromotion,
        authorizationCode: authorizationCode || null,
        regulationsSummary: regulationsSummary || null,
        regulationsDocumentUrl: regulationsDocumentUrl || null,
        federalLotteryContestNumber: federalLotteryContestNumber || null,
        prizes,
      };

      const res = await fetch("/api/admin/marketing/sorteios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao calcular prévia.");
      }

      // Buscar a prévia da campanha criada
      const prevRes = await fetch(`/api/admin/marketing/sorteios/${data.sweepstake.id}/previa`, {
        method: "POST",
      });
      const prevData = await prevRes.json();
      if (prevRes.ok) {
        setPreviewData({
          totalEligibleCustomers: prevData.preview.totalEligibleCustomers,
          totalEligibleVisits: prevData.preview.totalEligibleVisits,
          totalEligibleServices: prevData.preview.totalEligibleServices,
          totalChances: prevData.preview.totalChances,
        });
        // Redirecionar direto para o painel de detalhes da campanha
        router.push(`/admin/marketing/sorteios/${data.sweepstake.id}`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao calcular simulação.");
    } finally {
      setCalculatingPreview(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);

    if (!title.trim()) {
      setErrorMsg("O título da campanha é obrigatório.");
      setSaving(false);
      return;
    }

    if (prizes.length === 0 || !prizes[0].title.trim()) {
      setErrorMsg("Cadastre pelo menos o 1º prêmio da campanha.");
      setSaving(false);
      return;
    }

    if (isRegulatedPromotion && !authorizationCode.trim()) {
      setErrorMsg("Para campanhas reguladas, informe o Certificado de Autorização (SPA/MF).");
      setSaving(false);
      return;
    }

    try {
      const payload = {
        title: title.trim(),
        description,
        startDateCivil,
        endDateCivil,
        drawDateScheduled,
        participationMode,
        targetSegment,
        serviceIds: filterAllServices ? null : selectedServiceIds,
        allowMultiplePrizesPerUser,
        drawMethod,
        isRegulatedPromotion,
        authorizationCode: authorizationCode || null,
        regulationsSummary: regulationsSummary || null,
        regulationsDocumentUrl: regulationsDocumentUrl || null,
        federalLotteryContestNumber: federalLotteryContestNumber || null,
        prizes,
      };

      const res = await fetch("/api/admin/marketing/sorteios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao salvar campanha.");
      }

      router.push(`/admin/marketing/sorteios/${data.sweepstake.id}`);
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao criar campanha de sorteio.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-20 px-4 sm:px-6 lg:px-8">
      {/* Top Header */}
      <div className="border-b border-white/[0.08] pb-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Link
            href="/admin/marketing/sorteios"
            className="text-xs text-zinc-400 hover:text-white transition-colors flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span>Voltar para Sorteios</span>
          </Link>
        </div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold font-serif text-white tracking-tight break-words">
          Nova Campanha de Sorteio
        </h1>
        <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
          Configure as regras de participação, datas de apuração, prêmios e filtros de elegibilidade.
        </p>
      </div>

      {errorMsg && (
        <div className="p-3.5 sm:p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs sm:text-sm flex items-start gap-3">
          <svg className="w-5 h-5 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="break-words">{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5 sm:space-y-6">
        {/* Seção 1: Dados Gerais */}
        <div className="rounded-2xl bg-[#15171D] border border-white/[0.08] p-4 sm:p-6 space-y-4">
          <h2 className="text-base font-bold text-[#E8C76E] uppercase tracking-wider text-xs">
            1. Identificação da Campanha
          </h2>

          <div>
            <label className="block text-xs font-semibold uppercase text-zinc-300 mb-1.5">
              Título da Campanha *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Sorteio de Fim de Ano — Clientes VIP"
              className="w-full bg-stone-950/70 border border-stone-800 rounded-xl px-3.5 sm:px-4 py-2.5 text-xs sm:text-sm text-white placeholder-stone-600 focus:outline-none focus:border-[#D3AE55]"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-zinc-300 mb-1.5">
              Descrição / Regulamento Resumido
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva as condições da campanha, data de entrega dos prêmios e orientações gerais..."
              className="w-full bg-stone-950/70 border border-stone-800 rounded-xl px-3.5 sm:px-4 py-2.5 text-xs sm:text-sm text-white placeholder-stone-600 focus:outline-none focus:border-[#D3AE55]"
            />
          </div>
        </div>

        {/* Seção 2: Período e Datas */}
        <div className="rounded-2xl bg-[#15171D] border border-white/[0.08] p-4 sm:p-6 space-y-4">
          <h2 className="text-base font-bold text-[#E8C76E] uppercase tracking-wider text-xs">
            2. Período Elegível e Data da Apuração
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-zinc-300 mb-1.5">
                Data Inicial (Inclusiva) *
              </label>
              <input
                type="date"
                required
                value={startDateCivil}
                onChange={(e) => setStartDateCivil(e.target.value)}
                className="w-full bg-stone-950/70 border border-stone-800 rounded-xl px-3 py-2 sm:px-3.5 sm:py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-[#D3AE55]"
              />
              <span className="text-[11px] text-zinc-500 mt-1 block">00:00 (Fuso Brasília)</span>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-zinc-300 mb-1.5">
                Data Final (Inclusiva) *
              </label>
              <input
                type="date"
                required
                value={endDateCivil}
                onChange={(e) => setEndDateCivil(e.target.value)}
                className="w-full bg-stone-950/70 border border-stone-800 rounded-xl px-3 py-2 sm:px-3.5 sm:py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-[#D3AE55]"
              />
              <span className="text-[11px] text-zinc-500 mt-1 block">23:59:59 (Fuso Brasília)</span>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-zinc-300 mb-1.5">
                Data Prevista do Sorteio *
              </label>
              <input
                type="date"
                required
                value={drawDateScheduled}
                onChange={(e) => setDrawDateScheduled(e.target.value)}
                className="w-full bg-stone-950/70 border border-stone-800 rounded-xl px-3 py-2 sm:px-3.5 sm:py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-[#D3AE55]"
              />
              <span className="text-[11px] text-zinc-500 mt-1 block">Dia da Apuração</span>
            </div>
          </div>
        </div>

        {/* Seção 3: Regras de Participação e Modos */}
        <div className="rounded-2xl bg-[#15171D] border border-white/[0.08] p-4 sm:p-6 space-y-4">
          <h2 className="text-base font-bold text-[#E8C76E] uppercase tracking-wider text-xs">
            3. Regras de Participação & Chances
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                id: "ONE_PER_CUSTOMER",
                title: "Modo A: Por Cliente",
                desc: "1 chance fixa por cliente único elegível no período, não importando a quantidade de atendimentos.",
              },
              {
                id: "ONE_PER_APPOINTMENT",
                title: "Modo B: Por Atendimento",
                desc: "1 chance a cada visita concluída. Cliente que compareceu 4 vezes recebe 4 chances.",
              },
              {
                id: "ONE_PER_SERVICE",
                title: "Modo C: Por Serviço",
                desc: "1 chance por serviço elegível executado. Cliente que fez Corte + Barba recebe 2 chances.",
              },
            ].map((mode) => (
              <label
                key={mode.id}
                onClick={() => setParticipationMode(mode.id as any)}
                className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                  participationMode === mode.id
                    ? "bg-[#D3AE55]/15 border-[#D3AE55]/60 text-white"
                    : "bg-stone-950/40 border-stone-800 text-zinc-400 hover:border-zinc-700"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white">{mode.title}</span>
                    <input
                      type="radio"
                      name="participationMode"
                      checked={participationMode === mode.id}
                      onChange={() => {}}
                      className="accent-[#D3AE55]"
                    />
                  </div>
                  <p className="text-[11.5px] text-zinc-400 leading-normal">{mode.desc}</p>
                </div>
              </label>
            ))}
          </div>

          {/* Segmentação de Clientes */}
          <div className="pt-2">
            <label className="block text-xs font-semibold uppercase text-zinc-300 mb-2">
              Segmento de Clientes Elegíveis
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { id: "ALL_CUSTOMERS", label: "Todos os Clientes", desc: "Comuns e Assinantes do Clube" },
                { id: "CLUB_ONLY", label: "Apenas Clube", desc: "Apenas clientes com assinatura ativa comprovada" },
                { id: "REGULAR_ONLY", label: "Apenas Comuns", desc: "Clientes que não possuem assinatura do clube" },
              ].map((seg) => (
                <label
                  key={seg.id}
                  onClick={() => setTargetSegment(seg.id as any)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    targetSegment === seg.id
                      ? "bg-[#D3AE55]/15 border-[#D3AE55]/60 text-white"
                      : "bg-stone-950/40 border-stone-800 text-zinc-400 hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-white">{seg.label}</span>
                    <input
                      type="radio"
                      name="targetSegment"
                      checked={targetSegment === seg.id}
                      onChange={() => {}}
                      className="accent-[#D3AE55]"
                    />
                  </div>
                  <p className="text-[11px] text-zinc-400">{seg.desc}</p>
                </label>
              ))}
            </div>
          </div>

          {/* Filtro de Serviços */}
          <div className="pt-3 border-t border-white/[0.06]">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase text-zinc-300">
                Filtro de Serviços
              </label>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setFilterAllServices(true)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                    filterAllServices ? "bg-[#D3AE55]/20 text-[#E8C76E]" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Qualquer Serviço
                </button>
                <button
                  type="button"
                  onClick={() => setFilterAllServices(false)}
                  className={`px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                    !filterAllServices ? "bg-[#D3AE55]/20 text-[#E8C76E]" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Serviços Específicos
                </button>
              </div>
            </div>

            {!filterAllServices && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 p-3 rounded-xl bg-stone-950/50 border border-stone-800 max-h-44 overflow-y-auto">
                {services.map((srv) => (
                  <label
                    key={srv.id}
                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/[0.04] text-xs text-zinc-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedServiceIds.includes(srv.id)}
                      onChange={() => toggleService(srv.id)}
                      className="rounded accent-[#D3AE55]"
                    />
                    <span className="truncate">{srv.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Seção 4: Cadastro de Prêmios */}
        <div className="rounded-2xl bg-[#15171D] border border-white/[0.08] p-4 sm:p-6 space-y-4">
          <div className="flex flex-col xs:flex-row items-start xs:items-center justify-between gap-2">
            <h2 className="text-base font-bold text-[#E8C76E] uppercase tracking-wider text-xs">
              4. Prêmios da Campanha ({prizes.length})
            </h2>
            <button
              type="button"
              onClick={addPrize}
              className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs text-zinc-200 font-semibold border border-white/[0.08] transition-all flex items-center gap-1 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5 text-[#E8C76E]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>Adicionar Prêmio</span>
            </button>
          </div>

          <div className="space-y-3">
            {prizes.map((pz, idx) => (
              <div
                key={idx}
                className="p-3 sm:p-3.5 rounded-xl bg-stone-950/60 border border-stone-800 space-y-2 relative group"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#E8C76E] shrink-0">
                    {idx + 1}º Lugar:
                  </span>
                  <input
                    type="text"
                    required
                    value={pz.title}
                    onChange={(e) => updatePrize(idx, "title", e.target.value)}
                    placeholder="Nome do prêmio (ex: Kit Pomadas Premium)"
                    className="flex-1 min-w-0 bg-stone-900 border border-stone-700/80 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs text-white placeholder-stone-600 focus:outline-none focus:border-[#D3AE55]"
                  />
                  {prizes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePrize(idx)}
                      className="text-zinc-500 hover:text-rose-400 p-1 cursor-pointer shrink-0"
                      title="Remover prêmio"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={pz.description}
                  onChange={(e) => updatePrize(idx, "description", e.target.value)}
                  placeholder="Detalhes ou regras de entrega (opcional)"
                  className="w-full bg-stone-900/60 border border-stone-800 rounded-lg px-2.5 sm:px-3 py-1 text-xs text-zinc-300 placeholder-stone-600 focus:outline-none focus:border-[#D3AE55]"
                />
              </div>
            ))}
          </div>

          {/* Toggle múltiplos prêmios por usuário */}
          <div className="pt-2 flex items-start sm:items-center gap-2">
            <input
              type="checkbox"
              id="multiplePrizes"
              checked={allowMultiplePrizesPerUser}
              onChange={(e) => setAllowMultiplePrizesPerUser(e.target.checked)}
              className="rounded accent-[#D3AE55] mt-0.5 sm:mt-0 shrink-0"
            />
            <label htmlFor="multiplePrizes" className="text-xs text-zinc-300 cursor-pointer">
              Permitir que o mesmo cliente ganhe mais de um prêmio com bilhetes distintos
            </label>
          </div>
        </div>

        {/* Seção 5: Método de Apuração e Regulamento */}
        <div className="rounded-2xl bg-[#15171D] border border-white/[0.08] p-4 sm:p-6 space-y-4">
          <h2 className="text-base font-bold text-[#E8C76E] uppercase tracking-wider text-xs">
            5. Método de Apuração & Conformidade Regulatória
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              onClick={() => setDrawMethod("ELECTRONIC_DETERMINISTIC")}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                drawMethod === "ELECTRONIC_DETERMINISTIC"
                  ? "bg-[#D3AE55]/15 border-[#D3AE55]/60 text-white"
                  : "bg-stone-950/40 border-stone-800 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-white">Sorteio Eletrônico (Simulação Local)</span>
                <input
                  type="radio"
                  name="drawMethod"
                  checked={drawMethod === "ELECTRONIC_DETERMINISTIC"}
                  onChange={() => {}}
                  className="accent-[#D3AE55] shrink-0"
                />
              </div>
              <p className="text-[11px] text-zinc-400">
                Semente pré-comprometida imutável e algoritmo CSPRNG HMAC-SHA256 para testes locais e simulação.
              </p>
            </label>

            <label
              onClick={() => setDrawMethod("FEDERAL_LOTTERY")}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                drawMethod === "FEDERAL_LOTTERY"
                  ? "bg-[#D3AE55]/15 border-[#D3AE55]/60 text-white"
                  : "bg-stone-950/40 border-stone-800 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-white">Vinculado à Loteria Federal (Oficial)</span>
                <input
                  type="radio"
                  name="drawMethod"
                  checked={drawMethod === "FEDERAL_LOTTERY"}
                  onChange={() => {}}
                  className="accent-[#D3AE55] shrink-0"
                />
              </div>
              <p className="text-[11px] text-zinc-400">
                Apuração baseada nas dezenas do concurso da Caixa Econômica Federal conforme regulamento.
              </p>
            </label>
          </div>

          {drawMethod === "FEDERAL_LOTTERY" && (
            <div>
              <label className="block text-xs font-semibold uppercase text-zinc-300 mb-1.5">
                Número do Concurso da Loteria Federal (CEF)
              </label>
              <input
                type="text"
                value={federalLotteryContestNumber}
                onChange={(e) => setFederalLotteryContestNumber(e.target.value)}
                placeholder="Ex: Concurso 5998"
                className="w-full bg-stone-950/70 border border-stone-800 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-[#D3AE55]"
              />
            </div>
          )}

          {/* Toggle Promoção Regulamentada */}
          <div className="pt-3 border-t border-white/[0.06] space-y-3">
            <div className="flex items-start sm:items-center gap-2">
              <input
                type="checkbox"
                id="isRegulated"
                checked={isRegulatedPromotion}
                onChange={(e) => setIsRegulatedPromotion(e.target.checked)}
                className="rounded accent-[#D3AE55] mt-0.5 sm:mt-0 shrink-0"
              />
              <label htmlFor="isRegulated" className="text-xs text-zinc-200 font-semibold cursor-pointer">
                Campanha com Autorização Regulatória (SPA / Ministério da Fazenda)
              </label>
            </div>

            {isRegulatedPromotion && (
              <div className="p-3.5 sm:p-4 rounded-xl bg-amber-500/[0.04] border border-amber-500/20 space-y-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-amber-300 mb-1">
                    Número do Certificado de Autorização (SPA/MF) *
                  </label>
                  <input
                    type="text"
                    required={isRegulatedPromotion}
                    value={authorizationCode}
                    onChange={(e) => setAuthorizationCode(e.target.value)}
                    placeholder="Ex: Certificado de Autorização SPA/MF nº 01.012345/2026"
                    className="w-full bg-stone-950 border border-stone-800 rounded-lg px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#D3AE55]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-amber-300 mb-1">
                    Resumo do Regulamento Oficial
                  </label>
                  <textarea
                    rows={2}
                    value={regulationsSummary}
                    onChange={(e) => setRegulationsSummary(e.target.value)}
                    placeholder="Resumo das regras registradas perante a Secretaria de Prêmios e Apostas..."
                    className="w-full bg-stone-950 border border-stone-800 rounded-lg px-3.5 py-2 text-xs text-white focus:outline-none focus:border-[#D3AE55]"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Botões de Ação */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-4 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={handleSimulatePreview}
            disabled={calculatingPreview || saving}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 font-semibold text-xs sm:text-sm border border-white/[0.1] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {calculatingPreview ? (
              <span>Calculando Simulação...</span>
            ) : (
              <>
                <svg className="w-4 h-4 text-[#E8C76E] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>Simular e Abrir Campanha</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <Link
              href="/admin/marketing/sorteios"
              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-zinc-400 hover:text-white text-xs sm:text-sm font-medium transition-colors text-center"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              disabled={saving || calculatingPreview}
              className="flex-1 sm:flex-initial px-5 sm:px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#D3AE55] to-[#B8933A] text-stone-950 font-bold text-xs sm:text-sm shadow-[0_4px_20px_rgba(211,174,85,0.25)] hover:brightness-110 transition-all cursor-pointer disabled:opacity-50 text-center"
            >
              {saving ? "Salvando..." : "Salvar Campanha"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
