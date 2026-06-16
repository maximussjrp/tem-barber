import Link from "next/link";

export default function AcessoNegadoPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-stone-900 via-neutral-950 to-black px-4 overflow-hidden">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-red-500/5 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-600/5 rounded-full blur-3xl -z-10" />

      <div className="w-full max-w-md text-center rounded-2xl p-10 border border-red-500/10 bg-stone-950/60 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-red-500 to-transparent" />

        <div className="text-6xl mb-6">🚫</div>

        <h1 className="font-serif text-2xl font-bold text-red-400 mb-3">
          Acesso Negado
        </h1>

        <p className="text-stone-400 text-sm leading-relaxed mb-8">
          Você não possui permissão para acessar esta página.
          <br />
          Verifique suas credenciais ou entre em contato com o administrador.
        </p>

        <div className="flex flex-col gap-3">
          <Link
            href="/login"
            className="w-full bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold py-3 rounded-lg shadow-lg hover:from-amber-500 hover:to-amber-400 transition-all text-sm tracking-wide"
          >
            Voltar ao Login
          </Link>
          <Link
            href="/"
            className="w-full border border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-600 font-medium py-3 rounded-lg transition-all text-sm"
          >
            Ir para a Página Inicial
          </Link>
        </div>
      </div>
    </div>
  );
}
