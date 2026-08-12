"use client";

import { useState, useEffect, useRef } from "react";
import { formatPhone, formatCep } from "@/lib/utils";

interface BarbershopData {
  id: string;
  name: string;
  slug: string;
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

const PUBLIC_APP_URL = "https://app.tembarber.com.br";

const inputClass =
  "w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm";
const labelClass =
  "block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5";

export default function MarketingVitrinePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchingCep, setSearchingCep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const [slug, setSlug] = useState("");
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

  const publicUrl = `${PUBLIC_APP_URL}/${slug}`;
  const bookingUrl = `${PUBLIC_APP_URL}/${slug}/agendar`;

  async function handleUpload(file: File, type: "logo" | "cover") {
    // Frontend validations
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedMimeTypes.includes(file.type)) {
      setError("Tipo de arquivo inválido. Use JPEG, PNG ou WebP.");
      return;
    }

    const maxSize = type === "logo" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setError(
        type === "logo"
          ? "A logo deve ter no máximo 2MB."
          : "A foto de capa deve ter no máximo 5MB."
      );
      return;
    }

    const setUploading = type === "logo" ? setUploadingLogo : setUploadingCover;
    const setUrl = type === "logo" ? setLogoUrl : setCoverUrl;

    setUploading(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", type);

      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: fd,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setUrl(data.url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro no upload.";
      setError(message);
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    fetch("/api/admin/barbershop")
      .then((r) => r.json())
      .then((d: BarbershopData) => {
        setSlug(d.slug);
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
      .catch(() => setError("Não foi possível carregar os dados da vitrine."))
      .finally(() => setLoading(false));
  }, []);

  async function handleCopyLink(url: string, label: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Não foi possível copiar o link.");
    }
  }

  async function handleCepSearch() {
    const clean = zipCode.replace(/\D/g, "");
    if (clean.length !== 8) {
      setError("CEP deve ter 8 dígitos.");
      return;
    }
    setSearchingCep(true);
    setError(null);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await res.json();
      if (data.erro) {
        setError("CEP não encontrado. Preencha o endereço manualmente.");
        return;
      }
      setStreet(data.logradouro ?? "");
      setNeighborhood(data.bairro ?? "");
      setCity(data.localidade ?? "");
      setState(data.uf ?? "");
    } catch {
      setError("Erro ao buscar o CEP. Preencha o endereço manualmente.");
    } finally {
      setSearchingCep(false);
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
        body: JSON.stringify({
          name,
          description,
          phone,
          logoUrl: logoUrl || null,
          coverUrl: coverUrl || null,
          zipCode,
          street,
          number,
          complement,
          neighborhood,
          city,
          state,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess("Vitrine atualizada com sucesso!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao salvar.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-96">
        <p className="text-stone-500 animate-pulse">Carregando vitrine...</p>
      </div>
    );
  }

  const fullAddress = [street, number, complement, neighborhood, city, state]
    .filter((v) => v && v.trim())
    .join(", ");

  return (
    <div className="p-6 md:p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-100">Vitrine pública</h1>
        <p className="text-stone-400 text-sm mt-1">
          Configure como sua barbearia aparece para clientes no link público.
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

      {/* Links públicos */}
      <section className="bg-stone-900 border border-stone-800 rounded-xl p-6 mb-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-5">
          Links públicos
        </h2>
        <div className="space-y-4">
          {/* Vitrine link */}
          <div>
            <label className={labelClass}>Vitrine da barbearia</label>
            <div className="flex items-center gap-2">
              <div className={`${inputClass} flex-1 select-all cursor-text`}>
                {slug ? publicUrl : "—"}
              </div>
              <button
                type="button"
                onClick={() => handleCopyLink(publicUrl, "vitrine")}
                disabled={!slug}
                className="px-4 py-3 bg-stone-800 border border-stone-700 text-stone-300 hover:bg-stone-700 text-sm rounded-lg font-medium transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {copied === "vitrine" ? "✓ Copiado" : "Copiar"}
              </button>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-3 bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 text-sm rounded-lg font-medium transition-all whitespace-nowrap"
              >
                Visualizar
              </a>
            </div>
          </div>

          {/* Agendamento link */}
          <div>
            <label className={labelClass}>Link de agendamento</label>
            <div className="flex items-center gap-2">
              <div className={`${inputClass} flex-1 select-all cursor-text`}>
                {slug ? bookingUrl : "—"}
              </div>
              <button
                type="button"
                onClick={() => handleCopyLink(bookingUrl, "agendamento")}
                disabled={!slug}
                className="px-4 py-3 bg-stone-800 border border-stone-700 text-stone-300 hover:bg-stone-700 text-sm rounded-lg font-medium transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {copied === "agendamento" ? "✓ Copiado" : "Copiar"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Formulário */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identidade da vitrine */}
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-5">
            Informações da vitrine
          </h2>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Nome da barbearia *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Barbearia Estilo & Corte"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Descrição pública</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Conte um pouco sobre sua barbearia para os clientes..."
                className={`${inputClass} resize-none`}
              />
            </div>
            <div>
              <label className={labelClass}>Telefone / WhatsApp *</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                className={inputClass}
              />
              <p className="text-[11px] text-stone-500 mt-1">
                Este número aparece na vitrine e é usado como WhatsApp para contato.
              </p>
            </div>
            <div>
              <label className={labelClass}>Identificador público (slug)</label>
              <div className={`${inputClass} bg-stone-900/50 text-stone-500 cursor-default`}>
                {slug || "—"}
              </div>
              <p className="text-[11px] text-stone-500 mt-1">
                O identificador público não pode ser alterado por aqui.
              </p>
            </div>
          </div>
        </section>

        {/* Imagens */}
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-5">
            Imagens da vitrine
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Logo input and controls */}
            <div>
              <label className={labelClass}>Logo da barbearia</label>
              {logoUrl ? (
                <div className="mb-3 w-24 h-24 rounded-xl overflow-hidden border border-stone-700 bg-stone-950">
                  <img
                    src={logoUrl}
                    alt="Logo da barbearia"
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="mb-3 w-24 h-24 rounded-xl border border-dashed border-stone-700 flex items-center justify-center bg-stone-950">
                  <span className="text-stone-600 text-xs text-center px-2">
                    Sem logo
                  </span>
                </div>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                ref={logoInputRef}
                title="Upload logo"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f, "logo");
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                  className="flex-1 px-3 py-2 bg-stone-800 border border-stone-700 text-stone-300 hover:bg-stone-700 text-xs rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  {uploadingLogo ? "Enviando..." : logoUrl ? "Alterar" : "Enviar"}
                </button>
                {logoUrl && (
                  <button
                    type="button"
                    onClick={() => setLogoUrl("")}
                    disabled={uploadingLogo}
                    className="px-3 py-2 bg-red-950/20 border border-red-900/30 text-red-400 hover:bg-red-950/40 text-xs rounded-lg font-medium transition-all disabled:opacity-50"
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>

            {/* Cover input and controls */}
            <div>
              <label className={labelClass}>Foto de capa da vitrine</label>
              {coverUrl ? (
                <div className="mb-3 w-full h-24 rounded-xl overflow-hidden border border-stone-700 bg-stone-950">
                  <img
                    src={coverUrl}
                    alt="Capa da barbearia"
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="mb-3 w-full h-24 rounded-xl border border-dashed border-stone-700 flex items-center justify-center bg-stone-950">
                  <span className="text-stone-600 text-xs text-center px-2">
                    Sem capa
                  </span>
                </div>
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                ref={coverInputRef}
                title="Upload capa"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUpload(f, "cover");
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={uploadingCover}
                  className="flex-1 px-3 py-2 bg-stone-800 border border-stone-700 text-stone-300 hover:bg-stone-700 text-xs rounded-lg font-medium transition-all disabled:opacity-50"
                >
                  {uploadingCover ? "Enviando..." : coverUrl ? "Alterar" : "Enviar"}
                </button>
                {coverUrl && (
                  <button
                    type="button"
                    onClick={() => setCoverUrl("")}
                    disabled={uploadingCover}
                    className="px-3 py-2 bg-red-950/20 border border-red-900/30 text-red-400 hover:bg-red-950/40 text-xs rounded-lg font-medium transition-all disabled:opacity-50"
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-stone-500 mt-4 space-y-1">
            <p>✓ Use imagens nítidas e bem iluminadas para aumentar a confiança do cliente.</p>
            <p>✓ Logo: recomendado formato quadrado, máximo 2MB.</p>
            <p>✓ Foto de capa: recomendado formato horizontal, máximo 5MB.</p>
            <p>✓ Formatos aceitos: JPEG, PNG ou WebP.</p>
          </div>
        </section>

        {/* Endereço */}
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-5">
            Localização
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
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Rua, Avenida..."
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Número</label>
                <input
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="123"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Complemento</label>
                <input
                  type="text"
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                  placeholder="Apto, sala..."
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Bairro</label>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder="Centro"
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className={labelClass}>Cidade</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="São Paulo"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Estado</label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) =>
                    setState(e.target.value.toUpperCase().substring(0, 2))
                  }
                  placeholder="UF"
                  maxLength={2}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Preview */}
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-5">
            Prévia da vitrine
          </h2>
          <div className="bg-stone-950 border border-stone-800 rounded-xl overflow-hidden">
            {/* Cover */}
            {coverUrl ? (
              <div className="w-full h-32 overflow-hidden">
                <img
                  src={coverUrl}
                  alt="Capa"
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-full h-32 bg-gradient-to-br from-stone-800 to-stone-900" />
            )}
            <div className="p-5">
              <div className="flex items-start gap-4">
                {/* Logo */}
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="w-14 h-14 rounded-xl object-cover border border-stone-700 -mt-10 bg-stone-900"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-stone-800 border border-stone-700 flex items-center justify-center -mt-10 shrink-0">
                    <span className="font-serif font-bold text-stone-400 text-lg">
                      {name
                        .split(/\s+/)
                        .map((w) => w[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2)}
                    </span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-stone-100 text-lg leading-tight truncate">
                    {name || "Nome da barbearia"}
                  </h3>
                  {description && (
                    <p className="text-stone-400 text-sm mt-1 line-clamp-2">
                      {description}
                    </p>
                  )}
                </div>
              </div>
              {fullAddress && (
                <p className="text-stone-500 text-xs mt-3">📍 {fullAddress}</p>
              )}
              {phone && (
                <p className="text-stone-500 text-xs mt-1">📱 {phone}</p>
              )}
            </div>
          </div>
        </section>

        {/* Ações */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-3 bg-stone-800 border border-stone-700 text-stone-300 hover:bg-stone-700 text-sm rounded-lg font-medium transition-all"
          >
            Visualizar vitrine
          </a>
          <button
            type="submit"
            disabled={saving}
            className="bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold px-8 py-3 rounded-lg shadow-lg hover:from-amber-500 hover:to-amber-400 transition-all disabled:opacity-50 text-sm tracking-wide"
          >
            {saving ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </form>
    </div>
  );
}
