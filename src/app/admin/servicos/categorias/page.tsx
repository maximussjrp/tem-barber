"use client";

import { useState, useEffect } from "react";

interface Category {
  id: string;
  name: string;
  slug: string;
}

const inputClass =
  "w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm";

export default function CategoriasPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create form
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { loadCategories(); }, []);

  async function loadCategories() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/categories");
      setCategories(await res.json());
    } catch {
      setError("Não foi possível carregar as categorias.");
    } finally {
      setLoading(false);
    }
  }

  function showSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCategories((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      showSuccess("Categoria criada!");
    } catch (e: any) {
      setError(e.message ?? "Erro ao criar.");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(cat: Category) {
    setEditId(cat.id);
    setEditName(cat.name);
    setError(null);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editId || !editName.trim()) return;
    setEditSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/categories/${editId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCategories((prev) =>
        prev.map((c) => (c.id === editId ? data : c)).sort((a, b) => a.name.localeCompare(b.name))
      );
      setEditId(null);
      showSuccess("Categoria atualizada!");
    } catch (e: any) {
      setError(e.message ?? "Erro ao atualizar.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/categories/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCategories((prev) => prev.filter((c) => c.id !== id));
      showSuccess("Categoria excluída!");
    } catch (e: any) {
      setError(e.message ?? "Erro ao excluir.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-100">Categorias de Serviços</h1>
        <p className="text-stone-400 text-sm mt-1">
          Organize seus serviços em categorias como Cabelo, Barba, etc.
        </p>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-500/30 text-red-200 text-sm px-4 py-3 rounded-lg mb-6">
          ⚠️ {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-sm px-4 py-3 rounded-lg mb-6">
          ✓ {success}
        </div>
      )}

      {/* Create form */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl p-5 mb-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-4">
          Nova Categoria
        </h2>
        <form onSubmit={handleCreate} className="flex gap-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ex: Cabelo, Barba, Sobrancelha..."
            required
            className={inputClass}
          />
          <button
            type="submit"
            disabled={creating}
            className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-5 py-3 rounded-lg text-sm transition-all disabled:opacity-50 shrink-0"
          >
            {creating ? "..." : "+ Criar"}
          </button>
        </form>
      </div>

      {/* List */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-800">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            {categories.length} categoria{categories.length !== 1 ? "s" : ""}
          </span>
        </div>

        {loading ? (
          <p className="text-stone-600 text-sm p-5 animate-pulse">Carregando...</p>
        ) : categories.length === 0 ? (
          <p className="text-stone-600 text-sm p-5 text-center">
            Nenhuma categoria criada ainda.
          </p>
        ) : (
          <ul className="divide-y divide-stone-800">
            {categories.map((cat) => (
              <li key={cat.id} className="px-5 py-3">
                {editId === cat.id ? (
                  <form onSubmit={handleEdit} className="flex gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                      placeholder="Nome da categoria"
                      className={`${inputClass} flex-1`}
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={editSaving}
                      className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                    >
                      {editSaving ? "..." : "Salvar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditId(null)}
                      className="border border-stone-700 text-stone-400 hover:text-stone-200 px-4 py-2 rounded-lg text-sm"
                    >
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-stone-200 text-sm font-medium">{cat.name}</p>
                      <p className="text-stone-600 text-xs mt-0.5">/{cat.slug}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => startEdit(cat)}
                        className="text-stone-500 hover:text-amber-400 text-xs px-3 py-1.5 rounded-md hover:bg-amber-500/10 transition-all"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDelete(cat.id)}
                        disabled={deletingId === cat.id}
                        className="text-stone-500 hover:text-red-400 text-xs px-3 py-1.5 rounded-md hover:bg-red-500/10 transition-all disabled:opacity-50"
                      >
                        {deletingId === cat.id ? "..." : "Excluir"}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
