"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ComandaItemCard } from "@/components/admin/comanda/ComandaItemCard";
import { PaymentModal } from "@/components/admin/comanda/PaymentModal";

type Item = {
  id: string;
  type: string;
  status: string;
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  executor?: { id: string; user: { name: string } } | null;
  createdAt: string;
  completedAt: string | null;
};
type Payment = {
  id: string;
  method: string;
  amount: string;
  status: string;
  paidAt: string;
  refundedAmount?: string | number;
  refundOfId?: string | null;
  refundReason?: string | null;
};
type Comanda = {
  id: string;
  appointmentId: string | null;
  customerName: string;
  customerPhone: string | null;
  status: string;
  subtotal: string;
  discountTotal: string;
  surchargeTotal: string;
  total: string;
  paidTotal: string;
  remainingTotal: string;
  items: Item[];
  payments: Payment[];
  createdAt: string;
  openedAt: string;
  closedAt: string | null;
  permissions?: {
    canReopen?: boolean;
    canRefund?: boolean;
    canCancel?: boolean;
  };
};
type Service = { id: string; name: string; price: string };
type Product = { id: string; name: string; salePrice: string; currentStock: string; trackStock: boolean };
type Member = { id: string; user: { name: string } };
type ClubBenefit = {
  id: string;
  benefitType: string;
  serviceId?: string | null;
  productId?: string | null;
  isUnlimited?: boolean;
  availableQty?: number | null;
  includedQty?: number | null;
  pointWeight?: number | string | null;
  discountPercent?: number | string | null;
  canUse?: boolean;
};
type ClubBalance = {
  status?: string;
  clubPlan?: { id: string; name: string } | null;
  benefits?: ClubBenefit[];
};

function brl(value: string | number) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ComandaDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [comanda, setComanda] = useState<Comanda | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Modals state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showReopenModal, setShowReopenModal] = useState(false);

  // Form states
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedExecutorId, setSelectedExecutorId] = useState("");
  
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productQuantity, setProductQuantity] = useState("1");
  
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  // Customer Club states
  const [clubBalance, setClubBalance] = useState<ClubBalance | null>(null);
  const [clubBenefitRequested, setClubBenefitRequested] = useState(false);
  const [requestedClubPlanBenefitId, setRequestedClubPlanBenefitId] = useState("");

  // Refund and cancel states
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundConfirmed, setRefundConfirmed] = useState(false);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelRefundAll, setCancelRefundAll] = useState(true);
  const [cancelConfirmed, setCancelConfirmed] = useState(false);


  async function load() {
    setLoading(true);
    setError("");
    try {
      const [comandaRes, servicesRes, productsRes, appointmentsRes] = await Promise.all([
        fetch(`/api/admin/comandas/${id}`),
        fetch("/api/admin/services"),
        fetch("/api/admin/products"),
        fetch("/api/admin/appointments"),
      ]);
      const comandaData = await comandaRes.json();
      if (!comandaRes.ok) throw new Error(comandaData.message ?? comandaData.error ?? "Erro ao carregar comanda.");
      setComanda(comandaData);
      
      const servicesData = await servicesRes.json();
      const productsData = await productsRes.json();
      const appointmentsData = await appointmentsRes.json();
      
      setServices(Array.isArray(servicesData) ? servicesData : servicesData.services ?? []);
      setProducts(productsData.products ?? []);
      setMembers(appointmentsData.members ?? []);

      // Se houver cliente vinculado, buscar saldo do clube
      if (comandaData.customerId) {
        try {
          const clubRes = await fetch(`/api/admin/clube/subscriptions/customer/${comandaData.customerId}/balance`);
          if (clubRes.ok) {
            const clubData = await clubRes.json();
            setClubBalance(clubData);
          }
        } catch {
          // silent error, club module optional
        }
      } else {
        setClubBalance(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar comanda.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function mutate(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Erro na operação.");
      setComanda(data);
      return true;
    } catch (err) {
      let msg = err instanceof Error ? err.message : "Erro na operação.";
      if (msg.includes("TOTAL_BELOW_PAID") || msg.includes("abaixo do valor já pago") || msg.includes("reduziriam o total da comanda")) {
        msg = "Estorne primeiro o valor pago excedente para cancelar este item.";
      }
      setError(msg);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalize() {
    if (!comanda) return;
    if (Number(comanda.remainingTotal) <= 0) {
      await mutate(`/api/admin/comandas/${id}/finalize`, { payments: [] });
    } else {
      setShowPaymentModal(true);
    }
  }

  async function handleAddService(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedServiceId || !selectedExecutorId) return;
    const ok = await mutate(`/api/admin/comandas/${id}/items`, {
      type: "SERVICE",
      serviceId: selectedServiceId,
      executorId: selectedExecutorId,
      clubBenefitRequested,
      requestedClubPlanBenefitId: requestedClubPlanBenefitId || undefined,
    });
    if (ok) {
      setShowServiceModal(false);
      setSelectedServiceId("");
      setSelectedExecutorId("");
      setClubBenefitRequested(false);
      setRequestedClubPlanBenefitId("");
    }
  }

  async function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProductId) return;
    const qty = Number(productQuantity);
    if (qty <= 0) {
      setError("Quantidade deve ser maior que zero");
      return;
    }

    const p = products.find(prod => prod.id === selectedProductId);
    if (p && p.trackStock) {
      const inCart = comanda?.items.filter(i => i.type === "PRODUCT" && i.description === p.name && i.status !== "CANCELLED").reduce((sum, i) => sum + Number(i.quantity), 0) || 0;
      const available = Number(p.currentStock) - inCart;
      if (qty > available) {
        setError(`Quantidade indisponível. Estoque restante: ${Math.max(0, available)}`);
        return;
      }
    }

    const ok = await mutate(`/api/admin/comandas/${id}/items`, {
      type: "PRODUCT",
      productId: selectedProductId,
      quantity: qty,
      clubBenefitRequested,
      requestedClubPlanBenefitId: requestedClubPlanBenefitId || undefined,
    });
    if (ok) {
      setShowProductModal(false);
      setSelectedProductId("");
      setProductQuantity("1");
      setClubBenefitRequested(false);
      setRequestedClubPlanBenefitId("");
    }
  }

  async function handleAddDiscount(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = Number(discountAmount);
    if (amountNum < 0) {
      setError("Desconto não pode ser negativo.");
      return;
    }
    if (amountNum > 0 && !discountReason.trim()) {
      setError("Justificativa obrigatória para o desconto.");
      return;
    }
    const ok = await mutate(`/api/admin/comandas/${id}/items`, { type: "DISCOUNT", amount: amountNum, description: discountReason.trim() });
    if (ok) {
      setShowDiscountModal(false);
      setDiscountAmount("");
      setDiscountReason("");
    }
  }

  async function handlePay(payments: { method: string; amount: string }[]) {
    const ok = await mutate(`/api/admin/comandas/${id}/finalize`, { payments });
    if (ok) setShowPaymentModal(false);
  }

  async function handleReopen(e: React.FormEvent) {
    e.preventDefault();
    const reason = reopenReason.trim();
    if (reason.length < 5) {
      setError("Informe um motivo com pelo menos 5 caracteres para reabrir a comanda.");
      return;
    }

    const ok = await mutate(`/api/admin/comandas/${id}/reopen`, { reason });
    if (ok) {
      setShowReopenModal(false);
      setReopenReason("");
      await load();
    }
  }

  async function handleRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPayment) return;
    const reason = refundReason.trim();
    if (reason.length < 5) {
      setError("O motivo do estorno deve ter pelo menos 5 caracteres.");
      return;
    }
    if (!refundConfirmed) {
      setError("Confirme que a devolução real será fora do sistema.");
      return;
    }
    const ok = await mutate(`/api/admin/comandas/${id}/payments/${selectedPayment.id}/refund`, {
      amount: refundAmount,
      reason,
    });
    if (ok) {
      setShowRefundModal(false);
      setSelectedPayment(null);
      setRefundAmount("");
      setRefundReason("");
      setRefundConfirmed(false);
      await load();
    }
  }

  async function handleCancelComanda(e: React.FormEvent) {
    e.preventDefault();
    const reason = cancelReason.trim();
    if (reason.length < 5) {
      setError("O motivo do cancelamento deve ter pelo menos 5 caracteres.");
      return;
    }
    if (!cancelConfirmed) {
      setError("Confirme que os estornos reais foram/serão feitos fora do sistema.");
      return;
    }
    const ok = await mutate(`/api/admin/comandas/${id}/cancel`, {
      reason,
      refundAll: cancelRefundAll,
    });
    if (ok) {
      setShowCancelModal(false);
      setCancelReason("");
      setCancelConfirmed(false);
      await load();
    }
  }

  function getStatusLabel(status: string) {
    switch (status) {
      case "OPEN": return "Aberta";
      case "IN_SERVICE": return "Em Atendimento";
      case "PENDING_PAYMENT": return "Aguardando Pagamento";
      case "CLOSED": return "Concluída";
      case "CANCELLED": return "Cancelada";
      default: return status;
    }
  }

  if (loading) return <div className="p-6 text-[var(--text-muted)]">Carregando...</div>;
  if (!comanda) return <div className="p-6 text-[var(--danger)]">{error || "Comanda não encontrada."}</div>;

  const comandaClosed = comanda.status === "CLOSED" || comanda.status === "CANCELLED";
  const canReopenComanda = comanda.status === "CLOSED" && Boolean(comanda.permissions?.canReopen);

  // Build timeline from real data
  const timeline = [
    { type: "OPEN", date: new Date(comanda.openedAt), label: "Comanda Aberta" },
    ...comanda.items.map(i => ({ type: "ITEM_ADDED", date: new Date(i.createdAt), label: `Item adicionado: ${i.description}` })),
    ...comanda.items.filter(i => i.status === "DONE" && i.completedAt).map(i => ({ type: "ITEM_DONE", date: new Date(i.completedAt!), label: `Item concluído: ${i.description}` })),
    ...comanda.payments.map(p => {
      const originalAmount = Number(p.amount);
      const isRefund = originalAmount < 0 || p.status === "REFUNDED" || p.refundOfId != null;
      return {
        type: isRefund ? "REFUND" : "PAYMENT",
        date: new Date(p.paidAt),
        label: isRefund
          ? `Estorno registrado (${p.method}): ${brl(p.amount)}`
          : `Pagamento recebido (${p.method}): ${brl(p.amount)}`,
      };
    }),
  ];
  if (comanda.closedAt) {
    timeline.push({ type: "CLOSED", date: new Date(comanda.closedAt), label: "Comanda Fechada" });
  }
  timeline.sort((a, b) => b.date.getTime() - a.date.getTime()); // newest first

  return (
    <div className="p-4 md:p-6 pb-40 md:pb-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-serif font-bold text-[var(--text-primary)]">{comanda.customerName}</h1>
            <span className={`px-2 py-1 text-xs font-bold rounded-md border ${
              comanda.status === "OPEN" ? "bg-[var(--surface-raised)] text-[var(--text-muted)] border-[var(--border-subtle)]" :
              comanda.status === "IN_SERVICE" ? "bg-[var(--brand-subtle)] text-[var(--gold)] border-[var(--gold-border)]" :
              comanda.status === "PENDING_PAYMENT" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
              comanda.status === "CLOSED" ? "bg-[var(--success-subtle)] text-emerald-400 border border-emerald-950/20" :
              "bg-[var(--danger-subtle)] text-[var(--danger)] border border-[var(--border-danger)]"
            }`}>
              {getStatusLabel(comanda.status)}
            </span>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mb-3">{comanda.customerPhone ?? "Sem telefone"}</p>
          {clubBalance && clubBalance.clubPlan && (
            <div className="mb-3 px-3 py-2 rounded-xl border border-[var(--gold-border)] bg-[var(--brand-subtle)] text-[var(--gold)] text-xs font-bold max-w-fit flex items-center gap-2">
              <span>👑 Assinante Clube: {clubBalance.clubPlan.name}</span>
            </div>
          )}
          <div className="flex gap-2 items-center">
            {comanda.appointmentId ? (
              <Link href="/admin/agendamentos" className="text-sm text-[var(--gold)] hover:text-[var(--gold-light)] underline underline-offset-2 transition-colors">Voltar para agenda</Link>
            ) : (
              <span className="text-xs bg-[var(--surface-raised)] text-[var(--text-muted)] border border-[var(--border-subtle)] px-2 py-1 rounded">Atendimento Avulso</span>
            )}
          </div>
        </div>

        {/* Desktop actions */}
        <div className="flex flex-wrap gap-2">
          {comanda.status !== "CANCELLED" && comanda.permissions?.canCancel && (
            <button
              disabled={busy}
              onClick={() => {
                setCancelReason("");
                setCancelConfirmed(false);
                setCancelRefundAll(true);
                setShowCancelModal(true);
              }}
              className="px-4 py-2 rounded-lg bg-[var(--danger-subtle)] border border-[var(--border-danger)] text-[var(--danger)] hover:bg-red-950/20 text-sm font-bold transition-colors disabled:opacity-40 cursor-pointer"
            >
              Cancelar comanda
            </button>
          )}
          {canReopenComanda && (
            <button
              disabled={busy}
              onClick={() => setShowReopenModal(true)}
              className="px-4 py-2 rounded-lg border border-[var(--gold-border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)] text-[var(--gold)] text-sm font-bold transition-colors disabled:opacity-40 cursor-pointer"
            >
              Reabrir comanda
            </button>
          )}
          {!comandaClosed && (
            <button
              disabled={busy}
              onClick={handleFinalize}
              className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] text-sm font-bold transition-colors disabled:opacity-40 cursor-pointer"
            >
              Finalizar atendimento
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-[var(--border-danger)] bg-[var(--danger-subtle)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        <div className="md:col-span-2 space-y-6">
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] flex justify-between items-center bg-[var(--surface-raised)]">
              <h2 className="font-semibold text-[var(--text-primary)]">Itens do Atendimento</h2>
              <div className="flex gap-2">
                <button disabled={busy || comandaClosed} onClick={() => setShowServiceModal(true)} className="text-xs px-2 py-1 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-30 cursor-pointer transition-colors">Serviço</button>
                <button disabled={busy || comandaClosed} onClick={() => setShowProductModal(true)} className="text-xs px-2 py-1 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-30 cursor-pointer transition-colors">Produto</button>
                <button disabled={busy || comandaClosed} onClick={() => {
                  const existingDiscount = comanda.items.find(i => i.type === "DISCOUNT");
                  if (existingDiscount) {
                    setDiscountAmount(existingDiscount.unitPrice);
                    setDiscountReason(existingDiscount.description);
                  } else {
                    setDiscountAmount("");
                    setDiscountReason("");
                  }
                  setShowDiscountModal(true);
                }} className="text-xs px-2 py-1 rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-30 cursor-pointer transition-colors">Desconto</button>
              </div>
            </div>
            {comanda.items.length === 0 ? <p className="p-6 text-center text-sm text-[var(--text-muted)]">O carrinho está vazio.</p> : (
              <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
                {comanda.items.map((item) => (
                  <ComandaItemCard
                    key={item.id}
                    item={item}
                    busy={busy}
                    comandaClosed={comandaClosed}
                    clubBalance={clubBalance}
                    onConclude={(itemId) => mutate(`/api/admin/comandas/${id}/items/${itemId}`, { status: "DONE" }, "PATCH")}
                    onCancel={(itemId) => mutate(`/api/admin/comandas/${id}/items/${itemId}`, { status: "CANCELLED" }, "PATCH")}
                    onUpdate={(itemId, body) => mutate(`/api/admin/comandas/${id}/items/${itemId}`, body, "PATCH")}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Seção de Pagamentos */}
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] flex justify-between items-center">
              <h2 className="font-semibold text-[var(--text-primary)]">Pagamentos</h2>
            </div>
            <div className="p-4 space-y-4">
              {comanda.payments.length === 0 ? (
                <p className="text-center text-sm text-[var(--text-muted)]">Nenhum pagamento registrado.</p>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)]">
                  {comanda.payments.map((p) => {
                    const originalAmount = Number(p.amount);
                    const refundedAmount = Number(p.refundedAmount || 0);
                    const refundableBalance = originalAmount - refundedAmount;
                    const isRefund = originalAmount < 0 || p.status === "REFUNDED" || p.refundOfId != null;

                    return (
                      <div key={p.id} className="py-3 flex justify-between items-center gap-4 first:pt-0 last:pb-0">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-[var(--text-primary)]">
                              {isRefund ? `Estorno (${p.method})` : `Pagamento (${p.method})`}
                            </span>
                            {isRefund ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--danger-subtle)] text-[var(--danger)] font-bold">
                                Estornado
                              </span>
                            ) : refundedAmount > 0 ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-bold">
                                {refundableBalance === 0 ? "Totalmente Estornado" : "Parcialmente Estornado"}
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--success-subtle)] text-emerald-400 font-bold">
                                Confirmado
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {new Date(p.paidAt).toLocaleString("pt-BR")}
                          </p>
                          {p.refundReason && (
                            <p className="text-xs text-[var(--text-secondary)] italic mt-1">
                              Motivo: {p.refundReason}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold text-sm ${isRefund ? "text-[var(--danger)]" : "text-emerald-400"}`}>
                            {brl(p.amount)}
                          </p>
                          {!isRefund && refundedAmount > 0 && (
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                              Estornado: {brl(refundedAmount)} | Saldo: {brl(refundableBalance)}
                            </p>
                          )}
                          {!isRefund && refundableBalance > 0 && comanda.permissions?.canRefund && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                setSelectedPayment(p);
                                setRefundAmount(refundableBalance.toFixed(2));
                                setRefundReason("");
                                setRefundConfirmed(false);
                                setShowRefundModal(true);
                              }}
                              className="mt-1 text-xs text-[var(--gold)] hover:text-[var(--gold-light)] underline cursor-pointer disabled:opacity-50"
                            >
                              Estornar
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]">
              <h2 className="font-semibold text-[var(--text-primary)]">Linha do Tempo</h2>
            </div>
            <div className="p-4 space-y-4">
              {timeline.map((event, idx) => (
                <div key={idx} className="flex gap-4 items-start">
                  <div className="mt-1.5 w-2 h-2 rounded-full bg-[var(--border-subtle)] shrink-0"></div>
                  <div>
                    <p className="text-sm text-[var(--text-secondary)]">{event.label}</p>
                    <p className="text-xs text-[var(--text-muted)]">{event.date.toLocaleString("pt-BR")}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Resumo Financeiro */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden sticky top-6 shadow-md">
          <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]">
            <h2 className="font-semibold text-[var(--text-primary)]">Resumo</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex justify-between text-sm text-[var(--text-secondary)]">
              <span>Subtotal</span>
              <span>{brl(comanda.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-[var(--danger)]">
              <span>Descontos</span>
              <span>- {brl(comanda.discountTotal)}</span>
            </div>
            {Number(comanda.surchargeTotal) > 0 && (
              <div className="flex justify-between text-sm text-[var(--gold)]">
                <span>Acréscimos</span>
                <span>+ {brl(comanda.surchargeTotal)}</span>
              </div>
            )}
            <div className="pt-3 border-t border-[var(--border-subtle)] flex justify-between font-bold text-[var(--text-primary)]">
              <span>Total</span>
              <span>{brl(comanda.total)}</span>
            </div>
            <div className="flex justify-between text-sm text-emerald-400">
              <span>Valor Pago</span>
              <span>{brl(comanda.paidTotal)}</span>
            </div>
            <div className="pt-3 border-t border-[var(--border-subtle)] flex justify-between font-bold text-lg text-[var(--gold)] font-serif">
              <span>Restante</span>
              <span>{brl(comanda.remainingTotal)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sticky Bottom Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[var(--surface)] border-t border-[var(--border-strong)] p-4 z-40 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-[var(--text-secondary)] font-medium">Falta Pagar</span>
          <span className="text-xl font-bold text-[var(--gold)] font-serif">{brl(comanda.remainingTotal)}</span>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {comanda.status !== "CANCELLED" && comanda.permissions?.canCancel && (
            <button
              disabled={busy}
              onClick={() => {
                setCancelReason("");
                setCancelConfirmed(false);
                setCancelRefundAll(true);
                setShowCancelModal(true);
              }}
              className="w-full py-3 rounded-lg bg-[var(--danger-subtle)] border border-[var(--border-danger)] text-[var(--danger)] text-sm font-bold transition-colors disabled:opacity-40 cursor-pointer"
            >
              Cancelar comanda
            </button>
          )}
          {canReopenComanda && (
            <button
              disabled={busy}
              onClick={() => setShowReopenModal(true)}
              className="w-full py-3 rounded-lg border border-[var(--gold-border)] bg-[var(--surface-raised)] text-[var(--gold)] text-sm font-bold transition-colors disabled:opacity-40 cursor-pointer"
            >
              Reabrir comanda
            </button>
          )}
          {!comandaClosed && (
            <button
              disabled={busy}
              onClick={handleFinalize}
              className="w-full py-3 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] text-sm font-bold transition-colors disabled:opacity-40 cursor-pointer"
            >
              Finalizar atendimento
            </button>
          )}
        </div>
      </div>

      {/* Modals */}
      {showPaymentModal && (
        <PaymentModal 
          remainingTotal={Number(comanda.remainingTotal)} 
          busy={busy} 
          onPay={handlePay} 
          onClose={() => setShowPaymentModal(false)} 
        />
      )}

      {showReopenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)] backdrop-blur-sm p-4">
          <form onSubmit={handleReopen} className="bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">Reabrir comanda</h2>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Pagamentos e registros financeiros existentes serao preservados. A comanda voltara para pagamento pendente e podera ser ajustada sem reduzir o total abaixo do valor ja pago.
              </p>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                  Motivo <span className="text-[var(--danger)]">*</span>
                </label>
                <textarea
                  value={reopenReason}
                  onChange={e => setReopenReason(e.target.value)}
                  minLength={5}
                  maxLength={500}
                  required
                  rows={4}
                  placeholder="Ex: Correcao de item lancado incorretamente"
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)] resize-none"
                />
              </div>
            </div>
            <div className="p-5 border-t border-[var(--border-subtle)] flex justify-end gap-3 bg-[var(--surface-raised)]">
              <button type="button" onClick={() => setShowReopenModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors text-sm font-semibold">Cancelar</button>
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold disabled:opacity-50 cursor-pointer transition-colors text-sm">Confirmar reabertura</button>
            </div>
          </form>
        </div>
      )}

      {showServiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)] backdrop-blur-sm p-4">
          <form onSubmit={handleAddService} className="bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">Adicionar Serviço</h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Serviço</label>
                <select
                  value={selectedServiceId}
                  onChange={e => setSelectedServiceId(e.target.value)}
                  required
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                >
                  <option value="">Selecione...</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name} - {brl(s.price)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Profissional</label>
                <select
                  value={selectedExecutorId}
                  onChange={e => setSelectedExecutorId(e.target.value)}
                  required
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                >
                  <option value="">Selecione...</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.user.name}</option>)}
                </select>
              </div>

              {clubBalance && clubBalance.benefits && (
                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Benefícios do Clube</p>
                  {(() => {
                    const matchingBenefits = clubBalance.benefits.filter(
                      (b: ClubBenefit) => b.serviceId === selectedServiceId
                    );
                    if (matchingBenefits.length === 0) {
                      return <p className="text-xs text-[var(--text-muted)]">Nenhum benefício para este serviço.</p>;
                    }
                    return (
                      <div className="space-y-1.5">
                        {matchingBenefits.map((b: ClubBenefit) => {
                          const isIncluded = b.benefitType === "INCLUDED_SERVICE";
                          const label = isIncluded 
                            ? (b.isUnlimited ? "Serviço incluso (Ilimitado)" : `Serviço incluso (${b.availableQty} / ${b.includedQty} restantes)`)
                            : `Desconto de ${b.discountPercent}% no serviço`;
                          const canUse = b.canUse !== undefined ? b.canUse : (b.isUnlimited || (b.availableQty && b.availableQty > 0));
                          const isDisabled = isIncluded && !canUse;

                          return (
                            <label key={b.id} className={`flex items-start gap-2 text-sm text-[var(--text-primary)] ${isDisabled ? "opacity-50" : "cursor-pointer"}`}>
                              <input
                                type="checkbox"
                                disabled={isDisabled}
                                checked={clubBenefitRequested && requestedClubPlanBenefitId === b.id}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setClubBenefitRequested(true);
                                    setRequestedClubPlanBenefitId(b.id);
                                  } else {
                                    setClubBenefitRequested(false);
                                    setRequestedClubPlanBenefitId("");
                                  }
                                }}
                                className="mt-1"
                              />
                              <div>
                                <p className="font-semibold text-[var(--brand-hover)]">{label}</p>
                                {isIncluded && (
                                  <p className="text-[10px] text-[var(--text-muted)]">Gera {b.pointWeight} pontos no rateio</p>
                                )}
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="p-5 border-t border-[var(--border-subtle)] flex justify-end gap-3 bg-[var(--surface-raised)]">
              <button type="button" onClick={() => setShowServiceModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors text-sm font-semibold">Cancelar</button>
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold disabled:opacity-50 cursor-pointer transition-colors text-sm">Adicionar</button>
            </div>
          </form>
        </div>
      )}

      {showProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)] backdrop-blur-sm p-4">
          <form onSubmit={handleAddProduct} className="bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">Adicionar Produto</h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Produto</label>
                <select
                  value={selectedProductId}
                  onChange={e => setSelectedProductId(e.target.value)}
                  required
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                >
                  <option value="">Selecione...</option>
                  {products.map(p => {
                    const inCart = comanda?.items.filter(i => i.type === "PRODUCT" && i.description === p.name && i.status !== "CANCELLED").reduce((sum, i) => sum + Number(i.quantity), 0) || 0;
                    const available = Number(p.currentStock) - inCart;
                    const stockInfo = p.trackStock ? ` (Estoque: ${Math.max(0, available)})` : "";
                    return <option key={p.id} value={p.id} disabled={p.trackStock && available <= 0}>{p.name} - {brl(p.salePrice)}{stockInfo}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Quantidade</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={productQuantity}
                  onChange={e => setProductQuantity(e.target.value)}
                  required
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                />
              </div>

              {clubBalance && clubBalance.benefits && (
                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Benefícios do Clube</p>
                  {(() => {
                    const matchingBenefits = clubBalance.benefits.filter(
                      (b: ClubBenefit) => b.productId === selectedProductId
                    );
                    if (matchingBenefits.length === 0) {
                      return <p className="text-xs text-[var(--text-muted)]">Nenhum benefício para este produto.</p>;
                    }
                    return (
                      <div className="space-y-1.5">
                        {matchingBenefits.map((b: ClubBenefit) => {
                          const label = `Desconto de ${b.discountPercent}% no produto`;

                          return (
                            <label key={b.id} className="flex items-start gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
                              <input
                                type="checkbox"
                                checked={clubBenefitRequested && requestedClubPlanBenefitId === b.id}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setClubBenefitRequested(true);
                                    setRequestedClubPlanBenefitId(b.id);
                                  } else {
                                    setClubBenefitRequested(false);
                                    setRequestedClubPlanBenefitId("");
                                  }
                                }}
                                className="mt-1"
                              />
                              <div>
                                <p className="font-semibold text-[var(--brand-hover)]">{label}</p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="p-5 border-t border-[var(--border-subtle)] flex justify-end gap-3 bg-[var(--surface-raised)]">
              <button type="button" onClick={() => setShowProductModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors text-sm font-semibold">Cancelar</button>
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold disabled:opacity-50 cursor-pointer transition-colors text-sm">Adicionar</button>
            </div>
          </form>
        </div>
      )}

      {showDiscountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)] backdrop-blur-sm p-4">
          <form onSubmit={handleAddDiscount} className="bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">Desconto Geral da Comanda</h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Valor do Desconto (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={discountAmount}
                  onChange={e => setDiscountAmount(e.target.value)}
                  placeholder="0.00 (deixe vazio para remover)"
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Justificativa <span className="text-[var(--danger)]">*</span></label>
                <input
                  type="text"
                  value={discountReason}
                  onChange={e => setDiscountReason(e.target.value)}
                  maxLength={255}
                  placeholder="Ex: Desconto autorizado pelo gerente"
                  required={Number(discountAmount) > 0}
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                />
              </div>
            </div>
            <div className="p-5 border-t border-[var(--border-subtle)] flex justify-end gap-3 bg-[var(--surface-raised)]">
              <button type="button" onClick={() => setShowDiscountModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors text-sm font-semibold">Cancelar</button>
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold disabled:opacity-50 cursor-pointer transition-colors text-sm">Aplicar</button>
            </div>
          </form>
        </div>
      )}

      {showRefundModal && selectedPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)] backdrop-blur-sm p-4">
          <form onSubmit={handleRefund} className="bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">Registrar estorno</h2>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Este estorno registra a correção no sistema. A devolução real ao cliente deve ser feita fora do sistema.
              </p>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                  Valor a Estornar (R$) <span className="text-[var(--danger)]">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={(Number(selectedPayment.amount) - Number(selectedPayment.refundedAmount || 0)).toFixed(2)}
                  value={refundAmount}
                  onChange={e => setRefundAmount(e.target.value)}
                  required
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                  Motivo <span className="text-[var(--danger)]">*</span>
                </label>
                <textarea
                  value={refundReason}
                  onChange={e => setRefundReason(e.target.value)}
                  minLength={5}
                  maxLength={500}
                  required
                  rows={3}
                  placeholder="Ex: Cliente desistiu ou cobrado duplicado"
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)] resize-none"
                />
              </div>
              <label className="flex items-start gap-2 text-sm text-[var(--text-primary)] cursor-pointer mt-3">
                <input
                  type="checkbox"
                  checked={refundConfirmed}
                  onChange={e => setRefundConfirmed(e.target.checked)}
                  required
                  className="mt-1"
                />
                <span className="font-semibold text-amber-400">
                  Confirmo que este estorno é um registro operacional no sistema e que a devolução real ao cliente será feita fora do sistema.
                </span>
              </label>
            </div>
            <div className="p-5 border-t border-[var(--border-subtle)] flex justify-end gap-3 bg-[var(--surface-raised)]">
              <button type="button" onClick={() => setShowRefundModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors text-sm font-semibold">Cancelar</button>
              <button type="submit" disabled={busy || !refundConfirmed} className="px-4 py-2 rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-light)] text-[var(--text-inverse)] font-bold disabled:opacity-50 cursor-pointer transition-colors text-sm">Confirmar estorno</button>
            </div>
          </form>
        </div>
      )}

      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--backdrop)] backdrop-blur-sm p-4">
          <form onSubmit={handleCancelComanda} className="bg-[var(--surface)] border border-[var(--border-strong)] rounded-xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">Cancelar comanda</h2>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 bg-[var(--danger-subtle)] border border-[var(--border-danger)] text-[var(--danger)] text-sm rounded-lg font-semibold">
                ⚠️ AVISO: Esta ação cancelará permanentemente todos os itens da comanda e reverterá estoque, clube e comissões. Ela não pode ser desfeita.
              </div>
              <div className="text-sm space-y-1">
                <p className="text-[var(--text-secondary)]">Valor Pago: <span className="font-semibold text-[var(--text-primary)]">{brl(comanda.paidTotal)}</span></p>
                {Number(comanda.paidTotal) > 0 && (
                  <p className="text-[var(--text-secondary)]">Valor a Estornar: <span className="font-semibold text-[var(--text-primary)]">{brl(comanda.paidTotal)}</span></p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                  Motivo <span className="text-[var(--danger)]">*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  minLength={5}
                  maxLength={500}
                  required
                  rows={3}
                  placeholder="Ex: Lançada por engano ou duplicada"
                  className="w-full bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)] resize-none"
                />
              </div>
              {Number(comanda.paidTotal) > 0 && (
                <label className="flex items-start gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cancelRefundAll}
                    onChange={e => setCancelRefundAll(e.target.checked)}
                    className="mt-1"
                  />
                  <span>Estornar automaticamente todos os pagamentos confirmados</span>
                </label>
              )}
              <label className="flex items-start gap-2 text-sm text-[var(--text-primary)] cursor-pointer mt-3">
                <input
                  type="checkbox"
                  checked={cancelConfirmed}
                  onChange={e => setCancelConfirmed(e.target.checked)}
                  required
                  className="mt-1"
                />
                <span className="font-semibold text-amber-400">
                  Confirmo que este cancelamento é um registro operacional e que os estornos reais foram/serão feitos externamente.
                </span>
              </label>
            </div>
            <div className="p-5 border-t border-[var(--border-subtle)] flex justify-end gap-3 bg-[var(--surface-raised)]">
              <button type="button" onClick={() => setShowCancelModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] cursor-pointer transition-colors text-sm font-semibold">Cancelar</button>
              <button type="submit" disabled={busy || !cancelConfirmed} className="px-4 py-2 rounded-lg bg-[var(--danger)] hover:bg-red-500 text-white font-bold disabled:opacity-50 cursor-pointer transition-colors text-sm">Confirmar cancelamento</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
