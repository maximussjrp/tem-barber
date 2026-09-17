"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CategoryNode,
  ClientFinancialRoutine,
  deactivateRoutineClient,
  fetchCategoriesTreeClient,
  fetchRoutinesListClient,
  findCategoryByCode,
  reactivateRoutineClient,
  RECURRING_EXPENSE_PRESETS,
  RecurringExpensePreset,
} from "@/lib/financial/routines-client";
import { RecurringExpenseCard } from "@/components/admin/financial/RecurringExpenseCard";
import { RoutineConfigModal } from "@/components/admin/financial/RoutineConfigModal";

export default function ConfiguracoesFinanceirasPage() {
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [routines, setRoutines] = useState<ClientFinancialRoutine[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [refreshCount, setRefreshCount] = useState(0);

  const loadControllerRef = useRef<AbortController | null>(null);
  const routineActionLocksRef = useRef(new Set<string>());

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activePreset, setActivePreset] = useState<RecurringExpensePreset | null>(null);
  const [routineToEdit, setRoutineToEdit] = useState<ClientFinancialRoutine | null>(null);

  const reloadData = useCallback(() => {
    loadControllerRef.current?.abort();
    setIsLoading(true);
    setErrorStatus(null);
    setErrorMessage(null);
    setRefreshCount((c) => c + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadControllerRef.current = controller;

    async function load() {
      try {
        const [categoriesTree, routinesList] = await Promise.all([
          fetchCategoriesTreeClient(controller.signal),
          fetchRoutinesListClient(controller.signal),
        ]);

        if (controller.signal.aborted) return;

        setCategories(categoriesTree);
        setRoutines(routinesList);
        setErrorStatus(null);
        setErrorMessage(null);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;

        if (typeof err === "object" && err !== null && "status" in err) {
          const apiErr = err as { status: number; message: string };
          setErrorStatus(apiErr.status);
          setErrorMessage(apiErr.message);
        } else if (err instanceof Error) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage("Erro ao carregar dados de configurações financeiras.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
      }
      controller.abort();
    };
  }, [refreshCount]);

  const handleOpenCreate = (preset: RecurringExpensePreset) => {
    setActivePreset(preset);
    setRoutineToEdit(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (preset: RecurringExpensePreset, routine: ClientFinancialRoutine) => {
    setActivePreset(preset);
    setRoutineToEdit(routine);
    setIsModalOpen(true);
  };

  const handleDeactivate = async (routine: ClientFinancialRoutine) => {
    if (routineActionLocksRef.current.has(routine.id)) return;

    if (!window.confirm(`Deseja realmente desativar a rotina "${routine.title}"?`)) {
      return;
    }

    try {
      routineActionLocksRef.current.add(routine.id);
      await deactivateRoutineClient(routine.id);
      reloadData();
    } catch (err: unknown) {
      if (err instanceof Error) {
        alert(err.message);
      } else {
        alert("Erro ao desativar rotina.");
      }
    } finally {
      routineActionLocksRef.current.delete(routine.id);
    }
  };

  const handleReactivate = async (routine: ClientFinancialRoutine) => {
    if (routineActionLocksRef.current.has(routine.id)) return;

    try {
      routineActionLocksRef.current.add(routine.id);
      await reactivateRoutineClient(routine.id);
      setInfoMessage("Reativar não cria automaticamente meses anteriores.");
      setTimeout(() => setInfoMessage(null), 5000);
      reloadData();
    } catch (err: unknown) {
      if (err instanceof Error) {
        alert(err.message);
      } else {
        alert("Erro ao reativar rotina.");
      }
    } finally {
      routineActionLocksRef.current.delete(routine.id);
    }
  };

  // Map routines to preset codes
  const routinesByCategoryCode = useMemo(() => {
    const map = new Map<string, ClientFinancialRoutine[]>();
    for (const routine of routines) {
      let code = routine.category?.code;
      if (!code) {
        const findCode = (nodes: CategoryNode[]): string | undefined => {
          for (const n of nodes) {
            if (n.id === routine.categoryId) return n.code;
            if (n.children) {
              const res = findCode(n.children);
              if (res) return res;
            }
          }
          return undefined;
        };
        code = findCode(categories);
      }

      if (code) {
        const list = map.get(code) || [];
        list.push(routine);
        map.set(code, list);
      }
    }
    return map;
  }, [routines, categories]);

  const activeCategoryForModal = useMemo(() => {
    if (!activePreset) return null;
    return findCategoryByCode(categories, activePreset.code);
  }, [categories, activePreset]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">
            Configurações Financeiras
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Configure como o financeiro da sua barbearia funciona.
          </p>
        </div>
      </div>

      {infoMessage && (
        <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs flex items-center justify-between">
          <span>{infoMessage}</span>
          <button
            type="button"
            onClick={() => setInfoMessage(null)}
            className="text-xs font-semibold underline ml-2"
          >
            OK
          </button>
        </div>
      )}

      {/* Loading State */}
      {isLoading ? (
        <div className="p-12 text-center text-xs text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-xl bg-[var(--surface)]">
          Carregando configurações financeiras...
        </div>
      ) : errorStatus === 403 ? (
        <div className="p-8 text-center border border-red-500/30 bg-red-500/10 rounded-xl space-y-2">
          <h2 className="text-lg font-bold text-red-400">Acesso Negado</h2>
          <p className="text-xs text-[var(--text-muted)]">
            Você não possui permissão para acessar as configurações financeiras.
          </p>
        </div>
      ) : errorMessage ? (
        <div className="p-8 text-center border border-red-500/30 bg-red-500/10 rounded-xl space-y-4">
          <p className="text-xs text-red-400">{errorMessage}</p>
          <button
            type="button"
            onClick={reloadData}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors"
          >
            Tentar Novamente
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Section: Despesas recorrentes */}
          <div className="space-y-2">
            <h2 className="text-lg font-serif font-bold text-[var(--text-primary)]">
              Despesas recorrentes
            </h2>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed max-w-2xl">
              Configure contas que se repetem todo mês. O Tem Barber cria os títulos financeiros a partir dessas configurações.
            </p>

            {/* Grid of 6 Presets */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              {RECURRING_EXPENSE_PRESETS.map((preset) => {
                const category = findCategoryByCode(categories, preset.code);
                const presetRoutines = routinesByCategoryCode.get(preset.code) || [];

                return (
                  <RecurringExpenseCard
                    key={preset.code}
                    preset={preset}
                    category={category}
                    routines={presetRoutines}
                    onConfigureNew={() => handleOpenCreate(preset)}
                    onEditRoutine={(r) => handleOpenEdit(preset, r)}
                    onDeactivateRoutine={handleDeactivate}
                    onReactivateRoutine={handleReactivate}
                  />
                );
              })}
            </div>
          </div>

          {/* Card: Categorias (UX-D Placeholder) */}
          <div className="pt-4 border-t border-[var(--border-subtle)]">
            <div className="max-w-md rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 9h16" />
                    <path d="M4 15h16" />
                    <path d="M10 3v18" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">
                    Categorias
                  </h2>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Organize a classificação das movimentações financeiras.
                  </p>
                </div>
              </div>
              <p className="text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-3 leading-relaxed">
                Plano de contas e categorias usados para organizar receitas, despesas e demais movimentações financeiras.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && activePreset && (
        <RoutineConfigModal
          key={`${activePreset.code}-${routineToEdit?.id || "new"}`}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          preset={activePreset}
          category={activeCategoryForModal}
          routineToEdit={routineToEdit}
          onSuccess={reloadData}
        />
      )}
    </div>
  );
}
