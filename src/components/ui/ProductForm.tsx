import React, { useState, useEffect } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

export type Product = {
  id?: string;
  name: string;
  salePrice: string | number;
  isActive: boolean;
  trackStock: boolean;
  currentStock: string | number;
};

interface ProductFormProps {
  isOpen: boolean;
  mode: "create" | "edit";
  initialData?: Product;
  onClose: () => void;
  onSuccess: () => void;
}

export function ProductForm({ isOpen, mode, initialData, onClose, onSuccess }: ProductFormProps) {
  const [formData, setFormData] = useState<Product>({
    name: "",
    salePrice: "",
    isActive: true,
    trackStock: false,
    currentStock: "0",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      setError("");
      if (mode === "edit" && initialData) {
        setFormData({ ...initialData });
      } else {
        setFormData({
          name: "",
          salePrice: "",
          isActive: true,
          trackStock: false,
          currentStock: "0",
        });
      }
    }
  }, [isOpen, mode, initialData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.name) {
      setError("O nome é obrigatório.");
      return;
    }
    if (formData.salePrice === "" || Number(formData.salePrice) < 0) {
      setError("O preço de venda é obrigatório e não pode ser negativo.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const url = mode === "edit" ? `/api/admin/products/${formData.id}` : "/api/admin/products";
      const method = mode === "edit" ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          salePrice: Number(formData.salePrice),
          isActive: formData.isActive,
          trackStock: formData.trackStock,
          currentStock: formData.trackStock ? Math.floor(Number(formData.currentStock)) : 0,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? `Erro ao ${mode === "edit" ? "editar" : "criar"} produto.`);
        return;
      }
      onSuccess();
    } catch {
      setError("Falha na comunicação com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={mode === "edit" ? "Editar Produto" : "Novo Produto"} className="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        {error && <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}
        
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Nome do produto *</label>
          <input type="text" value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} className="w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)]" autoFocus disabled={loading} required />
        </div>
        
        <div className="space-y-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Preço de venda (R$) *</label>
          <input type="number" step="0.01" min="0" value={formData.salePrice} onChange={(e) => setFormData((p) => ({ ...p, salePrice: e.target.value }))} className="w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)]" disabled={loading} required />
        </div>

        <div className="flex items-center gap-3 py-2">
          <input type="checkbox" id="trackStock" checked={formData.trackStock} onChange={(e) => setFormData((p) => ({ ...p, trackStock: e.target.checked }))} disabled={loading} className="w-4 h-4 accent-[var(--gold)]" />
          <label htmlFor="trackStock" className="text-sm font-semibold text-[var(--text-primary)] cursor-pointer">Controlar estoque</label>
        </div>

        {formData.trackStock && (
          <div className="space-y-1.5 animate-in slide-in-from-top-2 fade-in">
            <label className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">Estoque atual</label>
            <input type="number" step="1" min="0" value={formData.currentStock} onChange={(e) => setFormData((p) => ({ ...p, currentStock: e.target.value }))} disabled={loading} className="w-full bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-[var(--text-primary)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold-border)]" required />
          </div>
        )}

        <div className="flex items-center gap-3 py-2">
          <input type="checkbox" id="isActive" checked={formData.isActive} onChange={(e) => setFormData((p) => ({ ...p, isActive: e.target.checked }))} disabled={loading} className="w-4 h-4 accent-[var(--gold)]" />
          <label htmlFor="isActive" className="text-sm font-semibold text-[var(--text-primary)] cursor-pointer">Produto ativo para venda</label>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-[var(--border-subtle)] mt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button type="submit" variant="primary" isLoading={loading}>Salvar</Button>
        </div>
      </form>
    </Dialog>
  );
}
