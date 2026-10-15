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
  categories?: Array<{
    id: string;
    name: string;
  }>;
  memberDefaultRule?: {
    effective: {
      type: "PERCENTAGE" | "FIXED_VALUE";
      value: number;
      origin: string;
      isCustomized: boolean;
    } | null;
    inheritedDefault?: {
      type: "PERCENTAGE" | "FIXED_VALUE";
      value: number;
      origin: string;
    } | null;
    individualRule: {
      id: string;
      type: "PERCENTAGE" | "FIXED_VALUE";
      value: number;
      active: boolean;
    } | null;
  };
  careerLevels?: Array<{
    id: string;
    name: string;
    defaultCommissionRate: string | number | null;
    sortOrder: number;
  }>;
  categoryRules?: Array<{
    id: string;
    categoryId: string;
    categoryName: string;
    type: "PERCENTAGE" | "FIXED_VALUE";
    value: number;
    active: boolean;
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
  active?: boolean;
}

interface ServiceRulePayload {
  serviceId: string;
  type: "PERCENTAGE" | "FIXED_VALUE";
  value: number;
  active: boolean;
}

interface CategoryRulePayload {
  categoryId: string;
  type: "PERCENTAGE" | "FIXED_VALUE";
  value: number;
  active: boolean;
}

interface ProductRulePayload {
  productId: string;
  type: "PERCENTAGE" | "FIXED_VALUE";
  value: number;
  active: boolean;
}

interface ProductDefaultRulePayload {
  type: "PERCENTAGE" | "FIXED_VALUE";
  value: number;
  active: boolean;
}

interface MemberDefaultRulePayload {
  type: "PERCENTAGE" | "FIXED_VALUE";
  value: number;
  active: boolean;
}

interface CommissionSettingsPayload {
  selectedServiceIds?: string[];
  isCommissionEligible?: boolean;
  serviceRules?: ServiceRulePayload[];
  removeServiceRuleIds?: string[];
  memberDefaultRule?: MemberDefaultRulePayload | null;
  categoryRules?: CategoryRulePayload[];
  removeCategoryRuleIds?: string[];
  productDefaultRule?: ProductDefaultRulePayload | null;
  productRules?: ProductRulePayload[];
  removeProductRuleIds?: string[];
}

function getOriginLabel(origin?: string): string {
  switch (origin) {
    case "MEMBER_SERVICE":
      return "Exceção Individual";
    case "CAREER_LEVEL_SERVICE":
    case "SERVICE_CAREER_LEVEL":
    case "CAREER_LEVEL_DEFAULT":
      return "Regra de Carreira";
    case "BARBERSHOP_DEFAULT":
      return "Padrão da Barbearia";
    case "MEMBER_DEFAULT":
      return "Padrão Individual";
    case "MEMBER_CATEGORY":
    case "CATEGORY_DEFAULT":
      return "Regra de Categoria";
    case "SERVICE_DEFAULT":
      return "Padrão do Serviço";
    case "MEMBER_PRODUCT":
      return "Exceção Individual";
    case "MEMBER_PRODUCT_DEFAULT":
      return "Padrão Individual";
    case "PRODUCT_DEFAULT":
      return "Padrão da Barbearia";
    case "PRODUCT":
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

  // Member default override: RuleDraft or "RESTORE"
  const [memberDefaultOverride, setMemberDefaultOverride] = useState<RuleDraft | "RESTORE" | null>(null);
  const [editingMemberDefault, setEditingMemberDefault] = useState(false);
  const [presetFeedback, setPresetFeedback] = useState<string | null>(null);

  // Category rules management
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, RuleDraft>>({});
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [showAddCategoryForm, setShowAddCategoryForm] = useState(false);
  const [newCategoryDraft, setNewCategoryDraft] = useState<{
    categoryId: string;
    type: "PERCENTAGE" | "FIXED_VALUE";
    value: string;
  }>({
    categoryId: "",
    type: "PERCENTAGE",
    value: "",
  });
  const [removedCategoryRuleIds, setRemovedCategoryRuleIds] = useState<Set<string>>(new Set());
  const [showAdditionalConfigs, setShowAdditionalConfigs] = useState(false);

  // Service overrides: map of serviceId -> RuleDraft (active override) or "RESTORE" (to remove individual rule)
  const [serviceOverrides, setServiceOverrides] = useState<Record<string, RuleDraft | "RESTORE">>({});
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);

  // Product default override: RuleDraft or "RESTORE"
  const [productDefaultOverride, setProductDefaultOverride] = useState<RuleDraft | "RESTORE" | null>(null);
  const [editingProductDefault, setEditingProductDefault] = useState(false);

  // Product overrides: map of productId -> RuleDraft or "RESTORE"
  const [productOverrides, setProductOverrides] = useState<Record<string, RuleDraft | "RESTORE">>({});
  const [editingProductId, setEditingProductId] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  const reloadSettings = useCallback(() => {
    setReloadKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let ignore = false;

    async function fetchSettings() {
      try {
        const res = await fetch(`/api/admin/team/${memberId}/commission-settings`);
        if (ignore) return;
        if (res.status === 403) {
          setHasCommissionAccess(false);
          return;
        }
        if (!res.ok) {
          throw new Error("Erro ao carregar serviços e comissões.");
        }
        const data: CommissionSettingsData = await res.json();
        if (ignore) return;
        setInitialData(data);
        setHasCommissionAccess(true);
        setSelectedServices(new Set(data.selectedServiceIds));
        setIsCommissionEligible(data.isCommissionEligible);
        setMemberDefaultOverride(null);
        setEditingMemberDefault(false);
        setPresetFeedback(null);
        setCategoryOverrides({});
        setEditingCategoryId(null);
        setShowAddCategoryForm(false);
        setNewCategoryDraft({ categoryId: "", type: "PERCENTAGE", value: "" });
        setRemovedCategoryRuleIds(new Set());
        setServiceOverrides({});
        setProductDefaultOverride(null);
        setProductOverrides({});
      } catch (e: unknown) {
        if (!ignore) {
          const msg = e instanceof Error ? e.message : "Erro ao carregar comissões.";
          onError(msg);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    fetchSettings();

    return () => {
      ignore = true;
    };
  }, [memberId, onError, reloadKey]);

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

  // Seção B - Comissão Padrão do Colaborador & Presets
  const handleStartCustomizingMemberDefault = (currentType: "PERCENTAGE" | "FIXED_VALUE", currentValue: number) => {
    setEditingMemberDefault(true);
    if (!memberDefaultOverride || memberDefaultOverride === "RESTORE") {
      setMemberDefaultOverride({ type: currentType, value: String(currentValue) });
    }
  };

  const handleUpdateMemberDefaultDraft = (field: "type" | "value", val: string) => {
    setMemberDefaultOverride((prev) => {
      const existing = (prev && prev !== "RESTORE" ? prev : { type: "PERCENTAGE", value: "0" }) as RuleDraft;
      return {
        ...existing,
        [field]: val,
      };
    });
  };

  const handleRestoreMemberDefault = () => {
    setEditingMemberDefault(false);
    setMemberDefaultOverride("RESTORE");
    setPresetFeedback(null);
  };

  const handleApplyPreset = (presetName: string, rate: number) => {
    setMemberDefaultOverride({ type: "PERCENTAGE", value: String(rate) });
    setEditingMemberDefault(true);
    setPresetFeedback(`Modelo "${presetName}" aplicado no rascunho (${rate}%). Revise e clique em "Salvar Serviços e Comissões" para confirmar.`);
  };

  // FIX 1 — Centralização da resolução do valor e tipo efetivos do rascunho de membro default
  const getEffectiveMemberDefault = (): { type: "PERCENTAGE" | "FIXED_VALUE"; value: number } => {
    if (memberDefaultOverride && memberDefaultOverride !== "RESTORE") {
      const draft = memberDefaultOverride as RuleDraft;
      return {
        type: draft.type,
        value: Number(draft.value) || 0,
      };
    }
    if (memberDefaultOverride === "RESTORE") {
      if (initialData.memberDefaultRule?.inheritedDefault) {
        return {
          type: initialData.memberDefaultRule.inheritedDefault.type,
          value: Number(initialData.memberDefaultRule.inheritedDefault.value) || 0,
        };
      }
      const cl = initialData.careerLevels?.find((c) => c.id === initialData.careerLevelId);
      if (cl && cl.defaultCommissionRate !== null) {
        return {
          type: "PERCENTAGE",
          value: Number(cl.defaultCommissionRate) || 0,
        };
      }
      return { type: "PERCENTAGE", value: 0 };
    }
    if (initialData.memberDefaultRule?.effective) {
      return {
        type: initialData.memberDefaultRule.effective.type,
        value: Number(initialData.memberDefaultRule.effective.value) || 0,
      };
    }
    return { type: "PERCENTAGE", value: 0 };
  };

  const handleApplyToAllServices = (overrideType?: "PERCENTAGE" | "FIXED_VALUE", overrideValue?: number) => {
    if (!initialData?.services) return;

    const effective = getEffectiveMemberDefault();
    const targetType = overrideType ?? effective.type;
    const targetValue = overrideValue ?? effective.value;

    if (isNaN(targetValue) || targetValue < 0) {
      onError("Valor de comissão inválido para aplicação em massa.");
      return;
    }

    const selectedList = initialData.services.filter((s) => selectedServices.has(s.id));
    const count = selectedList.length;

    if (count === 0) {
      onError("Nenhum serviço selecionado para este colaborador.");
      return;
    }

    const formattedTarget =
      targetType === "PERCENTAGE"
        ? `${targetValue}%`
        : `R$ ${targetValue.toFixed(2).replace(".", ",")}`;

    const confirmed = window.confirm(
      `Deseja sobrescrever a comissão de ${count} serviço(s) selecionado(s) para ${formattedTarget}? Esta ação alterará apenas os rascunhos em tela e exigirá clicar em "Salvar Serviços e Comissões" para persistir.`
    );
    if (!confirmed) return;

    const newOverrides: Record<string, RuleDraft | "RESTORE"> = { ...serviceOverrides };
    for (const s of selectedList) {
      newOverrides[s.id] = { type: targetType, value: String(targetValue) };
    }
    setServiceOverrides(newOverrides);
    setPresetFeedback(
      `Taxa de ${formattedTarget} aplicada a ${count} serviço(s) selecionado(s) no rascunho. Clique em "Salvar Serviços e Comissões" para persistir.`
    );
  };

  const handleStartEditingCategoryRule = (
    categoryId: string,
    currentType: "PERCENTAGE" | "FIXED_VALUE",
    currentValue: number
  ) => {
    setEditingCategoryId(categoryId);
    if (!categoryOverrides[categoryId]) {
      const existingRule = initialData.categoryRules?.find((r) => r.categoryId === categoryId);
      const isCurrentlyActive = existingRule ? existingRule.active !== false : true;
      setCategoryOverrides((prev) => ({
        ...prev,
        [categoryId]: { type: currentType, value: String(currentValue), active: isCurrentlyActive },
      }));
    }
  };

  const handleReactivateCategoryRule = (
    categoryId: string,
    currentType: "PERCENTAGE" | "FIXED_VALUE",
    currentValue: number
  ) => {
    setCategoryOverrides((prev) => ({
      ...prev,
      [categoryId]: { type: currentType, value: String(currentValue), active: true },
    }));
    setEditingCategoryId(categoryId);
    setPresetFeedback(
      `Exceção por categoria reativada no rascunho. Clique em "Salvar Serviços e Comissões" para persistir.`
    );
  };

  const handleUpdateCategoryRuleDraft = (
    categoryId: string,
    field: "type" | "value",
    val: string
  ) => {
    setCategoryOverrides((prev) => {
      const existing = prev[categoryId] ?? { type: "PERCENTAGE", value: "0" };
      return {
        ...prev,
        [categoryId]: { ...existing, [field]: val },
      };
    });
  };

  const handleRemoveCategoryRule = (ruleId: string, categoryId?: string) => {
    setRemovedCategoryRuleIds((prev) => {
      const next = new Set(prev);
      next.add(ruleId);
      return next;
    });
    if (categoryId) {
      setCategoryOverrides((prev) => {
        const next = { ...prev };
        delete next[categoryId];
        return next;
      });
      if (editingCategoryId === categoryId) {
        setEditingCategoryId(null);
      }
    }
  };

  const handleAddCategoryRuleDraft = () => {
    if (!newCategoryDraft.categoryId) {
      onError("Selecione uma categoria para adicionar a exceção.");
      return;
    }
    const hasExistingRule = initialData.categoryRules?.some(
      (r) => r.categoryId === newCategoryDraft.categoryId && !removedCategoryRuleIds.has(r.id)
    );
    if (hasExistingRule) {
      onError("Esta categoria já possui uma regra configurada. Utilize a seção de regras existentes ou inativas para gerenciá-la.");
      return;
    }
    const numVal = Number(newCategoryDraft.value);
    if (isNaN(numVal) || numVal < 0) {
      onError("Informe um valor numérico não negativo para a comissão da categoria.");
      return;
    }
    setCategoryOverrides((prev) => ({
      ...prev,
      [newCategoryDraft.categoryId]: {
        type: newCategoryDraft.type,
        value: String(numVal),
        active: true,
      },
    }));
    setShowAddCategoryForm(false);
    setNewCategoryDraft({ categoryId: "", type: "PERCENTAGE", value: "" });
    setPresetFeedback(
      `Exceção por categoria adicionada ao rascunho. Clique em "Salvar Serviços e Comissões" para persistir.`
    );
  };

  // Seção C - Serviços
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
      const payload: CommissionSettingsPayload = {};

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
      const serviceRules: ServiceRulePayload[] = [];
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

      // 3b. memberDefaultRule
      if (memberDefaultOverride === "RESTORE") {
        if (initialData.memberDefaultRule?.individualRule) {
          payload.memberDefaultRule = null;
        }
      } else if (memberDefaultOverride && typeof memberDefaultOverride === "object") {
        const numVal = Number(memberDefaultOverride.value);
        if (isNaN(numVal) || numVal < 0) {
          throw new Error("O valor da comissão padrão do colaborador deve ser um número não negativo.");
        }
        payload.memberDefaultRule = {
          type: memberDefaultOverride.type,
          value: numVal,
          active: true,
        };
      }

      // 3c. categoryRules e removeCategoryRuleIds
      const categoryRulesPayload: CategoryRulePayload[] = [];
      for (const [catId, draft] of Object.entries(categoryOverrides)) {
        if (draft && typeof draft === "object") {
          const numVal = Number(draft.value);
          if (isNaN(numVal) || numVal < 0) {
            throw new Error("O valor da comissão de categoria deve ser um número não negativo.");
          }
          const existingRule = initialData.categoryRules?.find(
            (r) => r.categoryId === catId && !removedCategoryRuleIds.has(r.id)
          );
          if (existingRule && existingRule.active === false && draft.active !== true) {
            continue;
          }
          categoryRulesPayload.push({
            categoryId: catId,
            type: draft.type,
            value: numVal,
            active: draft.active !== false,
          });
        }
      }
      if (categoryRulesPayload.length > 0) {
        payload.categoryRules = categoryRulesPayload;
      }
      if (removedCategoryRuleIds.size > 0) {
        payload.removeCategoryRuleIds = Array.from(removedCategoryRuleIds);
      }

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
      const productRules: ProductRulePayload[] = [];
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
      setLoading(true);
      reloadSettings();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao salvar configurações.";
      onError(msg);
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
          SEÇÃO B — Comissão Padrão do Colaborador & Presets
          ───────────────────────────────────────── */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl p-5 space-y-5" data-testid="member-default-commission-section">
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-amber-500/90">
                Comissão Padrão do Colaborador
              </h2>
              <p className="text-xs text-stone-400 mt-0.5">
                Taxa aplicada a todos os serviços executados por este profissional que não possuam exceção individual.
              </p>
            </div>

            {/* Display de Taxa Efetiva + Botões de Ação */}
            {(() => {
              const eff = initialData.memberDefaultRule?.effective;
              const hasRule = Boolean(initialData.memberDefaultRule || memberDefaultOverride);
              let displayType = eff?.type ?? "PERCENTAGE";
              let displayValue = eff?.value ?? 0;
              let displayOrigin = getOriginLabel(eff?.origin);

              const isOverridden = memberDefaultOverride && memberDefaultOverride !== "RESTORE";
              const isRestored = memberDefaultOverride === "RESTORE";
              const hasSavedIndividual = Boolean(initialData.memberDefaultRule?.individualRule?.active);
              const hasActiveCustomization = isOverridden || (hasSavedIndividual && !isRestored);

              if (isOverridden) {
                displayType = (memberDefaultOverride as RuleDraft).type;
                displayValue = Number((memberDefaultOverride as RuleDraft).value);
                displayOrigin = "Padrão Individual (não salvo)";
              } else if (isRestored) {
                const inherited = initialData.memberDefaultRule?.inheritedDefault;
                if (inherited) {
                  displayType = inherited.type;
                  displayValue = inherited.value;
                  displayOrigin =
                    inherited.origin === "CAREER_LEVEL_DEFAULT"
                      ? "Padrão do Nível de Carreira (após salvar)"
                      : "Padrão da Barbearia (após salvar)";
                } else {
                  const cl = initialData.careerLevels?.find((c) => c.id === initialData.careerLevelId);
                  if (cl && cl.defaultCommissionRate !== null) {
                    displayType = "PERCENTAGE";
                    displayValue = Number(cl.defaultCommissionRate);
                    displayOrigin = "Padrão do Nível de Carreira (após salvar)";
                  } else {
                    displayType = "PERCENTAGE";
                    displayValue = 0;
                    displayOrigin = "Padrão Geral (após salvar)";
                  }
                }
              }

              const formattedValue = (hasRule || isRestored)
                ? displayType === "PERCENTAGE"
                  ? `${displayValue}%`
                  : `R$ ${displayValue.toFixed(2).replace(".", ",")}`
                : "—";

              return (
                <div className="flex items-center gap-3 self-end sm:self-center">
                  <div className="text-right">
                    <div className="text-base font-bold text-amber-400" data-testid="member-default-rate">
                      {formattedValue}
                    </div>
                    <span className="text-[10px] text-stone-400 bg-stone-950 px-2 py-0.5 rounded border border-stone-800" data-testid="member-default-origin">
                      {hasRule ? displayOrigin : "Padrão Geral"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!editingMemberDefault && (
                      <button
                        type="button"
                        onClick={() => handleStartCustomizingMemberDefault(displayType, displayValue)}
                        className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 px-2.5 py-1.5 rounded transition-all cursor-pointer"
                        data-testid="customize-member-default-btn"
                      >
                        Personalizar padrão
                      </button>
                    )}

                    {hasActiveCustomization && (
                      <button
                        type="button"
                        onClick={handleRestoreMemberDefault}
                        className="text-xs text-amber-400 hover:text-amber-300 hover:underline px-2 py-1.5 transition-all cursor-pointer"
                        data-testid="restore-member-default-btn"
                      >
                        Restaurar padrão
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Editor Inline da Comissão Padrão */}
          {editingMemberDefault && (
            <div className="bg-stone-950/80 border border-amber-500/30 rounded-lg p-3 flex flex-wrap items-center gap-3 mt-3">
              <span className="text-xs font-semibold text-stone-300">Tipo:</span>
              <select
                aria-label="Tipo de comissão padrão do colaborador"
                value={(memberDefaultOverride as RuleDraft)?.type || "PERCENTAGE"}
                onChange={(e) =>
                  handleUpdateMemberDefaultDraft("type", e.target.value as "PERCENTAGE" | "FIXED_VALUE")
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
                aria-label="Valor da comissão padrão do colaborador"
                value={(memberDefaultOverride as RuleDraft)?.value ?? "0"}
                onChange={(e) => handleUpdateMemberDefaultDraft("value", e.target.value)}
                className="w-24 bg-stone-900 border border-stone-700 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
              />

              <button
                type="button"
                onClick={() => setEditingMemberDefault(false)}
                className="text-xs bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-3 py-1 rounded transition-all cursor-pointer ml-auto"
              >
                Aplicar
              </button>
            </div>
          )}
        </div>

        {/* SEÇÃO C — Modelos de Comissão / Sugestões (Presets) */}
        <div className="border-t border-stone-800/80 pt-4" data-testid="commission-presets-section">
          <p className="text-xs font-semibold text-stone-400 mb-2">
            Modelos rápidos de comissão (preenchimento com 1 clique):
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* Presets Padrão */}
            <button
              type="button"
              onClick={() => handleApplyPreset("Iniciante", 30)}
              className="text-xs bg-stone-950 hover:bg-stone-800 text-stone-300 hover:text-white border border-stone-800 hover:border-amber-500/50 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
            >
              Iniciante (30%)
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset("Profissional", 40)}
              className="text-xs bg-stone-950 hover:bg-stone-800 text-stone-300 hover:text-white border border-stone-800 hover:border-amber-500/50 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
            >
              Profissional (40%)
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset("Sênior", 50)}
              className="text-xs bg-stone-950 hover:bg-stone-800 text-stone-300 hover:text-white border border-stone-800 hover:border-amber-500/50 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
            >
              Sênior (50%)
            </button>

            {/* Presets baseados nos CareerLevels existentes */}
            {initialData.careerLevels?.filter((cl) => cl.defaultCommissionRate !== null).map((cl) => {
              const rate = Number(cl.defaultCommissionRate);
              return (
                <button
                  key={cl.id}
                  type="button"
                  onClick={() => handleApplyPreset(cl.name, rate)}
                  className="text-xs bg-stone-950 hover:bg-stone-800 text-stone-300 hover:text-white border border-stone-800 hover:border-amber-500/50 px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                >
                  Nível {cl.name} ({rate}%)
                </button>
              );
            })}

            {/* Botão: Aplicar taxa padrão aos serviços selecionados */}
            {(() => {
              const effectiveDefault = getEffectiveMemberDefault();
              const currentDefaultType = effectiveDefault.type;
              const currentDefaultValue = effectiveDefault.value;

              const formattedDefault =
                currentDefaultType === "PERCENTAGE"
                  ? `${currentDefaultValue}%`
                  : `R$ ${currentDefaultValue.toFixed(2).replace(".", ",")}`;

              const canShow =
                Boolean(memberDefaultOverride) ||
                Boolean(initialData.memberDefaultRule?.effective);

              if (!canShow) return null;

              return (
                <button
                  type="button"
                  onClick={() => handleApplyToAllServices(currentDefaultType, currentDefaultValue)}
                  className="text-xs bg-stone-800 hover:bg-stone-700 text-amber-300 border border-stone-700 px-3 py-1.5 rounded-lg transition-all cursor-pointer ml-auto"
                  data-testid="apply-to-all-services-btn"
                >
                  Sobrescrever serviços selecionados ({formattedDefault})
                </button>
              );
            })()}
          </div>

          {presetFeedback && (
            <div className="mt-2.5 text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-lg flex items-center justify-between">
              <span>{presetFeedback}</span>
              <button
                type="button"
                onClick={() => setPresetFeedback(null)}
                className="text-stone-400 hover:text-stone-200 ml-2"
              >
                ✕
              </button>
            </div>
          )}
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

      {/* ─────────────────────────────────────────
          SEÇÃO F — Configurações Adicionais / Regras Herdadas
          ───────────────────────────────────────── */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden" data-testid="additional-configs-section">
        <button
          type="button"
          onClick={() => setShowAdditionalConfigs((prev) => !prev)}
          className="w-full px-5 py-3 border-b border-stone-800 bg-stone-950/40 flex items-center justify-between text-left hover:bg-stone-950/60 transition-colors"
        >
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-stone-300">
              Configurações Adicionais &amp; Histórico
            </h2>
            <p className="text-xs text-stone-400 mt-0.5">
              Nível de carreira vinculado e regras de categoria herdadas ou personalizadas.
            </p>
          </div>
          <span className="text-stone-400 text-xs font-semibold px-2 py-1 rounded bg-stone-800">
            {showAdditionalConfigs ? "Ocultar ▲" : "Expandir ▼"}
          </span>
        </button>

        {showAdditionalConfigs && (
          <div className="p-5 space-y-4">
            {/* Informação sobre Nível de Carreira Vinculado */}
            <div className="bg-stone-950/60 border border-stone-800/80 rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-stone-300">Nível de Carreira do Colaborador</p>
                <p className="text-xs text-stone-400 mt-0.5">
                  {initialData.careerLevelName ? (
                    <>
                      Vinculado a <span className="text-amber-400 font-semibold">{initialData.careerLevelName}</span>.
                    </>
                  ) : (
                    "Nenhum nível de carreira explicitamente vinculado (utiliza comissão padrão do profissional ou barbearia)."
                  )}
                </p>
              </div>
              <Link
                href="/admin/comissoes/configuracoes"
                className="text-xs text-amber-400 hover:text-amber-300 hover:underline shrink-0"
              >
                Gerenciar Níveis de Carreira →
              </Link>
            </div>

            {/* Regras por Categoria */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-wider text-stone-400">
                  Regras por Categoria (Fluxo Avançado)
                </p>
                {!showAddCategoryForm && initialData.categories && initialData.categories.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAddCategoryForm(true)}
                    className="text-xs text-amber-400 hover:text-amber-300 font-semibold cursor-pointer"
                    data-testid="add-category-rule-btn"
                  >
                    + Adicionar exceção por categoria
                  </button>
                )}
              </div>

              {/* Formulário de Adicionar Nova Exceção por Categoria */}
              {showAddCategoryForm && (
                <div className="bg-stone-950/80 border border-amber-500/30 rounded-lg p-3 space-y-3 mb-3" data-testid="add-category-rule-form">
                  <p className="text-xs font-semibold text-stone-300">Nova Regra Individual por Categoria</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Selecionar categoria"
                      data-testid="select-new-category"
                      value={newCategoryDraft.categoryId}
                      onChange={(e) => setNewCategoryDraft((prev) => ({ ...prev, categoryId: e.target.value }))}
                      className="bg-stone-900 border border-stone-700 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
                    >
                      <option value="">Selecione uma categoria...</option>
                      {initialData.categories
                        ?.filter((cat) => {
                          const hasExistingRule = initialData.categoryRules?.some(
                            (r) => r.categoryId === cat.id && !removedCategoryRuleIds.has(r.id)
                          );
                          const hasDraft = Boolean(categoryOverrides[cat.id]);
                          return !hasExistingRule && !hasDraft;
                        })
                        .map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                    </select>

                    <select
                      aria-label="Tipo de comissão da categoria"
                      value={newCategoryDraft.type}
                      onChange={(e) =>
                        setNewCategoryDraft((prev) => ({
                          ...prev,
                          type: e.target.value as "PERCENTAGE" | "FIXED_VALUE",
                        }))
                      }
                      className="bg-stone-900 border border-stone-700 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
                    >
                      <option value="PERCENTAGE">Percentual (%)</option>
                      <option value="FIXED_VALUE">Valor fixo (R$)</option>
                    </select>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Valor"
                      aria-label="Valor da comissão da categoria"
                      data-testid="input-new-category-value"
                      value={newCategoryDraft.value}
                      onChange={(e) => setNewCategoryDraft((prev) => ({ ...prev, value: e.target.value }))}
                      className="w-20 bg-stone-900 border border-stone-700 rounded px-2.5 py-1 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
                    />

                    <button
                      type="button"
                      onClick={handleAddCategoryRuleDraft}
                      className="text-xs bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-3 py-1 rounded transition-all cursor-pointer"
                      data-testid="confirm-add-category-rule-btn"
                    >
                      Adicionar ao Rascunho
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowAddCategoryForm(false);
                        setNewCategoryDraft({ categoryId: "", type: "PERCENTAGE", value: "" });
                      }}
                      className="text-xs text-stone-400 hover:text-stone-200 px-2 py-1 cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Lista de regras por categoria */}
              {(() => {
                const activeExisting = (initialData.categoryRules || []).filter(
                  (r) => r.active !== false && !removedCategoryRuleIds.has(r.id)
                );
                const inactiveExisting = (initialData.categoryRules || []).filter(
                  (r) => r.active === false && !removedCategoryRuleIds.has(r.id)
                );
                const draftNewEntries = Object.entries(categoryOverrides).filter(
                  ([catId]) =>
                    !activeExisting.some((r) => r.categoryId === catId) &&
                    !inactiveExisting.some((r) => r.categoryId === catId)
                );

                if (activeExisting.length === 0 && inactiveExisting.length === 0 && draftNewEntries.length === 0) {
                  return (
                    <p className="text-xs text-stone-500 bg-stone-950/40 p-3 rounded border border-stone-800/50">
                      Nenhuma exceção por categoria ativa para este colaborador. Novas configurações utilizam a comissão padrão e exceções diretas por serviço.
                    </p>
                  );
                }

                return (
                  <div className="space-y-3">
                    {activeExisting.length > 0 || draftNewEntries.length > 0 ? (
                      <div className="border border-stone-800 rounded-lg divide-y divide-stone-800 overflow-hidden bg-stone-950/40">
                        {/* Regras ativas existentes */}
                        {activeExisting.map((catRule) => {
                          const isEditing = editingCategoryId === catRule.categoryId;
                          const draft = categoryOverrides[catRule.categoryId];
                          const currentType = draft ? draft.type : catRule.type;
                          const currentValue = draft ? Number(draft.value) : Number(catRule.value);

                          return (
                            <div key={catRule.id} className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                              <div>
                                <span className="font-semibold text-stone-200">{catRule.categoryName}</span>
                                {!isEditing && (
                                  <span className="ml-2 text-stone-400">
                                    {currentType === "PERCENTAGE" ? `${currentValue}%` : `R$ ${currentValue.toFixed(2).replace(".", ",")}`}
                                    {draft && <span className="ml-1 text-[10px] text-amber-400">(rascunho)</span>}
                                  </span>
                                )}
                              </div>

                              {isEditing ? (
                                <div className="flex items-center gap-2">
                                  <select
                                    aria-label={`Tipo de comissão para categoria ${catRule.categoryName}`}
                                    value={draft?.type ?? catRule.type}
                                    onChange={(e) =>
                                      handleUpdateCategoryRuleDraft(catRule.categoryId, "type", e.target.value as "PERCENTAGE" | "FIXED_VALUE")
                                    }
                                    className="bg-stone-900 border border-stone-700 rounded px-2 py-0.5 text-xs text-stone-200"
                                  >
                                    <option value="PERCENTAGE">%</option>
                                    <option value="FIXED_VALUE">R$</option>
                                  </select>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    aria-label={`Valor de comissão para categoria ${catRule.categoryName}`}
                                    data-testid={`input-category-rule-${catRule.categoryId}`}
                                    value={draft?.value ?? String(catRule.value)}
                                    onChange={(e) => handleUpdateCategoryRuleDraft(catRule.categoryId, "value", e.target.value)}
                                    className="w-16 bg-stone-900 border border-stone-700 rounded px-2 py-0.5 text-xs text-stone-200"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setEditingCategoryId(null)}
                                    className="text-xs bg-amber-500 text-stone-950 font-bold px-2.5 py-0.5 rounded cursor-pointer"
                                    data-testid={`done-edit-category-rule-${catRule.categoryId}`}
                                  >
                                    Concluir
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditingCategoryRule(catRule.categoryId, currentType, currentValue)}
                                    className="text-stone-300 hover:text-white underline text-xs cursor-pointer"
                                    data-testid={`edit-category-rule-${catRule.categoryId}`}
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveCategoryRule(catRule.id, catRule.categoryId)}
                                    className="text-amber-400 hover:text-amber-300 hover:underline text-xs cursor-pointer"
                                    data-testid={`restore-category-rule-${catRule.id}`}
                                  >
                                    Restaurar padrão
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Regras novas em rascunho */}
                        {draftNewEntries.map(([catId, draft]) => {
                          const catName = initialData.categories?.find((c) => c.id === catId)?.name ?? "Categoria";
                          const isEditing = editingCategoryId === catId;
                          const valNum = Number(draft.value);

                          return (
                            <div key={catId} className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs bg-amber-500/5">
                              <div>
                                <span className="font-semibold text-amber-300">{catName}</span>
                                {!isEditing && (
                                  <span className="ml-2 text-stone-300">
                                    {draft.type === "PERCENTAGE" ? `${valNum}%` : `R$ ${valNum.toFixed(2).replace(".", ",")}`}
                                    <span className="ml-1 text-[10px] text-amber-400 font-semibold">(nova exceção no rascunho)</span>
                                  </span>
                                )}
                              </div>

                              {isEditing ? (
                                <div className="flex items-center gap-2">
                                  <select
                                    aria-label={`Tipo de comissão para nova categoria ${catName}`}
                                    value={draft.type}
                                    onChange={(e) =>
                                      handleUpdateCategoryRuleDraft(catId, "type", e.target.value as "PERCENTAGE" | "FIXED_VALUE")
                                    }
                                    className="bg-stone-900 border border-stone-700 rounded px-2 py-0.5 text-xs text-stone-200"
                                  >
                                    <option value="PERCENTAGE">%</option>
                                    <option value="FIXED_VALUE">R$</option>
                                  </select>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    aria-label={`Valor de comissão para nova categoria ${catName}`}
                                    value={draft.value}
                                    onChange={(e) => handleUpdateCategoryRuleDraft(catId, "value", e.target.value)}
                                    className="w-16 bg-stone-900 border border-stone-700 rounded px-2 py-0.5 text-xs text-stone-200"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => setEditingCategoryId(null)}
                                    className="text-xs bg-amber-500 text-stone-950 font-bold px-2.5 py-0.5 rounded cursor-pointer"
                                    data-testid={`done-edit-category-rule-${catId}`}
                                  >
                                    Concluir
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditingCategoryRule(catId, draft.type, valNum)}
                                    className="text-stone-300 hover:text-white underline text-xs cursor-pointer"
                                    data-testid={`edit-category-rule-${catId}`}
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCategoryOverrides((prev) => {
                                        const next = { ...prev };
                                        delete next[catId];
                                        return next;
                                      });
                                    }}
                                    className="text-amber-400 hover:text-amber-300 hover:underline text-xs cursor-pointer"
                                    data-testid={`remove-draft-category-rule-${catId}`}
                                  >
                                    Remover do rascunho
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-stone-500 bg-stone-950/40 p-3 rounded border border-stone-800/50">
                        Nenhuma exceção ativa por categoria configurada para este colaborador.
                      </p>
                    )}

                    {/* Exceções Inativas por Categoria */}
                    {inactiveExisting.length > 0 && (
                      <div className="pt-2 space-y-1.5" data-testid="inactive-category-rules-section">
                        <p className="text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                          Exceções Inativas por Categoria
                        </p>
                        <div className="border border-stone-800/80 rounded-lg divide-y divide-stone-800/80 overflow-hidden bg-stone-950/20">
                          {inactiveExisting.map((catRule) => {
                            const draft = categoryOverrides[catRule.categoryId];
                            const isReactivated = Boolean(draft && draft.active === true);
                            const isEditing = editingCategoryId === catRule.categoryId;
                            const currentType = draft ? draft.type : catRule.type;
                            const currentValue = draft ? Number(draft.value) : Number(catRule.value);

                            return (
                              <div key={catRule.id} className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs bg-stone-900/20 opacity-80">
                                <div>
                                  <span className="font-semibold text-stone-300">{catRule.categoryName}</span>
                                  <span className="ml-2 text-[10px] text-stone-400 bg-stone-900 border border-stone-700/60 px-1.5 py-0.5 rounded" data-testid={`badge-inactive-category-${catRule.categoryId}`}>
                                    Inativa
                                  </span>
                                  {!isEditing && (
                                    <span className="ml-2 text-stone-500">
                                      {currentType === "PERCENTAGE" ? `${currentValue}%` : `R$ ${currentValue.toFixed(2).replace(".", ",")}`}
                                      {isReactivated && <span className="ml-1 text-[10px] text-emerald-400 font-semibold">(reativada no rascunho)</span>}
                                    </span>
                                  )}
                                </div>

                                {isEditing ? (
                                  <div className="flex items-center gap-2">
                                    <select
                                      aria-label={`Tipo de comissão para categoria ${catRule.categoryName}`}
                                      value={draft?.type ?? catRule.type}
                                      onChange={(e) =>
                                        handleUpdateCategoryRuleDraft(catRule.categoryId, "type", e.target.value as "PERCENTAGE" | "FIXED_VALUE")
                                      }
                                      className="bg-stone-900 border border-stone-700 rounded px-2 py-0.5 text-xs text-stone-200"
                                    >
                                      <option value="PERCENTAGE">%</option>
                                      <option value="FIXED_VALUE">R$</option>
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      aria-label={`Valor de comissão para categoria ${catRule.categoryName}`}
                                      data-testid={`input-category-rule-${catRule.categoryId}`}
                                      value={draft?.value ?? String(catRule.value)}
                                      onChange={(e) => handleUpdateCategoryRuleDraft(catRule.categoryId, "value", e.target.value)}
                                      className="w-16 bg-stone-900 border border-stone-700 rounded px-2 py-0.5 text-xs text-stone-200"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setEditingCategoryId(null)}
                                      className="text-xs bg-amber-500 text-stone-950 font-bold px-2.5 py-0.5 rounded cursor-pointer"
                                      data-testid={`done-edit-category-rule-${catRule.categoryId}`}
                                    >
                                      Concluir
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    {!isReactivated ? (
                                      <button
                                        type="button"
                                        onClick={() => handleReactivateCategoryRule(catRule.categoryId, catRule.type, Number(catRule.value))}
                                        className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 px-2.5 py-1 rounded transition-all cursor-pointer"
                                        data-testid={`reactivate-category-rule-${catRule.categoryId}`}
                                      >
                                        Reativar regra
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handleStartEditingCategoryRule(catRule.categoryId, currentType, currentValue)}
                                        className="text-stone-300 hover:text-white underline text-xs cursor-pointer"
                                        data-testid={`edit-category-rule-${catRule.categoryId}`}
                                      >
                                        Editar
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveCategoryRule(catRule.id, catRule.categoryId)}
                                      className="text-amber-400 hover:text-amber-300 hover:underline text-xs cursor-pointer"
                                      data-testid={`restore-category-rule-${catRule.id}`}
                                    >
                                      Restaurar padrão
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
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
