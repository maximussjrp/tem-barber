"use client";

import { useEffect, useRef, useState } from "react";

interface MemberProfile {
  id: string;
  role: string;
  bio: string | null;
  ratingAvg: number;
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string;
    avatarUrl: string | null;
  };
  barbershop: {
    name: string;
    logoUrl: string | null;
  };
}

const ROLE_LABELS: Record<string, string> = {
  BARBER: "Barbeiro",
  MANAGER: "Gerente",
  OWNER: "Proprietário",
};

export default function PerfilPage() {
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/member/perfil")
      .then((r) => r.json())
      .then((data: MemberProfile) => {
        setProfile(data);
        setName(data.user.name);
        setBio(data.bio ?? "");
        setAvatarUrl(data.user.avatarUrl);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleAvatarUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setError("Imagem deve ter no máximo 5MB.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", "avatar");
      const res = await fetch("/api/admin/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro no upload.");
      setAvatarUrl(data.url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) {
      setError("Nome deve ter ao menos 2 caracteres.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const res = await fetch("/api/member/perfil", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), bio, avatarUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Erro ao salvar.");
      }
      const updated: MemberProfile = await res.json();
      setProfile(updated);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-xl mx-auto space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-stone-900/40 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-xl mx-auto">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-serif font-bold text-stone-100">Meu Perfil</h1>
        <p className="text-stone-500 text-sm mt-1">
          {profile?.barbershop.name} · {ROLE_LABELS[profile?.role ?? ""] ?? profile?.role}
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Avatar */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative group">
            <div className="w-24 h-24 rounded-full bg-stone-800 border-2 border-stone-700 overflow-hidden flex items-center justify-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-bold text-stone-500">
                  {name.charAt(0).toUpperCase()}
                </span>
              )}
              {uploading && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-full">
                  <span className="text-white text-xs">...</span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 w-8 h-8 bg-amber-500 hover:bg-amber-400 rounded-full flex items-center justify-center text-stone-950 text-sm font-bold transition-colors disabled:opacity-50"
              title="Alterar foto"
            >
              📷
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            title="Selecionar foto de perfil"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAvatarUpload(file);
            }}
          />
          {avatarUrl && (
            <button
              type="button"
              onClick={() => setAvatarUrl(null)}
              className="text-xs text-stone-500 hover:text-red-400 transition-colors"
            >
              Remover foto
            </button>
          )}
        </div>

        {/* Name */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-stone-400">
            Nome completo
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Seu nome"
            title="Nome completo"
            className="w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 focus:border-amber-500/80 focus:outline-none transition-colors"
          />
        </div>

        {/* Bio */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-stone-400">
            Bio / Apresentação
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            placeholder="Conte um pouco sobre você, sua experiência e especialidades..."
            title="Bio / Apresentação"
            className="w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 focus:border-amber-500/80 focus:outline-none transition-colors resize-none text-sm"
          />
          <p className="text-xs text-stone-600">{bio.length}/300 caracteres</p>
        </div>

        {/* Read-only info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-400">
              Telefone
            </label>
            <input
              type="text"
              value={profile?.user.phone ?? ""}
              readOnly
              title="Telefone"
              className="w-full bg-stone-900/30 border border-stone-800/50 rounded-lg px-4 py-3 text-stone-500 text-sm cursor-not-allowed"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-400">
              Nota média
            </label>
            <div className="bg-stone-900/30 border border-stone-800/50 rounded-lg px-4 py-3 flex items-center gap-1.5">
              <span className="text-amber-400 font-bold">
                {profile?.ratingAvg?.toFixed(1) ?? "—"}
              </span>
              <span className="text-amber-400 text-sm">★</span>
            </div>
          </div>
        </div>

        {/* Feedback */}
        {error && (
          <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-lg px-4 py-3 text-sm text-emerald-400">
            ✓ Perfil atualizado com sucesso!
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={saving || uploading}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 font-bold py-3 px-6 rounded-lg transition-colors"
        >
          {saving ? "Salvando..." : "Salvar alterações"}
        </button>
      </form>
    </div>
  );
}
