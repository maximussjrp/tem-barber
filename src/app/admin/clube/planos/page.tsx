"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClubModal } from "@/components/admin/clube/ClubModal";
import { ClubConfirmDialog } from "@/components/admin/clube/ClubConfirmDialog";

type Benefit = {
  id: string;
  benefitType: "INCLUDED_SERVICE" | "SERVICE_DISCOUNT" | "PRODUCT_DISCOUNT";
  serviceId: string | null;
  productId: string | null;
  includedQty: number | null;
  discountPercent: string | null;
  pointWeight: string | null;
};

type Plan = {
  id: string;
  name: string;
  description: string | null;
  monthlyPrice: string;
  shopSharePercent: string;
  barberPoolPercent: string;
  isActive: boolean;
  benefits: Benefit[];
};

type ServiceItem = {
  id: string;
  name: string;
  price: string;
};

function brl(v: string | number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function PlanForm({
  initial,
  services,
  onSubmit,
  onClose,
  loading,
  error,
}: {
  initial?: Partial<Plan>;
  services: ServiceItem[];
  onSubmit: (data: any) => void;
  onClose: () => void;
  loading: boolean;
  error: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [monthlyPrice, setMonthlyPrice] = useState(initial?.monthlyPrice ?? "");
  const [shopShare, setShopShare] = useState(initial?.shopSharePercent ?? "");
  const [barberPool, setBarberPool] = useState(initial?.barberPoolPercent ?? "");

  const [selectedBenefits, setSelectedBenefits] = useState<Record<string, {
    includedQty: number;
    pointWeight: number;
    selected: boolean;
    benefitId?: string;
  }>>(() => {
    const initialMap: Record<string, any> = {};
    if (initial?.benefits) {
      initial.benefits.forEach((b: any) => {
        if (b.benefitType === "INCLUDED_SERVICE" && b.serviceId) {
          initialMap[b.serviceId] = {
            includedQty: b.includedQty ?? 1,
            pointWeight: b.pointWeight ? parseFloat(b.pointWeight) : 1.0,
            selected: true,
            benefitId: b.id,
          };
        }
      });
    }
    return initialMap;
  });

  const shopNum = parseFloat(shopShare) || 0;
  const barberNum = parseFloat(barberPool) || 0;
  const sumOk = Math.abs(shopNum + barberNum - 100) < 0.01;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sumOk) return;

    const selectedList = Object.entries(selectedBenefits)
      .filter(([_, value]) => value.selected)
      .map(([serviceId, value]) => ({
        benefitId: value.benefitId || null,
        serviceId,
        includedQty: value.includedQty,
        pointWeight: value.pointWeight,
      }));

    // Local validation
    for (const b of selectedList) {
      if (b.includedQty < 1) return;
      if (b.pointWeight <= 0) return;
    }

    onSubmit({
      name,
      description: description || null,
      monthlyPrice: parseFloat(monthlyPrice),
      shopSharePercent: shopNum,
      barberPoolPercent: barberNum,
      benefits: selectedList,
    });
  }

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--brand)] transition-colors placeholder:text-[var(--text-muted)]";
  const labelCls = "block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1.5";

  return (
    <form id="plan-form" onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2.5 text-sm text-red-300">
          {error}
        </div>
      )}
      <div>
        <label className={labelCls}>Nome do plano *</label>
        <input
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="Ex: Plano Ouro"
          maxLength={80}
        />
      </div>
      <div>
        <label className={labelCls}>Descrição</label>
        <textarea
          className={`${inputCls} resize-none`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descreva os benefícios do plano"
          maxLength={300}
        />
      </div>
      <div>
        <label className={labelCls}>Mensalidade (R$) *</label>
        <input
          className={inputCls}
          type="number"
          step="0.01"
          min="0"
          value={monthlyPrice}
          onChange={(e) => setMonthlyPrice(e.target.value)}
          required
          placeholder="0,00"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Parte da barbearia (%)</label>
          <input
            className={inputCls}
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={shopShare}
            onChange={(e) => setShopShare(e.target.value)}
            required
            placeholder="50"
          />
        </div>
        <div>
          <label className={labelCls}>Fundo dos barbeiros (%)</label>
          <input
            className={inputCls}
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={barberPool}
            onChange={(e) => setBarberPool(e.target.value)}
            required
            placeholder="50"
          />
        </div>
      </div>
      {(shopShare || barberPool) && (
        <p className={`text-xs font-semibold ${sumOk ? "text-green-400" : "text-red-400"}`}>
          {sumOk
            ? `✓ Soma correta: ${shopNum + barberNum}%`
            : `⚠ Soma deve ser 100%. Atual: ${shopNum + barberNum}%`}
        </p>
      )}

      {/* Serviços Inclusos */}
      <div className="space-y-2.5 pt-2">
        <label className={labelCls}>Serviços inclusos no plano</label>

        {services.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Nenhum serviço cadastrado na barbearia.</p>
        ) : (
          <div className="border border-[var(--border-subtle)] rounded-xl divide-y divide-[var(--border-subtle)] max-h-60 overflow-y-auto bg-[var(--surface-1)]">
            {services.map((svc) => {
              const state = selectedBenefits[svc.id] || { selected: false, includedQty: 1, pointWeight: 1.0 };

              return (
                <div key={svc.id} className="p-3 space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-[var(--gold)]"
                      title={svc.name}
                      checked={state.selected}
                      onChange={(e) => {
                        setSelectedBenefits({
                          ...selectedBenefits,
                          [svc.id]: {
                            ...state,
                            selected: e.target.checked
                          }
                        });
                      }}
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{svc.name}</span>
                      <span className="text-xs text-[var(--text-muted)] ml-2">({brl(svc.price)})</span>
                    </div>
                  </label>

                  {state.selected && (
                    <div className="grid grid-cols-2 gap-3 pl-7 pt-1">
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">
                          Quantidade mensal
                        </label>
                        <input
                          type="number"
                          min="1"
                          required
                          title="Quantidade mensal"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-xs focus:outline-none focus:border-[var(--brand)]"
                          value={state.includedQty}
                          onChange={(e) => {
                            setSelectedBenefits({
                              ...selectedBenefits,
                              [svc.id]: {
                                ...state,
                                includedQty: parseInt(e.target.value) || 1
                              }
                            });
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">
                          Peso no rateio dos barbeiros
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          title="Peso no rateio dos barbeiros"
                          className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-xs focus:outline-none focus:border-[var(--brand)]"
                          value={state.pointWeight}
                          onChange={(e) => {
                            setSelectedBenefits({
                              ...selectedBenefits,
                              [svc.id]: {
                                ...state,
                                pointWeight: parseFloat(e.target.value) || 1.0
                              }
                            });
                          }}
                        />
                      </div>
                      <p className="col-span-2 text-[10px] text-[var(--text-muted)] mt-0.5">
                        Use 1.00 para um serviço normal. Serviços mais complexos podem ter peso maior, como 1.50 ou 2.00.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {Object.values(selectedBenefits).filter(b => b.selected).length === 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Este plano ainda não possui serviços inclusos. Clientes assinantes não terão serviços cobertos até adicionar benefícios.
          </div>
        )}
      </div>
    </form>
  );
}

export default function PlanosPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formInitial, setFormInitial] = useState<Partial<Plan> | undefined>();
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [plansRes, servicesRes] = await Promise.all([
        fetch("/api/admin/clube/plans"),
        fetch("/api/admin/services"),
      ]);
      const plansData = await plansRes.json();
      const servicesData = await servicesRes.json();
      setPlans(Array.isArray(plansData) ? plansData : []);
      setServices(Array.isArray(servicesData) ? servicesData : []);
    } catch {
      setError("Erro ao carregar planos e serviços.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setFormInitial(undefined);
    setFormMode("create");
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(plan: Plan) {
    setFormInitial(plan);
    setFormMode("edit");
    setFormError("");
    setFormOpen(true);
  }

  async function handleSubmit(data: any) {
    setFormLoading(true);
    setFormError("");
    try {
      const url =
        formMode === "edit"
          ? `/api/admin/clube/plans/${formInitial?.id}`
          : "/api/admin/clube/plans";
      const method = formMode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        setFormError(err.message ?? "Erro ao salvar plano.");
        return;
      }
      setFormOpen(false);
      load();
    } catch {
      setFormError("Erro de conexão.");
    } finally {
      setFormLoading(false);
    }
  }

  async function handleDeactivate() {
    if (!confirmId) return;
    setConfirmLoading(true);
    try {
      await fetch(`/api/admin/clube/plans/${confirmId}`, { method: "DELETE" });
      setConfirmId(null);
      load();
    } catch {
      /* silent */
    } finally {
      setConfirmLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <ClubModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={formMode === "create" ? "Novo plano" : "Editar plano"}
        description="Configure nome, preço e rateio do plano."
        footer={
          <>
            <button
              onClick={() => setFormOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="plan-form"
              disabled={formLoading}
              className="btn-gold px-5 py-2 text-sm min-h-0"
            >
              {formLoading ? "Salvando..." : formMode === "create" ? "Criar plano" : "Salvar"}
            </button>
          </>
        }
      >
        <PlanForm
          initial={formInitial}
          services={services}
          onSubmit={handleSubmit}
          onClose={() => setFormOpen(false)}
          loading={formLoading}
          error={formError}
        />
      </ClubModal>

      <ClubConfirmDialog
        isOpen={!!confirmId}
        onClose={() => setConfirmId(null)}
        onConfirm={handleDeactivate}
        title="Inativar plano"
        message="O plano será inativado. Assinaturas existentes não serão afetadas. Deseja continuar?"
        confirmLabel="Inativar"
        variant="warning"
        loading={confirmLoading}
      />

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">Planos do Clube</h1>
          <p className="text-sm text-[var(--text-muted)]">Gerencie os planos de assinatura disponíveis.</p>
        </div>
        <button onClick={openCreate} className="btn-gold px-4 py-2 text-sm min-h-0">
          Novo plano
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <p className="text-[var(--text-muted)]">Carregando...</p>
      ) : plans.length === 0 ? (
        <div className="py-16 text-center border border-[var(--border-subtle)] rounded-xl bg-[var(--surface)]">
          <div className="w-16 h-16 bg-[var(--surface-hover)] rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⭐</span>
          </div>
          <p className="font-bold text-[var(--text-primary)] mb-1">Nenhum plano cadastrado</p>
          <p className="text-sm text-[var(--text-muted)] max-w-sm mx-auto mb-6">
            Crie o primeiro plano de assinatura do clube para começar a fidelizar seus clientes.
          </p>
          <button onClick={openCreate} className="btn-gold px-6 py-2 text-sm min-h-0">
            Criar primeiro plano
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-xl border ${plan.isActive ? "border-[var(--border)]" : "border-[var(--border-subtle)] opacity-60"} bg-[var(--surface)] p-4`}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-[var(--text-primary)]">{plan.name}</p>
                    {!plan.isActive && (
                      <span className="badge badge-completed">Inativo</span>
                    )}
                  </div>
                  {plan.description && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{plan.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-1.5 text-xs text-[var(--text-muted)]">
                    <span>Barbearia: <strong className="text-[var(--text-secondary)]">{plan.shopSharePercent}%</strong></span>
                    <span>Barbeiros: <strong className="text-[var(--text-secondary)]">{plan.barberPoolPercent}%</strong></span>
                    <span>{plan.benefits?.length ?? 0} benefício(s)</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <p className="font-bold text-[var(--brand-hover)] text-lg">{brl(plan.monthlyPrice)}<span className="text-xs font-normal text-[var(--text-muted)]">/mês</span></p>
                  <div className="flex gap-2">
                    <Link
                      href={`/admin/clube/planos/${plan.id}`}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
                    >
                      Benefícios
                    </Link>
                    <button
                      onClick={() => openEdit(plan)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] transition-colors"
                    >
                      Editar
                    </button>
                    {plan.isActive && (
                      <button
                        onClick={() => setConfirmId(plan.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-900/60 text-red-400 hover:bg-red-950/30 transition-colors"
                      >
                        Inativar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
