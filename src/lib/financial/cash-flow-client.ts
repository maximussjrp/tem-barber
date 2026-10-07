import {
  CashFlowReport,
  CashFlowPeriodInput,
  DailyCashFlowItem,
  UpcomingCashFlowItem,
  CategoryBreakdownItem,
} from "./cash-flow";

export type {
  CashFlowReport,
  CashFlowPeriodInput,
  DailyCashFlowItem,
  UpcomingCashFlowItem,
  CategoryBreakdownItem,
};

export interface FetchCashFlowFilters {
  startDate: string;
  endDate: string;
  categoryId?: string;
  direction?: "IN" | "OUT";
}

export async function fetchCashFlowReport(
  filters: FetchCashFlowFilters,
  signal?: AbortSignal
): Promise<CashFlowReport> {
  const params = new URLSearchParams();
  params.set("startDate", filters.startDate);
  params.set("endDate", filters.endDate);
  if (filters.categoryId) {
    params.set("categoryId", filters.categoryId);
  }
  if (filters.direction) {
    params.set("direction", filters.direction);
  }

  const res = await fetch(`/api/admin/financial/cash-flow?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (res.status === 403) {
    const err = new Error("Acesso negado ao fluxo de caixa financeiro.");
    (err as unknown as { status: number }).status = 403;
    throw err;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const msg = data?.error || `Erro ao consultar fluxo de caixa (HTTP ${res.status})`;
    const err = new Error(msg);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }

  const json = await res.json();
  return json as CashFlowReport;
}
