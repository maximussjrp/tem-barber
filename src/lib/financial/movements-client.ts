export type MovementDirection = "IN" | "OUT";

export type MovementAllocationStatus = "ALLOCATED" | "UNALLOCATED";

export interface MovementAllocation {
  id: string;
  allocatedAmount: string;
  financialCategory: {
    id: string;
    code: string;
    name: string;
    classification: string;
  };
}

export interface MovementSourceRefs {
  comandaId?: string | null;
  paymentId?: string | null;
  clubSubscriptionPaymentId?: string | null;
  financialSettlementId?: string | null;
  financialSettlementReversalId?: string | null;
  commissionAdvanceId?: string | null;
  commissionAdvanceReversalId?: string | null;
  commissionPayoutId?: string | null;
  tipEntryId?: string | null;
  tipRefundId?: string | null;
  tipPayoutId?: string | null;
  tipPayoutReversalId?: string | null;
  customerCreditEntryId?: string | null;
}

export interface FinancialMovement {
  id: string;
  type: string;
  amount: number;
  description: string;
  entryDate: string;
  direction: MovementDirection;
  allocationStatus: MovementAllocationStatus;
  sourceRefs: MovementSourceRefs;
  allocations: MovementAllocation[];
}

export interface MovementFilters {
  startDate?: string;
  endDate?: string;
  type?: string;
  direction?: MovementDirection;
  categoryId?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export interface MovementListResponse {
  items: FinancialMovement[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function fetchFinancialMovements(
  filters: MovementFilters = {},
  signal?: AbortSignal
): Promise<MovementListResponse> {
  const params = new URLSearchParams();

  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.type) params.set("type", filters.type);
  if (filters.direction) params.set("direction", filters.direction);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.q) params.set("q", filters.q.trim());
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));

  const qs = params.toString();
  const url = `/api/admin/financial/entries${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    signal,
  });

  if (!res.ok) {
    let errorMessage = `Erro ao carregar movimentações (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) errorMessage = data.error;
    } catch {
      // ignore
    }
    const error = new Error(errorMessage) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  return res.json();
}
