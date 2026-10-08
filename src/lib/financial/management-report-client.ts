import {
  ManagementReport,
  ManagementReportInput,
  ManagementReportPeriodInfo,
  ManagementReportRow,
  ManagementReportKPIs,
  OutsideResultItem,
  ManagementReportDataQuality,
} from "./management-report";

export type {
  ManagementReport,
  ManagementReportInput,
  ManagementReportPeriodInfo,
  ManagementReportRow,
  ManagementReportKPIs,
  OutsideResultItem,
  ManagementReportDataQuality,
};

export interface FetchManagementReportFilters {
  startDate: string;
  endDate: string;
  categoryId?: string;
}

export async function fetchManagementReport(
  filters: FetchManagementReportFilters,
  signal?: AbortSignal
): Promise<ManagementReport> {
  const params = new URLSearchParams();
  params.set("startDate", filters.startDate);
  params.set("endDate", filters.endDate);
  if (filters.categoryId) {
    params.set("categoryId", filters.categoryId);
  }

  const res = await fetch(`/api/admin/financial/management-report?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (res.status === 403) {
    const err = new Error("Acesso negado ao relatório gerencial.");
    (err as unknown as { status: number }).status = 403;
    throw err;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const msg = data?.error || `Erro ao consultar relatório gerencial (HTTP ${res.status})`;
    const err = new Error(msg);
    (err as unknown as { status: number }).status = res.status;
    throw err;
  }

  const json = await res.json();
  return json as ManagementReport;
}
