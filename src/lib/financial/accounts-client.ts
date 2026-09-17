import type { CategoryNode } from "./categories";

export interface FinancialTitleCategory {
  id: string;
  code: string;
  name: string;
  classification: string;
}

export interface FinancialTitleListItem {
  id: string;
  barbershopId: string;
  kind: "PAYABLE" | "RECEIVABLE";
  title: string;
  description: string | null;
  originalAmount: string;
  issuedOn: string;
  dueOn: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  category: FinancialTitleCategory;
  derivedStatus: "OPEN" | "OVERDUE" | "PARTIAL" | "PAID" | "CANCELLED";
  settledPrincipal: string;
  outstandingPrincipal: string;
}

export interface FinancialTitlesListResponse {
  items: FinancialTitleListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FinancialTitleSettlement {
  id: string;
  principalAmount: string;
  discountAmount: string;
  interestAmount: string;
  fineAmount: string;
  netCash: string;
  method: string | null;
  settledAt: string;
  notes: string | null;
  createdBy?: { id: string; name: string };
  financialEntry?: unknown;
}

export interface FinancialTitleDetail extends FinancialTitleListItem {
  createdBy?: { id: string; name: string; email: string };
  cancelledBy?: { id: string; name: string; email: string };
  activeSettlements: FinancialTitleSettlement[];
}

export interface LeafCategoryOption {
  id: string;
  code: string;
  name: string;
  classification: string;
  label: string;
}

export const PAYABLE_CLASSIFICATIONS = [
  "VARIABLE_COST",
  "FIXED_EXPENSE",
  "INVESTMENT",
  "NON_OPERATING_OUT",
];

export const RECEIVABLE_CLASSIFICATIONS = ["REVENUE", "NON_OPERATING_IN"];

/**
 * Traversa a árvore de categorias recursivamente e retorna apenas categorias folha (isLeaf = true) e ativas.
 */
export function flattenLeafCategories(nodes: CategoryNode[]): LeafCategoryOption[] {
  const leafList: LeafCategoryOption[] = [];

  function traverse(items: CategoryNode[]) {
    for (const node of items) {
      if (!node.isActive) continue;
      if (node.isLeaf) {
        leafList.push({
          id: node.id,
          code: node.code,
          name: node.name,
          classification: node.classification,
          label: `${node.code} - ${node.name}`,
        });
      }
      if (node.children && node.children.length > 0) {
        traverse(node.children);
      }
    }
  }

  traverse(nodes);
  return leafList.sort((a, b) => a.code.localeCompare(b.code));
}

export function generateUUIDv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("Ambiente sem suporte a Web Crypto API para geração de UUID v4.");
}

export function formatCurrencyBRL(amountStr: string | number): string {
  const num = typeof amountStr === "number" ? amountStr : parseFloat(amountStr || "0");
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(isNaN(num) ? 0 : num);
}

export function getDerivedStatusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case "OPEN":
      return {
        label: "Em aberto",
        className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
      };
    case "OVERDUE":
      return {
        label: "Vencida",
        className: "bg-red-500/10 text-red-400 border-red-500/20",
      };
    case "PARTIAL":
      return {
        label: "Parcial",
        className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      };
    case "PAID":
      return {
        label: "Quitada",
        className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      };
    case "CANCELLED":
      return {
        label: "Cancelada",
        className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
      };
    default:
      return {
        label: status,
        className: "bg-surface-raised text-text-muted border-border-subtle",
      };
  }
}

export function getKindBadge(kind: "PAYABLE" | "RECEIVABLE"): { label: string; className: string } {
  if (kind === "PAYABLE") {
    return {
      label: "A pagar",
      className: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    };
  }
  return {
    label: "A receber",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  };
}

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "CASH", label: "Dinheiro" },
  { value: "PIX", label: "PIX" },
  { value: "CREDIT_CARD", label: "Cartão de Crédito" },
  { value: "DEBIT_CARD", label: "Cartão de Débito" },
  { value: "BANK_TRANSFER", label: "Transferência Bancária" },
  { value: "BOLETO", label: "Boleto Bancário" },
  { value: "OTHER", label: "Outro" },
];

export function getPaymentMethodLabel(method: string | null): string {
  if (!method) return "Sem movimento financeiro";
  const found = PAYMENT_METHODS.find((m) => m.value === method);
  return found ? found.label : method;
}
