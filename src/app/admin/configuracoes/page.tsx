"use client";

import { useState, useEffect, useRef } from "react";
import { formatPhone, formatCep } from "@/lib/utils";

interface BarbershopData {
  id: string;
  name: string;
  description: string | null;
  phone: string;
  logoUrl: string | null;
  coverUrl: string | null;
  zipCode: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
}

const inputClass =
  "w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm";
const labelClass =
  "block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5";

export default function ConfiguracoesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [searchingCep, setSearchingCep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");

  const logoRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/barbershop")
      .then((r) => r.json())
      .then((d: BarbershopData) => {
        setName(d.name);
        setDescription(d.description ?? "");
        setPhone(formatPhone(d.phone));
        setLogoUrl(d.logoUrl ?? "");
        setCoverUrl(d.coverUrl ?? "");
        setZipCode(formatCep(d.zipCode));
        setStreet(d.street);
        setNumber(d.number);
        setComplement(d.complement ?? "");
        setNeighborhood(d.neighborhood);
        setCity(d.city);
        setState(d.state);
      })
      .catch(() => setError("Não foi possível carregar as configurações."))
      .finally(() => setLoading(false));
  }, []);

  async function handleCepSearch() {
    const clean = zipCode.replace(/\D/g, "");
    if (clean.length !== 8) { setError("CEP deve ter 8 dígitos."); return; }
    setSearchingCep(true);
    setError(null);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await res.json();
      if (data.erro) { setError("CEP não encontrado."); return; }
      setStreet(data.logradouro ?? "");
      setNeighborhood(data.bairro ?? "");
      setCity(data.localidade ?? "");
      setState(data.uf ?? "");
    } catch {
      setError("Erro ao buscar o CEP.");
    } finally {
      setSearchingCep(false);
    }
  }

  async function handleUpload(file: File, type: "logo" | "cover") {
    const setUploading = type === "logo" ? setUploadingLogo : setUploadingCover;
    const setUrl = type === "logo" ? setLogoUrl : setCoverUrl;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUrl(data.url);
    } catch (e: any) {
      setError(e.message ?? "Erro no upload.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/barbershop", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, phone, logoUrl, coverUrl, zipCode, street, number, complement, neighborhood, city, state }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess("Configurações salvas com sucesso!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message ?? "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-96">
        <p className="text-stone-500 animate-pulse">Carregando configurações...</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-100">Configurações Gerais</h1>
        <p className="text-stone-400 text-sm mt-1">Informações públicas da sua barbearia.</p>
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

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identidade */}
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-5">
            Identidade
          </h2>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Nome da Barbearia *</label>
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Barbearia Estilo & Corte" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Descrição</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Conte um pouco sobre sua barbearia..."
                className={`${inputClass} resize-none`}
              />
            </div>
            <div>
              <label className={labelClass}>Telefone *</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                className={inputClass}
              />
            </div>
          </div>
        </section>

        {/* Imagens */}
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-5">
            Imagens
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Logo */}
            <div>
              <label className={labelClass}>Logo</label>
              {logoUrl && (
                <div className="mb-3 w-24 h-24 rounded-xl overflow-hidden border border-stone-700">
                  <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" />
                </div>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                ref={logoRef}
                title="Selecionar logo da barbearia"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f, "logo"); }}
              />
              <button
                type="button"
                onClick={() => logoRef.current?.click()}
                disabled={uploadingLogo}
                className="w-full border border-dashed border-stone-700 hover:border-amber-500/50 text-stone-500 hover:text-stone-300 text-sm py-3 rounded-lg transition-all disabled:opacity-50"
              >
                {uploadingLogo ? "Enviando..." : logoUrl ? "Trocar logo" : "Selecionar logo"}
              </button>
            </div>
            {/* Capa */}
            <div>
              <label className={labelClass}>Foto de Capa</label>
              {coverUrl && (
                <div className="mb-3 w-full h-24 rounded-xl overflow-hidden border border-stone-700">
                  <img src={coverUrl} alt="Capa" className="w-full h-full object-cover" />
                </div>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                ref={coverRef}
                title="Selecionar foto de capa da barbearia"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f, "cover"); }}
              />
              <button
                type="button"
                onClick={() => coverRef.current?.click()}
                disabled={uploadingCover}
                className="w-full border border-dashed border-stone-700 hover:border-amber-500/50 text-stone-500 hover:text-stone-300 text-sm py-3 rounded-lg transition-all disabled:opacity-50"
              >
                {uploadingCover ? "Enviando..." : coverUrl ? "Trocar capa" : "Selecionar capa"}
              </button>
            </div>
          </div>
        </section>

        {/* Endereço */}
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-5">
            Endereço
          </h2>
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelClass}>CEP</label>
                <input
                  type="text"
                  value={zipCode}
                  onChange={(e) => setZipCode(formatCep(e.target.value))}
                  placeholder="00000-000"
                  maxLength={9}
                  className={inputClass}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleCepSearch}
                  disabled={searchingCep}
                  className="px-4 py-3 bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 text-sm rounded-lg font-medium transition-all disabled:opacity-50 whitespace-nowrap"
                >
                  {searchingCep ? "Buscando..." : "Buscar CEP"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className={labelClass}>Rua</label>
                <input type="text" value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Rua, Avenida..." className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Número</label>
                <input type="text" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="123" className={inputClass} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Complemento</label>
                <input type="text" value={complement} onChange={(e) => setComplement(e.target.value)} placeholder="Apto, sala..." className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Bairro</label>
                <input type="text" value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Centro" className={inputClass} />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className={labelClass}>Cidade</label>
                <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="São Paulo" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Estado</label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase().substring(0, 2))}
                  placeholder="UF"
                  maxLength={2}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold px-8 py-3 rounded-lg shadow-lg hover:from-amber-500 hover:to-amber-400 transition-all disabled:opacity-50 text-sm tracking-wide"
          >
            {saving ? "Salvando..." : "Salvar Configurações"}
          </button>
        </div>
      </form>
    </div>
  );
}
