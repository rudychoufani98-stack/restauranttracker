"use client";

// Petits graphiques SVG faits maison — pas de librairie à installer, pas de
// kilo-octets de JS à charger. Les couleurs reprennent les tokens Material 3
// de tailwind.config.ts (les SVG ne lisent pas les classes Tailwind, d'où les
// hex en dur ; garder les deux en phase si la palette change).

export const CHART = {
  primary: "#00694B",   // primary
  red: "#BA1A1A",       // red
  amber: "#F59E0B",     // amber
  blue: "#3B82F6",      // blue
  grid: "#BCCAC1",      // outline-variant
  axis: "#3D4A43",      // on-surface-variant
  muted: "#6D7A72",     // outline
};

const W = 720;
const PAD = { l: 64, r: 18, t: 16, b: 34 };

/** Échelle « jolie » : borne haute arrondie au pas supérieur. */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

function ticks(min: number, max: number, count = 4): number[] {
  if (max === min) return [min];
  return Array.from({ length: count + 1 }, (_, i) => min + ((max - min) * i) / count);
}

const dmy = (t: number) => new Date(t).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });

// ── Courbe temporelle ─────────────────────────────────────────────────
export type Serie = { name: string; color: string; points: { t: number; y: number }[] };

export function LineChart({
  series, formatY, height = 240, reference, ariaLabel,
}: {
  series: Serie[];
  formatY: (n: number) => string;
  height?: number;
  /** Repère horizontal (ex. le CMUP actuel). */
  reference?: { y: number; label: string };
  ariaLabel: string;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) {
    return <p className="text-sm text-on-surface-variant/50 py-12 text-center">Pas encore de données sur cette période.</p>;
  }

  const H = height;
  const xs = all.map((p) => p.t);
  const ys = all.map((p) => p.y).concat(reference ? [reference.y] : []);
  let minT = Math.min(...xs), maxT = Math.max(...xs);
  if (minT === maxT) { minT -= 86400000; maxT += 86400000; } // un seul point → on l'affiche au centre
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  // Marge de 8 % pour que la courbe ne colle ni au plafond ni au plancher.
  const span = maxY - minY || Math.abs(maxY) || 1;
  minY -= span * 0.08;
  maxY += span * 0.08;
  if (minY > 0 && minY < span * 0.3) minY = 0; // si on est déjà près de 0, ancrer à 0

  const px = (t: number) => PAD.l + ((t - minT) / (maxT - minT)) * (W - PAD.l - PAD.r);
  const py = (y: number) => PAD.t + (1 - (y - minY) / (maxY - minY)) * (H - PAD.t - PAD.b);

  const yTicks = ticks(minY, maxY, 4);
  const xTickCount = Math.min(6, Math.max(2, all.length));
  const xTicks = Array.from({ length: xTickCount }, (_, i) => minT + ((maxT - minT) * i) / (xTickCount - 1));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={ariaLabel}>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={py(v)} x2={W - PAD.r} y2={py(v)} stroke={CHART.grid} strokeWidth="1" opacity="0.35" />
          <text x={PAD.l - 8} y={py(v) + 4} textAnchor="end" fontSize="11" fill={CHART.axis} opacity="0.75">{formatY(v)}</text>
        </g>
      ))}

      {xTicks.map((t, i) => (
        <text key={i} x={px(t)} y={H - 10} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
          fontSize="11" fill={CHART.axis} opacity="0.75">{dmy(t)}</text>
      ))}

      {reference && (
        <g>
          <line x1={PAD.l} y1={py(reference.y)} x2={W - PAD.r} y2={py(reference.y)}
            stroke={CHART.muted} strokeWidth="1.5" strokeDasharray="5 4" opacity="0.8" />
          <text x={W - PAD.r} y={py(reference.y) - 6} textAnchor="end" fontSize="10.5" fill={CHART.muted}>{reference.label}</text>
        </g>
      )}

      {series.map((s) => {
        const pts = [...s.points].sort((a, b) => a.t - b.t);
        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${px(p.t)} ${py(p.y)}`).join(" ");
        return (
          <g key={s.name}>
            <path d={d} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => (
              <circle key={i} cx={px(p.t)} cy={py(p.y)} r="4" fill="#FFFFFF" stroke={s.color} strokeWidth="2.5">
                <title>{`${s.name} — ${dmy(p.t)} : ${formatY(p.y)}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ── Barres groupées par mois ──────────────────────────────────────────
export function BarsChart({
  labels, series, formatY, height = 240, ariaLabel,
}: {
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  formatY: (n: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  if (labels.length === 0) {
    return <p className="text-sm text-on-surface-variant/50 py-12 text-center">Pas encore de données sur cette période.</p>;
  }
  const H = height;
  const maxV = niceCeil(Math.max(0, ...series.flatMap((s) => s.values)));
  const py = (y: number) => PAD.t + (1 - y / maxV) * (H - PAD.t - PAD.b);
  const plotW = W - PAD.l - PAD.r;
  const slot = plotW / labels.length;
  const groupW = slot * 0.68;
  const barW = groupW / series.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={ariaLabel}>
      {ticks(0, maxV, 4).map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={py(v)} x2={W - PAD.r} y2={py(v)} stroke={CHART.grid} strokeWidth="1" opacity="0.35" />
          <text x={PAD.l - 8} y={py(v) + 4} textAnchor="end" fontSize="11" fill={CHART.axis} opacity="0.75">{formatY(v)}</text>
        </g>
      ))}

      {labels.map((label, i) => {
        const gx = PAD.l + slot * i + (slot - groupW) / 2;
        // Sur un long historique, n'écrire qu'un mois sur deux pour rester lisible.
        const showLabel = labels.length <= 14 || i % 2 === 0;
        return (
          <g key={label}>
            {series.map((s, j) => {
              const v = Math.max(0, s.values[i] ?? 0);
              const h = Math.max(0, py(0) - py(v));
              return (
                <rect key={s.name} x={gx + barW * j} y={py(v)} width={Math.max(1, barW - 1.5)} height={h}
                  fill={s.color} rx="2">
                  <title>{`${s.name} — ${label} : ${formatY(v)}`}</title>
                </rect>
              );
            })}
            {showLabel && (
              <text x={gx + groupW / 2} y={H - 10} textAnchor="middle" fontSize="11" fill={CHART.axis} opacity="0.75">{label}</text>
            )}
          </g>
        );
      })}
      <line x1={PAD.l} y1={py(0)} x2={W - PAD.r} y2={py(0)} stroke={CHART.grid} strokeWidth="1.5" />
    </svg>
  );
}

// ── Barres horizontales (classement) ──────────────────────────────────
export function HBars({
  items, color = CHART.primary, formatV,
}: {
  items: { name: string; value: number; sub?: string }[];
  color?: string;
  formatV: (n: number) => string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-on-surface-variant/50 py-10 text-center">Rien à afficher sur cette période.</p>;
  }
  const max = Math.max(...items.map((i) => i.value)) || 1;
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.name} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-semibold text-on-surface truncate">{it.name}</span>
            <span className="font-bold text-on-surface tabular-nums shrink-0">{formatV(it.value)}</span>
          </div>
          <div className="h-2.5 bg-surface-container rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${(it.value / max) * 100}%`, backgroundColor: color }} />
          </div>
          {it.sub && <p className="text-[11px] text-on-surface-variant/60">{it.sub}</p>}
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-on-surface-variant/70">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}
