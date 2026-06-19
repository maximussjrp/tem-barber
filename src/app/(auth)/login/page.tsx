"use client";

import React, { Suspense, useState, useEffect } from "react";
import { signIn, getSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[var(--bg)]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--gold)]"></div></div>}>
      <LoginContent />
    </Suspense>
  );
}

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

interface PublicBarbershop {
  slug: string;
  name: string;
  logoUrl: string | null;
  coverUrl: string | null;
  city: string;
  neighborhood: string;
  latitude: number | null;
  longitude: number | null;
  distance?: number;
}

interface SessionUserWithRole {
  role?: string;
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab: "client" | "admin" =
    searchParams.get("tab") === "admin" || searchParams.get("registered") === "true"
      ? "admin"
      : "client";
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");

  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  // Partners states
  const [partners, setPartners] = useState<PublicBarbershop[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [locationPermitted, setLocationPermitted] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const error = searchParams.get("error");
    const registered = searchParams.get("registered");
    if (registered === "true") {
      setSuccessMsg("Barbearia cadastrada com sucesso! Faça login para acessar o painel.");
    } else if (error === "AccessDenied") {
      setErrorMsg("Acesso negado. Você não possui as permissões necessárias.");
    } else if (error === "CredentialsSignin") {
      setErrorMsg("Falha na autenticação. Verifique suas credenciais.");
    } else if (error) {
      setErrorMsg("Ocorreu um erro ao tentar realizar o login.");
    }

  }, [searchParams]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    fetch("/api/public/barbershops")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setPartners(data);
      })
      .catch(() => setPartners([]))
      .finally(() => setPartnersLoading(false));
  }, []);

  const selectTab = (tab: "client" | "admin") => {
    setErrorMsg(null);
    setSuccessMsg(null);

    const nextParams = new URLSearchParams(searchParams.toString());
    if (tab === "admin") {
      nextParams.set("tab", "admin");
    } else {
      nextParams.delete("tab");
    }
    nextParams.delete("error");
    nextParams.delete("registered");

    const query = nextParams.toString();
    router.replace(query ? `/login?${query}` : "/login", { scroll: false });
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 11) value = value.substring(0, 11);

    if (value.length > 6) {
      value = `(${value.substring(0, 2)}) ${value.substring(2, 7)}-${value.substring(7)}`;
    } else if (value.length > 2) {
      value = `(${value.substring(0, 2)}) ${value.substring(2)}`;
    } else if (value.length > 0) {
      value = `(${value}`;
    }
    setClientPhone(value);
  };

  const handleClientSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await signIn("credentials", {
        redirect: false,
        loginType: "client",
        name: clientName,
        phone: clientPhone,
      });

      if (res?.error) {
        setErrorMsg(res.error);
      } else {
        const callbackUrl = searchParams.get("callbackUrl");
        router.push(callbackUrl || "/minha-conta");
        router.refresh();
      }
    } catch {
      setErrorMsg("Ocorreu um erro no servidor.");
    } finally {
      setLoading(false);
    }
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await signIn("credentials", {
        redirect: false,
        loginType: "admin",
        email: adminEmail,
        password: adminPassword,
      });

      if (res?.error) {
        setErrorMsg(res.error);
      } else {
        const session = await getSession();
        const role = (session?.user as SessionUserWithRole | undefined)?.role;

        if (role === "BARBER") {
          router.push("/member/agenda");
        } else {
          router.push("/admin/dashboard");
        }
        router.refresh();
      }
    } catch {
      setErrorMsg("Ocorreu um erro no servidor.");
    } finally {
      setLoading(false);
    }
  };

  const handleUseLocation = () => {
    if (!navigator.geolocation) {
      setLocationDenied(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;

        const sorted = [...partners].map(p => {
          if (p.latitude && p.longitude) {
            p.distance = getDistance(lat, lon, p.latitude, p.longitude);
          }
          return p;
        }).sort((a, b) => {
          if (a.distance !== undefined && b.distance !== undefined) return a.distance - b.distance;
          if (a.distance !== undefined) return -1;
          if (b.distance !== undefined) return 1;
          return a.name.localeCompare(b.name);
        });

        setPartners(sorted);
        setLocationPermitted(true);
        setLocationDenied(false);
      },
      () => {
        setLocationDenied(true);
      }
    );
  };

  return (
    <div className="relative min-h-screen bg-[var(--bg)] flex items-center justify-center px-4 py-8 overflow-hidden">
      {/* Background orbs */}
      <div className="fixed top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl -z-10 bg-[var(--gold-surface)] pointer-events-none" />
      <div className="fixed bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-3xl -z-10 bg-[var(--gold-surface)] opacity-50 pointer-events-none" />

      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start relative z-10">

        {/* Lado Esquerdo - LOGIN */}
        <div className="w-full max-w-md mx-auto relative z-20 lg:sticky lg:top-8">
          {/* Gold top line */}
          <div className="h-px bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent mb-0" />
          <div className="bg-[var(--surface-1)] border border-[var(--gold-border)] rounded-2xl p-6 sm:p-8 shadow-2xl relative z-20">

            {/* Logo */}
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-[var(--gold-surface)] border border-[var(--gold-border)] flex items-center justify-center mx-auto mb-4 glow-gold-sm">
                <span className="font-serif font-bold text-[var(--gold)] text-xl">TB</span>
              </div>
              <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-wide text-[var(--gold)]">
                TEM BARBER
              </h1>
              <p className="text-sm text-[var(--text-muted)] mt-2">Seu estilo no horário marcado</p>
            </div>

            {/* Tabs */}
            <div className="flex bg-[var(--surface-2)] p-1 rounded-xl border border-[var(--border-subtle)] mb-6 relative z-30">
              <button
                type="button"
                onClick={() => selectTab("client")}
                className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all min-h-[44px] ${
                  activeTab === "client"
                    ? "bg-[var(--gold)] text-[#111113] shadow-md"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Sou Cliente
              </button>
              <button
                type="button"
                onClick={() => selectTab("admin")}
                className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all min-h-[44px] ${
                  activeTab === "admin"
                    ? "bg-[var(--gold)] text-[#111113] shadow-md"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Sou Barbearia
              </button>
            </div>

            {/* Mensagem de Sucesso */}
            {successMsg && (
              <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm px-4 py-3 rounded-xl mb-5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                <span>{successMsg}</span>
              </div>
            )}

            {/* Mensagem de Erro */}
            {errorMsg && (
              <div className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 text-red-300 text-sm px-4 py-3 rounded-xl mb-5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Formulário do Cliente */}
            {activeTab === "client" && (
              <form onSubmit={handleClientSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">
                    Seu Nome completo
                  </label>
                  <input
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Ex: João da Silva"
                    className="w-full bg-[var(--surface-2)] border border-[var(--border-subtle)] rounded-xl px-4 py-3.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold-border)] transition-all text-base"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">
                    Seu Celular (DDD + Número)
                  </label>
                  <input
                    type="tel"
                    required
                    value={clientPhone}
                    onChange={handlePhoneChange}
                    placeholder="Ex: (11) 99999-9999"
                    className="w-full bg-[var(--surface-2)] border border-[var(--border-subtle)] rounded-xl px-4 py-3.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold-border)] transition-all text-base"
                  />
                </div>

                <button type="submit" disabled={loading} className="btn-gold w-full mt-2">
                  {loading ? "Acessando..." : "Entrar para Agendar"}
                </button>
              </form>
            )}

            {/* Formulário Administrativo */}
            {activeTab === "admin" && (
              <form onSubmit={handleAdminSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">
                    E-mail ou CPF cadastrado
                  </label>
                  <input
                    type="text"
                    required
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="Ex: admin@email.com ou 123.456.789-00"
                    className="w-full bg-[var(--surface-2)] border border-[var(--border-subtle)] rounded-xl px-4 py-3.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold-border)] transition-all text-base"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">
                    Sua Senha
                  </label>
                  <input
                    type="password"
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Digite sua senha"
                    className="w-full bg-[var(--surface-2)] border border-[var(--border-subtle)] rounded-xl px-4 py-3.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--gold)] focus:ring-1 focus:ring-[var(--gold-border)] transition-all text-base"
                  />
                </div>

                <button type="submit" disabled={loading} className="btn-gold w-full mt-2">
                  {loading ? "Autenticando..." : "Acessar Painel"}
                </button>

                <div className="text-center mt-5">
                  <p className="text-xs text-[var(--text-muted)]">
                    Ainda não tem o sistema?{" "}
                    <Link href="/register" className="text-[var(--gold)] hover:text-[var(--gold-light)] font-semibold">
                      Cadastrar minha barbearia
                    </Link>
                  </p>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Lado Direito / Inferior - BARBEARIAS PARCEIRAS */}
        <div id="parceiras" className="w-full max-w-md mx-auto lg:max-w-none pt-4 lg:pt-0 relative z-10">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)] font-serif">Barbearias Parceiras</h2>
              <p className="text-sm text-[var(--text-muted)]">Descubra as melhores perto de você</p>
            </div>

            {!locationPermitted && (
              <button
                onClick={handleUseLocation}
                className="text-xs font-medium text-[var(--gold)] hover:text-[var(--gold-light)] flex items-center gap-1 bg-[var(--gold-surface)] px-3 py-1.5 rounded-lg border border-[var(--gold-border)] transition-colors"
              >
                📍 Usar minha localização
              </button>
            )}
          </div>

          {locationDenied && !locationPermitted && (
            <p className="text-xs text-[var(--text-muted)] bg-[var(--surface-1)] border border-[var(--border-subtle)] p-2 rounded-lg mb-4 text-center">
              Acesso à localização negado. Exibindo lista padrão.
            </p>
          )}

          {partnersLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-28 rounded-2xl bg-[var(--surface-1)] animate-pulse border border-[var(--border-subtle)]" />
              ))}
            </div>
          ) : partners.length === 0 ? (
            <div className="text-center py-12 px-4 border border-[var(--border-subtle)] border-dashed rounded-2xl bg-[var(--surface-1)]">
              <span className="text-3xl block mb-2">🏪</span>
              <p className="text-[var(--text-primary)] font-semibold mb-1">Nenhuma barbearia parceira</p>
              <p className="text-[var(--text-muted)] text-sm">Disponível no momento.</p>
            </div>
          ) : (
            <div className="grid gap-4 max-h-[80vh] lg:overflow-y-auto lg:pr-2 custom-scrollbar">
              {partners.map(p => (
                <div key={p.slug} className="flex flex-col sm:flex-row bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden shadow-sm hover:border-[var(--gold-border)] transition-colors group">
                  {/* Foto de Capa / Área de Logo */}
                  <div className="w-full sm:w-32 h-32 relative bg-[var(--surface-2)] shrink-0">
                    {p.coverUrl ? (
                      <img src={p.coverUrl} alt={`Capa ${p.name}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[var(--surface-2)] to-[var(--surface-hover)] flex items-center justify-center opacity-50" />
                    )}
                    {/* Logo Overlay */}
                    <div className="absolute -bottom-3 sm:-right-3 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 left-4 sm:left-auto w-12 h-12 bg-[var(--surface-1)] rounded-xl border border-[var(--border-subtle)] shadow-md overflow-hidden flex items-center justify-center p-1">
                      <Avatar src={p.logoUrl} alt={p.name} fallbackText={p.name} size="md" className="w-full h-full object-contain" />
                    </div>
                  </div>

                  <div className="p-4 pl-4 sm:pl-6 flex flex-col justify-between flex-1 mt-2 sm:mt-0">
                    <div>
                      <h3 className="font-bold text-[var(--text-primary)] font-serif leading-tight">{p.name}</h3>
                      <p className="text-xs text-[var(--text-muted)] mt-1 flex items-center gap-1.5">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        <span className="truncate">{p.city}{p.neighborhood ? ` • ${p.neighborhood}` : ""}</span>
                      </p>
                      {p.distance !== undefined && (
                        <p className="text-[10px] text-[var(--gold)] mt-1 font-semibold uppercase tracking-wider">
                          A {p.distance.toFixed(1)} km de você
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex justify-end">
                      <Link
                        href={`/${p.slug}/agendar`}
                        className="text-xs font-semibold px-4 py-2 bg-[var(--surface-2)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--gold)] hover:text-[#111113] hover:border-[var(--gold-border)] transition-all"
                      >
                        Agendar Horário
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
