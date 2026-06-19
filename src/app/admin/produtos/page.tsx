"use client";

import { useEffect, useState } from "react";
import { ProductForm, Product as FormProduct } from "@/components/ui/ProductForm";
import { formatBRL } from "@/lib/operations/money";

type Product = {
  id: string;
  name: string;
  salePrice: string;
  unit: string;
  isActive: boolean;
  trackStock: boolean;
  currentStock: string;
};

export default function ProdutosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/products");
      const data = await res.json();
      setProducts(data.products ?? []);
    } catch {
      setError("Erro ao carregar produtos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const [formState, setFormState] = useState<{
    isOpen: boolean;
    mode: "create" | "edit";
    initialData?: FormProduct;
  }>({ isOpen: false, mode: "create" });

  function openCreate() {
    setFormState({ isOpen: true, mode: "create" });
  }

  function openEdit(product: Product) {
    setFormState({
      isOpen: true,
      mode: "edit",
      initialData: {
        id: product.id,
        name: product.name,
        salePrice: product.salePrice,
        isActive: product.isActive,
        trackStock: product.trackStock,
        currentStock: product.currentStock,
      },
    });
  }

  function handleSuccess() {
    setFormState({ isOpen: false, mode: "create" });
    load();
  }

  return (
    <div className="p-4 md:p-6 space-y-5">
      <ProductForm
        isOpen={formState.isOpen}
        mode={formState.mode}
        initialData={formState.initialData}
        onClose={() => setFormState((prev) => ({ ...prev, isOpen: false }))}
        onSuccess={handleSuccess}
      />

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-stone-100">Produtos</h1>
          <p className="text-sm text-stone-500">Cadastro simples e estoque básico.</p>
        </div>
        <button onClick={openCreate} className="btn-gold px-4 py-2">Novo produto</button>
      </div>
      {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
      {loading ? <p className="text-stone-500">Carregando...</p> : products.length === 0 ? (
        <div className="py-16 text-center border border-[var(--border-subtle)] rounded-xl bg-[var(--surface-1)]">
          <div className="w-16 h-16 bg-[var(--surface-3)] rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl leading-none">📦</span>
          </div>
          <p className="font-bold text-[var(--text-primary)] mb-1">Nenhum produto cadastrado</p>
          <p className="text-sm text-[var(--text-muted)] max-w-sm mx-auto mb-6">
            Adicione produtos para começar a controlar seu estoque e registrá-los nas comandas.
          </p>
          <button onClick={openCreate} className="btn-gold px-6 py-2">Novo produto</button>
        </div>
      ) : (
        <div className="grid gap-3">
          {products.map((product) => (
            <div key={product.id} className="rounded-xl border border-stone-800 bg-stone-950 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-stone-100">{product.name}</p>
                <p className="text-xs text-stone-500">{product.trackStock ? `Estoque: ${product.currentStock} ${product.unit}` : "Sem controle de estoque"}</p>
              </div>
              <div className="flex flex-row items-center justify-between md:justify-end gap-6 md:text-right w-full md:w-auto">
                <div>
                  <p className="font-bold text-amber-300">{formatBRL(product.salePrice)}</p>
                  <p className="text-xs text-stone-500">{product.isActive ? "Ativo" : "Inativo"}</p>
                </div>
                <button
                  onClick={() => openEdit(product)}
                  className="px-4 py-2 text-sm font-semibold text-stone-300 bg-stone-900 border border-stone-700 rounded-lg hover:bg-stone-800 transition-colors shrink-0"
                >
                  Editar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
