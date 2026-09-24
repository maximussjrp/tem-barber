"use client";

import React, { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function ShieldCheck({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function Lock({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function AlertTriangle({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function CheckCircle({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ArrowRight({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  );
}

export const dynamic = "force-dynamic";

export default function AtivarAcessoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-stone-950 text-stone-200">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
        </div>
      }
    >
      <AtivarAcessoContent />
    </Suspense>
  );
}

function AtivarAcessoContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tokenData, setTokenData] = useState<{
    purpose: string;
    userName: string;
    userEmail: string | null;
    barbershopName: string;
  } | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [errorMsg, setErrorMsg] = useState<string | null>(
    token ? null : "Link de acesso inválido ou incompleto. Verifique o link recebido."
  );
  const [success, setSuccess] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    async function checkToken() {
      try {
        const res = await fetch(`/api/auth/activate-access?token=${encodeURIComponent(token!)}`);
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setErrorMsg(data.message || "Link inválido ou expirado.");
        } else {
          setTokenData(data);
        }
      } catch {
        if (!cancelled) {
          setErrorMsg("Erro ao verificar o link de acesso. Verifique sua conexão.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    checkToken();
    return () => {
      cancelled = true;
    };
  }, [token, setLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (password.length < 8) {
      setErrorMsg("A senha deve ter no mínimo 8 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("As senhas não coincidem.");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/auth/activate-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.message || "Erro ao configurar senha.");
      } else {
        setSuccess(true);
      }
    } catch {
      setErrorMsg("Erro ao comunicar com o servidor.");
    } finally {
      setSubmitting(false);
    }
  };

  const isInvite = tokenData?.purpose === "INVITE";

  return (
    <div className="min-h-screen bg-stone-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="mx-auto w-12 h-12 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-center text-amber-500 mb-4">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-stone-100">
          {isInvite ? "Ativação de Acesso" : "Redefinição de Senha"}
        </h2>
        {tokenData && (
          <p className="mt-2 text-sm text-stone-400">
            {tokenData.barbershopName} • Olá, <strong className="text-stone-200">{tokenData.userName}</strong>
          </p>
        )}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-stone-900/90 py-8 px-4 shadow-xl border border-stone-800 sm:rounded-2xl sm:px-10">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
              <p className="text-xs text-stone-400 mt-4">Validando link de acesso...</p>
            </div>
          ) : errorMsg && !tokenData ? (
            <div className="text-center py-6">
              <div className="mx-auto w-12 h-12 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center text-red-500 mb-4">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-stone-100 mb-2">Não foi possível prosseguir</h3>
              <p className="text-sm text-stone-400 mb-6">{errorMsg}</p>
              <Link
                href="/login?tab=admin"
                className="inline-flex items-center gap-2 text-sm font-medium text-amber-500 hover:text-amber-400"
              >
                Voltar para o login <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : success ? (
            <div className="text-center py-6">
              <div className="mx-auto w-12 h-12 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center text-emerald-500 mb-4">
                <CheckCircle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-stone-100 mb-2">
                Senha {isInvite ? "cadastrada" : "redefinida"} com sucesso!
              </h3>
              <p className="text-sm text-stone-400 mb-6">
                Agora você já pode acessar a plataforma utilizando seu e-mail ou CPF e a senha recém criada.
              </p>
              <button
                onClick={() => router.push("/login?tab=admin")}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-stone-950 bg-amber-500 hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
              >
                Acessar Plataforma
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-stone-300">Nova Senha</label>
                <div className="mt-1 relative rounded-xl shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-500">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="block w-full pl-10 pr-3 py-2.5 bg-stone-950 border border-stone-800 rounded-xl text-stone-100 placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-300">Confirme a Nova Senha</label>
                <div className="mt-1 relative rounded-xl shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-500">
                    <Lock className="h-4 w-4" />
                  </div>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                    className="block w-full pl-10 pr-3 py-2.5 bg-stone-950 border border-stone-800 rounded-xl text-stone-100 placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 text-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-stone-950 bg-amber-500 hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-50"
              >
                {submitting ? "Salvando..." : isInvite ? "Ativar Meu Acesso" : "Redefinir Minha Senha"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
