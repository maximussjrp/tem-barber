"use client";

type DailyRevenue = { label: string; revenue: number; dateLabel?: string };
type OccupancyData = { occupied: number; available: number; blocked: number };

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function DashboardCharts({
  dailyRevenue,
  weekRevenue,
  occupancy,
  trendText = "+15%",
  trendPositive = true,
  peakDateLabel,
  compact = false,
}: {
  dailyRevenue: DailyRevenue[];
  weekRevenue: number;
  occupancy: OccupancyData;
  trendText?: string;
  trendPositive?: boolean;
  peakDateLabel?: string;
  compact?: boolean;
}) {
  void occupancy;
  const W = 440;
  const H = compact ? 135 : 170;
  const padLeft = 48;
  const padRight = 18;
  const padTop = 34;
  const padBottom = 24;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  const rawMax = Math.max(...dailyRevenue.map((d) => d.revenue), 0);
  const yMax = rawMax > 0 ? Math.ceil(rawMax / 150) * 150 : 600;

  const yTicks = compact
    ? [yMax, Math.round(yMax / 2), 0]
    : [
        yMax,
        Math.round(yMax * 0.75),
        Math.round(yMax * 0.5),
        Math.round(yMax * 0.25),
        0,
      ];

  const pts: { x: number; y: number; d: DailyRevenue; idx: number }[] =
    dailyRevenue.map((d, idx) => {
      const x =
        padLeft +
        (idx / Math.max(dailyRevenue.length - 1, 1)) * plotW;
      const ratio = yMax > 0 ? Math.min(1, Math.max(0, d.revenue / yMax)) : 0;
      const y = padTop + plotH - ratio * plotH;
      return { x, y, d, idx };
    });

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath =
    pts.length > 1
      ? `M${pts[0].x},${padTop + plotH} ` +
        pts.map((p) => `L${p.x},${p.y}`).join(" ") +
        ` L${pts[pts.length - 1].x},${padTop + plotH} Z`
      : "";

  // Find peak point for callout bubble
  let peakIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].d.revenue >= pts[peakIdx].d.revenue) {
      peakIdx = i;
    }
  }
  const peakPt = pts[peakIdx];

  return (
    <div className="w-full">
      {/* Summary Header Inside Chart */}
      <div className="mb-2">
        <p className="text-2xl sm:text-[28px] font-extrabold text-white tracking-tight tabular-nums leading-tight">
          {fmtBRL(weekRevenue)}
        </p>
        <div className="flex items-center gap-1.5 text-xs mt-1">
          <span
            className={`font-bold flex items-center gap-0.5 ${
              trendPositive ? "text-[#16C784]" : "text-[#EF5A67]"
            }`}
          >
            {trendPositive ? "▲" : "▼"} {trendText}
          </span>
          <span className="text-[#8E95A2] text-[11px]">
            vs. semana anterior
          </span>
        </div>
      </div>

      {/* Rich SVG Area + Line Chart */}
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto overflow-visible"
          role="img"
          aria-label="Gráfico de faturamento dos últimos 7 dias"
        >
          <defs>
            <linearGradient id="revAreaGold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E8C76E" stopOpacity="0.34" />
              <stop offset="65%" stopColor="#D3AE55" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#D3AE55" stopOpacity="0.0" />
            </linearGradient>
            <filter id="goldGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Horizontal Grid Lines + Y-Axis Labels */}
          {yTicks.map((tickVal, i) => {
            const ratio = yMax > 0 ? tickVal / yMax : 0;
            const y = padTop + plotH - ratio * plotH;
            return (
              <g key={i}>
                <text
                  x={padLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-[#7E8594] text-[10px] font-medium tabular-nums"
                >
                  R$ {tickVal}
                </text>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={W - padRight}
                  y2={y}
                  stroke="rgba(255,255,255,0.06)"
                  strokeDasharray="3 3"
                />
              </g>
            );
          })}

          {/* Vertical guide lines */}
          {pts.map((p) => (
            <line
              key={`v-${p.idx}`}
              x1={p.x}
              y1={padTop}
              x2={p.x}
              y2={padTop + plotH}
              stroke={
                p.idx === peakIdx
                  ? "rgba(232,199,110,0.35)"
                  : "rgba(255,255,255,0.03)"
              }
              strokeDasharray={p.idx === peakIdx ? "2 2" : undefined}
            />
          ))}

          {/* Area Fill */}
          {areaPath && <path d={areaPath} fill="url(#revAreaGold)" />}

          {/* Gold Line */}
          <polyline
            points={polyline}
            fill="none"
            stroke="#E8C76E"
            strokeWidth="2.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            filter="url(#goldGlow)"
          />

          {/* Data Vertices */}
          {pts.map((p) => {
            const isPeak = p.idx === peakIdx && rawMax > 0;
            return (
              <g key={`pt-${p.idx}`}>
                {isPeak && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="7"
                    fill="rgba(232,199,110,0.25)"
                  />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isPeak ? "4" : "3"}
                  fill={isPeak ? "#FFF6D6" : "#E8C76E"}
                  stroke="#B89036"
                  strokeWidth="1.2"
                />
              </g>
            );
          })}

          {/* Peak Callout Tooltip Box */}
          {peakPt && rawMax > 0 && (
            <g
              transform={`translate(${Math.min(
                Math.max(peakPt.x - 46, padLeft),
                W - 102
              )}, ${Math.max(peakPt.y - 38, 2)})`}
            >
              <rect
                x="0"
                y="0"
                width="92"
                height="30"
                rx="7"
                fill="#1E2128"
                stroke="rgba(232,199,110,0.45)"
                strokeWidth="1"
              />
              <text
                x="46"
                y="12"
                textAnchor="middle"
                className="fill-[#A6ADB9] text-[9px] font-medium"
              >
                {peakDateLabel || peakPt.d.dateLabel || peakPt.d.label}
              </text>
              <text
                x="46"
                y="24"
                textAnchor="middle"
                className="fill-white text-[10px] font-bold"
              >
                {fmtBRL(peakPt.d.revenue)}
              </text>
            </g>
          )}

          {/* X-Axis Day Labels */}
          {pts.map((p) => (
            <text
              key={`x-${p.idx}`}
              x={p.x}
              y={H - 5}
              textAnchor="middle"
              className={`text-[10px] font-medium ${
                p.idx === peakIdx ? "fill-[#E8C76E] font-bold" : "fill-[#8E95A2]"
              }`}
            >
              {p.d.label}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
