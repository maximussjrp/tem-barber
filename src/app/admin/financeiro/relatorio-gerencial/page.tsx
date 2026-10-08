"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { FinancialNav } from "@/components/admin/financial/FinancialNav";
import {
  fetchManagementReport,
  ManagementReport,
  ManagementReportRow,
} from "@/lib/financial/management-report-client";
import {
  LeafCategoryOption,
  flattenLeafCategories,
  formatCurrencyBRL,
} from "@/lib/financial/accounts-client";
import type { CategoryNode } from "@/lib/financial/categories";
import { todayIsoBR } from "@/lib/time-utils";

type PresetPeriod = "CURRENT_MONTH" | "PREVIOUS_MONTH" | "CURRENT_YEAR" | "CUSTOM";

export default function RelatorioGerencialPage() {
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

  // Report & Query States
  const [report, setReport] = useState<ManagementReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);
  const [, startTransition] = useTransition();

  // Presets
  const applyPresetDates = useCallback((selectedPreset: PresetPeriod) => {
    const today = todayIsoBR();
    const [y, m] = today.split("-").map(Number);

    if (selectedPreset === "CURRENT_MONTH") {
      const firstDay = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const lastDay = `${y}-${String(m).padStart(2, "0")}-${String(lastDayNum).padStart(2, "0")}`;
      setStartDate(firstDay);
      setEndDate(lastDay);
    } else if (selectedPreset === "PREVIOUS_MONTH") {
      let prevY = y;
      let prevM = m - 1;
      if (prevM === 0) {
        prevM = 12;
        prevY -= 1;
      }
      const firstDay = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
      const lastDayNum = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
      const lastDay = `${prevY}-${String(prevM).padStart(2, "0")}-${String(lastDayNum).padStart(2, "0")}`;
      setStartDate(firstDay);
      setEndDate(lastDay);
    } else if (selectedPreset === "CURRENT_YEAR") {
      setStartDate(`${y}-01-01`);
      setEndDate(`${y}-12-31`);
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
      const data = await fetchManagementReport({
        startDate,
        endDate,
        categoryId: categoryId || undefined,
      });
      setReport(data);
    } catch (err: unknown) {
      if ((err as { status?: number })?.status === 403) {
        setIsForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : "Erro ao carregar relatório gerencial.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, categoryId]);

  useEffect(() => {
    if (startDate && endDate) {
      startTransition(() => {
        loadReport();
      });
    }
  }, [startDate, endDate, categoryId, loadReport]);

  const handlePresetClick = (p: PresetPeriod) => {
    setPreset(p);
    if (p !== "CUSTOM") {
      applyPresetDates(p);
    }
  };

  const parseNumber = (val: string) => {
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
  };

  const renderPercent = (val: number | null) => {
    if (val === null || isNaN(val)) return "—";
    const sign = val > 0 ? "+" : "";
    return `${sign}${val.toFixed(1)}%`;
  };

  const renderRow = (row: ManagementReportRow) => {
    const isParent = !row.isLeaf && row.children && row.children.length > 0;
    const paddingLeft = `${(row.depth - 1) * 1.25}rem`;

    return (
      <tr
        key={row.id}
        className={`hover:bg-zinc-800/20 font-mono transition-colors ${
          isParent ? "font-semibold text-white bg-zinc-950/40" : "text-zinc-300"
        }`}
      >
        <td className="py-2.5 px-3 text-zinc-500">{row.code}</td>
        <td className="py-2.5 px-3 font-sans" style={{ paddingLeft }}>
          {row.name}
        </td>
        <td className="py-2.5 px-3 text-right text-zinc-300">
          {formatCurrencyBRL(row.expected)}
        </td>
        <td className="py-2.5 px-3 text-right text-white font-medium">
          {formatCurrencyBRL(row.realized)}
        </td>
        <td className="py-2.5 px-3 text-right text-zinc-400">
          {renderPercent(row.avPercent)}
        </td>
        <td className="py-2.5 px-3 text-right text-zinc-400">
          {renderPercent(row.ahPercent)}
        </td>
      </tr>
    );
  };

  const renderSectionRows = (rows: ManagementReportRow[]) => {
    const list: React.ReactNode[] = [];
    function traverse(r: ManagementReportRow) {
      list.push(renderRow(r));
      if (r.children && r.children.length > 0) {
        r.children.forEach(traverse);
      }
    }
    rows.forEach(traverse);
    return list;
  };

  return (
    <div className="space-y-6">
      <FinancialNav />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Relatório Gerencial
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            Estrutura gerencial com análise vertical, horizontal e comparação com projeções datadas.
          </p>
        </div>
      </div>

      {/* Alerta de Acesso Negado */}
      {isForbidden && (
        <div
          role="alert"
          className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4 text-rose-400 text-sm"
        >
          <div className="font-semibold text-rose-300">Acesso Restrito</div>
          <p className="mt-1">
            Você não possui permissão para visualizar o relatório gerencial.
          </p>
        </div>
      )}

      {/* Alerta de Erro Genérico */}
      {error && !isForbidden && (
        <div
          role="alert"
          className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4 text-rose-400 text-sm flex items-center justify-between"
        >
          <div>{error}</div>
          <button
            onClick={loadReport}
            className="px-3 py-1.5 text-xs bg-rose-900/40 hover:bg-rose-900/60 rounded-lg text-rose-200"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Filtros e Presets */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handlePresetClick("CURRENT_MONTH")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              preset === "CURRENT_MONTH"
                ? "bg-zinc-100 text-zinc-950"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            Este mês
          </button>
          <button
            onClick={() => handlePresetClick("PREVIOUS_MONTH")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              preset === "PREVIOUS_MONTH"
                ? "bg-zinc-100 text-zinc-950"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            Mês anterior
          </button>
          <button
            onClick={() => handlePresetClick("CURRENT_YEAR")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              preset === "CURRENT_YEAR"
                ? "bg-zinc-100 text-zinc-950"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            Ano atual
          </button>
          <button
            onClick={() => handlePresetClick("CUSTOM")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              preset === "CUSTOM"
                ? "bg-zinc-100 text-zinc-950"
                : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            Personalizado
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2 border-t border-zinc-800/60">
          <div>
            <label htmlFor="startDateInput" className="block text-xs font-medium text-zinc-400 mb-1">
              Data Inicial
            </label>
            <input
              id="startDateInput"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPreset("CUSTOM");
              }}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600"
            />
          </div>

          <div>
            <label htmlFor="endDateInput" className="block text-xs font-medium text-zinc-400 mb-1">
              Data Final
            </label>
            <input
              id="endDateInput"
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPreset("CUSTOM");
              }}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Categoria
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600"
            >
              <option value="">Todas as categorias</option>
              {leafCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-zinc-900/60 rounded-xl border border-zinc-800" />
            ))}
          </div>
          <div className="h-96 bg-zinc-900/60 rounded-xl border border-zinc-800" />
        </div>
      )}

      {/* Conteúdo do Relatório */}
      {!isLoading && report && (
        <div className="space-y-6">
          {/* Banner de Qualidade de Dados */}
          {report.dataQuality.hasResidualsOrUnclassified && (
            <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-amber-300 text-xs space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <span>Atenção: Qualidade dos Dados</span>
              </div>
              <p className="text-amber-400/90">
                Foram identificados lançamentos sem alocação ou resíduos de rateio no período. Esses
                valores são mantidos fora da estrutura principal do relatório para não distorcer as margens
                operacionais.
              </p>
              <div className="flex flex-wrap gap-4 pt-1 font-mono text-[11px] text-amber-300">
                {report.dataQuality.unclassifiedEntriesCount > 0 && (
                  <span>
                    Não categorizados: {report.dataQuality.unclassifiedEntriesCount} (
                    {formatCurrencyBRL(report.dataQuality.unclassifiedEntriesAmount)})
                  </span>
                )}
                {report.dataQuality.allocationResidualsCount > 0 && (
                  <span>
                    Resíduos de rateio: {report.dataQuality.allocationResidualsCount} (
                    {formatCurrencyBRL(report.dataQuality.allocationResidualsAmount)})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Cards Resumo / KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Receita */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-1">
              <span className="text-xs text-zinc-400 font-medium">Receita Realizada</span>
              <div className="text-lg sm:text-xl font-bold font-mono text-emerald-400">
                {formatCurrencyBRL(report.kpis.revenueRealized)}
              </div>
              <div className="text-[11px] text-zinc-500 font-mono flex items-center justify-between">
                <span>Esperado: {formatCurrencyBRL(report.kpis.revenueExpected)}</span>
              </div>
            </div>

            {/* Margem */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-1">
              <span className="text-xs text-zinc-400 font-medium">Margem de Contribuição</span>
              <div
                className={`text-lg sm:text-xl font-bold font-mono ${
                  parseNumber(report.kpis.marginRealized) >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {formatCurrencyBRL(report.kpis.marginRealized)}
              </div>
              <div className="text-[11px] text-zinc-500 font-mono flex items-center justify-between">
                <span>AV: {renderPercent(report.kpis.marginAVPercent)}</span>
                <span>AH: {renderPercent(report.kpis.marginAHPercent)}</span>
              </div>
            </div>

            {/* Resultado Operacional */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-1">
              <span className="text-xs text-zinc-400 font-medium">Resultado Operacional</span>
              <div
                className={`text-lg sm:text-xl font-bold font-mono ${
                  parseNumber(report.kpis.operatingResultRealized) >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {formatCurrencyBRL(report.kpis.operatingResultRealized)}
              </div>
              <div className="text-[11px] text-zinc-500 font-mono flex items-center justify-between">
                <span>AV: {renderPercent(report.kpis.operatingResultAVPercent)}</span>
                <span>AH: {renderPercent(report.kpis.operatingResultAHPercent)}</span>
              </div>
            </div>

            {/* Resultado Líquido */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-1">
              <span className="text-xs text-zinc-400 font-medium">Resultado Líquido</span>
              <div
                className={`text-lg sm:text-xl font-bold font-mono ${
                  parseNumber(report.kpis.netResultRealized) >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {formatCurrencyBRL(report.kpis.netResultRealized)}
              </div>
              <div className="text-[11px] text-zinc-500 font-mono flex items-center justify-between">
                <span>AV: {renderPercent(report.kpis.netResultAVPercent)}</span>
                <span>AH: {renderPercent(report.kpis.netResultAHPercent)}</span>
              </div>
            </div>
          </div>

          {/* Estrutura Gerencial */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white">Demonstrativo Gerencial</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Realizado (lançamentos classificados realizados), Esperado (realizado + valores ainda previstos/datados no período), Análise Vertical (% da
                  Receita) e Análise Horizontal (% vs período anterior: {report.period.previousStartDate} a {report.period.previousEndDate}).
                </p>
              </div>
            </div>

            <div className="max-h-[600px] overflow-y-auto overflow-x-auto border border-zinc-800/60 rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-zinc-900 z-10">
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="py-2.5 px-3 font-semibold">Código</th>
                    <th className="py-2.5 px-3 font-semibold">Estrutura de Contas</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Esperado</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Realizado</th>
                    <th className="py-2.5 px-3 font-semibold text-right">AV (%)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">AH (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40">
                  {/* SEÇÃO 1: RECEITAS */}
                  {report.sections.revenue.length > 0 && renderSectionRows(report.sections.revenue)}

                  {/* SEÇÃO 2: CUSTOS VARIÁVEIS */}
                  {report.sections.variableCost.length > 0 && renderSectionRows(report.sections.variableCost)}

                  {/* SUBTOTAL: MARGEM DE CONTRIBUIÇÃO */}
                  <tr className="bg-zinc-950/80 font-bold border-y border-zinc-700/60 text-amber-300">
                    <td className="py-2.5 px-3">—</td>
                    <td className="py-2.5 px-3 font-sans">(=) MARGEM DE CONTRIBUIÇÃO</td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {formatCurrencyBRL(report.kpis.marginExpected)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-white">
                      {formatCurrencyBRL(report.kpis.marginRealized)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {renderPercent(report.kpis.marginAVPercent)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {renderPercent(report.kpis.marginAHPercent)}
                    </td>
                  </tr>

                  {/* SEÇÃO 3: DESPESAS FIXAS */}
                  {report.sections.fixedExpense.length > 0 && renderSectionRows(report.sections.fixedExpense)}

                  {/* SUBTOTAL: RESULTADO ANTES DOS INVESTIMENTOS */}
                  <tr className="bg-zinc-950/80 font-semibold border-y border-zinc-800 text-zinc-200">
                    <td className="py-2.5 px-3">—</td>
                    <td className="py-2.5 px-3 font-sans">(=) RESULTADO ANTES DOS INVESTIMENTOS</td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {formatCurrencyBRL(report.kpis.resultBeforeInvestmentsExpected)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-white">
                      {formatCurrencyBRL(report.kpis.resultBeforeInvestmentsRealized)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">—</td>
                    <td className="py-2.5 px-3 text-right font-mono">—</td>
                  </tr>

                  {/* SEÇÃO 4: INVESTIMENTOS */}
                  {report.sections.investment.length > 0 && renderSectionRows(report.sections.investment)}

                  {/* SUBTOTAL: RESULTADO OPERACIONAL */}
                  <tr className="bg-zinc-950/80 font-bold border-y border-zinc-700/60 text-emerald-400">
                    <td className="py-2.5 px-3">—</td>
                    <td className="py-2.5 px-3 font-sans">(=) RESULTADO OPERACIONAL</td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {formatCurrencyBRL(report.kpis.operatingResultExpected)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-white">
                      {formatCurrencyBRL(report.kpis.operatingResultRealized)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {renderPercent(report.kpis.operatingResultAVPercent)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {renderPercent(report.kpis.operatingResultAHPercent)}
                    </td>
                  </tr>

                  {/* SEÇÃO 5 & 6: NÃO OPERACIONAIS */}
                  {report.sections.nonOperatingIn.length > 0 && renderSectionRows(report.sections.nonOperatingIn)}
                  {report.sections.nonOperatingOut.length > 0 && renderSectionRows(report.sections.nonOperatingOut)}

                  {/* TOTAL FINAL: RESULTADO LÍQUIDO */}
                  <tr className="bg-zinc-900 font-bold border-y-2 border-zinc-600 text-amber-300 text-sm">
                    <td className="py-3 px-3">—</td>
                    <td className="py-3 px-3 font-sans">(=) RESULTADO LÍQUIDO</td>
                    <td className="py-3 px-3 text-right font-mono">
                      {formatCurrencyBRL(report.kpis.netResultExpected)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-white">
                      {formatCurrencyBRL(report.kpis.netResultRealized)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono">
                      {renderPercent(report.kpis.netResultAVPercent)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono">
                      {renderPercent(report.kpis.netResultAHPercent)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* FORA DA ESTRUTURA PRINCIPAL */}
          {(report.outsideResult.transfers.length > 0 ||
            report.outsideResult.adjustments.length > 0 ||
            report.outsideResult.unclassified.length > 0) && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Movimentos Fora do Resultado Econômico
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Transferências entre contas bancárias, ajustes manuais e lançamentos sem categoria.
                </p>
              </div>

              <div className="overflow-x-auto border border-zinc-800/60 rounded-lg">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-400 bg-zinc-950/60">
                      <th className="py-2.5 px-3 font-semibold">Código</th>
                      <th className="py-2.5 px-3 font-semibold">Item</th>
                      <th className="py-2.5 px-3 font-semibold">Natureza</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Realizado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/40 font-mono">
                    {report.outsideResult.transfers.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-800/20">
                        <td className="py-2 px-3 text-zinc-500">{item.code}</td>
                        <td className="py-2 px-3 font-sans text-white">{item.name}</td>
                        <td className="py-2 px-3 font-sans text-zinc-400">Transferência</td>
                        <td className="py-2 px-3 text-right text-zinc-300">
                          {formatCurrencyBRL(item.realized)}
                        </td>
                      </tr>
                    ))}
                    {report.outsideResult.adjustments.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-800/20">
                        <td className="py-2 px-3 text-zinc-500">{item.code}</td>
                        <td className="py-2 px-3 font-sans text-white">{item.name}</td>
                        <td className="py-2 px-3 font-sans text-zinc-400">Ajuste</td>
                        <td className="py-2 px-3 text-right text-zinc-300">
                          {formatCurrencyBRL(item.realized)}
                        </td>
                      </tr>
                    ))}
                    {report.outsideResult.unclassified.map((item) => (
                      <tr key={item.id} className="hover:bg-zinc-800/20">
                        <td className="py-2 px-3 text-zinc-500">{item.code}</td>
                        <td className="py-2 px-3 font-sans text-amber-400 font-medium">
                          {item.name} ({item.count} lançamentos)
                        </td>
                        <td className="py-2 px-3 font-sans text-amber-400/80">Pendente de rateio</td>
                        <td className="py-2 px-3 text-right text-amber-300">
                          {formatCurrencyBRL(item.realized)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
