"use client";

import React, { useState, useEffect, useCallback, useRef, useTransition } from "react";
import { FinancialNav } from "@/components/admin/financial/FinancialNav";
import {
  fetchManagementReport,
  fetchMonthlyManagementReport,
  ManagementReport,
  ManagementReportRow,
  MonthlyManagementReport,
  MonthlyManagementReportRow,
} from "@/lib/financial/management-report-client";
import {
  LeafCategoryOption,
  flattenLeafCategories,
  formatCurrencyBRL,
} from "@/lib/financial/accounts-client";
import type { CategoryNode } from "@/lib/financial/categories";
import { todayIsoBR } from "@/lib/time-utils";

type PresetPeriod = "CURRENT_MONTH" | "PREVIOUS_MONTH" | "CURRENT_YEAR" | "CUSTOM";
type ViewMode = "CONSOLIDATED" | "MONTHLY";

export default function RelatorioGerencialPage() {
  const [leafCategories, setLeafCategories] = useState<LeafCategoryOption[]>([]);

  // Navigation: Consolidated vs Monthly
  const [viewMode, setViewMode] = useState<ViewMode>("CONSOLIDATED");

  // Filter States - Consolidated
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

  // Filter States - Monthly
  const [monthlyEndMonth, setMonthlyEndMonth] = useState(() => {
    const today = todayIsoBR();
    return today.slice(0, 7);
  });
  const [monthlyCount, setMonthlyCount] = useState<3 | 6 | 12>(3);

  // Shared Filter State
  const [categoryId, setCategoryId] = useState("");

  // Client-Side Presentation Toggles for Monthly View (Zero backend requests)
  const [showDetails, setShowDetails] = useState(false);
  const [realizedOnly, setRealizedOnly] = useState(false);

  // Report & Query States - Consolidated
  const [report, setReport] = useState<ManagementReport | null>(null);
  const [isLoadingConsolidated, setIsLoadingConsolidated] = useState(true);
  const [errorConsolidated, setErrorConsolidated] = useState<string | null>(null);
  const [isForbiddenConsolidated, setIsForbiddenConsolidated] = useState(false);
  const [consolidatedReloadKey, setConsolidatedReloadKey] = useState(0);

  // Report & Query States - Monthly
  const [monthlyReport, setMonthlyReport] = useState<MonthlyManagementReport | null>(null);
  const [isLoadingMonthly, setIsLoadingMonthly] = useState(false);
  const [errorMonthly, setErrorMonthly] = useState<string | null>(null);
  const [isForbiddenMonthly, setIsForbiddenMonthly] = useState(false);
  const [monthlyReloadKey, setMonthlyReloadKey] = useState(0);

  const consolidatedRequestIdRef = useRef(0);
  const monthlyRequestIdRef = useRef(0);
  const [, startTransition] = useTransition();

  // Helper de cálculo de mês anterior/próximo
  const shiftMonth = (monthKey: string, offset: number): string => {
    const [y, m] = monthKey.split("-").map(Number);
    const total = y * 12 + (m - 1) + offset;
    const newY = Math.floor(total / 12);
    const newM = (total % 12) + 1;
    return `${newY}-${String(newM).padStart(2, "0")}`;
  };

  // Helper de formatação de cabeçalho do mês humano (pt-BR sem timezone shift)
  const formatMonthHeader = (monthKey: string): string => {
    const [yStr, mStr] = monthKey.split("-");
    const m = parseInt(mStr, 10);
    const months = [
      "jan", "fev", "mar", "abr", "mai", "jun",
      "jul", "ago", "set", "out", "nov", "dez",
    ];
    return `${months[m - 1]}/${yStr}`;
  };

  // Presets para consolidado
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

  // Buscar relatório consolidado (com AbortController)
  const loadConsolidatedReport = useCallback(async (signal?: AbortSignal) => {
    if (!startDate || !endDate) return;
    const requestId = ++consolidatedRequestIdRef.current;
    setIsLoadingConsolidated(true);
    setErrorConsolidated(null);
    setIsForbiddenConsolidated(false);

    try {
      const data = await fetchManagementReport(
        {
          startDate,
          endDate,
          categoryId: categoryId || undefined,
        },
        signal
      );
      if (signal?.aborted || requestId !== consolidatedRequestIdRef.current) return;
      setReport(data);
    } catch (err: unknown) {
      if (
        signal?.aborted ||
        requestId !== consolidatedRequestIdRef.current ||
        (err as Error)?.name === "AbortError"
      ) return;
      if ((err as { status?: number })?.status === 403) {
        setIsForbiddenConsolidated(true);
      } else {
        setErrorConsolidated(err instanceof Error ? err.message : "Erro ao carregar relatório gerencial.");
      }
    } finally {
      if (!signal?.aborted && requestId === consolidatedRequestIdRef.current) {
        setIsLoadingConsolidated(false);
      }
    }
  }, [startDate, endDate, categoryId]);

  // Buscar relatório mensal (com AbortController)
  const loadMonthlyReport = useCallback(async (signal?: AbortSignal) => {
    if (!monthlyEndMonth) return;
    const requestId = ++monthlyRequestIdRef.current;
    setIsLoadingMonthly(true);
    setErrorMonthly(null);
    setIsForbiddenMonthly(false);

    try {
      const data = await fetchMonthlyManagementReport(
        {
          endMonth: monthlyEndMonth,
          count: monthlyCount,
          categoryId: categoryId || undefined,
        },
        signal
      );
      if (signal?.aborted || requestId !== monthlyRequestIdRef.current) return;
      setMonthlyReport(data);
    } catch (err: unknown) {
      if (
        signal?.aborted ||
        requestId !== monthlyRequestIdRef.current ||
        (err as Error)?.name === "AbortError"
      ) return;
      if ((err as { status?: number })?.status === 403) {
        setIsForbiddenMonthly(true);
      } else {
        setErrorMonthly(err instanceof Error ? err.message : "Erro ao carregar relatório mensal.");
      }
    } finally {
      if (!signal?.aborted && requestId === monthlyRequestIdRef.current) {
        setIsLoadingMonthly(false);
      }
    }
  }, [monthlyEndMonth, monthlyCount, categoryId]);

  // Effect para Consolidado
  useEffect(() => {
    if (viewMode !== "CONSOLIDATED") return;
    const controller = new AbortController();
    startTransition(() => {
      void loadConsolidatedReport(controller.signal);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, startDate, endDate, categoryId, consolidatedReloadKey]);

  // Effect para Mensal
  useEffect(() => {
    if (viewMode !== "MONTHLY") return;
    const controller = new AbortController();
    startTransition(() => {
      void loadMonthlyReport(controller.signal);
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, monthlyEndMonth, monthlyCount, categoryId, monthlyReloadKey]);

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

  // Renderizadores da visão consolidada
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

  // Renderizadores da visão mensal comparativa
  const renderMonthlyRow = (row: MonthlyManagementReportRow, months: { key: string }[]) => {
    const isParent = !row.isLeaf && row.children && row.children.length > 0;
    const paddingLeft = `${(row.depth - 1) * 1.25}rem`;

    return (
      <tr
        key={row.id}
        className={`hover:bg-zinc-800/20 font-mono transition-colors ${
          isParent ? "font-semibold text-white bg-zinc-950/40" : "text-zinc-300"
        }`}
      >
        <td className="py-2 px-3 text-zinc-500 whitespace-nowrap sticky left-0 w-24 min-w-24 max-w-24 bg-zinc-900 z-10">
          {row.code}
        </td>
        <td
          className="py-2 px-3 font-sans whitespace-nowrap sticky left-24 min-w-[200px] bg-zinc-900 z-10"
          style={{ paddingLeft }}
        >
          {row.name}
        </td>
        {months.map((m) => {
          const cell = row.valuesByMonth[m.key] || {
            expected: "0.00",
            realized: "0.00",
            avPercent: null,
            ahPercent: null,
          };
          return (
            <React.Fragment key={m.key}>
              {!realizedOnly && (
                <td className="py-2 px-2.5 text-right text-zinc-400 whitespace-nowrap">
                  {formatCurrencyBRL(cell.expected)}
                </td>
              )}
              <td className="py-2 px-2.5 text-right text-white font-medium whitespace-nowrap">
                {formatCurrencyBRL(cell.realized)}
              </td>
              <td className="py-2 px-2 text-right text-zinc-400 whitespace-nowrap text-[11px]">
                {renderPercent(cell.avPercent)}
              </td>
              <td className="py-2 px-2 text-right text-zinc-400 whitespace-nowrap text-[11px] border-r border-zinc-800/80">
                {renderPercent(cell.ahPercent)}
              </td>
            </React.Fragment>
          );
        })}
      </tr>
    );
  };

  const renderMonthlySectionRows = (
    rows: MonthlyManagementReportRow[],
    months: { key: string }[]
  ) => {
    const list: React.ReactNode[] = [];
    function traverse(r: MonthlyManagementReportRow) {
      list.push(renderMonthlyRow(r, months));
      if (showDetails && r.children && r.children.length > 0) {
        r.children.forEach(traverse);
      }
    }
    rows.forEach(traverse);
    return list;
  };

  const currentIsForbidden = viewMode === "CONSOLIDATED" ? isForbiddenConsolidated : isForbiddenMonthly;
  const currentError = viewMode === "CONSOLIDATED" ? errorConsolidated : errorMonthly;
  const currentRetry = viewMode === "CONSOLIDATED"
    ? () => setConsolidatedReloadKey((key) => key + 1)
    : () => setMonthlyReloadKey((key) => key + 1);
  const currentLoading = viewMode === "CONSOLIDATED" ? isLoadingConsolidated : isLoadingMonthly;

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

        {/* View Switcher: Consolidado vs Comparativo mensal */}
        <div className="inline-flex rounded-xl bg-zinc-950 p-1 border border-zinc-800 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode("CONSOLIDATED")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === "CONSOLIDATED"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            Consolidado
          </button>
          <button
            type="button"
            onClick={() => setViewMode("MONTHLY")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              viewMode === "MONTHLY"
                ? "bg-zinc-800 text-white shadow-sm"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            Comparativo mensal
          </button>
        </div>
      </div>

      {/* Alerta de Acesso Negado */}
      {currentIsForbidden && (
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
      {currentError && !currentIsForbidden && (
        <div
          role="alert"
          className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4 text-rose-400 text-sm flex items-center justify-between"
        >
          <div>{currentError}</div>
          <button
            onClick={currentRetry}
            className="px-3 py-1.5 text-xs bg-rose-900/40 hover:bg-rose-900/60 rounded-lg text-rose-200"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* FILTROS: VISÃO CONSOLIDADA */}
      {/* ==================================================================== */}
      {viewMode === "CONSOLIDATED" && (
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
      )}

      {/* ==================================================================== */}
      {/* FILTROS & CONTROLES: VISÃO MENSAL COMPARATIVA */}
      {/* ==================================================================== */}
      {viewMode === "MONTHLY" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Controles de Janela / Navegação */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mr-1">
                Janela:
              </span>
              <button
                type="button"
                onClick={() => setMonthlyCount(3)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  monthlyCount === 3
                    ? "bg-zinc-100 text-zinc-950"
                    : "bg-zinc-800 text-zinc-400 hover:text-white"
                }`}
              >
                3 meses
              </button>
              <button
                type="button"
                onClick={() => setMonthlyCount(6)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  monthlyCount === 6
                    ? "bg-zinc-100 text-zinc-950"
                    : "bg-zinc-800 text-zinc-400 hover:text-white"
                }`}
              >
                6 meses
              </button>
              <button
                type="button"
                onClick={() => setMonthlyCount(12)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  monthlyCount === 12
                    ? "bg-zinc-100 text-zinc-950"
                    : "bg-zinc-800 text-zinc-400 hover:text-white"
                }`}
              >
                12 meses
              </button>

              <div className="h-4 w-px bg-zinc-800 mx-1 hidden sm:block" />

              {/* Setas de navegação de mês */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Mês anterior"
                  aria-label="Mês anterior"
                  onClick={() => setMonthlyEndMonth(shiftMonth(monthlyEndMonth, -1))}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition"
                >
                  ‹
                </button>
                <span className="px-2 font-mono text-xs text-white">
                  {formatMonthHeader(monthlyEndMonth)}
                </span>
                <button
                  type="button"
                  title="Mês seguinte"
                  aria-label="Mês seguinte"
                  onClick={() => setMonthlyEndMonth(shiftMonth(monthlyEndMonth, 1))}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition"
                >
                  ›
                </button>
                <button
                  type="button"
                  onClick={() => setMonthlyEndMonth(todayIsoBR().slice(0, 7))}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition ml-1"
                >
                  Mês atual
                </button>
              </div>
            </div>

            {/* Toggles de Apresentação Client-Side */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-300 pt-2 sm:pt-0">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showDetails}
                  onChange={(e) => setShowDetails(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-amber-500 focus:ring-amber-500 focus:ring-offset-zinc-900"
                />
                <span>Exibir detalhes</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={realizedOnly}
                  onChange={(e) => setRealizedOnly(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-amber-500 focus:ring-amber-500 focus:ring-offset-zinc-900"
                />
                <span>Ver apenas realizado</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-3 border-t border-zinc-800/60 items-end">
            <div>
              <label htmlFor="endMonthSelect" className="block text-xs font-medium text-zinc-400 mb-1">
                Mês de Fechamento (endMonth)
              </label>
              <input
                id="endMonthSelect"
                type="month"
                value={monthlyEndMonth}
                onChange={(e) => setMonthlyEndMonth(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600 font-mono"
              />
            </div>

            <div>
              <label htmlFor="monthlyCategoryFilter" className="block text-xs font-medium text-zinc-400 mb-1">
                Filtrar por Categoria
              </label>
              <select
                id="monthlyCategoryFilter"
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

            <div className="text-[11px] text-zinc-500 leading-tight">
              <span>Esperado = realizado + valores ainda previstos no período.</span>
              <br />
              <span>AV = participação sobre a receita realizada do mês.</span>
              <br />
              <span>AH = variação em relação ao mês anterior.</span>
            </div>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {currentLoading && (
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-zinc-900/60 rounded-xl border border-zinc-800" />
            ))}
          </div>
          <div className="h-96 bg-zinc-900/60 rounded-xl border border-zinc-800" />
        </div>
      )}

      {/* ==================================================================== */}
      {/* CONTEÚDO DO RELATÓRIO: VISÃO CONSOLIDADA */}
      {/* ==================================================================== */}
      {!currentLoading && viewMode === "CONSOLIDATED" && report && (
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

      {/* ==================================================================== */}
      {/* CONTEÚDO DO RELATÓRIO: VISÃO MENSAL COMPARATIVA */}
      {/* ==================================================================== */}
      {!currentLoading && viewMode === "MONTHLY" && monthlyReport && (
        <div className="space-y-6">
          {/* Banner de Qualidade de Dados */}
          {monthlyReport.dataQuality.hasResidualsOrUnclassified && (
            <div className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 text-amber-300 text-xs space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <span>Atenção: Qualidade dos Dados</span>
              </div>
              <p className="text-amber-400/90">
                Foram identificados lançamentos sem alocação ou resíduos de rateio na janela exibida ({monthlyReport.period.startMonth} a {monthlyReport.period.endMonth}). Esses valores são mantidos fora da estrutura principal do relatório.
              </p>
              <div className="flex flex-wrap gap-4 pt-1 font-mono text-[11px] text-amber-300">
                {monthlyReport.dataQuality.unclassifiedEntriesCount > 0 && (
                  <span>
                    Não categorizados: {monthlyReport.dataQuality.unclassifiedEntriesCount} (
                    {formatCurrencyBRL(monthlyReport.dataQuality.unclassifiedEntriesAmount)})
                  </span>
                )}
                {monthlyReport.dataQuality.allocationResidualsCount > 0 && (
                  <span>
                    Resíduos de rateio: {monthlyReport.dataQuality.allocationResidualsCount} (
                    {formatCurrencyBRL(monthlyReport.dataQuality.allocationResidualsAmount)})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Tabela Comparativa Mensal Horizontalmente Scrollável */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Comparativo Mensal</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Evolução mensal com Análise Vertical (AV) sobre a receita de cada mês e Análise Horizontal (AH) em relação ao mês anterior (primeiro mês comparado a {formatMonthHeader(monthlyReport.period.previousMonth)}).
              </p>
            </div>

            <div className="overflow-x-auto border border-zinc-800/60 rounded-lg">
              <table className="min-w-full text-left text-xs border-collapse">
                <thead className="bg-zinc-950 text-zinc-400 border-b border-zinc-800">
                  {/* Linha 1 do Header: Meses Agrupados */}
                  <tr>
                    <th className="py-2.5 px-3 font-semibold sticky left-0 w-24 min-w-24 max-w-24 bg-zinc-950 z-20 border-r border-zinc-800">
                      Código
                    </th>
                    <th className="py-2.5 px-3 font-semibold sticky left-24 bg-zinc-950 z-20 border-r border-zinc-800 min-w-[200px]">
                      Estrutura de Contas
                    </th>
                    {monthlyReport.months.map((m) => (
                      <th
                        key={m.key}
                        colSpan={realizedOnly ? 3 : 4}
                        className="py-2 px-3 text-center font-bold text-white uppercase tracking-wider border-r border-zinc-800 bg-zinc-950/80"
                      >
                        {formatMonthHeader(m.key)}
                      </th>
                    ))}
                  </tr>

                  {/* Linha 2 do Header: Subcolunas E / R / AV / AH */}
                  <tr className="border-t border-zinc-800/60 text-[11px] bg-zinc-950/40 text-zinc-500">
                    <th className="py-1 px-3 sticky left-0 w-24 min-w-24 max-w-24 bg-zinc-950 z-20 border-r border-zinc-800">—</th>
                    <th className="py-1 px-3 sticky left-24 min-w-[200px] bg-zinc-950 z-20 border-r border-zinc-800">—</th>
                    {monthlyReport.months.map((m) => (
                      <React.Fragment key={m.key}>
                        {!realizedOnly && (
                          <th className="py-1.5 px-2.5 text-right font-medium">Esperado</th>
                        )}
                        <th className="py-1.5 px-2.5 text-right font-semibold text-zinc-300">Realizado</th>
                        <th className="py-1.5 px-2 text-right font-medium">AV</th>
                        <th className="py-1.5 px-2 text-right font-medium border-r border-zinc-800">AH</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-zinc-800/40">
                  {/* SEÇÃO 1: RECEITAS */}
                  {monthlyReport.sections.revenue.length > 0 &&
                    renderMonthlySectionRows(monthlyReport.sections.revenue, monthlyReport.months)}

                  {/* SEÇÃO 2: CUSTOS VARIÁVEIS */}
                  {monthlyReport.sections.variableCost.length > 0 &&
                    renderMonthlySectionRows(monthlyReport.sections.variableCost, monthlyReport.months)}

                  {/* SUBTOTAL CALCULADO: MARGEM DE CONTRIBUIÇÃO */}
                  <tr className="bg-zinc-950/90 font-bold border-y border-zinc-700/60 text-amber-300">
                    <td className="py-2.5 px-3 sticky left-0 w-24 min-w-24 max-w-24 bg-zinc-950 z-10">—</td>
                    <td className="py-2.5 px-3 font-sans sticky left-24 min-w-[200px] bg-zinc-950 z-10 whitespace-nowrap">
                      (=) MARGEM DE CONTRIBUIÇÃO
                    </td>
                    {monthlyReport.months.map((m) => {
                      const k = monthlyReport.kpisByMonth[m.key];
                      return (
                        <React.Fragment key={m.key}>
                          {!realizedOnly && (
                            <td className="py-2.5 px-2.5 text-right font-mono">
                              {k ? formatCurrencyBRL(k.marginExpected) : "—"}
                            </td>
                          )}
                          <td className="py-2.5 px-2.5 text-right font-mono text-white">
                            {k ? formatCurrencyBRL(k.marginRealized) : "—"}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-[11px]">
                            {k ? renderPercent(k.marginAVPercent) : "—"}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-[11px] border-r border-zinc-800">
                            {k ? renderPercent(k.marginAHPercent) : "—"}
                          </td>
                        </React.Fragment>
                      );
                    })}
                  </tr>

                  {/* SEÇÃO 3: DESPESAS FIXAS */}
                  {monthlyReport.sections.fixedExpense.length > 0 &&
                    renderMonthlySectionRows(monthlyReport.sections.fixedExpense, monthlyReport.months)}

                  {/* SUBTOTAL CALCULADO: RESULTADO ANTES DOS INVESTIMENTOS */}
                  <tr className="bg-zinc-950/90 font-semibold border-y border-zinc-800 text-zinc-200">
                    <td className="py-2.5 px-3 sticky left-0 w-24 min-w-24 max-w-24 bg-zinc-950 z-10">—</td>
                    <td className="py-2.5 px-3 font-sans sticky left-24 min-w-[200px] bg-zinc-950 z-10 whitespace-nowrap">
                      (=) RESULTADO ANTES DOS INVESTIMENTOS
                    </td>
                    {monthlyReport.months.map((m) => {
                      const k = monthlyReport.kpisByMonth[m.key];
                      return (
                        <React.Fragment key={m.key}>
                          {!realizedOnly && (
                            <td className="py-2.5 px-2.5 text-right font-mono">
                              {k ? formatCurrencyBRL(k.resultBeforeInvestmentsExpected) : "—"}
                            </td>
                          )}
                          <td className="py-2.5 px-2.5 text-right font-mono text-white">
                            {k ? formatCurrencyBRL(k.resultBeforeInvestmentsRealized) : "—"}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-[11px]">
                            {k ? renderPercent(k.resultBeforeInvestmentsAVPercent) : "—"}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-[11px] border-r border-zinc-800">
                            {k ? renderPercent(k.resultBeforeInvestmentsAHPercent) : "—"}
                          </td>
                        </React.Fragment>
                      );
                    })}
                  </tr>

                  {/* SEÇÃO 4: INVESTIMENTOS */}
                  {monthlyReport.sections.investment.length > 0 &&
                    renderMonthlySectionRows(monthlyReport.sections.investment, monthlyReport.months)}

                  {/* SUBTOTAL CALCULADO: RESULTADO OPERACIONAL */}
                  <tr className="bg-zinc-950/90 font-bold border-y border-zinc-700/60 text-emerald-400">
                    <td className="py-2.5 px-3 sticky left-0 w-24 min-w-24 max-w-24 bg-zinc-950 z-10">—</td>
                    <td className="py-2.5 px-3 font-sans sticky left-24 min-w-[200px] bg-zinc-950 z-10 whitespace-nowrap">
                      (=) RESULTADO OPERACIONAL
                    </td>
                    {monthlyReport.months.map((m) => {
                      const k = monthlyReport.kpisByMonth[m.key];
                      return (
                        <React.Fragment key={m.key}>
                          {!realizedOnly && (
                            <td className="py-2.5 px-2.5 text-right font-mono">
                              {k ? formatCurrencyBRL(k.operatingResultExpected) : "—"}
                            </td>
                          )}
                          <td className="py-2.5 px-2.5 text-right font-mono text-white">
                            {k ? formatCurrencyBRL(k.operatingResultRealized) : "—"}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-[11px]">
                            {k ? renderPercent(k.operatingResultAVPercent) : "—"}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono text-[11px] border-r border-zinc-800">
                            {k ? renderPercent(k.operatingResultAHPercent) : "—"}
                          </td>
                        </React.Fragment>
                      );
                    })}
                  </tr>

                  {/* SEÇÃO 5 & 6: NÃO OPERACIONAIS */}
                  {monthlyReport.sections.nonOperatingIn.length > 0 &&
                    renderMonthlySectionRows(monthlyReport.sections.nonOperatingIn, monthlyReport.months)}
                  {monthlyReport.sections.nonOperatingOut.length > 0 &&
                    renderMonthlySectionRows(monthlyReport.sections.nonOperatingOut, monthlyReport.months)}

                  {/* TOTAL FINAL CALCULADO: RESULTADO LÍQUIDO */}
                  <tr className="bg-zinc-900 font-bold border-y-2 border-zinc-600 text-amber-300 text-sm">
                    <td className="py-3 px-3 sticky left-0 w-24 min-w-24 max-w-24 bg-zinc-900 z-10">—</td>
                    <td className="py-3 px-3 font-sans sticky left-24 min-w-[200px] bg-zinc-900 z-10 whitespace-nowrap">
                      (=) RESULTADO LÍQUIDO
                    </td>
                    {monthlyReport.months.map((m) => {
                      const k = monthlyReport.kpisByMonth[m.key];
                      return (
                        <React.Fragment key={m.key}>
                          {!realizedOnly && (
                            <td className="py-3 px-2.5 text-right font-mono">
                              {k ? formatCurrencyBRL(k.netResultExpected) : "—"}
                            </td>
                          )}
                          <td className="py-3 px-2.5 text-right font-mono text-white">
                            {k ? formatCurrencyBRL(k.netResultRealized) : "—"}
                          </td>
                          <td className="py-3 px-2 text-right font-mono text-[11px]">
                            {k ? renderPercent(k.netResultAVPercent) : "—"}
                          </td>
                          <td className="py-3 px-2 text-right font-mono text-[11px] border-r border-zinc-800">
                            {k ? renderPercent(k.netResultAHPercent) : "—"}
                          </td>
                        </React.Fragment>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
