"use client";

import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Search, Info } from "lucide-react";
import clsx from "clsx";
import { LineChart, BarsChart, HBars, Legend, CHART } from "@/components/charts";
import {
  withinMonths, purchasePriceSeries, biggestMovers, monthlySummary,
  topPurchased, lossesByReason, inventorySeries, monthLabel, displayUnit,
  perDisplayUnit,
  type StatMovement, type StatIngredient, type StatSession,
} from "@/lib/stock-stats";

const eur = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const eur0 = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} €`;
const pct = (n: number) => `${n.toFixed(1)} %`;

const PERIODS: { key: string; label: string; months: number | null }[] = [
  { key: "6", label: "6 mois", months: 6 },
  { key: "12", label: "12 mois", months: 12 },
  { key: "24", label: "24 mois", months: 24 },
  { key: "all", label: "Tout", months: null },
];

interface Props {
  ingredients: StatIngredient[];
  movements: StatMovement[];
  sessions: StatSession[];
  /** Le chargement de la page plafonne le journal : on le dit si la borne est atteinte. */
  movementsCapped?: boolean;
}

export default function StatsTab({ ingredients, movements, sessions, movementsCapped = false }: Props) {
  const [periodKey, setPeriodKey] = useState("12");
  const [productId, setProductId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const months = PERIODS.find((p) => p.key === periodKey)?.months ?? 12;
  const scoped = useMemo(() => withinMonths(movements, months), [movements, months]);

  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const movers = useMemo(() => biggestMovers(scoped, ingredients), [scoped, ingredients]);
  const monthly = useMemo(() => monthlySummary(scoped), [scoped]);
  const top = useMemo(() => topPurchased(scoped, ingredients, 10), [scoped, ingredients]);
  const losses = useMemo(() => lossesByReason(scoped).slice(0, 6), [scoped]);
  const invPoints = useMemo(() => inventorySeries(sessions), [sessions]);

  // Produit affiché par défaut : celui dont le prix a le plus bougé — c'est
  // celui sur lequel il y a une décision à prendre.
  const selectedId = productId ?? movers[0]?.id ?? null;
  const selected = selectedId ? ingById.get(selectedId) ?? null : null;
  const priceSeries = useMemo(
    () => (selected ? purchasePriceSeries(scoped, selected.id, selected.unit) : []),
    [scoped, selected],
  );

  const pickable = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = movers.filter((m) => !q || m.name.toLowerCase().includes(q));
    return list.slice(0, 40);
  }, [movers, search]);

  const totals = useMemo(() => {
    const achats = monthly.reduce((s, m) => s + m.achats, 0);
    const pertes = monthly.reduce((s, m) => s + m.pertes, 0);
    const conso = monthly.reduce((s, m) => s + m.conso, 0);
    return { achats, pertes, conso, taux: achats > 0 ? (pertes / achats) * 100 : 0 };
  }, [monthly]);

  const labels = monthly.map((m) => monthLabel(m.month));
  const hasAnything = movements.length > 0;

  if (!hasAnything) {
    return (
      <div className="glass-card rounded-2xl p-12 text-center">
        <p className="text-3xl mb-3">📈</p>
        <h2 className="text-base font-semibold text-on-surface mb-1">Pas encore de statistiques</h2>
        <p className="text-sm text-on-surface-variant/60">
          Les courbes se remplissent au fil des réceptions, des ventes et des inventaires.
          Validez une première commande pour démarrer l&apos;historique.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Période */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="glass-card rounded-2xl p-2 flex flex-wrap gap-1">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriodKey(p.key)}
              className={clsx(
                "px-4 py-2 rounded-xl text-2xs font-bold uppercase tracking-wider transition-all duration-300",
                periodKey === p.key ? "bg-primary-container text-on-primary-container nav-active-glow" : "text-on-surface-variant/60 hover:bg-surface-container-low",
              )}>
              {p.label}
            </button>
          ))}
        </div>
        {movementsCapped && (
          <p className="text-2xs text-on-surface-variant/50 flex items-center gap-1.5">
            <Info size={12} /> Basé sur les 5 000 derniers mouvements.
          </p>
        )}
      </div>

      {/* Chiffres clés de la période */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Achats" value={eur0(totals.achats)} accent="orange" />
        <Stat label="Matière consommée" value={eur0(totals.conso)} accent="navy" />
        <Stat label="Pertes" value={eur0(totals.pertes)} accent={totals.pertes > 0 ? "red" : "muted"} />
        {/* Le taux de perte est un jugement, pas une couleur de marque : vert / ambre / rouge. */}
        <Stat label="Taux de perte" value={pct(totals.taux)} accent={totals.taux > 5 ? "red" : totals.taux > 2 ? "amber" : "green"}
          sub="pertes ÷ achats" />
      </section>

      {/* ── Évolution du prix d'un produit ── */}
      <section className="glass-card rounded-2xl overflow-hidden">
        <div className="px-6 pt-6 pb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-on-surface">Évolution du prix d&apos;achat</h2>
            <p className="text-2xs text-on-surface-variant/60 mt-0.5">
              Ce que vous payez réellement, achat après achat, ramené au kg / L / pièce.
            </p>
          </div>
          {selected && priceSeries.length >= 2 && (() => {
            const first = priceSeries[0].y;
            const last = priceSeries[priceSeries.length - 1].y;
            const d = first > 0 ? ((last - first) / first) * 100 : 0;
            const up = d > 0.05;
            return (
              <span className={clsx(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold",
                up ? "bg-red-light text-red" : d < -0.05 ? "bg-green-light text-green-dark" : "bg-surface-container text-on-surface-variant",
              )}>
                {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                {d > 0 ? "+" : ""}{d.toFixed(1)} % depuis le premier achat
              </span>
            );
          })()}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 px-6 pb-6">
          <div>
            {selected ? (
              <>
                <div className="flex flex-wrap items-baseline gap-3 mb-1">
                  <h3 className="text-lg font-bold text-on-surface">{selected.name}</h3>
                  <span className="text-2xs text-on-surface-variant/60">€ / {displayUnit(selected.unit)}</span>
                </div>
                <LineChart
                  ariaLabel={`Évolution du prix d'achat de ${selected.name}`}
                  series={[{ name: selected.name, color: CHART.orange, points: priceSeries }]}
                  formatY={(n) => eur(n)}
                  reference={referenceCmup(ingById.get(selected.id))}
                />
                {priceSeries.length === 1 && (
                  <p className="text-2xs text-on-surface-variant/50 text-center">
                    Un seul achat enregistré : la courbe apparaîtra dès le deuxième.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-on-surface-variant/50 py-12 text-center">
                Aucun produit n&apos;a encore deux achats sur cette période.
              </p>
            )}
          </div>

          {/* Sélecteur : les plus fortes variations d'abord */}
          <div className="flex flex-col min-h-0">
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher un produit…"
                className="w-full pl-9 pr-3 py-2 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface-variant/40" />
            </div>
            <div className="rounded-xl border border-outline-variant/25 divide-y divide-outline-variant/15 overflow-y-auto max-h-[260px]">
              {pickable.length === 0 ? (
                <p className="text-2xs text-on-surface-variant/50 p-4 text-center">Aucun produit avec au moins deux achats.</p>
              ) : pickable.map((m) => (
                <button key={m.id} onClick={() => setProductId(m.id)}
                  className={clsx(
                    "w-full text-left px-3 py-2.5 transition-colors",
                    m.id === selectedId ? "bg-primary/8" : "hover:bg-surface-container-low/60",
                  )}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={clsx("text-xs font-semibold truncate", m.id === selectedId ? "text-primary" : "text-on-surface")}>{m.name}</span>
                    <span className={clsx(
                      "text-2xs font-bold tabular-nums shrink-0",
                      m.deltaPct > 0.05 ? "text-red" : m.deltaPct < -0.05 ? "text-primary" : "text-on-surface-variant/50",
                    )}>
                      {m.deltaPct > 0 ? "+" : ""}{m.deltaPct.toFixed(1)} %
                    </span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant/55 tabular-nums">
                    {eur(m.first)} → {eur(m.last)} · {m.count} achats
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Achats / consommation / pertes par mois ── */}
      <section className="glass-card rounded-2xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <div>
            <h2 className="text-base font-semibold text-on-surface">Achats, consommation et pertes</h2>
            <p className="text-2xs text-on-surface-variant/60 mt-0.5">
              Acheter beaucoup plus que ce qui est consommé, c&apos;est du stock qui dort ou qui se perd.
            </p>
          </div>
          <Legend items={[
            { name: "Achats", color: CHART.orange },
            { name: "Consommé", color: CHART.navy },
            { name: "Pertes", color: CHART.red },
          ]} />
        </div>
        <BarsChart
          ariaLabel="Achats, matière consommée et pertes, mois par mois"
          labels={labels}
          series={[
            { name: "Achats", color: CHART.orange, values: monthly.map((m) => m.achats) },
            { name: "Consommé", color: CHART.navy, values: monthly.map((m) => m.conso) },
            { name: "Pertes", color: CHART.red, values: monthly.map((m) => m.pertes) },
          ]}
          formatY={eur0}
        />
      </section>

      {/* ── Taux de perte ── */}
      <section className="glass-card rounded-2xl p-6">
        <h2 className="text-base font-semibold text-on-surface">Taux de perte mensuel</h2>
        <p className="text-2xs text-on-surface-variant/60 mt-0.5 mb-2">
          Part des achats partie à la poubelle. Au-delà de 5 %, il y a un problème d&apos;approvisionnement ou de conservation.
        </p>
        <LineChart
          ariaLabel="Taux de perte mois par mois, en pourcentage des achats"
          series={[{
            name: "Taux de perte",
            color: CHART.red,
            points: monthly.map((m) => ({ t: Date.parse(`${m.month}-01T00:00:00Z`), y: m.tauxPerte })),
          }]}
          formatY={(n) => `${n.toFixed(1)} %`}
          reference={{ y: 5, label: "seuil 5 %" }}
          height={200}
        />
      </section>

      {/* ── Où part l'argent + causes de perte ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="glass-card rounded-2xl p-6">
          <h2 className="text-base font-semibold text-on-surface mb-1">Où part l&apos;argent</h2>
          <p className="text-2xs text-on-surface-variant/60 mb-4">Vos 10 plus gros postes d&apos;achat sur la période.</p>
          <HBars
            items={top.map((t) => ({ name: t.name, value: t.value, sub: `${t.count} réception${t.count !== 1 ? "s" : ""}` }))}
            formatV={eur}
          />
        </section>

        <section className="glass-card rounded-2xl p-6">
          <h2 className="text-base font-semibold text-on-surface mb-1">Causes de perte</h2>
          <p className="text-2xs text-on-surface-variant/60 mb-4">Ce qui vous coûte le plus cher en gaspillage.</p>
          <HBars
            items={losses.map((l) => ({ name: l.name, value: l.value, sub: `${l.count} perte${l.count !== 1 ? "s" : ""}` }))}
            color={CHART.red}
            formatV={eur}
          />
        </section>
      </div>

      {/* ── Inventaires ── */}
      {invPoints.length > 0 && (
        <section className="glass-card rounded-2xl p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <div>
              <h2 className="text-base font-semibold text-on-surface">Valeur comptée et écart, à chaque inventaire</h2>
              <p className="text-2xs text-on-surface-variant/60 mt-0.5">
                Un écart négatif qui se creuse d&apos;un inventaire à l&apos;autre signale de la démarque : pertes non saisies, vol, ou fiches techniques fausses.
              </p>
            </div>
            <Legend items={[
              { name: "Valeur comptée", color: CHART.navy },
              { name: "Écart", color: CHART.amber },
            ]} />
          </div>
          <LineChart
            ariaLabel="Valeur du stock compté et écart d'inventaire dans le temps"
            series={[
              { name: "Valeur comptée", color: CHART.navy, points: invPoints.map((p) => ({ t: p.t, y: p.valeur })) },
              { name: "Écart", color: CHART.amber, points: invPoints.map((p) => ({ t: p.t, y: p.ecart })) },
            ]}
            formatY={eur0}
          />
        </section>
      )}
    </div>
  );
}

/** Repère du coût moyen actuel (CMUP), pour situer le dernier prix payé. */
function referenceCmup(ing: StatIngredient | undefined): { y: number; label: string } | undefined {
  if (!ing) return undefined;
  const cmup = Number(ing.cmup ?? 0);
  if (!(cmup > 0)) return undefined;
  return { y: perDisplayUnit(cmup, ing.unit), label: "CMUP actuel" };
}

function Stat({ label, value, sub, accent }: {
  label: string; value: string; sub?: string;
  accent: "orange" | "navy" | "green" | "red" | "amber" | "muted";
}) {
  const tone = {
    orange: "text-brand-orange-deep border-brand-orange",
    navy: "text-primary border-primary",
    green: "text-emerald-700 border-emerald-500",
    red: "text-red border-red",
    amber: "text-amber-dark border-amber",
    muted: "text-on-surface border-outline-variant/30",
  }[accent];
  return (
    <div className={clsx("glass-card rounded-2xl p-5 border-l-4", tone.split(" ")[1])}>
      <p className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">{label}</p>
      <p className={clsx("text-2xl font-extrabold tabular-nums mt-1.5", tone.split(" ")[0])}>{value}</p>
      {sub && <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{sub}</p>}
    </div>
  );
}
