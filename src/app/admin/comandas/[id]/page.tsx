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
type Payment = { id: string; method: string; amount: string; status: string; paidAt: string };
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
};
type Service = { id: string; name: string; price: string };
type Product = { id: string; name: string; salePrice: string; currentStock: string; trackStock: boolean };
type Member = { id: string; user: { name: string } };

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

  // Form states
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedExecutorId, setSelectedExecutorId] = useState("");
  
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productQuantity, setProductQuantity] = useState("1");
  
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");

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
      setError(err instanceof Error ? err.message : "Erro na operação.");
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
    const ok = await mutate(`/api/admin/comandas/${id}/items`, { type: "SERVICE", serviceId: selectedServiceId, executorId: selectedExecutorId });
    if (ok) {
      setShowServiceModal(false);
      setSelectedServiceId("");
      setSelectedExecutorId("");
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

    const ok = await mutate(`/api/admin/comandas/${id}/items`, { type: "PRODUCT", productId: selectedProductId, quantity: qty });
    if (ok) {
      setShowProductModal(false);
      setSelectedProductId("");
      setProductQuantity("1");
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

  // Build timeline from real data
  const timeline = [
    { type: "OPEN", date: new Date(comanda.openedAt), label: "Comanda Aberta" },
    ...comanda.items.map(i => ({ type: "ITEM_ADDED", date: new Date(i.createdAt), label: `Item adicionado: ${i.description}` })),
    ...comanda.items.filter(i => i.status === "DONE" && i.completedAt).map(i => ({ type: "ITEM_DONE", date: new Date(i.completedAt!), label: `Item concluído: ${i.description}` })),
    ...comanda.payments.map(p => ({ type: "PAYMENT", date: new Date(p.paidAt), label: `Pagamento recebido (${p.method}): ${brl(p.amount)}` })),
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
                    onConclude={(itemId) => mutate(`/api/admin/comandas/${id}/items/${itemId}`, { status: "DONE" }, "PATCH")}
                    onCancel={(itemId) => mutate(`/api/admin/comandas/${id}/items/${itemId}`, { status: "CANCELLED" }, "PATCH")}
                  />
                ))}
              </div>
            )}
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
        <div className="grid grid-cols-1">
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

    </div>
  );
}
