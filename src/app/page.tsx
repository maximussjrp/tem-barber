import Link from "next/link";

export default function HomePage() {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-stone-900 via-neutral-950 to-black px-4 overflow-hidden">
      {/* Elementos decorativos */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-amber-500/8 rounded-full blur-3xl -z-10" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-amber-600/5 rounded-full blur-3xl -z-10" />

      {/* Hero */}
      <div className="text-center max-w-xl">
        <h1 className="font-serif text-5xl md:text-6xl font-bold tracking-wide text-amber-500 drop-shadow-md mb-4">
          TEM BARBER
        </h1>
        <p className="text-stone-300 text-lg md:text-xl font-light mb-2">
          Seu estilo no horário marcado.
        </p>
        <p className="text-stone-500 text-sm mb-10">
          Encontre a melhor barbearia perto de você e agende em segundos.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/login"
            className="bg-gradient-to-r from-amber-600 to-amber-500 text-stone-950 font-bold px-8 py-3.5 rounded-lg shadow-lg hover:from-amber-500 hover:to-amber-400 active:scale-[0.99] transition-all text-sm tracking-wide"
          >
            Agendar Agora
          </Link>
          <Link
            href="/login?tab=admin"
            className="border border-amber-500/40 text-amber-400 hover:text-amber-300 hover:border-amber-400 font-medium px-8 py-3.5 rounded-lg transition-all text-sm tracking-wide"
          >
            Sou Barbearia
          </Link>
        </div>
      </div>

      {/* Rodapé mínimo */}
      <p className="absolute bottom-6 text-stone-700 text-xs">
        © {new Date().getFullYear()} Tem Barber · Todos os direitos reservados
      </p>
    </div>
  );
}
