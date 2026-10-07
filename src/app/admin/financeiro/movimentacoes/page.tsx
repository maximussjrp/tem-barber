"use client";

import { useState, useEffect, useCallback } from "react";
import { FinancialNav } from "@/components/admin/financial/FinancialNav";
import {
  FinancialMovement,
  MovementFilters,
  MovementDirection,
  fetchFinancialMovements,
} from "@/lib/financial/movements-client";
import {
  LeafCategoryOption,
  flattenLeafCategories,
  formatCurrencyBRL,
} from "@/lib/financial/accounts-client";
import type { CategoryNode } from "@/lib/financial/categories";

const ENTRY_TYPE_LABELS: Record<string, string> = {
  COMMAND_REVENUE: "Receita de Comanda",
  REFUND: "Reembolso",
  MANUAL_IN: "Entrada Manual (Legada)",
  MANUAL_OUT: "Saída Manual (Legada)",
  CLUB_REVENUE: "Receita de Clube",
  CLUB_BARBER_PAYOUT: "Repasse de Clube a Barbeiro",
  COMMISSION_ADVANCE: "Adiantamento de Comissão",
  COMMISSION_ADVANCE_REVERSAL: "Estorno de Adiantamento",
  COMMISSION_PAYOUT: "Pagamento de Comissão",
  TIP_RECEIVED: "Gorjeta Recebida",
  TIP_REFUND: "Reembolso de Gorjeta",
  TIP_PAYOUT: "Repasse de Gorjeta",
  TIP_PAYOUT_REVERSAL: "Estorno de Repasse de Gorjeta",
  CUSTOMER_CREDIT_DEPOSIT: "Depósito de Crédito de Cliente",
  CUSTOMER_CREDIT_DEPOSIT_REFUND: "Estorno de Depósito de Crédito",
};

export default function MovimentacoesPage() {
  const [leafCategories, setLeafCategories] = useState<LeafCategoryOption[]>([]);

  // Filter states
  const [directionFilter, setDirectionFilter] = useState<"" | MovementDirection>("");
  const [typeFilter, setTypeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;

  // Data states
  const [items, setItems] = useState<FinancialMovement[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);

  // Load leaf categories for category filter
  const fetchCategories = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/financial/categories", { signal });
      if (signal?.aborted) return;
      if (res.ok) {
        const data: CategoryNode[] = await res.json();
        if (signal?.aborted) return;
        setLeafCategories(flattenLeafCategories(data));
      }
    } catch {
      // Non-blocking fallback
    }
  }, []);

  const loadMovements = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);
      setIsForbidden(false);

      const filters: MovementFilters = {
        direction: directionFilter || undefined,
        type: typeFilter || undefined,
        categoryId: categoryFilter || undefined,
        q: searchQuery.trim() || undefined,
        startDate: startDateFilter || undefined,
        endDate: endDateFilter || undefined,
        page,
        limit,
      };

      try {
        const res = await fetchFinancialMovements(filters, signal);
        if (signal?.aborted) return;
        setItems(res.items);
        setPagination(res.pagination);
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === "AbortError" || signal?.aborted) {
          return;
        }
        const errorObj = err as { status?: number; message?: string };
        if (errorObj?.status === 403) {
          setIsForbidden(true);
        } else {
          setError(errorObj?.message || "Erro inesperado ao carregar movimentações.");
        }
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [
      directionFilter,
      typeFilter,
      categoryFilter,
      searchQuery,
      startDateFilter,
      endDateFilter,
      page,
    ]
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void fetchCategories(controller.signal);
      }
    });
    return () => controller.abort();
  }, [fetchCategories]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void loadMovements(controller.signal);
      }
    });
    return () => controller.abort();
  }, [loadMovements]);

  const handleResetFilters = () => {
    setDirectionFilter("");
    setTypeFilter("");
    setCategoryFilter("");
    setSearchQuery("");
    setStartDateFilter("");
    setEndDateFilter("");
    setPage(1);
  };

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
    } catch {
      return isoStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Module Navigation */}
      <FinancialNav />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Movimentações
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Histórico contábil e extrato de lançamentos realizados (Ledger financeiro).
          </p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {/* Direção */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Direção
            </label>
            <select
              aria-label="Filtro de direção"
              value={directionFilter}
              onChange={(e) => {
                setDirectionFilter(e.target.value as "" | MovementDirection);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            >
              <option value="">Todas</option>
              <option value="IN">Entradas (+)</option>
              <option value="OUT">Saídas (-)</option>
            </select>
          </div>

          {/* Tipo de Lançamento */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Tipo
            </label>
            <select
              aria-label="Filtro de tipo"
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            >
              <option value="">Todos os tipos</option>
              {Object.entries(ENTRY_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Categoria */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Categoria
            </label>
            <select
              aria-label="Filtro de categoria"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            >
              <option value="">Todas as categorias</option>
              {leafCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* Data De */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              A partir de
            </label>
            <input
              type="date"
              aria-label="Filtro data inicial"
              value={startDateFilter}
              onChange={(e) => {
                setStartDateFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Data Até */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Até
            </label>
            <input
              type="date"
              aria-label="Filtro data final"
              value={endDateFilter}
              onChange={(e) => {
                setEndDateFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Busca Textual */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Buscar
            </label>
            <input
              type="text"
              aria-label="Busca textual"
              placeholder="Descrição..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500 placeholder-zinc-500"
            />
          </div>
        </div>

        {/* Clear Filters */}
        {(directionFilter ||
          typeFilter ||
          categoryFilter ||
          searchQuery ||
          startDateFilter ||
          endDateFilter) && (
          <div className="flex justify-end pt-2 border-t border-zinc-800/60">
            <button
              onClick={handleResetFilters}
              className="text-xs text-amber-500 hover:text-amber-400 transition"
            >
              Limpar filtros
            </button>
          </div>
        )}
      </div>

      {/* States: 403 Forbidden */}
      {isForbidden && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-6 text-center text-red-400">
          <p className="font-semibold text-base">Acesso negado</p>
          <p className="text-sm mt-1 text-red-300">
            Você não possui permissão para visualizar o extrato financeiro.
          </p>
        </div>
      )}

      {/* States: Error */}
      {!isForbidden && error && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-6 text-center text-red-400 space-y-3">
          <p className="font-semibold">{error}</p>
          <button
            onClick={() => loadMovements()}
            className="px-4 py-2 bg-red-900/50 hover:bg-red-900 border border-red-700 rounded-lg text-sm text-red-100 transition"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* States: Loading */}
      {!isForbidden && !error && isLoading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="h-16 rounded-xl bg-zinc-900/40 border border-zinc-800/50 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* States: Empty */}
      {!isForbidden && !error && !isLoading && items.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-12 text-center">
          <p className="text-base font-medium text-zinc-300">
            Nenhuma movimentação encontrada
          </p>
          <p className="text-sm text-zinc-500 mt-1">
            Não há lançamentos financeiros correspondentes aos filtros selecionados.
          </p>
        </div>
      )}

      {/* Content: List / Table */}
      {!isForbidden && !error && !isLoading && items.length > 0 && (
        <div className="space-y-4">
          {/* Desktop Table View (>= 768px) */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="bg-zinc-950/60 text-xs font-semibold uppercase tracking-wider text-zinc-400 border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Descrição / Origem</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Classificação / Categoria</th>
                  <th className="px-4 py-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {items.map((mov) => {
                  const isPositive = mov.direction === "IN";
                  const absAmount = Math.abs(parseFloat(mov.amount || "0"));
                  const formattedAmt = formatCurrencyBRL(absAmount);

                  return (
                    <tr
                      key={mov.id}
                      className="hover:bg-zinc-800/30 transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-zinc-400">
                        {formatDate(mov.entryDate)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-200">
                          {mov.description || "Sem descrição"}
                        </div>
                        {mov.sourceRefs.financialSettlementId && (
                          <div className="text-xs text-zinc-500 mt-0.5">
                            Baixa de Conta
                          </div>
                        )}
                        {mov.sourceRefs.comandaId && (
                          <div className="text-xs text-zinc-500 mt-0.5">
                            Comanda
                          </div>
                        )}
                        {mov.sourceRefs.commissionPayoutId && (
                          <div className="text-xs text-zinc-500 mt-0.5">
                            Repasse de Comissão
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs text-zinc-400">
                          {ENTRY_TYPE_LABELS[mov.type] || mov.type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {mov.allocations.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {mov.allocations.map((alloc) => (
                              <span
                                key={alloc.id}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-300 border border-zinc-700/60"
                              >
                                {alloc.financialCategory.name}
                                {mov.allocations.length > 1 && (
                                  <span className="ml-1 text-zinc-400 font-mono">
                                    ({formatCurrencyBRL(alloc.allocatedAmount)})
                                  </span>
                                )}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-zinc-800/50 text-zinc-500 italic border border-zinc-800">
                            Fora do plano gerencial
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <span
                          className={`font-semibold font-mono text-sm ${
                            isPositive ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {isPositive ? `+ ${formattedAmt}` : `- ${formattedAmt}`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View (< 768px) */}
          <div className="md:hidden space-y-3">
            {items.map((mov) => {
              const isPositive = mov.direction === "IN";
              const absAmount = Math.abs(parseFloat(mov.amount || "0"));
              const formattedAmt = formatCurrencyBRL(absAmount);

              return (
                <div
                  key={mov.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs text-zinc-500">
                        {formatDate(mov.entryDate)}
                      </span>
                      <h4 className="font-medium text-sm text-zinc-200 mt-0.5">
                        {mov.description || "Sem descrição"}
                      </h4>
                    </div>
                    <span
                      className={`font-bold font-mono text-sm whitespace-nowrap ${
                        isPositive ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {isPositive ? `+ ${formattedAmt}` : `- ${formattedAmt}`}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                      {ENTRY_TYPE_LABELS[mov.type] || mov.type}
                    </span>

                    {mov.allocations.length > 0 ? (
                      mov.allocations.map((alloc) => (
                        <span
                          key={alloc.id}
                          className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/50"
                        >
                          {alloc.financialCategory.name}
                        </span>
                      ))
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-zinc-800/40 text-zinc-500 italic border border-zinc-800">
                        Fora do plano gerencial
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-zinc-800 text-sm">
              <span className="text-zinc-500 text-xs sm:text-sm">
                Página {pagination.page} de {pagination.totalPages} ({pagination.total}{" "}
                registros)
              </span>
              <div className="flex gap-2">
                <button
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-800 transition text-xs"
                >
                  Anterior
                </button>
                <button
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() =>
                    setPage((p) => Math.min(pagination.totalPages, p + 1))
                  }
                  className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-800 transition text-xs"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
