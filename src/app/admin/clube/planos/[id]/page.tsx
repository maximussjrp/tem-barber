"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
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
  service?: { name: string } | null;
  product?: { name: string } | null;
};

type Plan = {
  id: string;
  name: string;
  monthlyPrice: string;
  shopSharePercent: string;
  barberPoolPercent: string;
  isActive: boolean;
  benefits: Benefit[];
};

type ServiceItem = { id: string; name: string };
type ProductItem = { id: string; name: string };

const BENEFIT_TYPE_LABELS: Record<string, string> = {
  INCLUDED_SERVICE: "Serviço incluso",
  SERVICE_DISCOUNT: "Desconto em serviço",
  PRODUCT_DISCOUNT: "Desconto em produto",
};

function brl(v: string | number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function BenefitForm({
  services,
  products,
  onSubmit,
  loading,
  error,
}: {
  services: ServiceItem[];
  products: ProductItem[];
  onSubmit: (data: any) => void;
  loading: boolean;
  error: string;
}) {
  const [type, setType] = useState<"INCLUDED_SERVICE" | "SERVICE_DISCOUNT" | "PRODUCT_DISCOUNT">(
    "INCLUDED_SERVICE"
  );
  const [serviceId, setServiceId] = useState("");
  const [productId, setProductId] = useState("");
  const [includedQty, setIncludedQty] = useState("1");
  const [discountPercent, setDiscountPercent] = useState("");
  const [pointWeight, setPointWeight] = useState("");

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--brand)] transition-colors";
  const labelCls = "block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1.5";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const base = { benefitType: type, pointWeight: pointWeight ? parseFloat(pointWeight) : undefined };
    if (type === "INCLUDED_SERVICE") {
      onSubmit({ ...base, serviceId, includedQty: parseInt(includedQty) });
    } else if (type === "SERVICE_DISCOUNT") {
      onSubmit({ ...base, serviceId, discountPercent: parseFloat(discountPercent) });
    } else {
      onSubmit({ ...base, productId, discountPercent: parseFloat(discountPercent) });
    }
  }

  return (
    <form id="benefit-form" onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 px-3 py-2.5 text-sm text-red-300">{error}</div>
      )}
      <div>
        <label className={labelCls}>Tipo de benefício *</label>
        <select
          className={inputCls}
          value={type}
          onChange={(e) => setType(e.target.value as any)}
          required
        >
          <option value="INCLUDED_SERVICE">Serviço incluso</option>
          <option value="SERVICE_DISCOUNT">Desconto em serviço</option>
          <option value="PRODUCT_DISCOUNT">Desconto em produto</option>
        </select>
      </div>

      {(type === "INCLUDED_SERVICE" || type === "SERVICE_DISCOUNT") && (
        <div>
          <label className={labelCls}>Serviço *</label>
          <select className={inputCls} value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
            <option value="">Selecione um serviço</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {type === "PRODUCT_DISCOUNT" && (
        <div>
          <label className={labelCls}>Produto *</label>
          <select className={inputCls} value={productId} onChange={(e) => setProductId(e.target.value)} required>
            <option value="">Selecione um produto</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {type === "INCLUDED_SERVICE" && (
        <div>
          <label className={labelCls}>Quantidade incluída por ciclo *</label>
          <input
            className={inputCls}
            type="number"
            min="1"
            value={includedQty}
            onChange={(e) => setIncludedQty(e.target.value)}
            required
          />
        </div>
      )}

      {(type === "SERVICE_DISCOUNT" || type === "PRODUCT_DISCOUNT") && (
        <div>
          <label className={labelCls}>Desconto (%) *</label>
          <input
            className={inputCls}
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={discountPercent}
            onChange={(e) => setDiscountPercent(e.target.value)}
            required
            placeholder="Ex: 20"
          />
        </div>
      )}

      <div>
        <label className={labelCls}>Peso para rateio</label>
        <input
          className={inputCls}
          type="number"
          step="0.0001"
          min="0"
          value={pointWeight}
          onChange={(e) => setPointWeight(e.target.value)}
          placeholder="Ex: 1.0 (opcional)"
        />
        <p className="text-xs text-[var(--text-muted)] mt-1">
          Define o peso deste benefício no cálculo de pontos para rateio de barbeiros.
        </p>
      </div>
    </form>
  );
}

export default function PlanDetailPage() {
  const params = useParams();
  const planId = params?.id as string;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [auditLockMsg, setAuditLockMsg] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [planRes, svcRes, prodRes] = await Promise.all([
        fetch(`/api/admin/clube/plans/${planId}`),
        fetch("/api/admin/services"),
        fetch("/api/admin/products"),
      ]);
      const planData = await planRes.json();
      const svcData = await svcRes.json();
      const prodData = await prodRes.json();
      setPlan(planData);
      setServices(Array.isArray(svcData) ? svcData : []);
      setProducts(Array.isArray(prodData?.products) ? prodData.products : []);
    } catch {
      setError("Erro ao carregar dados do plano.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [planId]);

  async function handleAddBenefit(data: any) {
    setFormLoading(true);
    setFormError("");
    try {
      const res = await fetch(`/api/admin/clube/plans/${planId}/benefits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        setFormError(err.message ?? "Erro ao adicionar benefício.");
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

  async function handleDeleteBenefit() {
    if (!deleteId) return;
    setDeleteLoading(true);
    setAuditLockMsg("");
    try {
      const res = await fetch(`/api/admin/clube/plans/${planId}/benefits/${deleteId}`, {
        method: "DELETE",
      });
      if (res.status === 422) {
        const err = await res.json();
        setAuditLockMsg(err.message ?? "Não é possível remover: há histórico de utilização.");
        setDeleteId(null);
        return;
      }
      setDeleteId(null);
      load();
    } catch {
      /* silent */
    } finally {
      setDeleteLoading(false);
    }
  }

  if (loading) return <div className="p-6 text-[var(--text-muted)]">Carregando...</div>;
  if (error) return <div className="p-6 text-red-400">{error}</div>;
  if (!plan) return null;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <ClubModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title="Adicionar benefício"
        description="Configure o tipo de benefício e seus parâmetros."
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
              form="benefit-form"
              disabled={formLoading}
              className="btn-gold px-5 py-2 text-sm min-h-0"
            >
              {formLoading ? "Salvando..." : "Adicionar"}
            </button>
          </>
        }
      >
        <BenefitForm
          services={services}
          products={products}
          onSubmit={handleAddBenefit}
          loading={formLoading}
          error={formError}
        />
      </ClubModal>

      <ClubConfirmDialog
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDeleteBenefit}
        title="Remover benefício"
        message="O benefício será removido permanentemente. Esta ação não pode ser desfeita."
        confirmLabel="Remover"
        variant="danger"
        loading={deleteLoading}
      />

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/admin/clube/planos" className="hover:text-[var(--text-primary)] transition-colors">
          Planos
        </Link>
        <span>/</span>
        <span className="text-[var(--text-primary)]">{plan.name}</span>
      </div>

      {/* Plan summary */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-serif font-bold text-[var(--text-primary)]">{plan.name}</h1>
            <div className="flex gap-4 text-xs text-[var(--text-muted)] mt-1">
              <span>Mensalidade: <strong className="text-[var(--brand-hover)]">{brl(plan.monthlyPrice)}</strong></span>
              <span>Barbearia: <strong className="text-[var(--text-secondary)]">{plan.shopSharePercent}%</strong></span>
              <span>Barbeiros: <strong className="text-[var(--text-secondary)]">{plan.barberPoolPercent}%</strong></span>
            </div>
          </div>
          <button
            onClick={() => { setFormError(""); setFormOpen(true); }}
            className="btn-gold px-4 py-2 text-sm min-h-0"
          >
            + Adicionar benefício
          </button>
        </div>
      </div>

      {auditLockMsg && (
        <div className="rounded-lg border border-amber-800 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
          🔒 {auditLockMsg}
        </div>
      )}

      {/* Benefits list */}
      <div>
        <h2 className="font-semibold text-[var(--text-primary)] mb-3">Benefícios do plano</h2>
        {plan.benefits.length === 0 ? (
          <div className="py-12 text-center border border-[var(--border-subtle)] rounded-xl bg-[var(--surface)]">
            <p className="font-bold text-[var(--text-primary)] mb-1">Nenhum benefício configurado</p>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              Adicione serviços inclusos ou descontos para os assinantes deste plano.
            </p>
            <button onClick={() => setFormOpen(true)} className="btn-gold px-6 py-2 text-sm min-h-0">
              Adicionar primeiro benefício
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {plan.benefits.map((b) => (
              <div
                key={b.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] p-4 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="badge badge-progress text-xs">
                      {BENEFIT_TYPE_LABELS[b.benefitType]}
                    </span>
                    <p className="font-semibold text-[var(--text-primary)] text-sm">
                      {b.service?.name ?? b.product?.name ?? "—"}
                    </p>
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-[var(--text-muted)]">
                    {b.includedQty && <span>{b.includedQty}x por ciclo</span>}
                    {b.discountPercent && <span>{b.discountPercent}% de desconto</span>}
                    {b.pointWeight && <span>Peso: {b.pointWeight}</span>}
                  </div>
                </div>
                <button
                  onClick={() => { setAuditLockMsg(""); setDeleteId(b.id); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-900/60 text-red-400 hover:bg-red-950/30 transition-colors shrink-0"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
