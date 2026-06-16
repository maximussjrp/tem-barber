"use client";

import React, { Suspense, useState, useEffect } from "react";
import { signIn, getSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"client" | "admin">("client");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estados do formulário do cliente
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");

  // Estados do formulário administrativo
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  // Checar parâmetros na URL
  useEffect(() => {
    const error = searchParams.get("error");
    const registered = searchParams.get("registered");
    const tab = searchParams.get("tab");

    if (tab === "admin") {
      setActiveTab("admin");
    }
    if (registered === "true") {
      setSuccessMsg("Barbearia cadastrada com sucesso! Faça login para acessar o painel.");
      setActiveTab("admin");
    } else if (error === "AccessDenied") {
      setErrorMsg("Acesso negado. Você não possui as permissões necessárias.");
    } else if (error === "CredentialsSignin") {
      setErrorMsg("Falha na autenticação. Verifique suas credenciais.");
    } else if (error) {
      setErrorMsg("Ocorreu um erro ao tentar realizar o login.");
    }
  }, [searchParams]);

  // Função para formatar o input do telefone (ex: (11) 99999-9999)
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
        // Buscar sessão para redirecionar com base no role
        const session = await getSession();
        const role = (session?.user as any)?.role as string | undefined;

        if (role === "BARBER") {
          router.push("/member/agenda");
        } else {
          // OWNER, MANAGER, SUPER_ADMIN
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

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[var(--bg)] px-4 py-8 overflow-hidden">
      {/* Background orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl -z-10 bg-[var(--gold-surface)]" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full blur-3xl -z-10 bg-[var(--gold-surface)] opacity-50" />

      <div className="w-full max-w-md relative">
        {/* Gold top line */}
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent mb-0" />
        <div className="bg-[var(--surface-1)] border border-[var(--gold-border)] rounded-2xl p-6 sm:p-8 shadow-2xl">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[var(--gold-surface)] border border-[var(--gold-border)] flex items-center justify-center mx-auto mb-4 glow-gold-sm">
            <span className="font-serif font-bold text-[var(--gold)] text-xl">MB</span>
          </div>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold tracking-wide text-[var(--gold)]">
            MATCH BARBER
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-2">Seu estilo no horário marcado</p>
        </div>

        {/* Tabs */}
        <div className="flex bg-[var(--surface-2)] p-1 rounded-xl border border-[var(--border-subtle)] mb-6">
          <button
            onClick={() => { setActiveTab("client"); setErrorMsg(null); }}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all min-h-[44px] ${
              activeTab === "client"
                ? "bg-[var(--gold)] text-[#111113] shadow-md"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            Sou Cliente
          </button>
          <button
            onClick={() => { setActiveTab("admin"); setErrorMsg(null); }}
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
    </div>
  );
}
