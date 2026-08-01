"use client";

interface CyclePotCardProps {
  label: string;
  amount: string | null;
  sub?: string;
  icon?: string;
  variant?: "brand" | "blue" | "gold";
  isRestricted?: boolean;
}

function brl(v: string | number) {
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function CyclePotCard({
  label,
  amount,
  sub,
  icon = "💰",
  variant = "blue",
  isRestricted = false,
}: CyclePotCardProps) {
  const colorMap = {
    brand: "border-[var(--brand)]/30 bg-[var(--brand-subtle)] text-[var(--brand-hover)]",
    blue: "border-blue-800/40 bg-blue-950/20 text-blue-400",
    gold: "border-amber-800/40 bg-amber-950/20 text-amber-400",
  };

  return (
    <div
      className={`rounded-xl border p-5 flex flex-col justify-between gap-2 transition-all ${
        colorMap[variant]
      }`}
    >
      <div className="flex justify-between items-center">
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
          {label}
        </p>
        <span className="text-xl">{icon}</span>
      </div>

      <div>
        {isRestricted || amount === null ? (
          <p className="text-sm font-semibold text-[var(--text-muted)] italic">
            Acesso reservado ao Dono
          </p>
        ) : (
          <p className="text-2xl font-bold font-mono tracking-tight">
            {brl(amount)}
          </p>
        )}
      </div>

      {sub && <p className="text-xs text-[var(--text-muted)] mt-1">{sub}</p>}
    </div>
  );
}
