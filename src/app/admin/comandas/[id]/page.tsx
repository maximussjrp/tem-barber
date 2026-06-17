"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Item = {
  id: string;
  type: string;
  status: string;
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
  executor?: { id: string; user: { name: string } } | null;
};
type Payment = { id: string; method: string; amount: string; status: string; paidAt: string };
type Comanda = {
  id: string;
  customerName: string;
  customerPhone: string | null;
  status: string;
  total: string;
  paidTotal: string;
  remainingTotal: string;
  items: Item[];
  payments: Payment[];
};
type Service = { id: string; name: string };
type Product = { id: string; name: string };
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro na operação.");
    } finally {
      setBusy(false);
    }
  }

  async function addService() {
    const serviceId = window.prompt(`Serviço:\n${services.map((s) => `${s.id} - ${s.name}`).join("\n")}`);
    if (!serviceId) return;
    const executorId = window.prompt(`Profissional:\n${members.map((m) => `${m.id} - ${m.user.name}`).join("\n")}`);
    if (!executorId) return;
    await mutate(`/api/admin/comandas/${id}/items`, { type: "SERVICE", serviceId, executorId });
  }

  async function addProduct() {
    const productId = window.prompt(`Produto:\n${products.map((p) => `${p.id} - ${p.name}`).join("\n")}`);
    if (!productId) return;
    const quantity = Number(window.prompt("Quantidade", "1") ?? "1");
    await mutate(`/api/admin/comandas/${id}/items`, { type: "PRODUCT", productId, quantity });
  }

  async function addDiscount() {
    const amount = window.prompt("Valor do desconto");
    if (!amount) return;
    await mutate(`/api/admin/comandas/${id}/items`, { type: "DISCOUNT", amount, description: "Desconto autorizado" });
  }

  async function pay() {
    const method = window.prompt("Forma: CASH, PIX, DEBIT, CREDIT, OTHER", "PIX");
    if (!method) return;
    const amount = window.prompt("Valor", comanda?.remainingTotal ?? "0");
    if (!amount) return;
    await mutate(`/api/admin/comandas/${id}/payments`, { method, amount });
  }

  if (loading) return <div className="p-6 text-stone-500">Carregando...</div>;
  if (!comanda) return <div className="p-6 text-red-300">{error || "Comanda nao encontrada."}</div>;

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-stone-100">{comanda.customerName}</h1>
          <p className="text-sm text-stone-500">{comanda.customerPhone ?? "Sem telefone"} · {comanda.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy || comanda.status !== "OPEN"} onClick={() => mutate(`/api/admin/comandas/${id}`, { status: "IN_SERVICE" }, "PATCH")} className="px-3 py-2 rounded-lg bg-amber-500 text-stone-950 text-sm font-bold disabled:opacity-40">Iniciar atendimento</button>
          <button disabled={busy || comanda.status === "CLOSED"} onClick={addService} className="px-3 py-2 rounded-lg border border-stone-700 text-stone-200 text-sm disabled:opacity-40">Adicionar serviço</button>
          <button disabled={busy || comanda.status === "CLOSED"} onClick={addProduct} className="px-3 py-2 rounded-lg border border-stone-700 text-stone-200 text-sm disabled:opacity-40">Adicionar produto</button>
          <button disabled={busy || comanda.status === "CLOSED"} onClick={addDiscount} className="px-3 py-2 rounded-lg border border-stone-700 text-stone-200 text-sm disabled:opacity-40">Aplicar desconto</button>
          <button disabled={busy || comanda.status === "CLOSED"} onClick={pay} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">Registrar pagamento</button>
          <button disabled={busy || Number(comanda.remainingTotal) > 0 || comanda.status === "CLOSED"} onClick={() => mutate(`/api/admin/comandas/${id}`, { status: "CLOSED" }, "PATCH")} className="px-3 py-2 rounded-lg bg-stone-100 text-stone-950 text-sm font-bold disabled:opacity-40">Fechar comanda</button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="grid md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-stone-800 bg-stone-950 p-4"><p className="text-xs text-stone-500">Total</p><p className="text-xl text-stone-100 font-bold">{brl(comanda.total)}</p></div>
        <div className="rounded-xl border border-stone-800 bg-stone-950 p-4"><p className="text-xs text-stone-500">Pago</p><p className="text-xl text-emerald-300 font-bold">{brl(comanda.paidTotal)}</p></div>
        <div className="rounded-xl border border-stone-800 bg-stone-950 p-4"><p className="text-xs text-stone-500">Restante</p><p className="text-xl text-amber-300 font-bold">{brl(comanda.remainingTotal)}</p></div>
      </div>

      <section className="rounded-xl border border-stone-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-800 font-semibold text-stone-100">Itens</div>
        {comanda.items.length === 0 ? <p className="p-4 text-sm text-stone-500">Nenhum item.</p> : comanda.items.map((item) => (
          <div key={item.id} className="px-4 py-3 border-b border-stone-900 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-stone-100">{item.description}</p>
              <p className="text-xs text-stone-500">{item.type} · {item.status} · {item.executor?.user.name ?? "Sem profissional"}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-amber-300">{brl(item.total)}</span>
              <button disabled={busy || item.status === "DONE"} onClick={() => mutate(`/api/admin/comandas/${id}/items/${item.id}`, { status: "DONE" }, "PATCH")} className="text-xs px-2 py-1 rounded border border-emerald-800 text-emerald-300 disabled:opacity-40">Concluir</button>
              <button disabled={busy || item.status === "CANCELLED"} onClick={() => mutate(`/api/admin/comandas/${id}/items/${item.id}`, { status: "CANCELLED" }, "PATCH")} className="text-xs px-2 py-1 rounded border border-red-800 text-red-300 disabled:opacity-40">Cancelar</button>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-stone-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-800 font-semibold text-stone-100">Pagamentos</div>
        {comanda.payments.length === 0 ? <p className="p-4 text-sm text-stone-500">Nenhum pagamento.</p> : comanda.payments.map((payment) => (
          <div key={payment.id} className="px-4 py-3 border-b border-stone-900 flex items-center justify-between">
            <p className="text-sm text-stone-300">{payment.method} · {new Date(payment.paidAt).toLocaleString("pt-BR")}</p>
            <p className="text-sm text-emerald-300">{brl(payment.amount)}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
