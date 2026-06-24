import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Assinatura Suspensa | Tem Barber",
  description: "Acesso suspenso por pendência de assinatura.",
};

export default function AssinaturaSuspensaPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-stone-950 text-stone-100 px-4 relative overflow-hidden">
      {/* Background radial gradient glow */}
      <div className="absolute w-[500px] h-[500px] rounded-full bg-amber-500/5 blur-[120px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" />

      {/* Main glassmorphism card */}
      <div className="relative max-w-md w-full bg-stone-900/60 backdrop-blur-xl border border-stone-800 rounded-3xl p-8 md:p-10 text-center shadow-2xl animate-fade-in">
        {/* Warning Icon */}
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-500 mx-auto mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-8 h-8"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z"
            />
          </svg>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold tracking-tight text-stone-100 mb-4 bg-gradient-to-r from-stone-100 to-stone-300 bg-clip-text text-transparent">
          Assinatura Suspensa
        </h1>

        {/* Description */}
        <p className="text-stone-400 text-sm leading-relaxed mb-8">
          Sua assinatura do Tem Barber está temporariamente suspensa.
          <br />
          Entre em contato para regularizar o acesso.
        </p>

        {/* Help Action Button */}
        <div className="flex flex-col gap-3">
          <a
            href="https://wa.me/5517997354089" /* Example WhatsApp or contact link */
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-full px-5 py-3 rounded-xl bg-amber-500 text-stone-950 text-sm font-semibold hover:bg-amber-400 transition-colors duration-200 shadow-lg shadow-amber-500/10"
          >
            Falar com Suporte
          </a>

          <Link
            href="/login"
            className="inline-flex items-center justify-center w-full px-5 py-3 rounded-xl bg-stone-800/80 text-stone-300 text-sm font-medium hover:bg-stone-800 transition-colors duration-200 border border-stone-700/50"
          >
            Voltar para o Login
          </Link>
        </div>
      </div>

      {/* Footer Branding */}
      <div className="mt-8 text-stone-600 text-xs font-medium tracking-wider uppercase pointer-events-none">
        Tem Barber
      </div>
    </div>
  );
}
