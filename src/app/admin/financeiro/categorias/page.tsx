"use client";

import { useState, useEffect, useCallback } from "react";
import { FinancialNav } from "@/components/admin/financial/FinancialNav";
import type { CategoryNode } from "@/lib/financial/categories";
import { LeafCategoryOption, flattenLeafCategories } from "@/lib/financial/accounts-client";

interface FlattenedCategoryWithDepth {
  id: string;
  code: string;
  name: string;
  classification: string;
  parentCategoryId: string | null;
  isActive: boolean;
  depth: number;
  isLeaf: boolean;
  hasChildren: boolean;
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  REVENUE: "Receita",
  VARIABLE_COST: "Custos Variáveis",
  FIXED_EXPENSE: "Despesas Fixas",
  INVESTMENT: "Investimentos",
  NON_OPERATING_IN: "Entradas Não Operacionais",
  NON_OPERATING_OUT: "Saídas Não Operacionais",
  TRANSFER: "Transferências",
  ADJUSTMENT: "Ajustes",
};

export default function CategoriasPage() {
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [leafCategories, setLeafCategories] = useState<LeafCategoryOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createClassification, setCreateClassification] = useState<string>("FIXED_EXPENSE");
  const [createParentId, setCreateParentId] = useState<string>("");
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [renameTarget, setRenameTarget] = useState<FlattenedCategoryWithDepth | null>(null);
  const [renameName, setRenameName] = useState("");
  const [isSubmittingRename, setIsSubmittingRename] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [moveTarget, setMoveTarget] = useState<FlattenedCategoryWithDepth | null>(null);
  const [moveParentId, setMoveParentId] = useState<string>("");
  const [isSubmittingMove, setIsSubmittingMove] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const [retireTarget, setRetireTarget] = useState<FlattenedCategoryWithDepth | null>(null);
  const [replacementCategoryId, setReplacementCategoryId] = useState<string>("");
  const [isReplacementRequired, setIsReplacementRequired] = useState(false);
  const [isSubmittingRetire, setIsSubmittingRetire] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);

  const loadCategories = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    setIsForbidden(false);

    try {
      const res = await fetch("/api/admin/financial/categories", { signal });
      if (signal?.aborted) return;
      if (res.status === 403) {
        setIsForbidden(true);
        return;
      }
      if (!res.ok) {
        throw new Error("Erro ao carregar plano de contas.");
      }
      const data: CategoryNode[] = await res.json();
      if (signal?.aborted) return;
      setTree(data);
      setLeafCategories(flattenLeafCategories(data));
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === "AbortError" || signal?.aborted) return;
      setError((err as Error).message || "Erro inesperado.");
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        void loadCategories(controller.signal);
      }
    });
    return () => controller.abort();
  }, [loadCategories]);

  // Flatten tree for list rendering preserving indentation & depth
  const flattenedNodes: FlattenedCategoryWithDepth[] = [];
  const traverse = (nodes: CategoryNode[]) => {
    for (const node of nodes) {
      flattenedNodes.push({
        id: node.id,
        code: node.code,
        name: node.name,
        classification: node.classification,
        parentCategoryId: node.parentCategoryId,
        isActive: node.isActive,
        depth: node.depth,
        isLeaf: node.isLeaf,
        hasChildren: (node.children || []).length > 0,
      });
      if (node.children && node.children.length > 0) {
        traverse(node.children);
      }
    }
  };
  traverse(tree);

  // Eligible parents for Move and Create (backend is 1-indexed: root=1, child=2, grandchild=3; so parent can be depth 1 or 2)
  const eligibleParentsForTarget = (target?: FlattenedCategoryWithDepth | null) => {
    return flattenedNodes.filter((c) => {
      if (!c.isActive) return false;
      if (target) {
        if (c.id === target.id) return false;
        if (c.classification !== target.classification) return false;
      }
      // Parent depth can be <= 2 (or < 3) so that children can reach depth 3
      return c.depth <= 2;
    });
  };

  // Eligible replacements for Retire (must be leaf, active, same classification, different ID)
  const eligibleReplacements = (target?: FlattenedCategoryWithDepth | null) => {
    if (!target) return [];
    return leafCategories.filter(
      (c) => c.id !== target.id && c.classification === target.classification
    );
  };

  // Create Category
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) {
      setCreateError("O nome da categoria é obrigatório.");
      return;
    }
    setIsSubmittingCreate(true);
    setCreateError(null);

    try {
      const res = await fetch("/api/admin/financial/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          classification: createClassification,
          parentCategoryId: createParentId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao criar categoria.");
      }

      setIsCreateOpen(false);
      setCreateName("");
      setCreateParentId("");
      loadCategories();
    } catch (err: unknown) {
      setCreateError((err as Error).message);
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  // Rename Category
  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget) return;
    if (!renameName.trim()) {
      setRenameError("O nome não pode ser vazio.");
      return;
    }
    setIsSubmittingRename(true);
    setRenameError(null);

    try {
      const res = await fetch(`/api/admin/financial/categories/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameName.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao renomear categoria.");
      }

      setRenameTarget(null);
      setRenameName("");
      loadCategories();
    } catch (err: unknown) {
      setRenameError((err as Error).message);
    } finally {
      setIsSubmittingRename(false);
    }
  };

  // Move Category
  const handleMoveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveTarget) return;
    setIsSubmittingMove(true);
    setMoveError(null);

    try {
      const res = await fetch(`/api/admin/financial/categories/${moveTarget.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentCategoryId: moveParentId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erro ao mover categoria.");
      }

      setMoveTarget(null);
      setMoveParentId("");
      loadCategories();
    } catch (err: unknown) {
      setMoveError((err as Error).message);
    } finally {
      setIsSubmittingMove(false);
    }
  };

  // Retire Category
  const handleRetireSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retireTarget) return;
    setIsSubmittingRetire(true);
    setRetireError(null);

    try {
      const payload: { replacementCategoryId?: string } = {};
      if (replacementCategoryId) {
        payload.replacementCategoryId = replacementCategoryId;
      }

      const res = await fetch(`/api/admin/financial/categories/${retireTarget.id}/retire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.code === "FINANCIAL_CATEGORY_REPLACEMENT_REQUIRED") {
          setIsReplacementRequired(true);
          throw new Error(data.error);
        }
        throw new Error(data.error || "Erro ao inativar categoria.");
      }

      setRetireTarget(null);
      setReplacementCategoryId("");
      setIsReplacementRequired(false);
      loadCategories();
    } catch (err: unknown) {
      setRetireError((err as Error).message);
    } finally {
      setIsSubmittingRetire(false);
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
            Plano de Categorias
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Organize a hierarquia e classificação de receitas e despesas.
          </p>
        </div>

        <button
          onClick={() => {
            setCreateName("");
            setCreateClassification("FIXED_EXPENSE");
            setCreateParentId("");
            setCreateError(null);
            setIsCreateOpen(true);
          }}
          className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition"
        >
          Nova Categoria
        </button>
      </div>

      {/* States: 403 Forbidden */}
      {isForbidden && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-6 text-center text-red-400">
          <p className="font-semibold text-base">Acesso negado</p>
          <p className="text-sm mt-1 text-red-300">
            Você não possui permissão para visualizar ou gerenciar as categorias financeiras.
          </p>
        </div>
      )}

      {/* States: Error */}
      {!isForbidden && error && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-6 text-center text-red-400 space-y-3">
          <p className="font-semibold">{error}</p>
          <button
            onClick={() => loadCategories()}
            className="px-4 py-2 bg-red-900/50 hover:bg-red-900 border border-red-700 rounded-lg text-sm text-red-100 transition"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* States: Loading */}
      {!isForbidden && !error && isLoading && (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-xl bg-zinc-900/40 border border-zinc-800/50 animate-pulse"
            />
          ))}
        </div>
      )}

      {/* States: Empty */}
      {!isForbidden && !error && !isLoading && flattenedNodes.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-12 text-center">
          <p className="text-base font-medium text-zinc-300">
            Nenhuma categoria encontrada
          </p>
          <p className="text-sm text-zinc-500 mt-1">
            Crie categorias para estruturar o plano financeiro.
          </p>
        </div>
      )}

      {/* Tree Content */}
      {!isForbidden && !error && !isLoading && flattenedNodes.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800/60 overflow-hidden">
          <div className="bg-zinc-950/60 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-400 grid grid-cols-12 gap-2">
            <div className="col-span-6 sm:col-span-5">Categoria</div>
            <div className="col-span-3 sm:col-span-3">Classificação</div>
            <div className="hidden sm:block sm:col-span-2">Código</div>
            <div className="col-span-3 sm:col-span-2 text-right">Ações</div>
          </div>

          <div className="divide-y divide-zinc-800/40">
            {flattenedNodes.map((item) => {
              const indentPadding =
                item.depth <= 1 ? "pl-4" : item.depth === 2 ? "pl-8" : "pl-12";

              return (
                <div
                  key={item.id}
                  className={`px-4 py-3 grid grid-cols-12 gap-2 items-center hover:bg-zinc-800/20 transition-colors ${
                    !item.isActive ? "opacity-50" : ""
                  }`}
                >
                  {/* Category Name & Indicator */}
                  <div className={`col-span-6 sm:col-span-5 flex items-center gap-2 ${indentPadding}`}>
                    {item.depth > 1 && (
                      <span className="text-zinc-600 select-none">↳</span>
                    )}
                    <div className="truncate">
                      <span className="font-medium text-sm text-zinc-200">
                        {item.name}
                      </span>
                      {!item.isActive && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-red-950 text-red-400 border border-red-900">
                          Inativa
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Classification */}
                  <div className="col-span-3 sm:col-span-3">
                    <span className="px-2 py-0.5 rounded text-xs bg-zinc-800 text-zinc-300 border border-zinc-700/50">
                      {CLASSIFICATION_LABELS[item.classification] || item.classification}
                    </span>
                  </div>

                  {/* Code */}
                  <div className="hidden sm:block sm:col-span-2 font-mono text-xs text-zinc-500 truncate">
                    {item.code}
                  </div>

                  {/* Actions */}
                  <div className="col-span-3 sm:col-span-2 flex items-center justify-end gap-1.5">
                    {item.isActive && (
                      <>
                        <button
                          onClick={() => {
                            setRenameTarget(item);
                            setRenameName(item.name);
                            setRenameError(null);
                          }}
                          className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                          title="Renomear"
                        >
                          Renomear
                        </button>

                        <button
                          onClick={() => {
                            setMoveTarget(item);
                            setMoveParentId(item.parentCategoryId || "");
                            setMoveError(null);
                          }}
                          className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                          title="Mover"
                        >
                          Mover
                        </button>

                        <button
                          onClick={() => {
                            setRetireTarget(item);
                            setReplacementCategoryId("");
                            setIsReplacementRequired(false);
                            setRetireError(null);
                          }}
                          className="px-2 py-1 text-xs rounded bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-900/50 transition"
                          title="Aposentar"
                        >
                          Aposentar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal: Create Category */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
            <h3 className="text-lg font-bold text-white">Nova Categoria</h3>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Nome da Categoria
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Aluguel da Loja"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label htmlFor="create-classification-select" className="block text-xs font-medium text-zinc-400 mb-1">
                  Classificação
                </label>
                <select
                  id="create-classification-select"
                  aria-label="Classificação"
                  value={createClassification}
                  onChange={(e) => {
                    setCreateClassification(e.target.value);
                    setCreateParentId("");
                  }}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                >
                  {Object.entries(CLASSIFICATION_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="create-parent-select" className="block text-xs font-medium text-zinc-400 mb-1">
                  Categoria Pai (Opcional - Raiz por padrão)
                </label>
                <select
                  id="create-parent-select"
                  aria-label="Categoria Pai"
                  value={createParentId}
                  onChange={(e) => setCreateParentId(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="">Nenhuma (Categoria Raiz)</option>
                  {eligibleParentsForTarget()
                    .filter((c) => c.classification === createClassification)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {"— ".repeat(Math.max(0, c.depth - 1))}
                        {c.name}
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-zinc-500 mt-1">
                  A hierarquia suporta no máximo 3 níveis.
                </p>
              </div>

              {createError && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-900/60 text-xs text-red-300">
                  {createError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm transition"
                >
                  {isSubmittingCreate ? "Salvando..." : "Criar Categoria"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Rename Category */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
            <h3 className="text-lg font-bold text-white">Renomear Categoria</h3>

            <form onSubmit={handleRenameSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Novo Nome
                </label>
                <input
                  type="text"
                  required
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              {renameError && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-900/60 text-xs text-red-300">
                  {renameError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRename}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm transition"
                >
                  {isSubmittingRename ? "Salvando..." : "Salvar Alterações"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Move Category */}
      {moveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
            <h3 className="text-lg font-bold text-white">
              Mover &quot;{moveTarget.name}&quot;
            </h3>

            <form onSubmit={handleMoveSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Novo Pai
                </label>
                <select
                  value={moveParentId}
                  onChange={(e) => setMoveParentId(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="">Nenhum (Raiz)</option>
                  {eligibleParentsForTarget(moveTarget).map((c) => (
                    <option key={c.id} value={c.id}>
                      {"— ".repeat(Math.max(0, c.depth - 1))}
                      {c.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Deve ter a mesma classificação ({CLASSIFICATION_LABELS[moveTarget.classification] || moveTarget.classification}) e profundidade máxima permitida.
                </p>
              </div>

              {moveError && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-900/60 text-xs text-red-300">
                  {moveError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setMoveTarget(null)}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingMove}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-semibold text-sm transition"
                >
                  {isSubmittingMove ? "Movendo..." : "Confirmar Movimentação"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Retire Category */}
      {retireTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
            <h3 className="text-lg font-bold text-white">
              Aposentar &quot;{retireTarget.name}&quot;
            </h3>

            <form onSubmit={handleRetireSubmit} className="space-y-4">
              <p className="text-sm text-zinc-400">
                Aposentar esta categoria impedirá novos lançamentos com ela.
                {retireTarget.hasChildren && (
                  <span className="block mt-2 text-rose-400 text-xs">
                    Aviso: Categorias com subcategorias ativas não podem ser aposentadas diretamente.
                  </span>
                )}
              </p>

              {isReplacementRequired && (
                <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-900/60 space-y-2">
                  <p className="text-xs font-medium text-amber-300">
                    Esta categoria está em uso. É obrigatório selecionar uma categoria substituta para receber as pendências:
                  </p>
                  <select
                    required
                    value={replacementCategoryId}
                    onChange={(e) => setReplacementCategoryId(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                  >
                    <option value="">Selecione uma substituta...</option>
                    {eligibleReplacements(retireTarget).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {retireError && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-900/60 text-xs text-red-300">
                  {retireError}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setRetireTarget(null);
                    setIsReplacementRequired(false);
                    setReplacementCategoryId("");
                  }}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRetire || (isReplacementRequired && !replacementCategoryId)}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold text-sm transition"
                >
                  {isSubmittingRetire ? "Processando..." : "Confirmar Aposentadoria"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
