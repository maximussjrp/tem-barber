import { todayIsoBR } from "@/lib/time-utils";

export interface CategoryNode {
  id: string;
  code: string;
  name: string;
  classification: string;
  parentCategoryId: string | null;
  isActive: boolean;
  depth: number;
  isLeaf: boolean;
  children?: CategoryNode[];
}

export interface ClientFinancialRoutine {
  id: string;
  barbershopId: string;
  createdById: string;
  categoryId: string;
  title: string;
  kind: "PAYABLE" | "RECEIVABLE";
  amountMode: "FIXED" | "VARIABLE";
  baseAmount: string | number | null;
  frequency: "MONTHLY";
  dueDay: number;
  startDate: string;
  endDate?: string | null;
  startDateCivil: string;
  endDateCivil?: string | null;
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category?: {
    id: string;
    code: string;
    name: string;
  };
}

export interface RecurringExpensePreset {
  code: string;
  name: string;
  description: string;
  suggestedAmountMode: "FIXED" | "VARIABLE";
}

export const RECURRING_EXPENSE_PRESETS: RecurringExpensePreset[] = [
  {
    code: "03.01",
    name: "Aluguel",
    description: "Aluguel do imóvel ou ponto comercial da barbearia.",
    suggestedAmountMode: "FIXED",
  },
  {
    code: "03.02",
    name: "Água",
    description: "Conta mensal de consumo de água e esgoto.",
    suggestedAmountMode: "VARIABLE",
  },
  {
    code: "03.03",
    name: "Energia",
    description: "Conta mensal de consumo de energia elétrica.",
    suggestedAmountMode: "VARIABLE",
  },
  {
    code: "03.04",
    name: "Internet e Telefonia",
    description: "Assinatura de internet, telefone e infraestrutura de rede.",
    suggestedAmountMode: "FIXED",
  },
  {
    code: "03.05",
    name: "Sistemas e Software",
    description: "Softwares de gestão, barbearia, sites e serviços em nuvem.",
    suggestedAmountMode: "FIXED",
  },
  {
    code: "03.06",
    name: "Contabilidade",
    description: "Serviços de assessoria contábil e fiscal.",
    suggestedAmountMode: "FIXED",
  },
];

export function findCategoryByCode(tree: CategoryNode[], code: string): CategoryNode | null {
  if (!Array.isArray(tree)) return null;
  for (const node of tree) {
    if (node.code === code && node.isActive && node.isLeaf) {
      return node;
    }
    if (node.children && node.children.length > 0) {
      const found = findCategoryByCode(node.children, code);
      if (found) return found;
    }
  }
  return null;
}

export function monthToStartDate(yearMonth: string): string {
  if (!yearMonth) return "";
  const parts = yearMonth.split("-");
  if (parts.length !== 2) return "";
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!year || !month || month < 1 || month > 12) return "";
  const yStr = String(year).padStart(4, "0");
  const mStr = String(month).padStart(2, "0");
  return `${yStr}-${mStr}-01`;
}

export function monthToEndDate(yearMonth: string | null | undefined): string | null {
  if (!yearMonth) return null;
  const parts = yearMonth.trim().split("-");
  if (parts.length !== 2) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!year || !month || month < 1 || month > 12) return null;

  // Day 0 of month + 1 gets the last day of month in UTC
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const yStr = String(year).padStart(4, "0");
  const mStr = String(month).padStart(2, "0");
  const dStr = String(lastDay).padStart(2, "0");
  return `${yStr}-${mStr}-${dStr}`;
}

export function startDateToMonth(startDate: string | null | undefined): string {
  if (!startDate) return "";
  return startDate.slice(0, 7);
}

export function endDateToMonth(endDate: string | null | undefined): string {
  if (!endDate) return "";
  return endDate.slice(0, 7);
}

export function getCurrentCivilMonth(): string {
  return todayIsoBR().slice(0, 7);
}

export interface ApiFetchError {
  status: number;
  message: string;
}

export async function fetchCategoriesTreeClient(signal?: AbortSignal): Promise<CategoryNode[]> {
  const res = await fetch("/api/admin/financial/categories", { signal });
  if (res.status === 403) {
    const err: ApiFetchError = { status: 403, message: "Acesso Negado" };
    throw err;
  }
  if (!res.ok) {
    let msg = "Erro ao carregar categorias.";
    try {
      const data = await res.json();
      if (data?.error || data?.message) {
        msg = data.message || data.error;
      }
    } catch {
      // fallback
    }
    const err: ApiFetchError = { status: res.status, message: msg };
    throw err;
  }
  return res.json();
}

export async function fetchRoutinesListClient(signal?: AbortSignal): Promise<ClientFinancialRoutine[]> {
  const res = await fetch("/api/admin/financial/routines", { signal });
  if (res.status === 403) {
    const err: ApiFetchError = { status: 403, message: "Acesso Negado" };
    throw err;
  }
  if (!res.ok) {
    let msg = "Erro ao carregar rotinas financeiras.";
    try {
      const data = await res.json();
      if (data?.error || data?.message) {
        msg = data.message || data.error;
      }
    } catch {
      // fallback
    }
    const err: ApiFetchError = { status: res.status, message: msg };
    throw err;
  }
  const data = await res.json();
  return data.routines || [];
}

export interface CreateRoutinePayload {
  categoryId: string;
  title: string;
  kind: "PAYABLE";
  amountMode: "FIXED" | "VARIABLE";
  baseAmount: string;
  frequency: "MONTHLY";
  dueDay: number;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
}

export async function createRoutineClient(payload: CreateRoutinePayload): Promise<ClientFinancialRoutine> {
  const res = await fetch("/api/admin/financial/routines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let msg = "Erro ao criar rotina financeira.";
    try {
      const data = await res.json();
      if (data?.message || data?.error) {
        msg = data.message || data.error;
      }
    } catch {
      // fallback
    }
    throw new Error(msg);
  }

  const data = await res.json();
  return data.routine;
}

export interface UpdateRoutinePayload {
  title?: string;
  amountMode?: "FIXED" | "VARIABLE";
  baseAmount?: string;
  dueDay?: number;
  startDate?: string;
  endDate?: string | null;
  notes?: string | null;
}

export async function updateRoutineClient(id: string, payload: UpdateRoutinePayload): Promise<ClientFinancialRoutine> {
  const res = await fetch(`/api/admin/financial/routines/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let msg = "Erro ao atualizar rotina financeira.";
    try {
      const data = await res.json();
      if (data?.message || data?.error) {
        msg = data.message || data.error;
      }
    } catch {
      // fallback
    }
    throw new Error(msg);
  }

  const data = await res.json();
  return data.routine;
}

export async function deactivateRoutineClient(id: string): Promise<ClientFinancialRoutine> {
  const res = await fetch(`/api/admin/financial/routines/${id}/deactivate`, {
    method: "POST",
  });

  if (!res.ok) {
    let msg = "Erro ao desativar rotina financeira.";
    try {
      const data = await res.json();
      if (data?.message || data?.error) {
        msg = data.message || data.error;
      }
    } catch {
      // fallback
    }
    throw new Error(msg);
  }

  const data = await res.json();
  return data.routine;
}

export async function reactivateRoutineClient(id: string): Promise<ClientFinancialRoutine> {
  const res = await fetch(`/api/admin/financial/routines/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive: true }),
  });

  if (!res.ok) {
    let msg = "Erro ao reativar rotina financeira.";
    try {
      const data = await res.json();
      if (data?.message || data?.error) {
        msg = data.message || data.error;
      }
    } catch {
      // fallback
    }
    throw new Error(msg);
  }

  const data = await res.json();
  return data.routine;
}
