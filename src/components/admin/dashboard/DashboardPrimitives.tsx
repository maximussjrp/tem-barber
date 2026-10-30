import React, { useId } from "react";

export interface DashboardCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "highlight" | "danger";
}

export function DashboardCard({
  className = "",
  variant = "default",
  children,
  ...props
}: DashboardCardProps) {
  const base = "rounded-2xl transition-all duration-200 border";
  const variants = {
    default:
      "bg-gradient-to-b from-[#191C22] to-[#13151A] border-white/[0.08] shadow-[0_8px_28px_rgba(0,0,0,0.45)]",
    elevated:
      "bg-gradient-to-b from-[#1D2027] to-[#15181E] border-white/[0.11] shadow-[0_10px_32px_rgba(0,0,0,0.55)]",
    highlight:
      "bg-gradient-to-br from-[#211E17] via-[#181A20] to-[#13151A] border-[#D3AE55]/45 shadow-[0_0_24px_rgba(211,174,85,0.12)]",
    danger:
      "bg-gradient-to-b from-[#1F1518] via-[#17181D] to-[#13151A] border-[#DC4854]/55 shadow-[0_0_28px_rgba(220,72,84,0.14)]",
  };

  return (
    <div className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function MiniSparklineSvg({ className = "w-24 h-10" }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gradId = `kpiSparkGrad-${uid}`;
  return (
    <svg viewBox="0 0 110 42" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#E8C76E" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#E8C76E" stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path
        d="M4,36 L26,27 L48,30 L76,12 L104,19 L104,40 L4,40 Z"
        fill={`url(#${gradId})`}
      />
      <polyline
        points="4,36 26,27 48,30 76,12 104,19"
        fill="none"
        stroke="#E8C76E"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26" cy="27" r="2.2" fill="#E8C76E" />
      <circle cx="76" cy="12" r="3" fill="#FFF3C4" stroke="#E8C76E" strokeWidth="1.5" />
      <circle cx="104" cy="19" r="2.2" fill="#E8C76E" />
    </svg>
  );
}

export function MiniBarsSvg({
  variant = "gold",
  className = "w-16 h-11",
}: {
  variant?: "gold" | "slate";
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const goldId = `barGoldGrad-${uid}`;
  const slateId = `barSlateGrad-${uid}`;
  const heights = [14, 20, 26, 33, 40];
  return (
    <svg viewBox="0 0 68 42" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={goldId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F2D680" />
          <stop offset="100%" stopColor="#B89036" />
        </linearGradient>
        <linearGradient id={slateId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#64748B" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#334155" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {heights.map((h, idx) => {
        const x = 6 + idx * 12;
        const y = 40 - h;
        const fill =
          variant === "gold"
            ? idx < 2
              ? "rgba(211,174,85,0.38)"
              : `url(#${goldId})`
            : idx === 3
            ? `url(#${slateId})`
            : "rgba(100,116,139,0.38)";
        return (
          <rect
            key={idx}
            x={x}
            y={y}
            width="6.5"
            height={h}
            rx="2.5"
            fill={fill}
          />
        );
      })}
    </svg>
  );
}

export interface MetricCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  trend?: {
    value: string;
    label?: string;
    positive?: boolean;
    neutral?: boolean;
  };
  icon?: React.ReactNode;
  progress?: {
    value: number; // 0 to 100
    color?: string;
  };
  visualType?: "sparkline" | "bars-gold" | "bars-slate" | "none";
  highlight?: boolean;
}

export function MetricCard({
  label,
  value,
  sublabel,
  trend,
  icon,
  progress,
  visualType = "none",
  highlight = false,
}: MetricCardProps) {
  return (
    <DashboardCard
      variant={highlight ? "highlight" : "default"}
      className="p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden"
    >
      {/* Top Row: Left Icon Box + Label/Value + Three-dots menu */}
      <div className="flex items-start gap-3.5">
        {icon && (
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#2B2416] to-[#1A1814] border border-[#D3AE55]/35 text-[#E8C76E] flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(211,174,85,0.12)]">
            {icon}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9CA3AF] truncate">
              {label}
            </span>
            <span
              className="text-zinc-500 hover:text-zinc-300 transition-colors select-none text-sm leading-none px-1"
              aria-hidden="true"
            >
              ⋮
            </span>
          </div>

          <p className="mt-1 text-2xl sm:text-[28px] font-extrabold tracking-tight text-white tabular-nums leading-tight">
            {value}
          </p>
        </div>
      </div>

      {/* Bottom Row: Trend / Progress / Sparkline */}
      <div className="mt-3 pt-1 flex items-end justify-between gap-2">
        <div className="flex-1 min-w-0">
          {progress && (
            <div className="mb-2">
              <div className="h-2.5 w-full bg-white/[0.08] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    progress.color ||
                    "bg-gradient-to-r from-[#D3AE55] to-[#F0D78C] shadow-[0_0_10px_rgba(211,174,85,0.35)]"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, progress.value))}%`,
                  }}
                />
              </div>
            </div>
          )}

          {trend ? (
            <div className="flex items-center gap-1.5 text-xs flex-wrap">
              <span
                className={`font-bold flex items-center gap-0.5 ${
                  trend.neutral
                    ? "text-zinc-300"
                    : trend.positive !== false
                    ? "text-[#16C784]"
                    : "text-[#EF5A67]"
                }`}
              >
                {trend.positive !== false && !trend.neutral && "▲ "}
                {trend.positive === false && !trend.neutral && "▼ "}
                {trend.value}
              </span>
              {(trend.label || sublabel) && (
                <span className="text-[#8E95A2] text-[11px] truncate">
                  {trend.label || sublabel}
                </span>
              )}
            </div>
          ) : (
            sublabel && (
              <span className="text-[11px] text-[#9CA3AF] block truncate">
                {sublabel}
              </span>
            )
          )}
        </div>

        {visualType === "sparkline" && (
          <div className="shrink-0 -mb-1 -mr-1">
            <MiniSparklineSvg className="w-24 h-9" />
          </div>
        )}
        {visualType === "bars-gold" && (
          <div className="shrink-0 -mb-1">
            <MiniBarsSvg variant="gold" className="w-16 h-10" />
          </div>
        )}
        {visualType === "bars-slate" && (
          <div className="shrink-0 -mb-1">
            <MiniBarsSvg variant="slate" className="w-16 h-10" />
          </div>
        )}
      </div>
    </DashboardCard>
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
  icon,
  iconTone = "gold",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  iconTone?: "gold" | "red";
}) {
  const toneClasses =
    iconTone === "red"
      ? "bg-[#DC4854]/15 border-[#DC4854]/35 text-[#F26470]"
      : "bg-[#D3AE55]/12 border-[#D3AE55]/30 text-[#E8C76E]";

  return (
    <div className="flex items-start sm:items-center justify-between gap-2 mb-3.5">
      <div className="flex items-center gap-2 min-w-0">
        {icon && (
          <div
            className={`w-7 h-7 rounded-xl border flex items-center justify-center shrink-0 ${toneClasses}`}
          >
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-[12.5px] sm:text-[13.5px] font-bold text-white tracking-tight leading-snug">
            {title}
          </h2>
          {subtitle && (
            <p className="text-[11px] text-[#8E95A2] truncate mt-0.5">
              {subtitle}
            </p>
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
    <div className="py-7 px-4 text-center flex flex-col items-center justify-center space-y-2.5">
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
