"use client";

type DailyRevenue = { label: string; revenue: number };
type OccupancyData = { occupied: number; available: number; blocked: number };

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function DashboardCharts({
  dailyRevenue,
  weekRevenue,
  occupancy,
}: {
  dailyRevenue: DailyRevenue[];
  weekRevenue: number;
  occupancy: OccupancyData;
}) {
  const W = 280;
  const H = 65;
  const maxRev = Math.max(...dailyRevenue.map((d) => d.revenue), 100);
  const pts: [number, number][] = dailyRevenue.map((d, i) => {
    const x = (i / Math.max(dailyRevenue.length - 1, 1)) * (W - 16) + 8;
    const y = H - 4 - (d.revenue / maxRev) * (H - 14);
    return [x, y];
  });
  const polyline = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const areaPath =
    pts.length > 1
      ? `M${pts[0][0]},${H} ` +
        pts.map(([x, y]) => `L${x},${y}`).join(" ") +
        ` L${pts[pts.length - 1][0]},${H} Z`
      : "";

  // Donut chart
  const R = 36;
  const C = 2 * Math.PI * R;
  const total = Math.max(occupancy.occupied + occupancy.available + occupancy.blocked, 1);
  const occLen = (occupancy.occupied / total) * C;
  const availLen = (occupancy.available / total) * C;
  const blkLen = (occupancy.blocked / total) * C;
  const occPct = Math.round((occupancy.occupied / total) * 100);
  const availPct = Math.round((occupancy.available / total) * 100);
  const blkPct = 100 - occPct - availPct;

  return (
    <div className="grid grid-cols-2 gap-4 items-start">
      {/* Line chart */}
      <div>
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-0.5">
          Faturamento da semana
        </p>
        <p className="font-serif text-xl font-bold text-[var(--text-primary)] mb-3">
          {fmtBRL(weekRevenue)}
        </p>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14">
          <defs>
            <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#C9A84C" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#C9A84C" stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaPath && <path d={areaPath} fill="url(#goldGrad)" />}
          <polyline
            points={polyline}
            fill="none"
            stroke="#C9A84C"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {pts.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.5" fill="#C9A84C" />
          ))}
        </svg>
        <div className="flex justify-between mt-1.5">
          {dailyRevenue.map((d) => (
            <span key={d.label} className="text-[9px] text-[var(--text-muted)]">
              {d.label}
            </span>
          ))}
        </div>
      </div>

      {/* Donut chart */}
      <div className="flex flex-col items-center">
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-2 self-start">
          Taxa de ocupação hoje
        </p>
        <div className="relative mb-2">
          <svg viewBox="0 0 100 100" className="w-20 h-20 -rotate-90">
            <circle r={R} cx={50} cy={50} fill="none" stroke="var(--surface-3)" strokeWidth={14} />
            {occLen > 0 && (
              <circle
                r={R}
                cx={50}
                cy={50}
                fill="none"
                stroke="#C9A84C"
                strokeWidth={14}
                strokeDasharray={`${occLen} ${C - occLen}`}
                strokeDashoffset={C * 0.25}
              />
            )}
            {availLen > 0 && (
              <circle
                r={R}
                cx={50}
                cy={50}
                fill="none"
                stroke="#22C55E"
                strokeWidth={14}
                strokeDasharray={`${availLen} ${C - availLen}`}
                strokeDashoffset={C * 0.25 - occLen}
              />
            )}
            {blkLen > 0 && (
              <circle
                r={R}
                cx={50}
                cy={50}
                fill="none"
                stroke="#3F3F46"
                strokeWidth={14}
                strokeDasharray={`${blkLen} ${C - blkLen}`}
                strokeDashoffset={C * 0.25 - occLen - availLen}
              />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-sm font-bold text-[var(--text-primary)]">{occPct}%</span>
            <span className="text-[9px] text-[var(--text-muted)]">ocupado</span>
          </div>
        </div>
        <div className="space-y-1.5 self-start w-full">
          {[
            { color: "bg-[var(--gold)]", label: "Ocupado", pct: occPct },
            { color: "bg-emerald-500", label: "Disponível", pct: availPct },
            { color: "bg-zinc-600", label: "Bloqueado", pct: blkPct },
          ].map(({ color, label, pct }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
              <span className="text-[11px] text-[var(--text-secondary)] flex-1">{label}</span>
              <span className="text-[11px] font-medium text-[var(--text-muted)]">{pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
