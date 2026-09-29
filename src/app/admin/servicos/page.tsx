"use client";

import { useState, useEffect, useRef } from "react";
import {
  PRESET_CATEGORIES,
  ServiceImagePreset,
  getPresetsByCategory,
} from "@/lib/service-image-presets";

interface Category {
  id: string;
  name: string;
}

interface Service {
  id: string;
  name: string;
  description: string | null;
  price: string;
  durationMin: number;
  imageUrl: string | null;
  isActive: boolean;
  categoryId: string;
  category: { id: string; name: string };
}

const inputClass =
  "w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm";
const labelClass = "block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5";

const emptyForm = {
  name: "",
  description: "",
  categoryId: "",
  price: "",
  durationMin: "30",
  isActive: true,
};

export default function ServicosPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Image selection state machine (ADENDO 3)
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [removeImageFlag, setRemoveImageFlag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Gallery modal state
  const [galleryModalOpen, setGalleryModalOpen] = useState(false);
  const [galleryCategoryFilter, setGalleryCategoryFilter] = useState("todos");

  // Main list category filter
  const [filterCategory, setFilterCategory] = useState("");

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [sRes, cRes] = await Promise.all([
          fetch("/api/admin/services"),
          fetch("/api/admin/categories"),
        ]);
        const sData = await sRes.json();
        const cData = await cRes.json();
        if (active) {
          setServices(sData);
          setCategories(cData);
        }
      } catch {
        if (active) setError("Erro ao carregar dados.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, categoryId: categories[0]?.id ?? "" });
    setImageFile(null);
    setSelectedPresetId(null);
    setImagePreview(null);
    setRemoveImageFlag(false);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(s: Service) {
    setEditingId(s.id);
    setForm({
      name: s.name,
      description: s.description ?? "",
      categoryId: s.categoryId,
      price: Number(s.price).toFixed(2),
      durationMin: String(s.durationMin),
      isActive: s.isActive,
    });
    setImageFile(null);
    setSelectedPresetId(null);
    setImagePreview(s.imageUrl ?? null);
    setRemoveImageFlag(false);
    setError(null);
    setModalOpen(true);
  }

  // ADENDO 3: Upload selection clears preset & remove flag
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Imagem muito grande. Máximo 5 MB.");
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) {
      setError("Tipo de imagem inválido. Use JPEG, PNG ou WebP.");
      return;
    }
    setError(null);
    setImageFile(file);
    setSelectedPresetId(null);
    setRemoveImageFlag(false);
    setImagePreview(URL.createObjectURL(file));
  }

  // ADENDO 3: Preset selection clears upload file & remove flag
  function handleSelectPreset(preset: ServiceImagePreset) {
    setError(null);
    setSelectedPresetId(preset.id);
    setImageFile(null);
    setRemoveImageFlag(false);
    setImagePreview(preset.imageUrl);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setGalleryModalOpen(false);
  }

  // ADENDO 3: Removal clears upload file & preset
  function handleRemoveImage() {
    setImageFile(null);
    setSelectedPresetId(null);
    setImagePreview(null);
    setRemoveImageFlag(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const url = editingId ? `/api/admin/services/${editingId}` : "/api/admin/services";
      const method = editingId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          price: Number(form.price),
          durationMin: Number(form.durationMin),
        }),
      });
      let data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const targetId = editingId || data.id;
      let uploadOrDeleteError: string | null = null;

      // ADENDO 4: Handle image persistence & partial failure messages
      if (imageFile) {
        try {
          const fd = new FormData();
          fd.append("file", imageFile);
          const imgRes = await fetch(`/api/admin/services/${targetId}/image`, {
            method: "POST",
            body: fd,
          });
          if (imgRes.ok) {
            const imgData = await imgRes.json();
            if (imgData.url) {
              data = { ...data, imageUrl: imgData.url };
            } else {
              uploadOrDeleteError = editingId
                ? "Serviço atualizado, mas não foi possível atualizar a foto."
                : "Serviço criado, mas não foi possível enviar a foto.";
            }
          } else {
            uploadOrDeleteError = editingId
              ? "Serviço atualizado, mas não foi possível atualizar a foto."
              : "Serviço criado, mas não foi possível enviar a foto.";
          }
        } catch {
          uploadOrDeleteError = editingId
            ? "Serviço atualizado, mas não foi possível atualizar a foto."
            : "Serviço criado, mas não foi possível enviar a foto.";
        }
      } else if (selectedPresetId) {
        try {
          const presetRes = await fetch(`/api/admin/services/${targetId}/image`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ presetId: selectedPresetId }),
          });
          if (presetRes.ok) {
            const presetData = await presetRes.json();
            if (presetData.url) {
              data = { ...data, imageUrl: presetData.url };
            } else {
              uploadOrDeleteError = editingId
                ? "Serviço atualizado, mas não foi possível atualizar a foto."
                : "Serviço criado, mas não foi possível definir a foto da galeria.";
            }
          } else {
            uploadOrDeleteError = editingId
              ? "Serviço atualizado, mas não foi possível atualizar a foto."
              : "Serviço criado, mas não foi possível definir a foto da galeria.";
          }
        } catch {
          uploadOrDeleteError = editingId
            ? "Serviço atualizado, mas não foi possível atualizar a foto."
            : "Serviço criado, mas não foi possível definir a foto da galeria.";
        }
      } else if (removeImageFlag && editingId) {
        try {
          const delRes = await fetch(`/api/admin/services/${targetId}/image`, { method: "DELETE" });
          if (delRes.ok) {
            data = { ...data, imageUrl: null };
          } else {
            uploadOrDeleteError = "Não foi possível remover a foto do serviço.";
          }
        } catch {
          uploadOrDeleteError = "Não foi possível remover a foto do serviço.";
        }
      }

      if (editingId) {
        setServices((prev) =>
          prev.map((s) => {
            if (s.id !== editingId) return s;
            const finalImageUrl =
              uploadOrDeleteError !== null
                ? s.imageUrl
                : data.imageUrl !== undefined
                ? data.imageUrl
                : s.imageUrl;
            return { ...s, ...data, imageUrl: finalImageUrl };
          })
        );
        if (uploadOrDeleteError) {
          setError(uploadOrDeleteError);
        } else {
          showSuccess("Serviço atualizado!");
        }
      } else {
        setServices((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
        if (uploadOrDeleteError) {
          setError(uploadOrDeleteError);
        } else {
          showSuccess("Serviço criado!");
        }
      }
      setModalOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(service: Service) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/services/${service.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !service.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setServices((prev) => prev.map((s) => (s.id === service.id ? { ...s, isActive: data.isActive } : s)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao alterar status.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este serviço?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/services/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.softDeleted) {
        setServices((prev) => prev.map((s) => (s.id === id ? { ...s, isActive: false } : s)));
        showSuccess("Serviço desativado (possui agendamentos vinculados).");
      } else {
        setServices((prev) => prev.filter((s) => s.id !== id));
        showSuccess("Serviço excluído!");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao excluir.");
    }
  }

  const filtered = filterCategory
    ? services.filter((s) => s.categoryId === filterCategory)
    : services;

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-100">Catálogo de Serviços</h1>
          <p className="text-stone-400 text-sm mt-1">Gerencie os serviços oferecidos pela barbearia.</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold px-5 py-2.5 rounded-lg text-sm transition-all cursor-pointer"
        >
          + Novo Serviço
        </button>
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

      {/* Filter */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <button
          onClick={() => setFilterCategory("")}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            !filterCategory
              ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
              : "bg-stone-900 text-stone-500 border border-stone-800 hover:text-stone-300"
          }`}
        >
          Todos
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilterCategory(c.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filterCategory === c.id
                ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                : "bg-stone-900 text-stone-500 border border-stone-800 hover:text-stone-300"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Services list */}
      <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-800">
          <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            {filtered.length} serviço{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {loading ? (
          <p className="text-stone-600 text-sm p-5 animate-pulse">Carregando...</p>
        ) : filtered.length === 0 ? (
          <p className="text-stone-600 text-sm p-5 text-center">Nenhum serviço encontrado.</p>
        ) : (
          <ul className="divide-y divide-stone-800">
            {filtered.map((s) => (
              <li key={s.id} className={`px-5 py-4 flex items-center gap-4 ${!s.isActive ? "opacity-50" : ""}`}>
                {s.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={s.imageUrl}
                    alt={s.name}
                    className="w-12 h-12 rounded-lg object-cover border border-stone-800 shrink-0 bg-stone-950"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-stone-950 border border-stone-800 flex items-center justify-center text-stone-500 text-lg shrink-0">
                    ✂️
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-stone-200 text-sm font-medium truncate">{s.name}</p>
                    {!s.isActive && (
                      <span className="bg-stone-800 text-stone-500 text-xs px-2 py-0.5 rounded">
                        Inativo
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-xs text-stone-500">{s.category.name}</span>
                    <span className="text-xs text-amber-400 font-medium">
                      R$ {Number(s.price).toFixed(2).replace(".", ",")}
                    </span>
                    <span className="text-xs text-stone-500">{s.durationMin} min</span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleToggle(s)}
                    className={`text-xs px-3 py-1.5 rounded-md transition-all ${
                      s.isActive
                        ? "text-stone-500 hover:text-amber-400 hover:bg-amber-500/10"
                        : "text-stone-500 hover:text-emerald-400 hover:bg-emerald-500/10"
                    }`}
                  >
                    {s.isActive ? "Desativar" : "Ativar"}
                  </button>
                  <button
                    onClick={() => openEdit(s)}
                    className="text-stone-500 hover:text-amber-400 text-xs px-3 py-1.5 rounded-md hover:bg-amber-500/10 transition-all"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-stone-500 hover:text-red-400 text-xs px-3 py-1.5 rounded-md hover:bg-red-500/10 transition-all"
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Service Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-stone-950 border border-stone-800 rounded-2xl w-full max-w-lg shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
            <div className="p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-stone-100">
                  {editingId ? "Editar Serviço" : "Novo Serviço"}
                </h2>
                <button
                  onClick={() => setModalOpen(false)}
                  className="text-stone-600 hover:text-stone-300 text-xl leading-none"
                >
                  ✕
                </button>
              </div>

              {error && (
                <div className="bg-red-950/40 border border-red-500/30 text-red-200 text-xs px-3 py-2 rounded-lg mb-4">
                  ⚠️ {error}
                </div>
              )}

              <form onSubmit={handleSave} className="space-y-4">
                {/* Foto do Serviço */}
                <div>
                  <label className={labelClass}>Foto do Serviço</label>
                  <div className="border border-dashed border-stone-800 rounded-xl p-4 bg-stone-950/40 text-center">
                    {imagePreview ? (
                      <div className="space-y-3">
                        <div className="relative w-full h-36 rounded-lg overflow-hidden border border-stone-800 bg-stone-900 flex items-center justify-center">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imagePreview} alt="Preview do serviço" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setGalleryModalOpen(true)}
                            className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 text-xs px-3 py-1.5 rounded-lg border border-amber-500/30 transition-colors font-medium cursor-pointer"
                          >
                            Escolher da galeria
                          </button>
                          <label className="cursor-pointer bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs px-3 py-1.5 rounded-lg border border-stone-700 transition-colors font-medium">
                            {editingId ? "Alterar foto" : "Enviar minha foto"}
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={handleFileChange}
                              className="sr-only"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={handleRemoveImage}
                            className="text-red-400 hover:text-red-300 text-xs px-3 py-1.5 rounded-lg border border-red-500/20 hover:bg-red-500/10 transition-colors font-medium cursor-pointer"
                          >
                            Remover foto
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 py-3">
                        <div className="w-12 h-12 rounded-full bg-stone-900 border border-stone-800 flex items-center justify-center mx-auto text-xl text-stone-500">
                          📷
                        </div>
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setGalleryModalOpen(true)}
                            className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 text-xs px-4 py-2 rounded-lg border border-amber-500/30 transition-colors font-semibold cursor-pointer"
                          >
                            Escolher da galeria
                          </button>
                          <label className="cursor-pointer bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs px-4 py-2 rounded-lg border border-stone-700 transition-colors font-semibold">
                            Enviar minha foto
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={handleFileChange}
                              className="sr-only"
                            />
                          </label>
                        </div>
                        <p className="text-[11px] text-stone-500">JPEG, PNG ou WebP — máx. 5 MB</p>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Nome *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Ex: Corte Masculino"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className={labelClass}>Categoria *</label>
                  <select
                    required
                    title="Categoria do serviço"
                    value={form.categoryId}
                    onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Selecione uma categoria</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelClass}>Descrição</label>
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Descreva o serviço..."
                    className={`${inputClass} resize-none`}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Preço (R$) *</label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                      placeholder="0,00"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Duração (min) *</label>
                    <input
                      type="number"
                      required
                      min="5"
                      step="5"
                      value={form.durationMin}
                      onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))}
                      placeholder="30"
                      className={inputClass}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label={form.isActive ? "Desativar serviço" : "Ativar serviço"}
                    onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                    className={`w-10 h-5 rounded-full transition-colors relative shrink-0 ${
                      form.isActive ? "bg-amber-500" : "bg-stone-700"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                        form.isActive ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                  <span className="text-sm text-stone-400">
                    {form.isActive ? "Serviço ativo" : "Serviço inativo"}
                  </span>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold py-3 rounded-lg text-sm transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Criar serviço"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-5 border border-stone-700 text-stone-400 hover:text-stone-200 rounded-lg text-sm transition-all cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal da Galeria de Fotos */}
      {galleryModalOpen && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
          <div className="bg-stone-950 border border-stone-800 rounded-2xl w-full max-w-2xl shadow-2xl relative overflow-hidden flex flex-col max-h-[85vh]">
            <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
            <div className="p-6 border-b border-stone-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-stone-100">Galeria Tem Barber</h3>
                <p className="text-stone-400 text-xs mt-0.5">Escolha uma imagem oficial para o serviço</p>
              </div>
              <button
                onClick={() => setGalleryModalOpen(false)}
                className="text-stone-500 hover:text-stone-200 text-xl leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Category Filters */}
            <div className="p-4 border-b border-stone-800 flex gap-2 flex-wrap bg-stone-900/50">
              <button
                type="button"
                onClick={() => setGalleryCategoryFilter("todos")}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  galleryCategoryFilter === "todos"
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
                }`}
              >
                Todos
              </button>
              {PRESET_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setGalleryCategoryFilter(cat.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    galleryCategoryFilter === cat.id
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                      : "bg-stone-900 text-stone-400 border border-stone-800 hover:text-stone-200"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Grid of presets */}
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {getPresetsByCategory(galleryCategoryFilter).map((preset) => {
                  const isSelected =
                    selectedPresetId === preset.id || imagePreview === preset.imageUrl;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={`group relative rounded-xl overflow-hidden border text-left transition-all cursor-pointer ${
                        isSelected
                          ? "border-amber-500 ring-2 ring-amber-500/40 bg-amber-500/10"
                          : "border-stone-800 bg-stone-900 hover:border-stone-700"
                      }`}
                    >
                      <div className="aspect-square w-full bg-stone-950 relative overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={preset.imageUrl}
                          alt={preset.label}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        {isSelected && (
                          <div className="absolute top-2 right-2 bg-amber-500 text-stone-950 text-xs px-2 py-0.5 rounded-md font-bold shadow">
                            Selecionado
                          </div>
                        )}
                      </div>
                      <div className="p-2.5">
                        <p className="text-stone-200 text-xs font-semibold truncate">{preset.label}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-stone-800 flex justify-end bg-stone-900/30">
              <button
                type="button"
                onClick={() => setGalleryModalOpen(false)}
                className="px-4 py-2 border border-stone-700 text-stone-300 hover:text-white rounded-lg text-xs transition-all cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
