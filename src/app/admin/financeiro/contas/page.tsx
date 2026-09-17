"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FinancialTitlesListResponse,
  LeafCategoryOption,
  flattenLeafCategories,
  formatCurrencyBRL,
  getDerivedStatusBadge,
  getKindBadge,
} from "@/lib/financial/accounts-client";
import type { CategoryNode } from "@/lib/financial/categories";
import { TitleCreateModal } from "@/components/admin/financial/TitleCreateModal";
import { TitleDetailModal } from "@/components/admin/financial/TitleDetailModal";

export default function ContasPage() {
  const [leafCategories, setLeafCategories] = useState<LeafCategoryOption[]>([]);

  // Filter State
  const [kindFilter, setKindFilter] = useState<"" | "PAYABLE" | "RECEIVABLE">("");
  const [statusFilter, setStatusFilter] = useState<
    "" | "OPEN" | "OVERDUE" | "PARTIAL" | "PAID" | "CANCELLED"
  >("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dueFromFilter, setDueFromFilter] = useState("");
  const [dueToFilter, setDueToFilter] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;

  // Data State
  const [titlesData, setTitlesData] = useState<FinancialTitlesListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);

  // Modals State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Load Categories
  const fetchCategories = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/admin/financial/categories", { signal });
      if (signal?.aborted) return;
      if (res.ok) {
        const data: CategoryNode[] = await res.json();
        if (signal?.aborted) return;
        setLeafCategories(flattenLeafCategories(data));
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError" || signal?.aborted) return;
      // Non-blocking fallback for categories
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void fetchCategories(controller.signal);
      }
    });
    return () => {
      controller.abort();
    };
  }, [fetchCategories]);

  // Fetch Titles
  const fetchTitles = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);
      setIsForbidden(false);

      const params = new URLSearchParams();
      if (kindFilter) params.set("kind", kindFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (categoryFilter) params.set("categoryId", categoryFilter);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (dueFromFilter) params.set("dueFrom", dueFromFilter);
      if (dueToFilter) params.set("dueTo", dueToFilter);
      params.set("page", String(page));
      params.set("limit", String(limit));

      try {
        const res = await fetch(`/api/admin/financial/titles?${params.toString()}`, { signal });
        if (signal?.aborted) return;

        if (res.status === 403) {
          setIsForbidden(true);
          setTitlesData(null);
          return;
        }

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          if (signal?.aborted) return;
          setError(errJson.error || "Erro ao carregar lista de contas.");
          setTitlesData(null);
          return;
        }

        const data: FinancialTitlesListResponse = await res.json();
        if (signal?.aborted) return;
        setTitlesData(data);
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === "AbortError" || signal?.aborted) return;
        setError("Falha de conexão com o servidor ao carregar títulos.");
        setTitlesData(null);
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [kindFilter, statusFilter, categoryFilter, searchQuery, dueFromFilter, dueToFilter, page, limit]
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void fetchTitles(controller.signal);
      }
    });
    return () => {
      controller.abort();
    };
  }, [fetchTitles]);

  const resetFilters = () => {
    setKindFilter("");
    setStatusFilter("");
    setCategoryFilter("");
    setSearchQuery("");
    setDueFromFilter("");
    setDueToFilter("");
    setPage(1);
  };

  const openDetailModal = (id: string) => {
    setSelectedTitleId(id);
    setIsDetailOpen(true);
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">
            Contas a Pagar / Receber
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Gerencie títulos financeiros, emissões, vencimentos, baixas e cancelamentos.
          </p>
        </div>

        {!isForbidden && (
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand)] text-black font-bold text-xs hover:opacity-90 transition-opacity shadow-sm self-start sm:self-auto"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nova Conta
          </button>
        )}
      </div>

      {/* 403 Forbidden State */}
      {isForbidden ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-8 text-center space-y-3 max-w-2xl mx-auto my-8">
          <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="text-base font-bold text-red-300">
            Acesso Negado
          </h2>
          <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
            Você não possui permissão para visualizar dados financeiros desta barbearia. Esta seção é restrita a Sócios e Gerentes.
          </p>
        </div>
      ) : (
        <>
          {/* Filters Bar */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] mr-2">
                Tipo:
              </span>
              <button
                type="button"
                onClick={() => {
                  setKindFilter("");
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                  kindFilter === ""
                    ? "bg-[var(--brand)] text-black border-[var(--brand)]"
                    : "bg-[var(--surface-raised)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => {
                  setKindFilter("PAYABLE");
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                  kindFilter === "PAYABLE"
                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                    : "bg-[var(--surface-raised)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                Contas a Pagar
              </button>
              <button
                type="button"
                onClick={() => {
                  setKindFilter("RECEIVABLE");
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                  kindFilter === "RECEIVABLE"
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                    : "bg-[var(--surface-raised)] text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                Contas a Receber
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-[var(--border-subtle)]">
              {/* Search */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Buscar Título
                </label>
                <input
                  type="text"
                  placeholder="Nome do título..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  className="w-full px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
                />
              </div>

              {/* Status */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    const val = e.target.value as
                      | ""
                      | "OPEN"
                      | "OVERDUE"
                      | "PARTIAL"
                      | "PAID"
                      | "CANCELLED";
                    setStatusFilter(val);
                    setPage(1);
                  }}
                  className="w-full px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
                >
                  <option value="">Todos os status</option>
                  <option value="OPEN">Em aberto</option>
                  <option value="OVERDUE">Vencida</option>
                  <option value="PARTIAL">Parcial</option>
                  <option value="PAID">Quitada</option>
                  <option value="CANCELLED">Cancelada</option>
                </select>
              </div>

              {/* Category */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Categoria
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-full px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
                >
                  <option value="">Todas as categorias</option>
                  {leafCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Due Dates */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Venc. De
                  </label>
                  <input
                    type="date"
                    value={dueFromFilter}
                    onChange={(e) => {
                      setDueFromFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Até
                  </label>
                  <input
                    type="date"
                    value={dueToFilter}
                    onChange={(e) => {
                      setDueToFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand)]"
                  />
                </div>
              </div>
            </div>

            {/* Clear Filters Button */}
            {(kindFilter || statusFilter || categoryFilter || searchQuery || dueFromFilter || dueToFilter) && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-xs font-semibold text-[var(--brand)] hover:underline"
                >
                  Limpar todos os filtros
                </button>
              </div>
            )}
          </div>

          {/* Loading / Error / Table Content */}
          {isLoading ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-12 text-center text-xs text-[var(--text-muted)] space-y-3">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-[var(--brand)] border-t-transparent"></div>
              <p>Carregando contas...</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-center space-y-3">
              <p className="text-xs text-red-300">{error}</p>
              <button
                type="button"
                onClick={() => fetchTitles()}
                className="px-4 py-2 text-xs font-bold rounded-lg border border-red-500/40 text-red-300 hover:bg-red-950/40"
              >
                Tentar Novamente
              </button>
            </div>
          ) : !titlesData || titlesData.items.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-12 text-center space-y-3">
              <p className="text-xs text-[var(--text-muted)]">
                Nenhuma conta encontrada com os filtros selecionados.
              </p>
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-[var(--brand)] text-black hover:opacity-90"
              >
                Criar Nova Conta
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* DESKTOP TABLE VIEW */}
              <div className="hidden md:block rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--surface-raised)] border-b border-[var(--border-subtle)] text-[var(--text-muted)] font-bold uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3">Título</th>
                      <th className="px-4 py-3">Categoria</th>
                      <th className="px-4 py-3">Vencimento</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Valor Orig.</th>
                      <th className="px-4 py-3 text-right">Saldo Rest.</th>
                      <th className="px-4 py-3 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {titlesData.items.map((item) => {
                      const kindB = getKindBadge(item.kind);
                      const statusB = getDerivedStatusBadge(item.derivedStatus);

                      return (
                        <tr
                          key={item.id}
                          className="hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                          onClick={() => openDetailModal(item.id)}
                        >
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full border ${kindB.className}`}>
                              {kindB.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">
                            {item.title}
                          </td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">
                            {item.category ? `${item.category.code} - ${item.category.name}` : "-"}
                          </td>
                          <td className="px-4 py-3 text-[var(--text-secondary)] whitespace-nowrap">
                            {new Date(item.dueOn).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`px-2.5 py-0.5 text-[11px] font-bold rounded-full border ${statusB.className}`}>
                              {statusB.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-[var(--text-secondary)] whitespace-nowrap">
                            {formatCurrencyBRL(item.originalAmount)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-[var(--text-primary)] whitespace-nowrap">
                            {formatCurrencyBRL(item.outstandingPrincipal)}
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => openDetailModal(item.id)}
                              className="px-3 py-1 text-[11px] font-bold rounded-md border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                            >
                              Ver / Ações
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* MOBILE STACKED CARDS VIEW */}
              <div className="md:hidden space-y-3">
                {titlesData.items.map((item) => {
                  const kindB = getKindBadge(item.kind);
                  const statusB = getDerivedStatusBadge(item.derivedStatus);

                  return (
                    <div
                      key={item.id}
                      onClick={() => openDetailModal(item.id)}
                      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 space-y-3 hover:border-[var(--brand)] transition-colors cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-full border mb-1 ${kindB.className}`}>
                            {kindB.label}
                          </span>
                          <h3 className="text-sm font-bold text-[var(--text-primary)] leading-tight">
                            {item.title}
                          </h3>
                        </div>
                        <span className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full border shrink-0 ${statusB.className}`}>
                          {statusB.label}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-[var(--border-subtle)]">
                        <div>
                          <span className="text-[10px] text-[var(--text-muted)] font-semibold uppercase block">
                            Categoria
                          </span>
                          <span className="text-[var(--text-secondary)] font-medium">
                            {item.category ? item.category.name : "-"}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[var(--text-muted)] font-semibold uppercase block">
                            Vencimento
                          </span>
                          <span className="text-[var(--text-secondary)] font-medium">
                            {new Date(item.dueOn).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[var(--text-muted)] font-semibold uppercase block">
                            Valor Original
                          </span>
                          <span className="text-[var(--text-secondary)] font-medium">
                            {formatCurrencyBRL(item.originalAmount)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-[var(--text-muted)] font-semibold uppercase block">
                            Saldo Restante
                          </span>
                          <span className="text-[var(--text-primary)] font-bold">
                            {formatCurrencyBRL(item.outstandingPrincipal)}
                          </span>
                        </div>
                      </div>

                      <div className="pt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => openDetailModal(item.id)}
                          className="w-full py-2 text-xs font-bold rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
                        >
                          Ver / Efetuar Baixa
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* PAGINATION */}
              {titlesData.totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs">
                  <span className="text-[var(--text-muted)]">
                    Mostrando página <strong className="text-[var(--text-primary)]">{titlesData.page}</strong> de{" "}
                    <strong className="text-[var(--text-primary)]">{titlesData.totalPages}</strong> ({titlesData.total} contas)
                  </span>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      disabled={page >= titlesData.totalPages}
                      onClick={() => setPage((p) => Math.min(titlesData.totalPages, p + 1))}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
                    >
                      Próxima
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      <TitleCreateModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={() => {
          fetchTitles();
        }}
        leafCategories={leafCategories}
      />

      <TitleDetailModal
        isOpen={isDetailOpen}
        titleId={selectedTitleId}
        onClose={() => {
          setIsDetailOpen(false);
          setSelectedTitleId(null);
        }}
        onSuccess={() => {
          fetchTitles();
        }}
        leafCategories={leafCategories}
      />
    </div>
  );
}
