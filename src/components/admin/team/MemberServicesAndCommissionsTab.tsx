"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

export interface CommissionSettingsData {
  memberId: string;
  memberName: string;
  role: string;
  careerLevelId: string | null;
  careerLevelName: string | null;
  isCommissionEligible: boolean;
  selectedServiceIds: string[];
  services: Array<{
    id: string;
    name: string;
    categoryId: string | null;
    categoryName: string | null;
    price: string | number;
    isSelected: boolean;
    effectiveCommission: {
      type: "PERCENTAGE" | "FIXED_VALUE";
      value: number;
      origin: string;
      configId: string | null;
      isCustomized: boolean;
    } | null;
    individualRule: {
      id: string;
      type: "PERCENTAGE" | "FIXED_VALUE";
      value: number;
      active: boolean;
    } | null;
  }>;
  productDefaultRule: {
    effective: {
      type: "PERCENTAGE" | "FIXED_VALUE";
      value: number;
      origin: string;
      isCustomized: boolean;
    } | null;
    individualRule: {
      id: string;
      type: "PERCENTAGE" | "FIXED_VALUE";
      value: number;
      active: boolean;
    } | null;
  };
  products: Array<{
    id: string;
    name: string;
    salePrice: string | number;
    effectiveCommission: {
      type: "PERCENTAGE" | "FIXED_VALUE";
      value: number;
      origin: string;
      configId: string | null;
      isCustomized: boolean;
    } | null;
    individualRule: {
      id: string;
      type: "PERCENTAGE" | "FIXED_VALUE";
      value: number;
      active: boolean;
    } | null;
  }>;
}

interface MemberServicesAndCommissionsTabProps {
  memberId: string;
  legacyServices: Array<{ id: string; name: string; price: string; category: { name: string } }>;
  legacySelectedServices: Set<string>;
  onLegacyToggleService: (id: string) => void;
  onLegacySaveServices: () => Promise<void>;
  savingLegacyServices: boolean;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

interface RuleDraft {
  type: "PERCENTAGE" | "FIXED_VALUE";
  value: string;
}

function getOriginLabel(origin?: string): string {
  switch (origin) {
    case "MEMBER_SERVICE":
      return "Exceção Individual";
    case "CAREER_LEVEL_SERVICE":
      return "Regra de Carreira";
    case "BARBERSHOP_DEFAULT":
      return "Padrão da Barbearia";
    case "MEMBER_DEFAULT":
      return "Padrão Individual";
    case "MEMBER_PRODUCT":
      return "Exceção Individual";
    case "MEMBER_PRODUCT_DEFAULT":
      return "Padrão Individual";
    case "PRODUCT_DEFAULT":
      return "Padrão da Barbearia";
    case "PRODUCT_SPECIFIC":
      return "Produto Específico";
    default:
      return origin || "Configuração Geral";
  }
}

export function MemberServicesAndCommissionsTab({
  memberId,
  legacyServices,
  legacySelectedServices,
  onLegacyToggleService,
  onLegacySaveServices,
  savingLegacyServices,
  onSuccess,
  onError,
}: MemberServicesAndCommissionsTabProps) {
  const [loading, setLoading] = useState(true);
  const [hasCommissionAccess, setHasCommissionAccess] = useState(true);
  const [saving, setSaving] = useState(false);

  // Initial loaded baseline
  const [initialData, setInitialData] = useState<CommissionSettingsData | null>(null);

  // Form states
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [isCommissionEligible, setIsCommissionEligible] = useState(true);

  // Service overrides: map of serviceId -> RuleDraft (active override) or "RESTORE" (to remove individual rule)
  const [serviceOverrides, setServiceOverrides] = useState<Record<string, RuleDraft | "RESTORE">>({});
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);

  // Product default override: RuleDraft or "RESTORE"
  const [productDefaultOverride, setProductDefaultOverride] = useState<RuleDraft | "RESTORE" | null>(null);
  const [editingProductDefault, setEditingProductDefault] = useState(false);

  // Product overrides: map of productId -> RuleDraft or "RESTORE"
  const [productOverrides, setProductOverrides] = useState<Record<string, RuleDraft | "RESTORE">>({});
  const [editingProductId, setEditingProductId] = useState<string | null>(null);

  const loadCommissionSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/team/${memberId}/commission-settings`);
      if (res.status === 403) {
        setHasCommissionAccess(false);
        return;
      }
      if (!res.ok) {
        throw new Error("Erro ao carregar serviços e comissões.");
      }
      const data: CommissionSettingsData = await res.json();
      setInitialData(data);
      setHasCommissionAccess(true);
      setSelectedServices(new Set(data.selectedServiceIds));
      setIsCommissionEligible(data.isCommissionEligible);
      setServiceOverrides({});
      setProductDefaultOverride(null);
      setProductOverrides({});
    } catch (e: any) {
      onError(e.message || "Erro ao carregar comissões.");
    } finally {
      setLoading(false);
    }
  }, [memberId, onError]);

  useEffect(() => {
    loadCommissionSettings();
  }, [loadCommissionSettings]);

  // ─────────────────────────────────────────
  // Fallback para perfil sem permissão financeira
  // ─────────────────────────────────────────
  if (!loading && !hasCommissionAccess) {
    return (
      <div data-testid="fallback-legacy-services">
        <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden mb-4">
          <div className="px-5 py-3 border-b border-stone-800 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
              Selecione os serviços que este colaborador realiza
            </p>
            <span className="text-[11px] text-stone-500">
              (Acesso a comissões restrito aos proprietários e gerentes autorizados)
            </span>
          </div>
          {legacyServices.length === 0 ? (
            <p className="text-stone-600 text-sm p-5 text-center">
              Nenhum serviço cadastrado.{" "}
              <Link href="/admin/servicos" className="text-amber-400 hover:underline">
                Criar serviços →
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-stone-800">
              {legacyServices.map((s) => (
                <li key={s.id} className="px-5 py-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={legacySelectedServices.has(s.id)}
                      onChange={() => onLegacyToggleService(s.id)}
                      className="w-4 h-4 accent-amber-500"
                      title={`Selecionar serviço ${s.name}`}
                    />
                    <div className="flex-1">
                      <p className="text-stone-200 text-sm">{s.name}</p>
                      <p className="text-stone-500 text-xs">{s.category.name}</p>
                    </div>
                    <span className="text-amber-400 text-sm font-medium">
                      R$ {Number(s.price).toFixed(2).replace(".", ",")}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end">
          <button
            onClick={onLegacySaveServices}
            disabled={savingLegacyServices}
            className="bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold px-8 py-3 rounded-lg text-sm transition-all disabled:opacity-50 cursor-pointer"
          >
            {savingLegacyServices ? "Salvando..." : "Salvar Serviços"}
          </button>
        </div>
      </div>
    );
  }

  if (loading || !initialData) {
    return (
      <div className="bg-stone-900 border border-stone-800 rounded-xl p-8 text-center text-stone-500">
        Carregando configurações de serviços e comissões...
      </div>
    );
  }

  // ─────────────────────────────────────────
  // Ações de alteração de estado
  // ─────────────────────────────────────────
  const toggleService = (id: string) => {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Seção A - Serviços
  const handleStartCustomizingService = (serviceId: string, currentType: "PERCENTAGE" | "FIXED_VALUE", currentValue: number) => {
    setEditingServiceId(serviceId);
    if (!serviceOverrides[serviceId] || serviceOverrides[serviceId] === "RESTORE") {
      setServiceOverrides((prev) => ({
        ...prev,
        [serviceId]: { type: currentType, value: String(currentValue) },
      }));
    }
  };

  const handleUpdateServiceRuleDraft = (serviceId: string, field: "type" | "value", val: string) => {
    setServiceOverrides((prev) => {
      const existing = (prev[serviceId] && prev[serviceId] !== "RESTORE" ? prev[serviceId] : { type: "PERCENTAGE", value: "0" }) as RuleDraft;
      return {
        ...prev,
        [serviceId]: {
          ...existing,
          [field]: val,
        },
      };
    });
  };

  const handleRestoreService = (serviceId: string) => {
    setEditingServiceId(null);
    setServiceOverrides((prev) => ({
      ...prev,
      [serviceId]: "RESTORE",
    }));
  };

  // Seção B - Produtos
  const handleStartCustomizingProductDefault = (currentType: "PERCENTAGE" | "FIXED_VALUE", currentValue: number) => {
    setEditingProductDefault(true);
    if (!productDefaultOverride || productDefaultOverride === "RESTORE") {
      setProductDefaultOverride({ type: currentType, value: String(currentValue) });
    }
  };

  const handleUpdateProductDefaultDraft = (field: "type" | "value", val: string) => {
    setProductDefaultOverride((prev) => {
      const existing = (prev && prev !== "RESTORE" ? prev : { type: "PERCENTAGE", value: "0" }) as RuleDraft;
      return {
        ...existing,
        [field]: val,
      };
    });
  };

  const handleRestoreProductDefault = () => {
    setEditingProductDefault(false);
    setProductDefaultOverride("RESTORE");
  };

  const handleStartCustomizingProduct = (productId: string, currentType: "PERCENTAGE" | "FIXED_VALUE", currentValue: number) => {
    setEditingProductId(productId);
    if (!productOverrides[productId] || productOverrides[productId] === "RESTORE") {
      setProductOverrides((prev) => ({
        ...prev,
        [productId]: { type: currentType, value: String(currentValue) },
      }));
    }
  };

  const handleUpdateProductRuleDraft = (productId: string, field: "type" | "value", val: string) => {
    setProductOverrides((prev) => {
      const existing = (prev[productId] && prev[productId] !== "RESTORE" ? prev[productId] : { type: "PERCENTAGE", value: "0" }) as RuleDraft;
      return {
        ...prev,
        [productId]: {
          ...existing,
          [field]: val,
        },
      };
    });
  };

  const handleRestoreProduct = (productId: string) => {
    setEditingProductId(null);
    setProductOverrides((prev) => ({
      ...prev,
      [productId]: "RESTORE",
    }));
  };

  // ─────────────────────────────────────────
  // Salvamento Atômico (PUT)
  // ─────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {};

      // 1. selectedServiceIds (somente se alterou)
      const initialSelected = new Set(initialData.selectedServiceIds);
      let servicesChanged = selectedServices.size !== initialSelected.size;
      if (!servicesChanged) {
        for (const id of selectedServices) {
          if (!initialSelected.has(id)) {
            servicesChanged = true;
            break;
          }
        }
      }
      if (servicesChanged) {
        payload.selectedServiceIds = Array.from(selectedServices);
      }

      // 2. Elegibilidade (somente se alterou)
      if (isCommissionEligible !== initialData.isCommissionEligible) {
        payload.isCommissionEligible = isCommissionEligible;
      }

      // 3. serviceRules e removeServiceRuleIds
      const serviceRules: any[] = [];
      const removeServiceRuleIds: string[] = [];

      for (const [srvId, action] of Object.entries(serviceOverrides)) {
        if (action === "RESTORE") {
          const svc = initialData.services.find((s) => s.id === srvId);
          if (svc?.individualRule?.id) {
            removeServiceRuleIds.push(svc.individualRule.id);
          }
        } else if (action && typeof action === "object") {
          const numVal = Number(action.value);
          if (isNaN(numVal) || numVal < 0) {
            throw new Error("O valor da comissão de serviço deve ser um número não negativo.");
          }
          serviceRules.push({
            serviceId: srvId,
            type: action.type,
            value: numVal,
            active: true,
          });
        }
      }
      if (serviceRules.length > 0) payload.serviceRules = serviceRules;
      if (removeServiceRuleIds.length > 0) payload.removeServiceRuleIds = removeServiceRuleIds;

      // 4. productDefaultRule
      if (productDefaultOverride === "RESTORE") {
        if (initialData.productDefaultRule.individualRule) {
          payload.productDefaultRule = null;
        }
      } else if (productDefaultOverride && typeof productDefaultOverride === "object") {
        const numVal = Number(productDefaultOverride.value);
        if (isNaN(numVal) || numVal < 0) {
          throw new Error("O valor da comissão padrão de produto deve ser um número não negativo.");
        }
        payload.productDefaultRule = {
          type: productDefaultOverride.type,
          value: numVal,
          active: true,
        };
      }

      // 5. productRules e removeProductRuleIds
      const productRules: any[] = [];
      const removeProductRuleIds: string[] = [];

      for (const [prodId, action] of Object.entries(productOverrides)) {
        if (action === "RESTORE") {
          const prod = initialData.products.find((p) => p.id === prodId);
          if (prod?.individualRule?.id) {
            removeProductRuleIds.push(prod.individualRule.id);
          }
        } else if (action && typeof action === "object") {
          const numVal = Number(action.value);
          if (isNaN(numVal) || numVal < 0) {
            throw new Error("O valor da comissão de produto deve ser um número não negativo.");
          }
          productRules.push({
            productId: prodId,
            type: action.type,
            value: numVal,
            active: true,
          });
        }
      }
      if (productRules.length > 0) payload.productRules = productRules;
      if (removeProductRuleIds.length > 0) payload.removeProductRuleIds = removeProductRuleIds;

      // Se nada foi alterado, apenas notificar
      if (Object.keys(payload).length === 0) {
        onSuccess("Nenhuma alteração detectada.");
        return;
      }

      const res = await fetch(`/api/admin/team/${memberId}/commission-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || resData.message || "Erro ao salvar configurações de comissão.");
      }

      onSuccess("Serviços e comissões atualizados com sucesso!");
      await loadCommissionSettings();
    } catch (e: any) {
      onError(e.message || "Erro ao salvar configurações.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="services-and-commissions-tab">
      {/* ─────────────────────────────────────────
          SEÇÃO C — Elegibilidade de Comissão
          ───────────────────────────────────────── */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl p-5 space-y-4" data-testid="eligibility-section">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-stone-300">
              Elegibilidade de Comissão
            </h2>
            <p className="text-xs text-stone-400 mt-1">
              Essa alteração vale para novos atendimentos e vendas. Comissões já reconhecidas são preservadas.
            </p>
          </div>
          <label className="flex items-center gap-3 cursor-pointer shrink-0">
            <span className="text-xs font-semibold text-stone-300">
              Recebe comissão?
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={isCommissionEligible}
              onChange={(e) => setIsCommissionEligible(e.target.checked)}
              className="w-5 h-5 accent-amber-500 cursor-pointer"
              aria-label="Recebe comissão?"
            />
          </label>
        </div>
      </div>

      {/* ─────────────────────────────────────────
          SEÇÃO A — Serviços e Comissões
          ───────────────────────────────────────── */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden" data-testid="services-section">
        <div className="px-5 py-3 border-b border-stone-800 bg-stone-950/40">
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber-500/90">
            Serviços e Comissões
          </h2>
          <p className="text-xs text-stone-400 mt-0.5">
            Defina quais serviços o profissional executa e personalize as comissões individuais quando necessário.
          </p>
        </div>

        {initialData.services.length === 0 ? (
          <p className="text-stone-600 text-sm p-5 text-center">
            Nenhum serviço cadastrado na barbearia.{" "}
            <Link href="/admin/servicos" className="text-amber-400 hover:underline">
              Criar serviços →
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-stone-800/80">
            {initialData.services.map((s) => {
              const isSelected = selectedServices.has(s.id);
              const override = serviceOverrides[s.id];
              const isOverridden = override && override !== "RESTORE";
              const isRestored = override === "RESTORE";

              // Regra individual existente no banco (se ativa)
              const hasSavedIndividual = Boolean(s.individualRule && s.individualRule.active);
              const hasActiveCustomization = isOverridden || (hasSavedIndividual && !isRestored);

              // Determinar o que exibir na interface
              let displayType = s.effectiveCommission?.type ?? "PERCENTAGE";
              let displayValue = s.effectiveCommission?.value ?? 0;
              let displayOrigin = getOriginLabel(s.effectiveCommission?.origin);

              if (isOverridden) {
                displayType = (override as RuleDraft).type;
                displayValue = Number((override as RuleDraft).value);
                displayOrigin = "Exceção Individual (não salva)";
              } else if (isRestored) {
                // Se foi restaurado, voltar para a regra herdada (origem diferente de individual)
                displayOrigin = "Padrão Herdado";
              }

              const isEditing = editingServiceId === s.id;

              return (
                <li key={s.id} className="p-4 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <label className="flex items-center gap-3 cursor-pointer flex-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleService(s.id)}
                        className="w-4 h-4 accent-amber-500"
                        title={`Realiza ${s.name}`}
                      />
                      <div>
                        <p className="text-stone-200 text-sm font-semibold">{s.name}</p>
                        <p className="text-stone-400 text-xs">
                          {s.categoryName || "Geral"} • Preço:{" "}
                          <span className="text-stone-300">
                            R$ {Number(s.price).toFixed(2).replace(".", ",")}
                          </span>
                        </p>
                      </div>
                    </label>

                    {/* Exibição da comissão */}
                    <div className="flex items-center gap-3 self-end md:self-center">
                      <div className="text-right">
                        <div className="text-sm font-bold text-amber-400">
                          {displayType === "PERCENTAGE" ? `${displayValue}%` : `R$ ${displayValue.toFixed(2).replace(".", ",")}`}
                        </div>
                        <span className="text-[10px] text-stone-400 bg-stone-950 px-2 py-0.5 rounded border border-stone-800">
                          {displayOrigin}
                        </span>
                      </div>

                      {/* Botões de Ação */}
                      <div className="flex items-center gap-1.5">
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => handleStartCustomizingService(s.id, displayType, displayValue)}
                            className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 px-2.5 py-1.5 rounded transition-all cursor-pointer"
                          >
                            Personalizar comissão
                          </button>
                        )}

                        {hasActiveCustomization && (
                          <button
                            type="button"
                            onClick={() => handleRestoreService(s.id)}
                            className="text-xs text-amber-400 hover:text-amber-300 hover:underline px-2 py-1.5 transition-all cursor-pointer"
                          >
                            Restaurar padrão
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Painel inline de personalização */}
                  {isEditing && (
                    <div className="bg-stone-950/80 border border-amber-500/30 rounded-lg p-3 flex flex-wrap items-center gap-3 mt-2">
                      <span className="text-xs font-semibold text-stone-300">Tipo:</span>
                      <select
                        aria-label="Tipo de comissão"
                        value={(serviceOverrides[s.id] as RuleDraft)?.type || "PERCENTAGE"}
                        onChange={(e) =>
                          handleUpdateServiceRuleDraft(s.id, "type", e.target.value as "PERCENTAGE" | "FIXED_VALUE")
                        }
                        className="bg-stone-900 border border-stone-700 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
                      >
                        <option value="PERCENTAGE">Percentual (%)</option>
                        <option value="FIXED_VALUE">Valor fixo (R$)</option>
                      </select>

                      <span className="text-xs font-semibold text-stone-300">Valor:</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label="Valor da comissão"
                        value={(serviceOverrides[s.id] as RuleDraft)?.value ?? "0"}
                        onChange={(e) => handleUpdateServiceRuleDraft(s.id, "value", e.target.value)}
                        className="w-24 bg-stone-900 border border-stone-700 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
                      />

                      <button
                        type="button"
                        onClick={() => setEditingServiceId(null)}
                        className="text-xs bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-3 py-1 rounded transition-all cursor-pointer ml-auto"
                      >
                        Aplicar
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ─────────────────────────────────────────
          SEÇÃO B — Comissão de Produtos
          ───────────────────────────────────────── */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden" data-testid="products-section">
        <div className="px-5 py-3 border-b border-stone-800 bg-stone-950/40">
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber-500/90">
            Comissão sobre Produtos
          </h2>
          <p className="text-xs text-stone-400 mt-0.5">
            Configure a comissão padrão individual para produtos e defina exceções específicas por produto.
          </p>
        </div>

        {/* B.1 — Regra Padrão de Produtos */}
        <div className="p-5 border-b border-stone-800 bg-stone-950/20 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-stone-200">
                Comissão Padrão de Produtos
              </p>
              <p className="text-xs text-stone-400">
                Aplicável a qualquer produto que não possua exceção individual.
              </p>
            </div>

            {(() => {
              const hasIndividualSaved = Boolean(
                initialData.productDefaultRule.individualRule &&
                initialData.productDefaultRule.individualRule.active
              );
              const isOverridden = productDefaultOverride && productDefaultOverride !== "RESTORE";
              const isRestored = productDefaultOverride === "RESTORE";
              const hasActiveCustomization = isOverridden || (hasIndividualSaved && !isRestored);

              let displayType = initialData.productDefaultRule.effective?.type ?? "PERCENTAGE";
              let displayValue = initialData.productDefaultRule.effective?.value ?? 0;
              let displayOrigin = getOriginLabel(initialData.productDefaultRule.effective?.origin);

              if (isOverridden) {
                displayType = (productDefaultOverride as RuleDraft).type;
                displayValue = Number((productDefaultOverride as RuleDraft).value);
                displayOrigin = "Padrão Individual (não salvo)";
              } else if (isRestored) {
                displayOrigin = "Padrão da Barbearia";
              }

              return (
                <div className="flex items-center gap-3 self-end sm:self-center">
                  <div className="text-right">
                    <div className="text-sm font-bold text-amber-400">
                      {displayType === "PERCENTAGE" ? `${displayValue}%` : `R$ ${displayValue.toFixed(2).replace(".", ",")}`}
                    </div>
                    <span className="text-[10px] text-stone-400 bg-stone-950 px-2 py-0.5 rounded border border-stone-800">
                      {displayOrigin}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!editingProductDefault && (
                      <button
                        type="button"
                        onClick={() => handleStartCustomizingProductDefault(displayType, displayValue)}
                        className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 px-2.5 py-1.5 rounded transition-all cursor-pointer"
                      >
                        Personalizar padrão
                      </button>
                    )}

                    {hasActiveCustomization && (
                      <button
                        type="button"
                        onClick={handleRestoreProductDefault}
                        className="text-xs text-amber-400 hover:text-amber-300 hover:underline px-2 py-1.5 transition-all cursor-pointer"
                      >
                        Restaurar padrão
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {editingProductDefault && (
            <div className="bg-stone-950/80 border border-amber-500/30 rounded-lg p-3 flex flex-wrap items-center gap-3 mt-2">
              <span className="text-xs font-semibold text-stone-300">Tipo:</span>
              <select
                aria-label="Tipo de comissão padrão de produto"
                value={(productDefaultOverride as RuleDraft)?.type || "PERCENTAGE"}
                onChange={(e) =>
                  handleUpdateProductDefaultDraft("type", e.target.value as "PERCENTAGE" | "FIXED_VALUE")
                }
                className="bg-stone-900 border border-stone-700 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
              >
                <option value="PERCENTAGE">Percentual (%)</option>
                <option value="FIXED_VALUE">Valor fixo (R$)</option>
              </select>

              <span className="text-xs font-semibold text-stone-300">Valor:</span>
              <input
                type="number"
                min="0"
                step="0.01"
                aria-label="Valor da comissão padrão de produto"
                value={(productDefaultOverride as RuleDraft)?.value ?? "0"}
                onChange={(e) => handleUpdateProductDefaultDraft("value", e.target.value)}
                className="w-24 bg-stone-900 border border-stone-700 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
              />

              <button
                type="button"
                onClick={() => setEditingProductDefault(false)}
                className="text-xs bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-3 py-1 rounded transition-all cursor-pointer ml-auto"
              >
                Aplicar
              </button>
            </div>
          )}
        </div>

        {/* B.2 — Lista de Produtos e Exceções */}
        <div className="px-5 py-3 border-b border-stone-800 bg-stone-950/40">
          <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
            Exceções por Produto
          </h3>
        </div>

        {initialData.products.length === 0 ? (
          <p className="text-stone-600 text-sm p-5 text-center">
            Nenhum produto cadastrado na barbearia.
          </p>
        ) : (
          <ul className="divide-y divide-stone-800/80">
            {initialData.products.map((p) => {
              const override = productOverrides[p.id];
              const isOverridden = override && override !== "RESTORE";
              const isRestored = override === "RESTORE";
              const hasSavedIndividual = Boolean(p.individualRule && p.individualRule.active);
              const hasActiveCustomization = isOverridden || (hasSavedIndividual && !isRestored);

              let displayType = p.effectiveCommission?.type ?? "PERCENTAGE";
              let displayValue = p.effectiveCommission?.value ?? 0;
              let displayOrigin = getOriginLabel(p.effectiveCommission?.origin);

              if (isOverridden) {
                displayType = (override as RuleDraft).type;
                displayValue = Number((override as RuleDraft).value);
                displayOrigin = "Exceção Individual (não salva)";
              } else if (isRestored) {
                displayOrigin = "Regra Padrão";
              }

              const isEditing = editingProductId === p.id;

              return (
                <li key={p.id} className="p-4 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <p className="text-stone-200 text-sm font-semibold">{p.name}</p>
                      <p className="text-stone-400 text-xs">
                        Preço de venda:{" "}
                        <span className="text-stone-300">
                          R$ {Number(p.salePrice).toFixed(2).replace(".", ",")}
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center gap-3 self-end md:self-center">
                      <div className="text-right">
                        <div className="text-sm font-bold text-amber-400">
                          {displayType === "PERCENTAGE" ? `${displayValue}%` : `R$ ${displayValue.toFixed(2).replace(".", ",")}`}
                        </div>
                        <span className="text-[10px] text-stone-400 bg-stone-950 px-2 py-0.5 rounded border border-stone-800">
                          {displayOrigin}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => handleStartCustomizingProduct(p.id, displayType, displayValue)}
                            className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 px-2.5 py-1.5 rounded transition-all cursor-pointer"
                          >
                            Personalizar comissão
                          </button>
                        )}

                        {hasActiveCustomization && (
                          <button
                            type="button"
                            onClick={() => handleRestoreProduct(p.id)}
                            className="text-xs text-amber-400 hover:text-amber-300 hover:underline px-2 py-1.5 transition-all cursor-pointer"
                          >
                            Restaurar padrão
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="bg-stone-950/80 border border-amber-500/30 rounded-lg p-3 flex flex-wrap items-center gap-3 mt-2">
                      <span className="text-xs font-semibold text-stone-300">Tipo:</span>
                      <select
                        aria-label="Tipo de comissão do produto"
                        value={(productOverrides[p.id] as RuleDraft)?.type || "PERCENTAGE"}
                        onChange={(e) =>
                          handleUpdateProductRuleDraft(p.id, "type", e.target.value as "PERCENTAGE" | "FIXED_VALUE")
                        }
                        className="bg-stone-900 border border-stone-700 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
                      >
                        <option value="PERCENTAGE">Percentual (%)</option>
                        <option value="FIXED_VALUE">Valor fixo (R$)</option>
                      </select>

                      <span className="text-xs font-semibold text-stone-300">Valor:</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label="Valor da comissão do produto"
                        value={(productOverrides[p.id] as RuleDraft)?.value ?? "0"}
                        onChange={(e) => handleUpdateProductRuleDraft(p.id, "value", e.target.value)}
                        className="w-24 bg-stone-900 border border-stone-700 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
                      />

                      <button
                        type="button"
                        onClick={() => setEditingProductId(null)}
                        className="text-xs bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-3 py-1 rounded transition-all cursor-pointer ml-auto"
                      >
                        Aplicar
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Botão de Salvamento Unificado */}
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold px-8 py-3 rounded-lg text-sm transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-amber-500/10 hover:brightness-110"
        >
          {saving ? "Salvando alterações..." : "Salvar Serviços e Comissões"}
        </button>
      </div>
    </div>
  );
}
