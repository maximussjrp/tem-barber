"use client";

import { useEffect, useState } from "react";

type Product = {
  id: string;
  name: string;
  salePrice: string;
  unit: string;
  isActive: boolean;
  trackStock: boolean;
  currentStock: string;
};

function brl(value: string | number) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ProdutosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/products");
    const data = await res.json();
    setProducts(data.products ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setError("Erro ao carregar produtos."));
  }, []);

  async function createProduct() {
    const name = window.prompt("Nome do produto");
    if (!name) return;
    const salePrice = window.prompt("Preço de venda", "0");
    if (!salePrice) return;
    const trackStock = window.confirm("Controlar estoque?");
    const currentStock = trackStock ? window.prompt("Estoque atual", "0") : "0";
    const res = await fetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, salePrice, trackStock, currentStock }),
    });
    if (!res.ok) {
      setError("Erro ao criar produto.");
      return;
    }
    await load();
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-stone-100">Produtos</h1>
          <p className="text-sm text-stone-500">Cadastro simples e estoque básico.</p>
        </div>
        <button onClick={createProduct} className="btn-gold px-4 py-2">Novo produto</button>
      </div>
      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      {loading ? <p className="text-stone-500">Carregando...</p> : products.length === 0 ? (
        <div className="py-16 text-center border border-stone-800 rounded-xl text-stone-500">Nenhum produto cadastrado.</div>
      ) : (
        <div className="grid gap-3">
          {products.map((product) => (
            <div key={product.id} className="rounded-xl border border-stone-800 bg-stone-950 p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-stone-100">{product.name}</p>
                <p className="text-xs text-stone-500">{product.trackStock ? `Estoque: ${product.currentStock} ${product.unit}` : "Sem controle de estoque"}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-amber-300">{brl(product.salePrice)}</p>
                <p className="text-xs text-stone-500">{product.isActive ? "Ativo" : "Inativo"}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
