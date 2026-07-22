"use client";

import { useEffect, useState, useCallback, useTransition } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { formatBRL } from "@/lib/operations/money";

type PaymentMethodItem = {
  method: string;
  amount: number;
  count: number;
};

type TopServiceItem = {
  serviceId: string;
  serviceName: string;
  quantity: number;
  grossRevenue: number;
  netRevenue: number;
};

type TopProfessionalItem = {
  memberId: string;
  name: string;
  serviceCount: number;
  grossRevenue: number;
  netRevenue: number;
  releasedCommissions: number;
};

type FinancialSummaryData = {
  period: {
    startDate: string;
    endDate: string;
    timezone: string;
  };
  totals: {
    grossRevenue: number;
    totalDiscounts: number;
    netRevenue: number;
    totalReceived: number;
    totalReceivable: number;
    totalExpenses: number;
    releasedCommissions: number;
    estimatedCommissions: number;
    operationalResult: number;
  };
  paymentMethods: PaymentMethodItem[];
  topServices: TopServiceItem[];
  topProfessionals: TopProfessionalItem[];
  openCommands: {
    count: number;
    amount: number;
  };
  closedCommands: {
    count: number;
    amount: number;
  };
};

const METHOD_LABELS: Record<string, string> = {
  CASH: "Dinheiro",
  PIX: "Pix",
  DEBIT: "Cartão de Débito",
  CREDIT: "Cartão de Crédito",
  OTHER: "Outros",
};

function formatDateBR(dateStr: string): string {
  if (!dateStr || !dateStr.includes("-")) return dateStr;
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function getPresetDates(preset: string): { startDate: string; endDate: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  const formatDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dayStr = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dayStr}`;
  };

  if (preset === "today") {
    const todayStr = formatDate(now);
    return { startDate: todayStr, endDate: todayStr };
  }

  if (preset === "yesterday") {
    const yest = new Date(year, month, day - 1);
    const yestStr = formatDate(yest);
    return { startDate: yestStr, endDate: yestStr };
  }

  if (preset === "thisWeek") {
    const currentDayOfWeek = now.getDay();
    const diffToMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
    const monday = new Date(year, month, day - diffToMonday);
    return { startDate: formatDate(monday), endDate: formatDate(now) };
  }

  if (preset === "thisMonth") {
    const firstDay = new Date(year, month, 1);
    return { startDate: formatDate(firstDay), endDate: formatDate(now) };
  }

  if (preset === "lastMonth") {
    const firstDayLastMonth = new Date(year, month - 1, 1);
    const lastDayLastMonth = new Date(year, month, 0);
    return { startDate: formatDate(firstDayLastMonth), endDate: formatDate(lastDayLastMonth) };
  }

  return { startDate: formatDate(now), endDate: formatDate(now) };
}

export default function FinanceiroPage() {
  const [, startTransition] = useTransition();

  // Preset & Range State
  const [activePreset, setActivePreset] = useState<string>("thisMonth");
  const [startDate, setStartDate] = useState<string>(() => getPresetDates("thisMonth").startDate);
  const [endDate, setEndDate] = useState<string>(() => getPresetDates("thisMonth").endDate);

  const [data, setData] = useState<FinancialSummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [forbiddenError, setForbiddenError] = useState(false);

  // Manual Movement Dialog (Preserved)
  const [manualDialog, setManualDialog] = useState<{
    isOpen: boolean;
    type: "MANUAL_IN" | "MANUAL_OUT" | null;
    amount: string;
    description: string;
  }>({ isOpen: false, type: null, amount: "", description: "" });
  const [savingManual, setSavingManual] = useState(false);

  const loadData = useCallback(async (sDate: string, eDate: string) => {
    setLoading(true);
    setError("");
    setForbiddenError(false);
    try {
      const res = await fetch(`/api/admin/financial/summary?startDate=${sDate}&endDate=${eDate}`);
      if (res.status === 403) {
        setForbiddenError(true);
        setData(null);
        return;
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        setError(errJson.error || "Não foi possível carregar o financeiro do período.");
        setData(null);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch {
      setError("Não foi possível carregar o financeiro do período.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    startTransition(() => {
      loadData(startDate, endDate);
    });
  }, [startDate, endDate, loadData]);

  function handlePresetClick(presetKey: string) {
    setActivePreset(presetKey);
    if (presetKey !== "custom") {
      const { startDate: s, endDate: e } = getPresetDates(presetKey);
      setStartDate(s);
      setEndDate(e);
    }
  }

  function handleCustomStartDateChange(val: string) {
    setActivePreset("custom");
    setStartDate(val);
  }

  function handleCustomEndDateChange(val: string) {
    setActivePreset("custom");
    setEndDate(val);
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualDialog.type || !manualDialog.amount) return;
    setSavingManual(true);
    try {
      await fetch("/api/admin/financial/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: manualDialog.type,
          amount: manualDialog.amount,
          description: manualDialog.description,
          category: "Manual",
        }),
      });
      await loadData(startDate, endDate);
      setManualDialog({ isOpen: false, type: null, amount: "", description: "" });
    } finally {
      setSavingManual(false);
    }
  }

  function openManual(type: "MANUAL_IN" | "MANUAL_OUT") {
    setManualDialog({
      isOpen: true,
      type,
      amount: "",
      description: type === "MANUAL_IN" ? "Entrada manual" : "Saída manual",
    });
  }

  if (forbiddenError) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">Financeiro</h1>
        <div className="rounded-xl border border-red-500/30 bg-red-950/40 p-6 text-center text-red-200">
          <p className="font-bold text-lg mb-1">Acesso Negado</p>
          <p className="text-sm text-red-300/80">Você não tem permissão para acessar o financeiro.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Manual Entry Dialog (Preserved) */}
      <Dialog
        isOpen={manualDialog.isOpen}
        onClose={() => setManualDialog((prev) => ({ ...prev, isOpen: false }))}
        title={manualDialog.type === "MANUAL_IN" ? "Nova Entrada" : "Nova Saída"}
        className="max-w-md"
      >
        <form onSubmit={handleManualSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Valor (R$)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={manualDialog.amount}
              onChange={(e) => setManualDialog((p) => ({ ...p, amount: e.target.value }))}
              className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)]"
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
              Descrição
            </label>
            <input
              type="text"
              value={manualDialog.description}
              onChange={(e) => setManualDialog((p) => ({ ...p, description: e.target.value }))}
              className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)]"
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={() => setManualDialog((prev) => ({ ...prev, isOpen: false }))}
              disabled={savingManual}
              className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--surface-raised)] transition-colors text-sm font-semibold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingManual}
              className="px-4 py-2 rounded-lg bg-[var(--gold)] text-[var(--text-inverse)] font-bold transition-colors text-sm hover:brightness-110 cursor-pointer"
            >
              Confirmar
            </button>
          </div>
        </form>
      </Dialog>

      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">
            Dashboard Financeiro
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Visão gerencial por período • {formatDateBR(startDate)} até {formatDateBR(endDate)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => openManual("MANUAL_IN")}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-950/40 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-900/40 transition-colors cursor-pointer"
          >
            + Nova Entrada
          </button>
          <button
            onClick={() => openManual("MANUAL_OUT")}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-red-950/40 text-red-400 border border-red-500/20 hover:bg-red-900/40 transition-colors cursor-pointer"
          >
            - Nova Saída
          </button>
          <button
            onClick={() => loadData(startDate, endDate)}
            disabled={loading}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--surface-raised)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--gold)] transition-colors cursor-pointer"
            title="Atualizar dados"
          >
            🔄
          </button>
        </div>
      </div>

      {/* Period Selector Presets & Custom Dates */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mr-1">
            Período:
          </span>
          {[
            { key: "today", label: "Hoje" },
            { key: "yesterday", label: "Ontem" },
            { key: "thisWeek", label: "Esta Semana" },
            { key: "thisMonth", label: "Este Mês" },
            { key: "lastMonth", label: "Mês Passado" },
            { key: "custom", label: "Personalizado" },
          ].map((preset) => (
            <button
              key={preset.key}
              onClick={() => handlePresetClick(preset.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activePreset === preset.key
                  ? "bg-[var(--gold)] text-[var(--text-inverse)] font-bold shadow-sm"
                  : "bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)]"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-muted)] font-medium">De:</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => handleCustomStartDateChange(e.target.value)}
              className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--text-muted)] font-medium">Até:</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => handleCustomEndDateChange(e.target.value)}
              className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
            />
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-200 flex items-center justify-between gap-4">
          <span>⚠️ {error}</span>
          <button
            onClick={() => loadData(startDate, endDate)}
            className="px-3 py-1.5 bg-red-900/60 hover:bg-red-800 text-red-100 rounded-lg text-xs font-bold transition-colors cursor-pointer shrink-0"
          >
            Tentar Novamente
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading ? (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-28 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)] p-4"
              />
            ))}
          </div>
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Main Cards Grid (8 Cards) */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {/* 1. Faturamento Bruto */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Faturamento Bruto
              </p>
              <p className="text-xl font-bold text-[var(--text-primary)] mt-2">
                {formatBRL(data.totals.grossRevenue)}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Antes dos descontos</p>
            </div>

            {/* 2. Descontos */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Descontos
              </p>
              <p className="text-xl font-bold text-amber-400 mt-2">
                {formatBRL(data.totals.totalDiscounts)}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Concedidos no período</p>
            </div>

            {/* 3. Faturamento Líquido */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Faturamento Líquido
              </p>
              <p className="text-xl font-bold text-[var(--gold)] mt-2">
                {formatBRL(data.totals.netRevenue)}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Bruto - Descontos</p>
            </div>

            {/* 4. Total Recebido */}
            <div className="rounded-xl border border-emerald-500/20 bg-[var(--surface)] p-4 shadow-sm">
              <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                Total Recebido
              </p>
              <p className="text-xl font-bold text-emerald-400 mt-2">
                {formatBRL(data.totals.totalReceived)}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Pagamentos confirmados</p>
            </div>

            {/* 5. A Receber */}
            <div className="rounded-xl border border-amber-500/20 bg-[var(--surface)] p-4 shadow-sm">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                A Receber
              </p>
              <p className="text-xl font-bold text-amber-400 mt-2">
                {formatBRL(data.totals.totalReceivable)}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                {data.openCommands.count} comandas abertas
              </p>
            </div>

            {/* 6. Despesas */}
            <div className="rounded-xl border border-red-500/20 bg-[var(--surface)] p-4 shadow-sm">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">
                Despesas (Saídas)
              </p>
              <p className="text-xl font-bold text-red-400 mt-2">
                {formatBRL(data.totals.totalExpenses)}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Lançamentos manuais</p>
            </div>

            {/* 7. Comissões Liberadas */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                Comissões Liberadas
              </p>
              <p className="text-xl font-bold text-[var(--text-primary)] mt-2">
                {formatBRL(data.totals.releasedCommissions)}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Estimadas: {formatBRL(data.totals.estimatedCommissions)}
              </p>
            </div>

            {/* 8. Resultado Operacional (Highlighted) */}
            <div
              className={`rounded-xl border p-4 shadow-lg flex flex-col justify-between transition-all ${
                data.totals.operationalResult >= 0
                  ? "border-[var(--gold-border)] bg-gradient-to-br from-[var(--surface-raised)] to-[var(--surface)]"
                  : "border-red-500/40 bg-red-950/20"
              }`}
            >
              <p
                className={`text-xs font-bold uppercase tracking-wider ${
                  data.totals.operationalResult >= 0 ? "text-[var(--gold)]" : "text-red-400"
                }`}
              >
                Resultado Operacional
              </p>
              <p
                className={`text-2xl font-bold font-serif mt-2 ${
                  data.totals.operationalResult >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {data.totals.operationalResult >= 0 ? "+" : ""}
                {formatBRL(data.totals.operationalResult)}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Recebido - Despesas - Comissões
              </p>
            </div>
          </section>

          {/* Section: Resumo de Comandas & Formas de Pagamento */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Recebimentos por Forma de Pagamento */}
            <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm space-y-4">
              <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest border-b border-[var(--border-subtle)] pb-3">
                Recebimentos por Forma de Pagamento
              </h2>
              {data.paymentMethods.every((pm) => pm.amount === 0) ? (
                <p className="text-sm text-[var(--text-muted)] py-4 text-center">
                  Não há recebimentos no período.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.paymentMethods.map((item) => {
                    const label = METHOD_LABELS[item.method] || item.method;
                    const pct =
                      data.totals.totalReceived > 0
                        ? ((item.amount / data.totals.totalReceived) * 100).toFixed(1)
                        : "0.0";

                    return (
                      <div key={item.method} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-[var(--text-primary)] font-medium">{label}</span>
                          <span className="text-[10px] bg-[var(--surface-raised)] text-[var(--text-muted)] border border-[var(--border-subtle)] px-1.5 py-0.5 rounded-full">
                            {item.count}x
                          </span>
                          {data.totals.totalReceived > 0 && (
                            <span className="text-[10px] bg-emerald-950/40 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-full font-bold">
                              {pct}%
                            </span>
                          )}
                        </div>
                        <span className="font-bold text-[var(--text-primary)]">
                          {formatBRL(item.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Resumo de Comandas */}
            <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm space-y-4">
              <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest border-b border-[var(--border-subtle)] pb-3">
                Status de Comandas no Período
              </h2>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="rounded-lg border border-amber-500/20 bg-[var(--surface-raised)] p-3 space-y-1">
                  <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                    Abertas / A Receber
                  </p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">
                    {data.openCommands.count} <span className="text-xs font-normal text-[var(--text-muted)]">comandas</span>
                  </p>
                  <p className="text-sm font-bold text-amber-400">
                    {formatBRL(data.openCommands.amount)}
                  </p>
                </div>

                <div className="rounded-lg border border-emerald-500/20 bg-[var(--surface-raised)] p-3 space-y-1">
                  <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                    Concluídas no Período
                  </p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">
                    {data.closedCommands.count} <span className="text-xs font-normal text-[var(--text-muted)]">comandas</span>
                  </p>
                  <p className="text-sm font-bold text-emerald-400">
                    {formatBRL(data.closedCommands.amount)}
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* Section: Top Serviços & Top Profissionais */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Top Serviços */}
            <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm space-y-4">
              <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest border-b border-[var(--border-subtle)] pb-3">
                Top Serviços por Receita Líquida
              </h2>
              {data.topServices.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-4 text-center">
                  Nenhum serviço vendido no período.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] uppercase tracking-wider">
                        <th className="py-2 pr-2 font-semibold">Serviço</th>
                        <th className="py-2 px-2 text-center font-semibold">Qtd</th>
                        <th className="py-2 px-2 text-right font-semibold">Bruto</th>
                        <th className="py-2 pl-2 text-right font-semibold">Líquido</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {data.topServices.map((service) => (
                        <tr key={service.serviceId} className="hover:bg-[var(--surface-raised)]/50 transition-colors">
                          <td className="py-2.5 pr-2 font-semibold text-[var(--text-primary)]">
                            {service.serviceName}
                          </td>
                          <td className="py-2.5 px-2 text-center text-[var(--text-secondary)] font-bold">
                            {service.quantity}
                          </td>
                          <td className="py-2.5 px-2 text-right text-[var(--text-muted)]">
                            {formatBRL(service.grossRevenue)}
                          </td>
                          <td className="py-2.5 pl-2 text-right font-bold text-[var(--gold)]">
                            {formatBRL(service.netRevenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Top Profissionais */}
            <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 shadow-sm space-y-4">
              <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest border-b border-[var(--border-subtle)] pb-3">
                Top Profissionais em Faturamento
              </h2>
              {data.topProfessionals.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-4 text-center">
                  Nenhum profissional com vendas no período.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] uppercase tracking-wider">
                        <th className="py-2 pr-2 font-semibold">Profissional</th>
                        <th className="py-2 px-2 text-center font-semibold">Serviços</th>
                        <th className="py-2 px-2 text-right font-semibold">Líquido</th>
                        <th className="py-2 pl-2 text-right font-semibold">Comissão</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {data.topProfessionals.map((prof) => (
                        <tr key={prof.memberId} className="hover:bg-[var(--surface-raised)]/50 transition-colors">
                          <td className="py-2.5 pr-2 font-semibold text-[var(--text-primary)]">
                            {prof.name}
                          </td>
                          <td className="py-2.5 px-2 text-center text-[var(--text-secondary)] font-bold">
                            {prof.serviceCount}
                          </td>
                          <td className="py-2.5 px-2 text-right font-bold text-[var(--gold)]">
                            {formatBRL(prof.netRevenue)}
                          </td>
                          <td className="py-2.5 pl-2 text-right text-emerald-400 font-semibold">
                            {formatBRL(prof.releasedCommissions)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-8 text-center text-[var(--text-muted)] text-sm">
          Selecione um período para visualizar os dados financeiros.
        </div>
      )}
    </div>
  );
}
