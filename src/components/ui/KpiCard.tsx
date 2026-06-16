import type { ReactNode } from "react";

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  trend?: { value: number; label?: string }; // positive = up, negative = down
  sub?: string;
  highlight?: boolean; // gold border variant
}

export function KpiCard({ label, value, icon, trend, sub, highlight }: KpiCardProps) {
  const trendUp = trend && trend.value >= 0;
  return (
    <div
      className={`relative rounded-2xl p-5 flex flex-col gap-3 transition-all ${
        highlight
          ? "bg-[var(--surface-1)] border border-[var(--gold-border)] glow-gold-sm"
          : "bg-[var(--surface-1)] border border-[var(--border-subtle)]"
      }`}
    >
      {/* Icon + label row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          {label}
        </span>
        <span className="w-8 h-8 rounded-xl bg-[var(--gold-surface)] border border-[var(--gold-border)] flex items-center justify-center text-[var(--gold)] text-base">
          {icon}
        </span>
      </div>

      {/* Value */}
      <p className="font-serif text-3xl font-bold text-[var(--text-primary)] leading-none">
        {value}
      </p>

      {/* Trend + sub */}
      {(trend || sub) && (
        <div className="flex items-center gap-2 text-xs">
          {trend && (
            <span
              className={`flex items-center gap-0.5 font-semibold px-1.5 py-0.5 rounded-md ${
                trendUp
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              {trendUp ? "▲" : "▼"} {Math.abs(trend.value)}%
            </span>
          )}
          {sub && <span className="text-[var(--text-muted)]">{sub}</span>}
        </div>
      )}
    </div>
  );
}
