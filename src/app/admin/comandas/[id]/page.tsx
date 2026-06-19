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

  async function handlePay(method: string, amount: string) {
    const ok = await mutate(`/api/admin/comandas/${id}/payments`, { method, amount });
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

  if (loading) return <div className="p-6 text-stone-500">Carregando...</div>;
  if (!comanda) return <div className="p-6 text-red-300">{error || "Comanda nao encontrada."}</div>;

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
            <h1 className="text-2xl font-serif font-bold text-stone-100">{comanda.customerName}</h1>
            <span className={`px-2 py-1 text-xs font-bold rounded-md ${
              comanda.status === "OPEN" ? "bg-stone-800 text-stone-300" :
              comanda.status === "IN_SERVICE" ? "bg-amber-500/20 text-amber-300" :
              comanda.status === "PENDING_PAYMENT" ? "bg-orange-500/20 text-orange-300" :
              comanda.status === "CLOSED" ? "bg-emerald-500/20 text-emerald-300" :
              "bg-red-500/20 text-red-300"
            }`}>
              {getStatusLabel(comanda.status)}
            </span>
          </div>
          <p className="text-sm text-stone-400 mb-3">{comanda.customerPhone ?? "Sem telefone"}</p>
          <div className="flex gap-2 items-center">
            {comanda.appointmentId ? (
              <Link href="/admin/agendamentos" className="text-sm text-amber-500 hover:text-amber-400 underline underline-offset-2">Voltar para agenda</Link>
            ) : (
              <span className="text-xs bg-stone-800 text-stone-400 px-2 py-1 rounded">Atendimento Avulso</span>
            )}
          </div>
        </div>

        {/* Desktop actions */}
        <div className="flex flex-wrap gap-2">
          {comanda.status === "OPEN" && (
            <button disabled={busy} onClick={() => mutate(`/api/admin/comandas/${id}`, { status: "IN_SERVICE" }, "PATCH")} className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 text-sm font-bold disabled:opacity-40 hover:bg-amber-400">Iniciar atendimento</button>
          )}
          {comanda.status === "IN_SERVICE" && (
            <button disabled={busy} onClick={() => mutate(`/api/admin/comandas/${id}`, { status: "PENDING_PAYMENT" }, "PATCH")} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-emerald-500">Ir para pagamento</button>
          )}
          {comanda.status === "PENDING_PAYMENT" && (
            <>
              <button disabled={busy} onClick={() => mutate(`/api/admin/comandas/${id}`, { status: "IN_SERVICE" }, "PATCH")} className="px-4 py-2 rounded-lg border border-stone-700 text-stone-300 text-sm disabled:opacity-40 hover:bg-stone-800">Voltar para edição</button>
              <button disabled={busy} onClick={() => setShowPaymentModal(true)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-emerald-500">Receber Pagamento</button>
            </>
          )}
          {!comandaClosed && Number(comanda.remainingTotal) <= 0 && Number(comanda.total) >= 0 && (
            <button disabled={busy} onClick={() => mutate(`/api/admin/comandas/${id}`, { status: "CLOSED" }, "PATCH")} className="px-4 py-2 rounded-lg bg-stone-100 text-stone-950 text-sm font-bold disabled:opacity-40 hover:bg-stone-300">Fechar comanda</button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        <div className="md:col-span-2 space-y-6">
          <section className="rounded-xl border border-stone-800 bg-stone-900/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-800 flex justify-between items-center bg-stone-900">
              <h2 className="font-semibold text-stone-100">Itens do Atendimento</h2>
              <div className="flex gap-2">
                <button disabled={busy || comandaClosed || comanda.status === "PENDING_PAYMENT"} onClick={() => setShowServiceModal(true)} className="text-xs px-2 py-1 rounded border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-30">Serviço</button>
                <button disabled={busy || comandaClosed || comanda.status === "PENDING_PAYMENT"} onClick={() => setShowProductModal(true)} className="text-xs px-2 py-1 rounded border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-30">Produto</button>
                <button disabled={busy || comandaClosed || comanda.status === "PENDING_PAYMENT"} onClick={() => {
                  const existingDiscount = comanda.items.find(i => i.type === "DISCOUNT");
                  if (existingDiscount) {
                    setDiscountAmount(existingDiscount.unitPrice);
                    setDiscountReason(existingDiscount.description);
                  } else {
                    setDiscountAmount("");
                    setDiscountReason("");
                  }
                  setShowDiscountModal(true);
                }} className="text-xs px-2 py-1 rounded border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-30">Desconto</button>
              </div>
            </div>
            {comanda.items.length === 0 ? <p className="p-6 text-center text-sm text-stone-500">O carrinho está vazio.</p> : (
              <div className="flex flex-col">
                {comanda.items.map((item) => (
                  <ComandaItemCard
                    key={item.id}
                    item={item}
                    busy={busy}
                    comandaClosed={comandaClosed || comanda.status === "PENDING_PAYMENT"}
                    onConclude={(itemId) => mutate(`/api/admin/comandas/${id}/items/${itemId}`, { status: "DONE" }, "PATCH")}
                    onCancel={(itemId) => mutate(`/api/admin/comandas/${id}/items/${itemId}`, { status: "CANCELLED" }, "PATCH")}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-stone-800 bg-stone-900/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-800 bg-stone-900">
              <h2 className="font-semibold text-stone-100">Linha do Tempo</h2>
            </div>
            <div className="p-4 space-y-4">
              {timeline.map((event, idx) => (
                <div key={idx} className="flex gap-4 items-start">
                  <div className="mt-1 w-2 h-2 rounded-full bg-stone-700 shrink-0"></div>
                  <div>
                    <p className="text-sm text-stone-200">{event.label}</p>
                    <p className="text-xs text-stone-500">{event.date.toLocaleString("pt-BR")}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Resumo Financeiro */}
        <div className="rounded-xl border border-stone-800 bg-stone-900 overflow-hidden sticky top-6">
          <div className="px-4 py-3 border-b border-stone-800">
            <h2 className="font-semibold text-stone-100">Resumo</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex justify-between text-sm text-stone-400">
              <span>Subtotal</span>
              <span>{brl(comanda.subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm text-red-400">
              <span>Descontos</span>
              <span>- {brl(comanda.discountTotal)}</span>
            </div>
            {Number(comanda.surchargeTotal) > 0 && (
              <div className="flex justify-between text-sm text-amber-400">
                <span>Acréscimos</span>
                <span>+ {brl(comanda.surchargeTotal)}</span>
              </div>
            )}
            <div className="pt-3 border-t border-stone-800 flex justify-between font-bold text-stone-100">
              <span>Total</span>
              <span>{brl(comanda.total)}</span>
            </div>
            <div className="flex justify-between text-sm text-emerald-400">
              <span>Valor Pago</span>
              <span>{brl(comanda.paidTotal)}</span>
            </div>
            <div className="pt-3 border-t border-stone-800 flex justify-between font-bold text-lg text-amber-400">
              <span>Restante</span>
              <span>{brl(comanda.remainingTotal)}</span>
            </div>
          </div>
          
          {/* Mobile Bottom Bar spacer equivalent, but action buttons here for desktop if needed. The mobile sticky handles mobile. */}
        </div>
      </div>

      {/* Mobile Sticky Bottom Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-stone-950 border-t border-stone-800 p-4 z-40 shadow-[0_-10px_20px_rgba(0,0,0,0.5)]">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-stone-400 font-medium">Falta Pagar</span>
          <span className="text-xl font-bold text-amber-400">{brl(comanda.remainingTotal)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {comanda.status === "OPEN" && (
            <button disabled={busy} onClick={() => mutate(`/api/admin/comandas/${id}`, { status: "IN_SERVICE" }, "PATCH")} className="col-span-2 py-3 rounded-lg bg-amber-500 text-stone-950 text-sm font-bold disabled:opacity-40">Iniciar atendimento</button>
          )}
          {comanda.status === "IN_SERVICE" && (
            <button disabled={busy} onClick={() => mutate(`/api/admin/comandas/${id}`, { status: "PENDING_PAYMENT" }, "PATCH")} className="col-span-2 py-3 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">Ir para pagamento</button>
          )}
          {comanda.status === "PENDING_PAYMENT" && (
            <>
              <button disabled={busy} onClick={() => mutate(`/api/admin/comandas/${id}`, { status: "IN_SERVICE" }, "PATCH")} className="py-3 rounded-lg border border-stone-700 text-stone-300 text-sm font-bold disabled:opacity-40">Voltar para edicao</button>
              <button disabled={busy} onClick={() => setShowPaymentModal(true)} className="py-3 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">Receber Pagamento</button>
            </>
          )}
          {!comandaClosed && Number(comanda.remainingTotal) <= 0 && Number(comanda.total) >= 0 && (
            <button disabled={busy} onClick={() => mutate(`/api/admin/comandas/${id}`, { status: "CLOSED" }, "PATCH")} className="col-span-2 py-3 rounded-lg bg-stone-100 text-stone-950 text-sm font-bold disabled:opacity-40">Fechar comanda</button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-4">
          <form onSubmit={handleAddService} className="bg-stone-900 border border-stone-800 rounded-xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-stone-800">
              <h2 className="text-lg font-bold text-stone-100">Adicionar Serviço</h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-300 mb-1">Serviço</label>
                <select value={selectedServiceId} onChange={e => setSelectedServiceId(e.target.value)} required className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:outline-none focus:border-amber-500">
                  <option value="">Selecione...</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name} - {brl(s.price)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-300 mb-1">Profissional</label>
                <select value={selectedExecutorId} onChange={e => setSelectedExecutorId(e.target.value)} required className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:outline-none focus:border-amber-500">
                  <option value="">Selecione...</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.user.name}</option>)}
                </select>
              </div>
            </div>
            <div className="p-5 border-t border-stone-800 flex justify-end gap-3">
              <button type="button" onClick={() => setShowServiceModal(false)} className="px-4 py-2 rounded-lg border border-stone-700 text-stone-300">Cancelar</button>
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 font-bold disabled:opacity-50">Adicionar</button>
            </div>
          </form>
        </div>
      )}

      {showProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-4">
          <form onSubmit={handleAddProduct} className="bg-stone-900 border border-stone-800 rounded-xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-stone-800">
              <h2 className="text-lg font-bold text-stone-100">Adicionar Produto</h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-300 mb-1">Produto</label>
                <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)} required className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:outline-none focus:border-amber-500">
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
                <label className="block text-sm font-medium text-stone-300 mb-1">Quantidade</label>
                <input type="number" min="1" step="1" value={productQuantity} onChange={e => setProductQuantity(e.target.value)} required className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:outline-none focus:border-amber-500" />
              </div>
            </div>
            <div className="p-5 border-t border-stone-800 flex justify-end gap-3">
              <button type="button" onClick={() => setShowProductModal(false)} className="px-4 py-2 rounded-lg border border-stone-700 text-stone-300">Cancelar</button>
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 font-bold disabled:opacity-50">Adicionar</button>
            </div>
          </form>
        </div>
      )}

      {showDiscountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-4">
          <form onSubmit={handleAddDiscount} className="bg-stone-900 border border-stone-800 rounded-xl w-full max-w-md overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-stone-800">
              <h2 className="text-lg font-bold text-stone-100">Desconto Geral da Comanda</h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-stone-300 mb-1">Valor do Desconto (R$)</label>
                <input type="number" step="0.01" min="0" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} placeholder="0.00 (deixe vazio para remover)" className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:outline-none focus:border-amber-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-stone-300 mb-1">Justificativa <span className="text-red-400">*</span></label>
                <input type="text" value={discountReason} onChange={e => setDiscountReason(e.target.value)} maxLength={255} placeholder="Ex: Desconto autorizado pelo gerente" required={Number(discountAmount) > 0} className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 focus:outline-none focus:border-amber-500" />
              </div>
            </div>
            <div className="p-5 border-t border-stone-800 flex justify-end gap-3">
              <button type="button" onClick={() => setShowDiscountModal(false)} className="px-4 py-2 rounded-lg border border-stone-700 text-stone-300">Cancelar</button>
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-amber-500 text-stone-950 font-bold disabled:opacity-50">Aplicar</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
