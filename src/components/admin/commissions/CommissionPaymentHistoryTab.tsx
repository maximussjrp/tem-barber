"use client";

import React, { useState, useEffect, useRef } from "react";

type MemberOption = {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
};

type PayoutItem = {
  id: string;
  cycleId: string;
  memberId: string;
  amount: number;
  paymentMethod: string | null;
  paidAt: string;
  notes: string | null;
  createdAt: string;
  member: {
    id: string;
    name: string;
    role: string;
    isActive: boolean;
  };
  cycle: {
    id: string;
    cycleNumber: number;
    status: string;
    grossCommission: number;
    adjustmentsTotal: number;
    advancesTotal: number;
    finalPayoutAmount: number;
    remainingBalance: number;
    openedAt: string;
    closedAt: string | null;
    paidAt: string | null;
  };
  createdBy: {
    id: string;
    name: string;
  } | null;
};

type CycleDetail = {
  id: string;
  cycleNumber: number;
  status: string;
  grossCommission: number;
  adjustmentsTotal: number;
  advancesTotal: number;
  finalPayoutAmount: number;
  remainingBalance: number;
  openedAt: string;
  closedAt: string | null;
  paidAt: string | null;
  notes?: string | null;
  member: {
    id: string;
    name: string;
    role?: string;
  };
  advances: Array<{
    id: string;
    amount: number;
    paymentMethod: string;
    disbursedAt: string;
    notes: string | null;
    reversals: Array<{
      id: string;
      amount: number;
      returnMethod?: string;
      returnedAt: string;
      reason: string;
    }>;
  }>;
  adjustments: Array<{
    id: string;
    type: "CREDIT" | "DEBIT";
    amount: number;
    reason: string;
    createdAt: string;
  }>;
  payableItems: Array<{
    id: string;
    type: string;
    amount: number;
    sourceKind: string;
    createdAt: string;
  }>;
  payout: {
    id: string;
    amount: number;
    paymentMethod: string | null;
    paidAt: string;
    notes: string | null;
  } | null;
};

type FilterState = {
  memberId: string;
  periodMode: "month" | "range" | "all";
  yearMonth: string;
  startDate: string;
  endDate: string;
  paymentMethod: string;
  searchQuery: string;
};

type PrintSnapshot = {
  filters: FilterState;
  records: PayoutItem[];
  totalRecords: number;
  totalPaidAmount: number;
};

function getInitialYearMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

const defaultFilters: FilterState = {
  memberId: "",
  periodMode: "month",
  yearMonth: getInitialYearMonth(),
  startDate: "",
  endDate: "",
  paymentMethod: "",
  searchQuery: "",
};

function brl(val: number | string | undefined | null) {
  const n = Number(val || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(isoStr: string | null | undefined) {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr);
    return `${d.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })} ${d.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  } catch {
    return isoStr;
  }
}

function formatDateOnly(isoStr: string | null | undefined) {
  if (!isoStr) return "-";
  try {
    return new Date(isoStr).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return isoStr;
  }
}

function getPaymentMethodBadge(method: string | null) {
  switch (method) {
    case "PIX":
      return (
        <span className="payment-badge inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
          PIX
        </span>
      );
    case "CASH":
      return (
        <span className="payment-badge inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          Dinheiro
        </span>
      );
    case "TRANSFER":
      return (
        <span className="payment-badge inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
          Transferência
        </span>
      );
    case "OTHER":
      return (
        <span className="payment-badge inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
          Outro
        </span>
      );
    default:
      return (
        <span className="payment-badge inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
          Não informado
        </span>
      );
  }
}

function getSourceKindLabel(sourceKind: string): string {
  switch (sourceKind) {
    case "PAYMENT":
      return "Pagamento";
    case "REFUND":
      return "Estorno";
    case "ITEM_COMPLETION":
      return "Conclusão de item";
    case "COMANDA_RECALCULATION":
      return "Recálculo de comanda";
    case "EXECUTOR_CORRECTION":
      return "Correção de executor";
    case "LEGACY_BACKFILL":
      return "Migração de histórico";
    default:
      return sourceKind || "Não informado";
  }
}

function buildFilterParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.memberId) {
    params.set("memberId", filters.memberId);
  }

  if (filters.periodMode === "month" && filters.yearMonth) {
    params.set("yearMonth", filters.yearMonth);
  } else if (filters.periodMode === "range" && filters.startDate && filters.endDate) {
    params.set("startDate", filters.startDate);
    params.set("endDate", filters.endDate);
  }

  if (filters.paymentMethod) {
    params.set("paymentMethod", filters.paymentMethod);
  }

  if (filters.searchQuery.trim()) {
    params.set("search", filters.searchQuery.trim());
  }

  return params;
}

function getAppliedPeriodLabel(filters: FilterState): string {
  if (filters.periodMode === "month" && filters.yearMonth) {
    const parts = filters.yearMonth.split("-");
    if (parts.length === 2) {
      return `Mês do pagamento: ${parts[1]}/${parts[0]}`;
    }
    return `Mês do pagamento: ${filters.yearMonth}`;
  }
  if (filters.periodMode === "range" && filters.startDate && filters.endDate) {
    return `Período Personalizado: ${formatDateOnly(filters.startDate + "T12:00:00Z")} a ${formatDateOnly(filters.endDate + "T12:00:00Z")}`;
  }
  return "Período: Todo o Histórico";
}

function getAppliedMemberLabel(memberId: string, members: MemberOption[]): string {
  if (!memberId) return "Todos os profissionais";
  const m = members.find((x) => x.id === memberId);
  return m ? `${m.name}${!m.isActive ? " (Inativo)" : ""}` : "Profissional selecionado";
}

function getAppliedPaymentMethodLabel(method: string): string {
  switch (method) {
    case "PIX":
      return "PIX";
    case "CASH":
      return "Dinheiro";
    case "TRANSFER":
      return "Transferência";
    case "OTHER":
      return "Outro";
    case "NULL":
      return "Não informado";
    default:
      return "Todas as formas";
  }
}

export interface CommissionPaymentHistoryTabProps {
  barbershopName?: string;
}

export function CommissionPaymentHistoryTab({
  barbershopName: propBarbershopName,
}: CommissionPaymentHistoryTabProps = {}) {
  const [barbershopName, setBarbershopName] = useState<string>(propBarbershopName || "");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [payouts, setPayouts] = useState<PayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Pagination & Aggregation State
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPaidAmount, setTotalPaidAmount] = useState(0);

  // Draft Filters (controlled by UI form inputs)
  const [draftFilters, setDraftFilters] = useState<FilterState>(defaultFilters);

  // Committed / Applied Filters (governs current query, pagination, CSV & Print)
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(defaultFilters);

  // Export & Print State
  const [exportingCsv, setExportingCsv] = useState(false);
  const [preparingPrint, setPreparingPrint] = useState(false);
  const [printSnapshot, setPrintSnapshot] = useState<PrintSnapshot | null>(null);
  const [pendingPrintTrigger, setPendingPrintTrigger] = useState(false);
  const tableBodyRef = useRef<HTMLTableSectionElement | null>(null);
  const activePrintRequestId = useRef(0);
  const printAbortControllerRef = useRef<AbortController | null>(null);

  // Invalidate and cancel any in-flight or pending print request
  function cancelPendingPrint() {
    activePrintRequestId.current += 1;
    if (printAbortControllerRef.current) {
      printAbortControllerRef.current.abort();
      printAbortControllerRef.current = null;
    }
    setPreparingPrint(false);
    setPendingPrintTrigger(false);
    setPrintSnapshot(null);
  }

  // Print lifecycle: reset on afterprint or unmount
  useEffect(() => {
    const handleAfterPrint = () => {
      setPrintSnapshot(null);
      setPendingPrintTrigger(false);
      setPreparingPrint(false);
    };
    window.addEventListener("afterprint", handleAfterPrint);
    return () => {
      window.removeEventListener("afterprint", handleAfterPrint);
      if (printAbortControllerRef.current) {
        printAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Print lifecycle: trigger print only when all records are fully rendered in the DOM
  useEffect(() => {
    if (!pendingPrintTrigger || !printSnapshot) return;

    let rafId: number;
    const checkDomAndPrint = () => {
      if (!pendingPrintTrigger || !printSnapshot) return;
      const renderedCount = tableBodyRef.current ? tableBodyRef.current.children.length : 0;
      if (renderedCount >= printSnapshot.records.length) {
        setPendingPrintTrigger(false);
        if (typeof window.print === "function") {
          window.print();
        }
      } else {
        rafId = requestAnimationFrame(checkDomAndPrint);
      }
    };

    rafId = requestAnimationFrame(checkDomAndPrint);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [pendingPrintTrigger, printSnapshot]);

  function updateDraftFilters(updater: (prev: FilterState) => FilterState) {
    cancelPendingPrint();
    setDraftFilters(updater);
    setValidationError(null);
  }

  // Cycle Drilldown Modal State
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [cycleDetail, setCycleDetail] = useState<CycleDetail | null>(null);
  const [loadingCycleDetail, setLoadingCycleDetail] = useState(false);
  const [cycleDetailError, setCycleDetailError] = useState<string | null>(null);

  // Request race condition guard
  const activeRequestId = useRef(0);

  // 1. Fetch team members (including inactive) and barbershop name on mount
  useEffect(() => {
    async function loadMembers() {
      try {
        const res = await fetch("/api/admin/team");
        if (res.ok) {
          const data: unknown = await res.json();
          if (Array.isArray(data)) {
            setMembers(
              data.map((m: { id: string; role: string; isActive: boolean; user?: { name?: string | null } | null }) => ({
                id: m.id,
                name: m.user?.name ?? "Sem nome",
                role: m.role,
                isActive: m.isActive,
              }))
            );
          }
        }
      } catch (err) {
        console.error("Falha ao carregar equipe:", err);
      }
    }

    async function loadBarbershop() {
      if (propBarbershopName) return;
      try {
        const res = await fetch("/api/admin/barbershop");
        if (res.ok) {
          const data = await res.json();
          if (data?.name) {
            setBarbershopName(data.name);
          }
        }
      } catch {
        // Fallback gracefully
      }
    }

    loadMembers();
    loadBarbershop();
  }, [propBarbershopName]);

  // 2. Fetch payouts with explicit filters and target page
  async function executeFetch(filters: FilterState, targetPage: number) {
    activeRequestId.current += 1;
    const reqId = activeRequestId.current;

    setLoading(true);
    setError(null);

    const params = buildFilterParams(filters);
    params.set("page", String(targetPage));
    params.set("limit", "20");

    try {
      const res = await fetch(`/api/admin/commissions/payouts?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao carregar histórico de pagamentos.");
      }

      const data = await res.json();

      // Discard stale responses from superseded requests
      if (reqId !== activeRequestId.current) {
        return;
      }

      if (data.barbershop?.name) {
        setBarbershopName((prev) => prev || data.barbershop.name);
      }

      setPayouts(data.payouts || []);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotalRecords(data.pagination?.totalRecords || 0);
      setTotalPaidAmount(data.summary?.totalPaidAmount || 0);
      setPage(targetPage);
    } catch (err: unknown) {
      if (reqId === activeRequestId.current) {
        setError(err instanceof Error ? err.message : "Erro inesperado.");
      }
    } finally {
      if (reqId === activeRequestId.current) {
        setLoading(false);
      }
    }
  }

  // 3. Initial load on mount (protected against race conditions via activeRequestId)
  useEffect(() => {
    activeRequestId.current += 1;
    const reqId = activeRequestId.current;

    async function loadInitial() {
      const params = buildFilterParams(defaultFilters);
      params.set("page", "1");
      params.set("limit", "20");
      try {
        const res = await fetch(`/api/admin/commissions/payouts?${params.toString()}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Falha ao carregar histórico de pagamentos.");
        }
        const data = await res.json();
        if (reqId === activeRequestId.current) {
          if (data.barbershop?.name) {
            setBarbershopName((prev) => prev || data.barbershop.name);
          }
          setPayouts(data.payouts || []);
          setTotalPages(data.pagination?.totalPages || 1);
          setTotalRecords(data.pagination?.totalRecords || 0);
          setTotalPaidAmount(data.summary?.totalPaidAmount || 0);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (reqId === activeRequestId.current) {
          setError(err instanceof Error ? err.message : "Erro inesperado.");
          setLoading(false);
        }
      }
    }
    loadInitial();
  }, []);

  // 4. Handle Filter Application
  function handleApplyFilters(e?: React.FormEvent) {
    if (e) e.preventDefault();
    cancelPendingPrint();

    // Validate date range completeness
    if (draftFilters.periodMode === "range") {
      if (!draftFilters.startDate || !draftFilters.endDate) {
        setValidationError(
          "Para filtrar por período personalizado, preencha tanto a data inicial quanto a data final."
        );
        return;
      }
      if (draftFilters.endDate < draftFilters.startDate) {
        setValidationError("A data final não pode ser anterior à data inicial.");
        return;
      }
    }

    setValidationError(null);
    setAppliedFilters(draftFilters);
    executeFetch(draftFilters, 1);
  }

  function handleClearFilters() {
    cancelPendingPrint();
    setDraftFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
    setValidationError(null);
    executeFetch(defaultFilters, 1);
  }

  function handlePageChange(newPage: number) {
    cancelPendingPrint();
    executeFetch(appliedFilters, newPage);
  }

  // 5. CSV Export (using committed appliedFilters)
  async function handleExportCsv() {
    if (appliedFilters.periodMode === "range" && (!appliedFilters.startDate || !appliedFilters.endDate)) {
      setValidationError("Para exportar por período personalizado, preencha tanto a data inicial quanto a data final.");
      return;
    }

    setExportingCsv(true);
    try {
      const params = buildFilterParams(appliedFilters);
      params.set("format", "csv");
      const url = `/api/admin/commissions/payouts?${params.toString()}`;

      const res = await fetch(url);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Erro ao gerar arquivo CSV.");
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `historico-pagamentos-comissoes-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Não foi possível exportar os dados.");
    } finally {
      setExportingCsv(false);
    }
  }

  // 6. Print / PDF (fetches full filtered dataset using format=print up to 5,000 records)
  async function handlePrint() {
    cancelPendingPrint();
    activePrintRequestId.current += 1;
    const printReqId = activePrintRequestId.current;

    const controller = new AbortController();
    printAbortControllerRef.current = controller;

    // Capture immutable snapshot of currently applied filters
    const snapshotFilters: FilterState = { ...appliedFilters };

    setPreparingPrint(true);
    setValidationError(null);
    try {
      const params = buildFilterParams(snapshotFilters);
      params.set("format", "print");
      const res = await fetch(`/api/admin/commissions/payouts?${params.toString()}`, {
        signal: controller.signal,
      });

      // Discard if superseded while fetching
      if (printReqId !== activePrintRequestId.current) {
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 422 || data.code === "PRINT_LIMIT_EXCEEDED") {
          setValidationError(
            data.error || "O relatório para impressão excede o limite máximo de 5.000 registros. Refine os filtros antes de imprimir."
          );
        } else {
          setValidationError(data.error || "Não foi possível carregar os registros para impressão.");
        }
        return;
      }

      const data = await res.json();
      // Discard if superseded while parsing JSON
      if (printReqId !== activePrintRequestId.current) {
        return;
      }

      if (data.barbershop?.name && !barbershopName) {
        setBarbershopName(data.barbershop.name);
      }

      const records: PayoutItem[] = data.payouts || [];
      const expectedTotal: number =
        typeof data.pagination?.totalRecords === "number"
          ? data.pagination.totalRecords
          : records.length;

      if (records.length !== expectedTotal) {
        setValidationError(
          `Atenção: A listagem para impressão retornou ${records.length} registros, mas o total apurado é de ${expectedTotal}. A impressão foi cancelada por segurança.`
        );
        return;
      }

      const totalPaid =
        typeof data.summary?.totalPaidAmount === "number"
          ? data.summary.totalPaidAmount
          : records.reduce((acc, r) => acc + Number(r.amount || 0), 0);

      setPrintSnapshot({
        filters: snapshotFilters,
        records,
        totalRecords: expectedTotal,
        totalPaidAmount: totalPaid,
      });
      setPendingPrintTrigger(true);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (printReqId === activePrintRequestId.current) {
        setValidationError(err instanceof Error ? err.message : "Erro ao preparar relatório para impressão.");
      }
    } finally {
      if (printReqId === activePrintRequestId.current) {
        setPreparingPrint(false);
      }
    }
  }

  // 7. Cycle Drilldown Modal
  async function handleOpenCycleDetail(cycleId: string) {
    setSelectedCycleId(cycleId);
    setLoadingCycleDetail(true);
    setCycleDetailError(null);
    setCycleDetail(null);

    try {
      const res = await fetch(`/api/admin/commissions/cycles/${cycleId}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao carregar detalhes do ciclo.");
      }
      const data = await res.json();
      setCycleDetail(data.cycle);
    } catch (err: unknown) {
      setCycleDetailError(err instanceof Error ? err.message : "Erro ao carregar detalhes.");
    } finally {
      setLoadingCycleDetail(false);
    }
  }

  function handleCloseCycleDetail() {
    setSelectedCycleId(null);
    setCycleDetail(null);
    setCycleDetailError(null);
  }

  const displayedPayouts = printSnapshot !== null ? printSnapshot.records : payouts;
  const printHeaderFilters = printSnapshot !== null ? printSnapshot.filters : appliedFilters;
  const printHeaderTotalPaid = printSnapshot !== null ? printSnapshot.totalPaidAmount : totalPaidAmount;
  const printHeaderTotalRecords = printSnapshot !== null ? printSnapshot.totalRecords : totalRecords;

  return (
    <div className="space-y-6">
      {/* Print CSS Rules */}
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            background: #ffffff !important;
            color: #111827 !important;
            font-size: 10pt !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          aside,
          nav,
          header,
          .no-print {
            display: none !important;
          }
          main,
          div,
          .overflow-x-auto,
          .overflow-hidden {
            overflow: visible !important;
          }
          .print-only {
            display: block !important;
          }
          table {
            border-collapse: collapse !important;
            width: 100% !important;
            page-break-inside: auto !important;
          }
          tr {
            page-break-inside: avoid !important;
            page-break-after: auto !important;
          }
          thead {
            display: table-header-group !important;
          }
          tfoot {
            display: table-footer-group !important;
          }
          th, td {
            border: 1px solid #d1d5db !important;
            padding: 6px 8px !important;
            color: #111827 !important;
            background: #ffffff !important;
            font-size: 9pt !important;
          }
          th {
            background-color: #f3f4f6 !important;
            font-weight: 700 !important;
            text-transform: uppercase !important;
          }
          .payment-badge {
            background: transparent !important;
            border: 1px solid #6b7280 !important;
            color: #111827 !important;
            font-weight: 600 !important;
          }
        }
      `}</style>

      {/* Print Header */}
      <div className="hidden print-only pb-4 mb-4 border-b-2 border-stone-800 text-stone-900">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-stone-950 uppercase">
              Histórico de Pagamentos de Comissões — {barbershopName || "TEM BARBER"}
            </h1>
          </div>
          <div className="text-right text-[11px] text-stone-600">
            <p>
              Data e hora da emissão: {new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} às{" "}
              {new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-stone-800 bg-stone-50 p-3 rounded border border-stone-300">
          <div className="space-y-1">
            <p>
              <strong className="text-stone-900">Período selecionado:</strong> {getAppliedPeriodLabel(printHeaderFilters)}
            </p>
            <p>
              <strong className="text-stone-900">Profissional selecionado:</strong> {getAppliedMemberLabel(printHeaderFilters.memberId, members)}
            </p>
            {printHeaderFilters.searchQuery && (
              <p>
                <strong className="text-stone-900">Busca:</strong> &quot;{printHeaderFilters.searchQuery}&quot;
              </p>
            )}
          </div>
          <div className="space-y-1">
            <p>
              <strong className="text-stone-900">Forma de pagamento:</strong> {getAppliedPaymentMethodLabel(printHeaderFilters.paymentMethod)}
            </p>
            <p>
              <strong className="text-stone-900">Total pago em liquidações:</strong>{" "}
              <span className="font-bold text-stone-950">{brl(printHeaderTotalPaid)}</span>
            </p>
            <p>
              <strong className="text-stone-900">Quantidade de pagamentos:</strong> {printHeaderTotalRecords} registro(s)
              {displayedPayouts.length < printHeaderTotalRecords && (
                <span className="text-[11px] text-stone-600"> (Exibindo primeiros {displayedPayouts.length})</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 no-print">
        <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-4 rounded-xl shadow-sm">
          <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Total pago em liquidações
          </div>
          <div className="mt-1 text-2xl font-bold text-emerald-400">
            {brl(totalPaidAmount)}
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-1">
            Conforme filtros aplicados
          </div>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-4 rounded-xl shadow-sm">
          <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Pagamentos Realizados
          </div>
          <div className="mt-1 text-2xl font-bold text-[var(--gold)]">
            {totalRecords}
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-1">
            Ciclos liquidados
          </div>
        </div>

        <div className="bg-[var(--surface)] border border-[var(--border-subtle)] p-4 rounded-xl shadow-sm">
          <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            Média por Pagamento
          </div>
          <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">
            {totalRecords > 0 ? brl(totalPaidAmount / totalRecords) : "R$ 0,00"}
          </div>
          <div className="text-xs text-[var(--text-secondary)] mt-1">
            Ticket médio de liquidação
          </div>
        </div>
      </div>

      {/* Validation Error Feedback */}
      {validationError && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm flex items-center justify-between no-print">
          <span>{validationError}</span>
          <button
            onClick={() => setValidationError(null)}
            className="text-amber-400 hover:text-amber-200 font-bold ml-2 cursor-pointer"
            title="Fechar aviso"
          >
            ✕
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl p-4 shadow-sm no-print space-y-4">
        <form onSubmit={handleApplyFilters} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Professional Filter */}
            <div>
              <label htmlFor="filter-member" className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                Profissional
              </label>
              <select
                id="filter-member"
                value={draftFilters.memberId}
                onChange={(e) => {
                  updateDraftFilters((prev) => ({ ...prev, memberId: e.target.value }));
                }}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
              >
                <option value="">Todos os profissionais</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {!m.isActive ? "(Inativo)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Period Mode Selector */}
            <div>
              <label htmlFor="filter-period-mode" className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                Filtro de Período
              </label>
              <select
                id="filter-period-mode"
                value={draftFilters.periodMode}
                onChange={(e) => {
                  updateDraftFilters((prev) => ({
                    ...prev,
                    periodMode: e.target.value as "month" | "range" | "all",
                  }));
                }}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
              >
                <option value="month">Mês do pagamento</option>
                <option value="range">Período Personalizado (De/Até)</option>
                <option value="all">Todo o Histórico</option>
              </select>
            </div>

            {/* Month or Date Inputs */}
            {draftFilters.periodMode === "month" && (
              <div>
                <label htmlFor="filter-year-month" className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                  Mês / Ano
                </label>
                <input
                  id="filter-year-month"
                  type="month"
                  value={draftFilters.yearMonth}
                  onChange={(e) => {
                    updateDraftFilters((prev) => ({ ...prev, yearMonth: e.target.value }));
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
                />
              </div>
            )}

            {draftFilters.periodMode === "range" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="filter-start-date" className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    De
                  </label>
                  <input
                    id="filter-start-date"
                    type="date"
                    value={draftFilters.startDate}
                    onChange={(e) => {
                      updateDraftFilters((prev) => ({ ...prev, startDate: e.target.value }));
                    }}
                    className="w-full px-2 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs focus:outline-none focus:border-[var(--gold)]"
                  />
                </div>
                <div>
                  <label htmlFor="filter-end-date" className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Até
                  </label>
                  <input
                    id="filter-end-date"
                    type="date"
                    value={draftFilters.endDate}
                    onChange={(e) => {
                      updateDraftFilters((prev) => ({ ...prev, endDate: e.target.value }));
                    }}
                    className="w-full px-2 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs focus:outline-none focus:border-[var(--gold)]"
                  />
                </div>
              </div>
            )}

            {draftFilters.periodMode === "all" && (
              <div className="flex items-center text-xs text-[var(--text-muted)] pt-6">
                Mostrando todos os registros sem limite temporal.
              </div>
            )}

            {/* Payment Method */}
            <div>
              <label htmlFor="filter-payment-method" className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                Forma de Pagamento
              </label>
              <select
                id="filter-payment-method"
                value={draftFilters.paymentMethod}
                onChange={(e) => {
                  updateDraftFilters((prev) => ({ ...prev, paymentMethod: e.target.value }));
                }}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
              >
                <option value="">Todas as formas</option>
                <option value="PIX">PIX</option>
                <option value="CASH">Dinheiro</option>
                <option value="TRANSFER">Transferência</option>
                <option value="OTHER">Outro</option>
                <option value="NULL">Não informado</option>
              </select>
            </div>
          </div>

          {/* Row 2: Search input and action buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-[var(--border-subtle)]">
            <div className="w-full sm:max-w-md">
              <input
                type="text"
                value={draftFilters.searchQuery}
                onChange={(e) => {
                  updateDraftFilters((prev) => ({ ...prev, searchQuery: e.target.value }));
                }}
                placeholder="Buscar por profissional ou número do ciclo..."
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--gold)]"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end flex-wrap">
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[var(--gold)] text-[var(--text-inverse)] text-xs font-semibold hover:bg-[var(--gold-light)] transition-colors cursor-pointer"
              >
                Filtrar
              </button>
              <button
                type="button"
                onClick={handleClearFilters}
                className="px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-medium hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={exportingCsv || payouts.length === 0}
                className="px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] text-xs font-medium hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                title="Exportar todos os registros filtrados em CSV"
              >
                <span>{exportingCsv ? "Gerando..." : "Exportar CSV"}</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={preparingPrint || payouts.length === 0}
                className="px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] text-xs font-medium hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                title="Visualizar para impressão ou salvar em PDF"
              >
                <span>{preparingPrint ? "Preparando..." : "Imprimir / PDF"}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Error Feedback */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm no-print">
          {error}
        </div>
      )}

      {/* Table of Historical Payouts */}
      <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-xl shadow-md overflow-hidden print:border-none print:shadow-none print:bg-transparent print:overflow-visible">
        <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between no-print">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Pagamentos Efetivados
          </h2>
          <span className="text-xs text-[var(--text-muted)]">
            {totalRecords} registro(s) encontrado(s)
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-[var(--text-muted)] animate-pulse">
            Carregando histórico de pagamentos...
          </div>
        ) : displayedPayouts.length === 0 ? (
          <div className="p-12 text-center text-sm text-[var(--text-muted)] space-y-2">
            <p>Nenhum pagamento de comissão encontrado para os filtros selecionados.</p>
            <button
              onClick={handleClearFilters}
              className="text-xs text-[var(--gold)] hover:underline cursor-pointer"
            >
              Limpar filtros de busca
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--surface-raised)] text-[var(--text-secondary)] text-xs uppercase border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Data do Pagamento</th>
                  <th className="px-4 py-3 font-semibold">Profissional</th>
                  <th className="px-4 py-3 font-semibold">Ciclo</th>
                  <th className="px-4 py-3 font-semibold text-right">Valor Pago</th>
                  <th className="px-4 py-3 font-semibold text-center">Forma</th>
                  <th className="px-4 py-3 font-semibold">Responsável</th>
                  <th className="px-4 py-3 font-semibold text-center no-print">Ações</th>
                </tr>
              </thead>
              <tbody ref={tableBodyRef} className="divide-y divide-[var(--border-subtle)]">
                {displayedPayouts.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-[var(--surface-hover)] transition-colors"
                  >
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs text-[var(--text-primary)] font-medium">
                      {formatDateTime(item.paidAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                        <span>{item.member.name}</span>
                        {!item.member.isActive && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            Inativo
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {item.member.role}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[var(--text-secondary)]">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {`Ciclo #${item.cycle.cycleNumber}`}
                      </span>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        Aberto em {formatDateOnly(item.cycle.openedAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-emerald-400 whitespace-nowrap">
                      {brl(item.amount)}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {getPaymentMethodBadge(item.paymentMethod)}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[var(--text-muted)]">
                      {item.createdBy?.name || "Sistema"}
                    </td>
                    <td className="px-4 py-3.5 text-center no-print">
                      <button
                        onClick={() => handleOpenCycleDetail(item.cycle.id)}
                        className="px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                        title="Ver apuração e composição deste ciclo"
                      >
                        Ver Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {!loading && totalPages > 1 && (
          <div className="p-4 border-t border-[var(--border-subtle)] flex items-center justify-between no-print flex-wrap gap-2 text-xs">
            <span className="text-[var(--text-muted)]">
              Página <strong>{page}</strong> de <strong>{totalPages}</strong> ({totalRecords} pagamentos)
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] font-medium hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-40 cursor-pointer"
              >
                Anterior
              </button>
              <button
                onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] font-medium hover:bg-[var(--surface-hover)] transition-colors disabled:opacity-40 cursor-pointer"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cycle Drilldown Modal */}
      {selectedCycleId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm no-print">
          <div className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
              <div>
                <h3 className="text-lg font-bold text-[var(--text-primary)]">
                  {cycleDetail ? `Detalhamento do Ciclo #${cycleDetail.cycleNumber}` : "Carregando apuração..."}
                </h3>
                {cycleDetail && (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Colaborador: <strong>{cycleDetail.member.name}</strong>{cycleDetail.member.role ? ` (${cycleDetail.member.role})` : ""}
                  </p>
                )}
              </div>
              <button
                onClick={handleCloseCycleDetail}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl font-bold cursor-pointer"
                title="Fechar modal"
              >
                ✕
              </button>
            </div>

            {loadingCycleDetail ? (
              <div className="p-8 text-center text-sm text-[var(--text-muted)] animate-pulse">
                Carregando apuração completa do ciclo...
              </div>
            ) : cycleDetailError ? (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
                {cycleDetailError}
              </div>
            ) : cycleDetail ? (
              <div className="space-y-6 text-sm">
                {/* Financial Summary Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[var(--surface-raised)] p-4 rounded-xl border border-[var(--border-subtle)]">
                  <div>
                    <span className="text-[11px] text-[var(--text-muted)] uppercase block">Comissão Bruta</span>
                    <span className="text-base font-bold text-[var(--text-primary)]">
                      {brl(cycleDetail.grossCommission)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-[var(--text-muted)] uppercase block">Ajustes</span>
                    <span className={`text-base font-bold ${cycleDetail.adjustmentsTotal < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                      {cycleDetail.adjustmentsTotal > 0 ? "+" : ""}{brl(cycleDetail.adjustmentsTotal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-[var(--text-muted)] uppercase block">Adiantamentos</span>
                    <span className="text-base font-bold text-amber-400">
                      -{brl(cycleDetail.advancesTotal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-[var(--text-muted)] uppercase block">Total Liquidado</span>
                    <span className="text-base font-bold text-emerald-400">
                      {brl(cycleDetail.payout?.amount ?? cycleDetail.finalPayoutAmount)}
                    </span>
                  </div>
                </div>

                {/* Settlement/Payout Metadata */}
                {cycleDetail.payout && (
                  <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-2">
                    <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                      Informações da Liquidação
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-[var(--text-muted)] block">Data do Pagamento:</span>
                        <span className="font-medium text-[var(--text-primary)]">{formatDateTime(cycleDetail.payout.paidAt)}</span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)] block">Forma de Pagamento:</span>
                        <span className="font-medium text-[var(--text-primary)]">{cycleDetail.payout.paymentMethod || "Não informado"}</span>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)] block">Valor Efetivamente Pago:</span>
                        <span className="font-bold text-emerald-400">{brl(cycleDetail.payout.amount)}</span>
                      </div>
                    </div>
                    {cycleDetail.payout.notes && (
                      <div className="text-xs text-[var(--text-secondary)] mt-1">
                        <strong>Observações:</strong> {cycleDetail.payout.notes}
                      </div>
                    )}
                  </div>
                )}

                {/* Payable Items Breakdown */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                    Itens e Serviços Apurados ({cycleDetail.payableItems.length})
                  </h4>
                  {cycleDetail.payableItems.length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--text-muted)] bg-[var(--surface-raised)] rounded-lg">
                      Nenhum item individual listado neste ciclo.
                    </div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto border border-[var(--border-subtle)] rounded-lg">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[var(--surface-raised)] text-[var(--text-muted)]">
                          <tr>
                            <th className="p-2">Tipo</th>
                            <th className="p-2">Origem do Lançamento</th>
                            <th className="p-2">Data</th>
                            <th className="p-2 text-right">Comissão</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {cycleDetail.payableItems.map((item) => {
                            const isReversal = item.type === "REVERSAL";
                            return (
                              <tr key={item.id}>
                                <td className="p-2">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                      isReversal
                                        ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                        : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                    }`}
                                  >
                                    {isReversal ? "Reversão" : "Liberação"}
                                  </span>
                                </td>
                                <td className="p-2 text-[var(--text-secondary)]">
                                  {getSourceKindLabel(item.sourceKind)}
                                </td>
                                <td className="p-2 text-[var(--text-muted)]">
                                  {formatDateTime(item.createdAt)}
                                </td>
                                <td
                                  className={`p-2 text-right font-medium ${
                                    isReversal ? "text-rose-400" : "text-emerald-400"
                                  }`}
                                >
                                  {isReversal ? "-" : "+"}
                                  {brl(item.amount)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Adjustments Breakdown */}
                {cycleDetail.adjustments && cycleDetail.adjustments.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      Ajustes Manuais ({cycleDetail.adjustments.length})
                    </h4>
                    <div className="space-y-2">
                      {cycleDetail.adjustments.map((adj) => (
                        <div
                          key={adj.id}
                          className="p-3 bg-[var(--surface-raised)] rounded-lg border border-[var(--border-subtle)] text-xs flex items-center justify-between"
                        >
                          <div>
                            <span
                              className={`font-semibold ${
                                adj.type === "DEBIT" ? "text-rose-400" : "text-emerald-400"
                              }`}
                            >
                              {adj.type === "DEBIT" ? "Débito" : "Crédito"}: {brl(adj.amount)}
                            </span>
                            <span className="text-[var(--text-muted)] ml-2">
                              em {formatDateTime(adj.createdAt)}
                            </span>
                            {adj.reason && (
                              <p className="text-[var(--text-secondary)] mt-0.5">{adj.reason}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Advances Breakdown */}
                {cycleDetail.advances.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      Adiantamentos do Ciclo ({cycleDetail.advances.length})
                    </h4>
                    <div className="space-y-2">
                      {cycleDetail.advances.map((adv) => (
                        <div key={adv.id} className="p-3 bg-[var(--surface-raised)] rounded-lg border border-[var(--border-subtle)] text-xs flex items-center justify-between">
                          <div>
                            <span className="font-medium text-[var(--text-primary)]">{brl(adv.amount)} via {adv.paymentMethod}</span>
                            <span className="text-[var(--text-muted)] ml-2 block sm:inline">em {formatDateTime(adv.disbursedAt)}</span>
                            {adv.notes && <p className="text-[var(--text-secondary)] mt-0.5">{adv.notes}</p>}
                          </div>
                          {adv.reversals.length > 0 && (
                            <span className="text-rose-400 font-semibold text-[11px]">
                              Estornado (-{brl(adv.reversals.reduce((acc, r) => acc + Number(r.amount), 0))})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            <div className="pt-4 border-t border-[var(--border-subtle)] flex justify-end">
              <button
                onClick={handleCloseCycleDetail}
                className="px-4 py-2 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
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
