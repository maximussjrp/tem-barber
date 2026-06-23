"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estados do formulário
  const [barbershopName, setBarbershopName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [cpf, setCpf] = useState("");
  const [password, setPassword] = useState("");

  // Máscara para celular: (99) 99999-9999
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
    setPhone(value);
  };

  // Máscara para CPF: 999.999.999-99
  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length > 11) value = value.substring(0, 11);

    if (value.length > 9) {
      value = `${value.substring(0, 3)}.${value.substring(3, 6)}.${value.substring(6, 9)}-${value.substring(9)}`;
    } else if (value.length > 6) {
      value = `${value.substring(0, 3)}.${value.substring(3, 6)}.${value.substring(6)}`;
    } else if (value.length > 3) {
      value = `${value.substring(0, 3)}.${value.substring(3)}`;
    }
    setCpf(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          cpf,
          password,
          barbershopName,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Ocorreu um erro no cadastro.");
      }

      setSuccessMsg("Barbearia cadastrada com sucesso! Redirecionando...");

      // Limpar formulário
      setBarbershopName("");
      setName("");
      setEmail("");
      setPhone("");
      setCpf("");
      setPassword("");

      // Redirecionar para o login após 2 segundos
      setTimeout(() => {
        router.push("/login?registered=true");
      }, 2000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Erro de conexão com o servidor.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-stone-900 via-neutral-950 to-black px-4 py-12 overflow-hidden">
      {/* Elementos decorativos de fundo */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-600/5 rounded-full blur-3xl -z-10" />

      <div className="w-full max-w-lg glass rounded-2xl p-8 shadow-2xl border border-amber-500/10 relative overflow-hidden transition-all duration-300">

        {/* Detalhe dourado decorativo no topo */}
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-amber-500 to-transparent" />

        {/* Logo/Nome */}
        <div className="text-center mb-8">
          <img
            src="/tem-barber-logo.png"
            alt="Tem Barber Logo"
            className="w-20 md:w-28 h-auto mx-auto mb-4 object-contain"
          />
          <h1 className="font-serif text-3xl font-bold tracking-wide text-amber-500 drop-shadow-md">
            CADASTRAR MEU NEGÓCIO
          </h1>
          <p className="text-sm text-stone-400 mt-2">
            Cadastre sua barbearia no Tem Barber e gerencie com facilidade
          </p>
        </div>

        {/* Mensagem de Erro */}
        {errorMsg && (
          <div className="bg-red-950/40 border border-red-500/30 text-red-200 text-sm px-4 py-3 rounded-lg mb-6 flex items-start gap-2">
            <span className="text-red-500 mt-0.5">⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Mensagem de Sucesso */}
        {successMsg && (
          <div className="bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-sm px-4 py-3 rounded-lg mb-6 flex items-start gap-2">
            <span className="text-emerald-500 mt-0.5">✓</span>
            <span>{successMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Seção 1: Estabelecimento */}
          <div className="border-b border-stone-850 pb-4 mb-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-4">
              Dados do Estabelecimento
            </h3>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                Nome da Barbearia
              </label>
              <input
                type="text"
                required
                value={barbershopName}
                onChange={(e) => setBarbershopName(e.target.value)}
                placeholder="Ex: Barbearia Estilo & Corte"
                className="w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm"
              />
            </div>
          </div>

          {/* Seção 2: Responsável / Administrador */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-500/80 mb-4">
              Dados do Proprietário / Administrador
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                  Seu Nome Completo
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Carlos Santos"
                  className="w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                  Seu CPF (obrigatório)
                </label>
                <input
                  type="text"
                  required
                  value={cpf}
                  onChange={handleCpfChange}
                  placeholder="Ex: 000.000.000-00"
                  className="w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                  Seu E-mail (obrigatório)
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Ex: carlos@email.com"
                  className="w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                  Seu Celular (DDD + Número)
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={handlePhoneChange}
                  placeholder="Ex: (11) 99999-9999"
                  className="w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
                Crie uma Senha
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="No mínimo 6 caracteres"
                minLength={6}
                className="w-full bg-stone-950/70 border border-stone-800 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500/80 focus:ring-1 focus:ring-amber-500/80 transition-all text-sm"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold py-3 rounded-lg shadow-lg hover:from-amber-500 hover:to-amber-400 active:scale-[0.99] transition-all disabled:opacity-50 text-sm tracking-wide mt-4"
          >
            {loading ? "Cadastrando..." : "Cadastrar Barbearia"}
          </button>

          <div className="text-center mt-6">
            <p className="text-xs text-stone-500">
              Já possui cadastro administrativo?{" "}
              <Link
                href="/login"
                className="text-amber-500 hover:text-amber-400 font-semibold underline underline-offset-4"
              >
                Acessar minha conta
              </Link>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
