import React from "react";

export interface DashboardCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "highlight";
}

export function DashboardCard({
  className = "",
  variant = "default",
  children,
  ...props
}: DashboardCardProps) {
  const base = "rounded-2xl transition-all duration-200 border";
  const variants = {
    default: "bg-[#1A1C20] border-white/[0.08] shadow-sm hover:border-white/[0.14]",
    elevated: "bg-[#22252B] border-white/[0.12] shadow-md hover:border-white/[0.18]",
    highlight:
      "bg-gradient-to-br from-[#1A1C20] via-[#1E2026] to-[#1A1C20] border-[#D3AE55]/30 shadow-[0_0_15px_rgba(211,174,85,0.08)]",
  };

  return (
    <div className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </div>
  );
}

export interface MetricCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  trend?: {
    value: string;
    positive?: boolean;
    neutral?: boolean;
  };
  icon?: React.ReactNode;
  progress?: {
    value: number; // 0 to 100
    color?: string;
  };
  highlight?: boolean;
}

export function MetricCard({
  label,
  value,
  sublabel,
  trend,
  icon,
  progress,
  highlight = false,
}: MetricCardProps) {
  return (
    <DashboardCard
      variant={highlight ? "highlight" : "default"}
      className="p-5 flex flex-col justify-between"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          {label}
        </span>
        {icon && (
          <div
            className={`p-2 rounded-xl shrink-0 ${
              highlight
                ? "bg-[#D3AE55]/15 text-[#D3AE55] border border-[#D3AE55]/30"
                : "bg-white/[0.05] text-zinc-300 border border-white/[0.08]"
            }`}
          >
            {icon}
          </div>
        )}
      </div>

      <div className="mt-3">
        <p className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-white tabular-nums">
          {value}
        </p>
      </div>

      {(sublabel || trend || progress) && (
        <div className="mt-3 pt-3 border-t border-white/[0.06] space-y-2">
          <div className="flex items-center justify-between text-xs">
            {sublabel && <span className="text-zinc-400">{sublabel}</span>}
            {trend && (
              <span
                className={`font-semibold ml-auto flex items-center gap-0.5 ${
                  trend.neutral
                    ? "text-zinc-400"
                    : trend.positive
                    ? "text-emerald-400"
                    : "text-rose-400"
                }`}
              >
                {trend.value}
              </span>
            )}
          </div>

          {progress && (
            <div className="h-1.5 w-full bg-white/[0.08] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  progress.color || "bg-[#D3AE55]"
                }`}
                style={{ width: `${Math.min(100, Math.max(0, progress.value))}%` }}
              />
            </div>
          )}
        </div>
      )}
    </DashboardCard>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 mb-4">
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && (
          <div className="w-7 h-7 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-zinc-300 shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-sm sm:text-base font-bold text-white tracking-wide truncate">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-zinc-400 truncate mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function DashboardEmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-8 px-4 text-center flex flex-col items-center justify-center space-y-3">
      {icon ? (
        <div className="p-3 rounded-2xl bg-white/[0.04] text-zinc-500 border border-white/[0.06]">
          {icon}
        </div>
      ) : (
        <div className="w-10 h-10 rounded-2xl bg-white/[0.04] flex items-center justify-center text-zinc-500 border border-white/[0.06]">
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-zinc-200">{title}</p>
        <p className="text-xs text-zinc-400 max-w-sm">{description}</p>
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}
