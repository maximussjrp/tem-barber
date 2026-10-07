"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { FinancialNav } from "@/components/admin/financial/FinancialNav";
import {
  fetchCashFlowReport,
  CashFlowReport,
} from "@/lib/financial/cash-flow-client";
import {
  LeafCategoryOption,
  flattenLeafCategories,
  formatCurrencyBRL,
} from "@/lib/financial/accounts-client";
import type { CategoryNode } from "@/lib/financial/categories";
import { todayIsoBR, shiftDateISO } from "@/lib/time-utils";

type PresetPeriod = "CURRENT_MONTH" | "NEXT_30" | "NEXT_60" | "NEXT_90" | "CUSTOM";

export default function FluxoCaixaPage() {
  const [leafCategories, setLeafCategories] = useState<LeafCategoryOption[]>([]);

  // Filter States
  const [preset, setPreset] = useState<PresetPeriod>("CURRENT_MONTH");
  const [startDate, setStartDate] = useState(() => {
    const today = todayIsoBR();
    const [y, m] = today.split("-").map(Number);
    return `${y}-${String(m).padStart(2, "0")}-01`;
  });
  const [endDate, setEndDate] = useState(() => {
    const today = todayIsoBR();
    const [y, m] = today.split("-").map(Number);
    const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(lastDayNum).padStart(2, "0")}`;
  });
  const [categoryId, setCategoryId] = useState("");
  const [direction, setDirection] = useState<"" | "IN" | "OUT">("");

  // Report & Query States
  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);
  const [, startTransition] = useTransition();

  // Inicializar datas com base no preset
  const applyPresetDates = useCallback((selectedPreset: PresetPeriod) => {
    const today = todayIsoBR();
    const [y, m] = today.split("-").map(Number);

    if (selectedPreset === "CURRENT_MONTH") {
      const firstDay = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const lastDay = `${y}-${String(m).padStart(2, "0")}-${String(lastDayNum).padStart(2, "0")}`;
      setStartDate(firstDay);
      setEndDate(lastDay);
    } else if (selectedPreset === "NEXT_30") {
      setStartDate(today);
      setEndDate(shiftDateISO(today, 30));
    } else if (selectedPreset === "NEXT_60") {
      setStartDate(today);
      setEndDate(shiftDateISO(today, 60));
    } else if (selectedPreset === "NEXT_90") {
      setStartDate(today);
      setEndDate(shiftDateISO(today, 90));
    }
  }, []);

  // Carregar categorias folha para filtro
  useEffect(() => {
    async function loadCategories() {
      try {
        const res = await fetch("/api/admin/financial/categories?format=tree");
        if (res.ok) {
          const tree: CategoryNode[] = await res.json();
          setLeafCategories(flattenLeafCategories(tree));
        }
      } catch (e) {
        console.error("Erro ao carregar categorias:", e);
      }
    }
    loadCategories();
  }, []);

  // Buscar relatório
  const loadReport = useCallback(async () => {
    if (!startDate || !endDate) return;
    setIsLoading(true);
    setError(null);
    setIsForbidden(false);

    try {
      const data = await fetchCashFlowReport({
        startDate,
        endDate,
        categoryId: categoryId || undefined,
        direction: (direction as "IN" | "OUT") || undefined,
      });
      setReport(data);
    } catch (err: unknown) {
      if ((err as { status?: number })?.status === 403) {
        setIsForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : "Erro ao carregar fluxo de caixa.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, categoryId, direction]);

  useEffect(() => {
    if (startDate && endDate) {
      startTransition(() => {
        loadReport();
      });
    }
  }, [startDate, endDate, categoryId, direction, loadReport]);

  const handlePresetChange = (newPreset: PresetPeriod) => {
    setPreset(newPreset);
    if (newPreset !== "CUSTOM") {
      applyPresetDates(newPreset);
    }
  };

  const parseNumber = (val: string | undefined): number => {
    if (!val) return 0;
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  };

  return (
    <div className="space-y-6">
      <FinancialNav />

      {/* Header & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Fluxo de Caixa e Projeção
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Visão operacional realizada e projetada baseada estritamente nas obrigações e direitos canônicos da barbearia.
          </p>
        </div>
      </div>

      {/* Aviso de Rotinas Variáveis sem Base */}
      {report && report.forecastMeta.unprojectableRoutineCount > 0 && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300 flex items-start gap-3"
        >
          <span className="text-lg">⚠️</span>
          <div>
            <p className="font-semibold">Recorrências variáveis sem valor base</p>
            <p className="text-amber-200/80 mt-0.5">
              Há {report.forecastMeta.unprojectableRoutineCount} recorrência(s) variável(is) sem valor base e, por isso, elas não entram na projeção.
            </p>
          </div>
        </div>
      )}

      {/* 403 Forbidden State */}
      {isForbidden && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-center text-red-400"
        >
          <p className="font-semibold text-lg">Acesso Restrito</p>
          <p className="text-sm mt-1 text-red-300">
            Você não possui permissão para visualizar o fluxo de caixa desta barbearia.
          </p>
        </div>
      )}

      {/* Error State */}
      {error && !isForbidden && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm text-rose-300 flex items-center justify-between"
        >
          <span>{error}</span>
          <button
            onClick={() => loadReport()}
            className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-medium transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Filtros */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-4">
        {/* Presets */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-zinc-400 mr-1 uppercase tracking-wider">
            Período:
          </span>
          {[
            { id: "CURRENT_MONTH", label: "Este mês" },
            { id: "NEXT_30", label: "Próximos 30 dias" },
            { id: "NEXT_60", label: "Próximos 60 dias" },
            { id: "NEXT_90", label: "Próximos 90 dias" },
            { id: "CUSTOM", label: "Personalizado" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handlePresetChange(item.id as PresetPeriod)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                preset === item.id
                  ? "bg-amber-500 text-zinc-950 font-semibold shadow-sm"
                  : "bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700 hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Inputs de data, categoria e direção */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-zinc-800/50">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Data inicial
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPreset("CUSTOM");
              }}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Data final
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPreset("CUSTOM");
              }}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Categoria
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="">Todas as categorias</option>
              {leafCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Direção
            </label>
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "" | "IN" | "OUT")}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value="">Entradas e Saídas</option>
              <option value="IN">Apenas Entradas</option>
              <option value="OUT">Apenas Saídas</option>
            </select>
          </div>
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
          <div className="h-32 bg-zinc-800/40 rounded-xl" />
          <div className="h-32 bg-zinc-800/40 rounded-xl" />
          <div className="h-32 bg-zinc-800/40 rounded-xl" />
        </div>
      )}

      {/* Conteúdo Principal do Fluxo de Caixa */}
      {!isLoading && !isForbidden && report && (
        <div className="space-y-6">
          {/* CARDS DE RESUMO (Realizado, Projetado, Resultado Esperado) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card Realizado */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Realizado no período
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  Operacional
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold text-white tracking-tight">
                  {formatCurrencyBRL(report.realized.net)}
                </p>
                <p className="text-xs text-zinc-400 mt-1">Resultado realizado</p>
              </div>
              <div className="pt-3 border-t border-zinc-800/60 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-zinc-500 block">Entradas:</span>
                  <span className="text-emerald-400 font-medium">
                    + {formatCurrencyBRL(report.realized.inflow)}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Saídas:</span>
                  <span className="text-rose-400 font-medium">
                    - {formatCurrencyBRL(report.realized.outflow)}
                  </span>
                </div>
              </div>
            </div>

            {/* Card Projetado */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Projetado no período
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Datado
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold text-white tracking-tight">
                  {formatCurrencyBRL(report.projected.net)}
                </p>
                <p className="text-xs text-zinc-400 mt-1">Resultado projetado</p>
              </div>
              <div className="pt-3 border-t border-zinc-800/60 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-zinc-500 block">A receber:</span>
                  <span className="text-emerald-400 font-medium">
                    + {formatCurrencyBRL(report.projected.receivable)}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 block">A pagar:</span>
                  <span className="text-rose-400 font-medium">
                    - {formatCurrencyBRL(report.projected.payable)}
                  </span>
                </div>
              </div>
            </div>

            {/* Card Resultado Esperado */}
            <div className="rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-zinc-900/60 to-zinc-900/60 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                  Resultado Geral
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                  Realizado + Projetado
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold text-white tracking-tight">
                  {formatCurrencyBRL(report.expectedPeriodNet)}
                </p>
                <p className="text-xs font-medium text-amber-200/80 mt-1">
                  Resultado esperado no período
                </p>
              </div>
              <div className="pt-3 border-t border-amber-500/20 text-xs text-zinc-400 leading-relaxed">
                Variação líquida acumulada no período considerando fatos realizados e obrigações datadas.
              </div>
            </div>
          </div>

          {/* VENCIDOS E VALORES SEM VENCIMENTO DEFINIDO */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Vencidos */}
            <div className="rounded-xl border border-red-500/20 bg-zinc-900/60 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Vencidos</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Contas com vencimento anterior à data de hoje ainda em aberto.
                  </p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 font-semibold">
                  Atenção
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80">
                  <span className="text-xs text-zinc-400 block">A receber vencido</span>
                  <span className="text-base font-bold text-emerald-400 block mt-1">
                    + {formatCurrencyBRL(report.overdue.receivable)}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80">
                  <span className="text-xs text-zinc-400 block">A pagar vencido</span>
                  <span className="text-base font-bold text-rose-400 block mt-1">
                    - {formatCurrencyBRL(report.overdue.payable)}
                  </span>
                </div>
              </div>
            </div>

            {/* Valores sem Vencimento Definido */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    Valores sem vencimento definido
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Obrigações e direitos pendentes não datados no calendário.
                  </p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                  Paralelo
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-xs">
                <div className="p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-500 block truncate">Recebíveis de clientes</span>
                  <span className="text-sm font-semibold text-emerald-400 block mt-1">
                    {formatCurrencyBRL(report.undated.customerReceivables)}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-500 block truncate">Comissões a pagar</span>
                  <span className="text-sm font-semibold text-rose-400 block mt-1">
                    {formatCurrencyBRL(report.undated.commissionPayables)}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-500 block truncate">Gorjetas a repassar</span>
                  <span className="text-sm font-semibold text-rose-400 block mt-1">
                    {formatCurrencyBRL(report.undated.tipPayables)}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-500 block truncate">Repasses Clube (aprovados)</span>
                  <span className="text-sm font-semibold text-rose-400 block mt-1">
                    {formatCurrencyBRL(report.undated.clubApprovedPayables)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* SÉRIE DIÁRIA / EVOLUÇÃO NO PERÍODO */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Realizado x Projetado por Data
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Movimentação diária de liquidez e previsões de vencimento no período selecionado.
                </p>
              </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="py-2.5 px-3 font-semibold">Data</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Realizado Entradas</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Realizado Saídas</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Realizado Líquido</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Projetado Entradas</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Projetado Saídas</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Projetado Líquido</th>
                    <th className="py-2.5 px-3 font-semibold text-right text-amber-400">Variação Líquida</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {report.daily.map((d) => (
                    <tr key={d.date} className="hover:bg-zinc-800/20 font-mono">
                      <td className="py-2.5 px-3 text-zinc-300 font-sans">{d.date}</td>
                      <td className="py-2.5 px-3 text-right text-emerald-400">
                        {parseNumber(d.realizedIn) > 0 ? `+ ${formatCurrencyBRL(d.realizedIn)}` : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-rose-400">
                        {parseNumber(d.realizedOut) > 0 ? `- ${formatCurrencyBRL(d.realizedOut)}` : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-zinc-200">
                        {formatCurrencyBRL(d.realizedNet)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-400">
                        {parseNumber(d.projectedIn) > 0 ? `+ ${formatCurrencyBRL(d.projectedIn)}` : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-rose-400">
                        {parseNumber(d.projectedOut) > 0 ? `- ${formatCurrencyBRL(d.projectedOut)}` : "—"}
                      </td>
                      <td className="py-2.5 px-3 text-right text-zinc-200">
                        {formatCurrencyBRL(d.projectedNet)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-amber-300">
                        {formatCurrencyBRL(d.expectedNetDelta)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
              {report.daily
                .filter(
                  (d) =>
                    parseNumber(d.realizedIn) > 0 ||
                    parseNumber(d.realizedOut) > 0 ||
                    parseNumber(d.projectedIn) > 0 ||
                    parseNumber(d.projectedOut) > 0
                )
                .map((d) => (
                  <div
                    key={d.date}
                    className="p-3.5 rounded-lg bg-zinc-950/60 border border-zinc-800 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                      <span className="font-semibold text-white">{d.date}</span>
                      <span className="font-mono text-amber-400 font-semibold">
                        Δ {formatCurrencyBRL(d.expectedNetDelta)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-zinc-400">
                      <div>
                        <span className="text-zinc-500 block">Realizado:</span>
                        <span className="text-white font-mono">{formatCurrencyBRL(d.realizedNet)}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block">Projetado:</span>
                        <span className="text-white font-mono">{formatCurrencyBRL(d.projectedNet)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              {report.daily.every(
                (d) =>
                  parseNumber(d.realizedIn) === 0 &&
                  parseNumber(d.realizedOut) === 0 &&
                  parseNumber(d.projectedIn) === 0 &&
                  parseNumber(d.projectedOut) === 0
              ) && (
                <p className="text-center text-xs text-zinc-500 py-4">
                  Nenhum movimento ou previsão nas datas do período.
                </p>
              )}
            </div>
          </div>

          {/* PRÓXIMOS VENCIMENTOS */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Próximos Vencimentos</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Contas e recorrências com vencimento a partir de hoje.
                </p>
              </div>
              <span className="text-xs font-mono text-zinc-400">
                {report.upcoming.length} item(ns)
              </span>
            </div>

            {report.upcoming.length === 0 ? (
              <p className="text-xs text-zinc-500 py-3">
                Nenhum vencimento futuro datado no horizonte selecionado.
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/50">
                {report.upcoming.map((u) => {
                  const isReceivable = u.kind === "RECEIVABLE";
                  return (
                    <div
                      key={u.id}
                      className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              isReceivable
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            }`}
                          >
                            {isReceivable ? "A Receber" : "A Pagar"}
                          </span>
                          <span className="font-medium text-white truncate max-w-xs sm:max-w-md">
                            {u.title}
                          </span>
                          {u.confidence === "ESTIMATED" && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/20">
                              Estimado
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-zinc-400 text-[11px]">
                          <span>Vencimento: {u.dueOn}</span>
                          <span>•</span>
                          <span>{u.category.name}</span>
                          <span>•</span>
                          <span className="font-mono text-zinc-500">
                            {u.source === "ROUTINE_FORECAST" ? "Recorrência" : "Título"}
                          </span>
                        </div>
                      </div>

                      <div className="text-right sm:self-center font-mono font-semibold">
                        <span className={isReceivable ? "text-emerald-400" : "text-rose-400"}>
                          {isReceivable ? "+ " : "- "}
                          {formatCurrencyBRL(u.amount)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* BREAKDOWN POR CATEGORIA */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Distribuição por Categoria
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Valores realizados e projetados agrupados pelas categorias do plano de contas.
              </p>
            </div>

            {report.categoryBreakdown.length === 0 ? (
              <p className="text-xs text-zinc-500 py-3">
                Nenhum movimento ou previsão categorizada no período.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-400">
                      <th className="py-2.5 px-3 font-semibold">Código</th>
                      <th className="py-2.5 px-3 font-semibold">Categoria</th>
                      <th className="py-2.5 px-3 font-semibold">Classificação</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Realizado Entrada</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Realizado Saída</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Projetado Entrada</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Projetado Saída</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/40">
                    {report.categoryBreakdown.map((cat) => (
                      <tr key={cat.categoryId} className="hover:bg-zinc-800/20 font-mono">
                        <td className="py-2.5 px-3 text-zinc-500">{cat.code}</td>
                        <td className="py-2.5 px-3 text-white font-sans font-medium">
                          {cat.name}
                        </td>
                        <td className="py-2.5 px-3 text-zinc-400 font-sans">
                          {cat.classification}
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-400">
                          {parseNumber(cat.realizedIn) > 0 ? `+ ${formatCurrencyBRL(cat.realizedIn)}` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right text-rose-400">
                          {parseNumber(cat.realizedOut) > 0 ? `- ${formatCurrencyBRL(cat.realizedOut)}` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-400">
                          {parseNumber(cat.projectedIn) > 0 ? `+ ${formatCurrencyBRL(cat.projectedIn)}` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right text-rose-400">
                          {parseNumber(cat.projectedOut) > 0 ? `- ${formatCurrencyBRL(cat.projectedOut)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
