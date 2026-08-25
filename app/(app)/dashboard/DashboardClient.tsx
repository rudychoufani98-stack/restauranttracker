"use client";

import { useMemo, useState } from "react";
import { eur as eurFmt } from "@/lib/format";
import Link from "next/link";
import { TrendingUp, TrendingDown, ShoppingCart, Trash2, Percent, Warehouse, Receipt, Utensils, ArrowRight , AlertTriangle } from "lucide-react";
import { perDisplayUnit } from "@/lib/ingredient-helpers";

type Recipe = { id: string; name: string; category: string; total_cost: number; menu_price: number | null; yield_portions: number };
type Ingredient = { id: string; name: string; category: string; stock_qty: number | null; cmup: number | null; cost_per_base_unit: number | null; pack_price: number | null; selling_price: number | null; unit?: string };
type SalesLine = { recipe_id: string | null; ingredient_id: string | null; qty_sold: number };
type Period = { id: string; month: string; sales_lines: SalesLine[] };
type Movement = { movement_type: string; reference_type?: string | null; qty: number; unit_cost: number | null; created_at: string; ingredient_id: string | null };

interface Props {
  restaurantName: string;
  targetFoodCost: number;
  recipes: Recipe[];
  ingredients: Ingredient[];
  periods: Period[];
  movements: Movement[];
  fournitureIds: string[];
  /** true si le plafond de lecture des mouvements a été atteint */
  movementsTruncated?: boolean;
  alertesPrix?: { total: number; aContester: number; premiere: string | null };
}

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const monthKey = (s: string) => (s ?? "").slice(0, 7); // "YYYY-MM"
const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 ? `${MONTHS_FR[mi]} ${y}` : key;
};
// Le signe reste devant le symbole : « −€6 » se lit mieux que « €-6 ».
const eur = (n: number) => `${n < 0 ? "−" : ""}€${Math.abs(n).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function DashboardClient({ alertesPrix, restaurantName, targetFoodCost, recipes, ingredients, periods, movements, fournitureIds, movementsTruncated = false }: Props) {
  const recipeMap = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const fournitureSet = useMemo(() => new Set(fournitureIds), [fournitureIds]);

  // Flatten sales into events
  const saleEvents = useMemo(() => {
    const out: { month: string; category: string; name: string; revenue: number; cost: number; qty: number }[] = [];
    for (const p of periods) {
      const mk = monthKey(p.month);
      for (const l of p.sales_lines ?? []) {
        const qty = Number(l.qty_sold) || 0;
        if (!qty) continue;
        if (l.recipe_id) {
          const r = recipeMap.get(l.recipe_id);
          // Même règle que l'écran Ventes & marges : un plat sans prix est ignoré
          if (!r || !Number(r.menu_price)) continue;
          out.push({ month: mk, category: r.category || "Autre", name: r.name, revenue: qty * Number(r.menu_price || 0), cost: qty * (Number(r.total_cost || 0) / (r.yield_portions || 1)), qty });
        } else if (l.ingredient_id) {
          const i = ingMap.get(l.ingredient_id);
          if (!i || !Number(i.selling_price)) continue;
          // CMUP ramené à l'unité de vente (pièce, ou kg/L pour un produit au poids)
          out.push({ month: mk, category: i.category || "Autre", name: i.name, revenue: qty * Number(i.selling_price || 0), cost: qty * perDisplayUnit(Number(i.cmup ?? i.cost_per_base_unit ?? 0), i.unit ?? "unit"), qty });
        }
      }
    }
    return out;
  }, [periods, recipeMap, ingMap]);

  // Flatten purchases + losses
  const moveEvents = useMemo(() => movements.map((m) => {
    const i = m.ingredient_id ? ingMap.get(m.ingredient_id) : null;
    // Correction de facture / annulation de commande = achat en MOINS.
    const isPurchaseCorrection = m.movement_type === "adjustment" && (m.reference_type === "invoice" || m.reference_type === "adjustment");
    return { month: monthKey(m.created_at), day: (m.created_at ?? "").slice(0, 10), category: i?.category || "Autre", type: isPurchaseCorrection ? "in" : m.movement_type, sign: isPurchaseCorrection ? -1 : 1, value: Number(m.qty) * Number(m.unit_cost || 0), isFourniture: m.ingredient_id ? fournitureSet.has(m.ingredient_id) : false };
  }).filter((e) => e.type !== "adjustment"), [movements, ingMap, fournitureSet]);

  // Month + category options
  const months = useMemo(() => {
    const set = new Set<string>();
    saleEvents.forEach((e) => set.add(e.month));
    moveEvents.forEach((e) => e.month && set.add(e.month));
    return Array.from(set).filter(Boolean).sort().reverse();
  }, [saleEvents, moveEvents]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    saleEvents.forEach((e) => set.add(e.category));
    recipes.forEach((r) => set.add(r.category || "Autre"));
    return Array.from(set).filter(Boolean).sort();
  }, [saleEvents, recipes]);

  const [month, setMonth] = useState<string>(months[0] ?? "all");
  const [category, setCategory] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Custom date range takes precedence over the month select when set.
  const rangeActive = !!(fromDate || toDate);
  const inRangeMonth = (mk: string) => (!fromDate || mk >= fromDate.slice(0, 7)) && (!toDate || mk <= toDate.slice(0, 7));
  const inRangeDay = (d: string) => (!fromDate || d >= fromDate) && (!toDate || d <= toDate);

  const matchC = (c: string) => category === "all" || c === category;
  // Sales are monthly → filter by month (range = months intersecting the range).
  const matchM = (m: string) => rangeActive ? inRangeMonth(m) : (month === "all" || m === month);
  // Movements are dated → filter by exact day when a range is set.
  const matchMove = (e: { day: string; month: string }) => rangeActive ? inRangeDay(e.day) : (month === "all" || e.month === month);

  // KPIs
  const sales = saleEvents.filter((e) => matchM(e.month) && matchC(e.category));
  const ca = sales.reduce((s, e) => s + e.revenue, 0);
  const coutMatiere = sales.reduce((s, e) => s + e.cost, 0);
  const marge = ca - coutMatiere;
  const foodCost = ca > 0 ? (coutMatiere / ca) * 100 : 0;
  const platsVendus = sales.reduce((s, e) => s + e.qty, 0);

  // Achats séparés : nourriture (food) vs fournitures (couverts, emballages…).
  const achatsFood = moveEvents.filter((e) => e.type === "in" && !e.isFourniture && matchMove(e) && matchC(e.category)).reduce((s, e) => s + e.sign * e.value, 0);
  const achatsFournitures = moveEvents.filter((e) => e.type === "in" && e.isFourniture && matchMove(e) && matchC(e.category)).reduce((s, e) => s + e.sign * e.value, 0);
  const achatsTotal = achatsFood + achatsFournitures;
  const pertes = moveEvents.filter((e) => e.type === "loss" && matchMove(e) && matchC(e.category)).reduce((s, e) => s + e.value, 0);

  const stockValue = ingredients
    .filter((i) => matchC(i.category || "Autre"))
    .reduce((s, i) => s + Number(i.stock_qty ?? 0) * Number(i.cmup ?? i.cost_per_base_unit ?? 0), 0);

  // Ventes par catégorie
  const byCat = useMemo(() => {
    const map = new Map<string, { revenue: number; cost: number; qty: number }>();
    for (const e of saleEvents.filter((e) => matchM(e.month))) {
      const g = map.get(e.category) ?? { revenue: 0, cost: 0, qty: 0 };
      g.revenue += e.revenue; g.cost += e.cost; g.qty += e.qty;
      map.set(e.category, g);
    }
    return Array.from(map.entries()).map(([cat, g]) => ({ cat, ...g, fc: g.revenue > 0 ? (g.cost / g.revenue) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [saleEvents, month, fromDate, toDate]);
  const maxCatRev = Math.max(1, ...byCat.map((c) => c.revenue));

  // Top plats
  const topDishes = useMemo(() => {
    const map = new Map<string, { revenue: number; qty: number; cost: number }>();
    for (const e of sales) {
      const g = map.get(e.name) ?? { revenue: 0, qty: 0, cost: 0 };
      g.revenue += e.revenue; g.qty += e.qty; g.cost += e.cost;
      map.set(e.name, g);
    }
    return Array.from(map.entries()).map(([name, g]) => ({ name, ...g, fc: g.revenue > 0 ? (g.cost / g.revenue) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [sales]);

  // Série mensuelle (6 derniers mois) : donne vie au tableau de bord et
  // répond à « est-ce que ça progresse ? », ce qu'un chiffre seul ne dit pas.
  const caByMonth = useMemo(() => {
    const m = new Map<string, { ca: number; cost: number }>();
    for (const e of saleEvents) {
      if (!matchC(e.category)) continue;
      const g = m.get(e.month) ?? { ca: 0, cost: 0 };
      g.ca += e.revenue; g.cost += e.cost;
      m.set(e.month, g);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleEvents, category]);

  const monthlySeries = useMemo(() =>
    Array.from(caByMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([m, g]) => ({ month: m, ca: g.ca, fc: g.ca > 0 ? (g.cost / g.ca) * 100 : 0 })),
    [caByMonth]);

  // Évolution vs le mois précédent (uniquement quand un mois précis est choisi).
  const trendPct = useMemo(() => {
    if (rangeActive || month === "all") return null;
    const keys = Array.from(caByMonth.keys()).sort();
    const i = keys.indexOf(month);
    if (i <= 0) return null;
    const prev = caByMonth.get(keys[i - 1])?.ca ?? 0;
    const cur = caByMonth.get(month)?.ca ?? 0;
    if (prev <= 0) return null;
    return ((cur - prev) / prev) * 100;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caByMonth, month, rangeActive]);

  // Libellé de la période affichée, pour que chaque chiffre soit situé.
  const periodLabel = rangeActive
    ? `du ${fromDate || "…"} au ${toDate || "…"}`
    : month === "all" ? "toute la période" : monthLabel(month);

  const partFood = achatsTotal > 0 ? (achatsFood / achatsTotal) * 100 : 0;

  const hasSales = saleEvents.length > 0;
  const fcColor = foodCost === 0 ? "text-gray-400" : foodCost <= targetFoodCost ? "text-emerald-600" : foodCost <= targetFoodCost * 1.2 ? "text-amber-600" : "text-red-600";

  return (
    <div className="min-h-screen bg-surface">
      {/* Barre supérieure : identité + période */}
      <header className="flex flex-wrap justify-between items-end gap-4 px-6 lg:px-8 pt-5 pb-4 border-b border-outline-variant/60 bg-surface/85 backdrop-blur-md sticky top-0 z-30">
        <div className="flex flex-col">
          <span className="text-2xs font-bold text-primary tracking-widest uppercase">Tableau de bord</span>
          <h1 className="text-2xl font-semibold text-on-surface tracking-tight leading-tight">{restaurantName}</h1>
          <p className="text-xs text-on-surface-variant/60 mt-0.5">{periodLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)} disabled={rangeActive}
            aria-label="Mois affiché"
            className="px-3 py-2 text-sm bg-surface-container-lowest border border-outline-variant rounded-full outline-none focus:border-primary disabled:opacity-50">
            <option value="all">Toute la période</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <div className="flex items-center gap-1.5 bg-surface-container-lowest border border-outline-variant rounded-full px-3 py-1.5">
            <span className="text-2xs text-on-surface-variant/60">Du</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} aria-label="Date de début"
              className="text-xs outline-none text-on-surface-variant bg-transparent" />
            <span className="text-2xs text-on-surface-variant/60">au</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} aria-label="Date de fin"
              className="text-xs outline-none text-on-surface-variant bg-transparent" />
            {rangeActive && (
              <button onClick={() => { setFromDate(""); setToDate(""); }} className="text-on-surface-variant/50 hover:text-on-surface text-sm leading-none ml-0.5" title="Effacer la plage">×</button>
            )}
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie"
            className="px-3 py-2 text-sm bg-surface-container-lowest border border-outline-variant rounded-full outline-none focus:border-primary">
            <option value="all">Toutes catégories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </header>

      <div className="p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {(rangeActive || movementsTruncated) && (
          <div className="mb-5 space-y-2">
            {rangeActive && (
              <div className="text-xs text-amber-dark bg-amber-light border border-amber/30 rounded-xl px-4 py-2.5">
                Les ventes sont saisies <b>au mois</b> : le CA, la marge et le food cost couvrent les <b>mois entiers</b>
                touchés par cette plage. Les achats et les pertes, eux, suivent les dates exactes — ne compare donc pas
                directement les deux sur une plage de quelques jours.
              </div>
            )}
            {alertesPrix && alertesPrix.total > 0 && (
              <Link
                href="/statistiques"
                className="flex items-start gap-3 rounded-xl border border-amber/30 bg-amber-light px-4 py-3 hover:bg-amber-light/70 transition"
              >
                <AlertTriangle size={17} className="text-amber-dark shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-dark">
                    {alertesPrix.total} alerte{alertesPrix.total !== 1 ? "s" : ""} sur tes prix d&apos;achat
                    {alertesPrix.aContester > 0 && ` · ${eurFmt(alertesPrix.aContester)} facturés en trop`}
                  </p>
                  {alertesPrix.premiere && (
                    <p className="text-xs text-on-surface-variant mt-0.5 truncate">{alertesPrix.premiere}</p>
                  )}
                </div>
                <span className="text-xs font-semibold text-primary shrink-0 self-center">Voir →</span>
              </Link>
            )}
            {movementsTruncated && (
              <div className="text-xs text-on-surface-variant/70 bg-surface-container-low border border-outline-variant/30 rounded-xl px-4 py-2.5">
                Beaucoup de mouvements de stock sur la période : seuls les plus récents sont pris en compte ici.
                Utilise les <b>exports Excel</b> pour un historique complet.
              </div>
            )}
          </div>
        )}

        {/* ── VEDETTE : les deux chiffres qu&apos;on regarde en premier ── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {/* Chiffre d&apos;affaires + évolution + 6 derniers mois */}
          <div className="lg:col-span-2 relative overflow-hidden rounded-2xl bg-primary text-on-primary p-6 shadow-lg">
            <div className="absolute -top-16 -right-10 w-64 h-64 rounded-full bg-white/10 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -left-6 w-56 h-56 rounded-full bg-primary-fixed/20 blur-3xl pointer-events-none" />
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-2xs font-bold uppercase tracking-widest text-on-primary/70">Chiffre d&apos;affaires</p>
                  <div className="flex items-end gap-3 mt-1.5">
                    <span className="text-5xl font-bold tracking-tight tabular-nums leading-none">{eur(ca)}</span>
                    {trendPct !== null && (
                      <span className={trendChipClass(trendPct)}>
                        {trendPct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                        {trendPct >= 0 ? "+" : ""}{trendPct.toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-on-primary/70 mt-2">
                    {platsVendus > 0
                      ? `${platsVendus} article${platsVendus !== 1 ? "s" : ""} vendu${platsVendus !== 1 ? "s" : ""} · marge brute ${eur(marge)}`
                      : "Aucune vente saisie sur cette période"}
                    {trendPct !== null && <span className="opacity-80"> · vs mois précédent</span>}
                  </p>
                </div>
                <span className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                  <Receipt size={20} />
                </span>
              </div>

              {/* 6 derniers mois : la barre pleine est le mois affiché */}
              {monthlySeries.length > 1 && (
                <div className="mt-6 pt-5 border-t border-white/15">
                  <div className="flex items-end gap-2 h-20">
                    {monthlySeries.map((s) => {
                      const max = Math.max(...monthlySeries.map((x) => x.ca), 1);
                      const h = Math.max(4, (s.ca / max) * 100);
                      const active = !rangeActive && s.month === month;
                      return (
                        <div key={s.month} className="flex-1 flex flex-col items-center gap-1.5 group">
                          <div className="w-full flex-1 flex items-end justify-center">
                            <div
                              title={`${monthLabel(s.month)} — ${eur(s.ca)}`}
                              className={`w-full rounded-t-md transition-all ${active ? "bg-primary-fixed" : "bg-white/25 group-hover:bg-white/45"}`}
                              style={{ height: `${h}%` }}
                            />
                          </div>
                          <span className={`text-[10px] ${active ? "text-on-primary font-bold" : "text-on-primary/60"}`}>
                            {(monthLabel(s.month).split(" ")[0] ?? "").slice(0, 4)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Food cost : jauge avec repère d&apos;objectif */}
          <div className="glass-card rounded-2xl p-6 flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <p className="text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60">Food cost</p>
              <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Percent size={16} />
              </span>
            </div>
            <Gauge value={hasSales && ca > 0 ? foodCost : null} target={targetFoodCost} />
            <p className="text-xs text-center text-on-surface-variant/70">
              {ca > 0 ? (
                foodCost <= targetFoodCost
                  ? <>Sous l&apos;objectif de <b>{targetFoodCost}%</b> — {eur(marge)} de marge</>
                  : <>Au-dessus de l&apos;objectif — <b>{eur(coutMatiere - ca * (targetFoodCost / 100))}</b> de coût matière en trop</>
              ) : <>Objectif <b>{targetFoodCost}%</b> — saisis tes ventes pour le mesurer</>}
            </p>
          </div>
        </section>

        {/* ── SECONDAIRE ── */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <Kpi label="Coût matière" value={eur(coutMatiere)} icon={<Utensils size={15} />}
            sub={ca > 0 ? `${foodCost.toFixed(0)}% du CA` : "des plats vendus"} />
          <Kpi label="Achats" value={eur(achatsTotal)} icon={<ShoppingCart size={15} />} accent="blue"
            sub={achatsTotal > 0 ? `${partFood.toFixed(0)}% food · ${(100 - partFood).toFixed(0)}% fournitures` : "food + fournitures"}
            bar={achatsTotal > 0 ? partFood : undefined} />
          <Kpi label="Pertes" value={eur(pertes)} icon={<Trash2 size={15} />} accent={pertes > 0 ? "amber" : "default"}
            sub={ca > 0 && pertes > 0 ? `${((pertes / ca) * 100).toFixed(1)}% du CA` : "gaspillage, casse, écarts"} />
          <Kpi label="Valeur du stock" value={eur(stockValue)} icon={<Warehouse size={15} />} sub="au coût moyen (CMUP)" />
        </section>

        {/* ── BANDE COMPACTE : chiffres de contexte ── */}
        <section className="glass-card rounded-2xl px-5 py-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-y-3 md:divide-x divide-outline-variant/30">
          <Mini label="Marge brute" value={eur(marge)} hint={ca > 0 ? `${(100 - foodCost).toFixed(0)}% du CA` : "—"} />
          <Mini label="Marge nette est." value={eur(marge - pertes)} hint="marge − pertes" />
          <Mini label="Achats food" value={eur(achatsFood)} hint="hors fournitures" />
          <Mini label="Fournitures" value={eur(achatsFournitures)} hint="couverts, emballages…" />
        </section>

        {/* ── Guide si aucune vente, sinon les analyses ── */}
        {!hasSales ? (
          <div className="glass-card rounded-2xl p-7 mb-6">
            <h2 className="text-lg font-semibold text-on-surface">Trois étapes pour voir tes chiffres</h2>
            <p className="text-sm text-on-surface-variant/70 mt-1 mb-5">
              Tes achats et ton stock sont déjà suivis. Il manque les ventes pour calculer le food cost et la marge.
            </p>
            <ol className="space-y-3">
              {[
                { n: 1, t: "Vérifie tes fiches techniques", d: "Chaque plat vendu doit avoir ses ingrédients et son prix de vente.", href: "/recipes", cta: "Ouvrir les recettes" },
                { n: 2, t: "Saisis les ventes du mois", d: "Quantités vendues par plat — le stock se déduit automatiquement.", href: "/rentabilite", cta: "Saisir les ventes" },
                { n: 3, t: "Fais un inventaire", d: "Pour comparer le stock réel au stock théorique et voir les écarts.", href: "/inventaire?vue=inventaire", cta: "Prendre un inventaire" },
              ].map((s) => (
                <li key={s.n} className="flex flex-wrap items-start gap-4 rounded-xl border border-outline-variant/40 p-4 hover:border-primary/40 transition-colors">
                  <span className="w-8 h-8 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0">{s.n}</span>
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-semibold text-on-surface">{s.t}</p>
                    <p className="text-xs text-on-surface-variant/70 mt-0.5">{s.d}</p>
                  </div>
                  <Link href={s.href} className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-on-primary bg-primary rounded-lg hover:bg-primary-container transition">
                    {s.cta} <ArrowRight size={13} />
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Ventes par catégorie */}
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-baseline justify-between mb-5">
                <h2 className="text-base font-semibold text-on-surface">Ventes par catégorie</h2>
                <span className="text-2xs text-on-surface-variant/50">{byCat.length} catégorie{byCat.length !== 1 ? "s" : ""}</span>
              </div>
              {byCat.length === 0 ? (
                <p className="text-sm text-on-surface-variant/60 py-8 text-center">Pas de ventes sur la période choisie.</p>
              ) : (
                <div className="space-y-4">
                  {byCat.map((c) => {
                    const over = c.fc > 0 && c.fc > targetFoodCost;
                    return (
                      <div key={c.cat} className="space-y-1.5">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-semibold text-on-surface">{c.cat}</span>
                          <span className="font-bold text-on-surface tabular-nums">{eur(c.revenue)}</span>
                        </div>
                        <div className="h-2.5 bg-surface-container rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${over ? "bg-amber" : "bg-primary"}`}
                            style={{ width: `${(c.revenue / maxCatRev) * 100}%` }} />
                        </div>
                        <div className="flex justify-between text-[11px] text-on-surface-variant/70">
                          <span>{c.qty} vendu{c.qty !== 1 ? "s" : ""}</span>
                          <span className={over ? "text-amber-dark font-semibold" : c.fc > 0 ? "text-primary" : ""}>
                            {c.fc > 0 ? `food cost ${c.fc.toFixed(0)}%` : "coût à définir"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Meilleures ventes */}
            <div className="glass-card rounded-2xl overflow-hidden flex flex-col">
              <div className="px-6 pt-6 pb-4 flex items-baseline justify-between">
                <h2 className="text-base font-semibold text-on-surface">Meilleures ventes</h2>
                <span className="text-2xs text-on-surface-variant/50">par chiffre d&apos;affaires</span>
              </div>
              {topDishes.length === 0 ? (
                <p className="text-sm text-on-surface-variant/60 py-10 text-center">Aucune vente sur la sélection.</p>
              ) : (
                <div className="divide-y divide-outline-variant/25">
                  {topDishes.map((d, i) => {
                    const over = d.fc > 0 && d.fc > targetFoodCost;
                    return (
                      <div key={d.name} className="px-6 py-3.5 flex items-center gap-4 hover:bg-surface-container-low/50 transition-colors group">
                        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${i === 0 ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant group-hover:bg-primary/10 group-hover:text-primary"}`}>
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-on-surface truncate">{d.name}</p>
                          <p className="text-[11px] text-on-surface-variant/60">×{d.qty} · marge {eur(d.revenue - d.cost)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-on-surface tabular-nums">{eur(d.revenue)}</p>
                          {d.fc > 0 && (
                            <p className={`text-[11px] tabular-nums ${over ? "text-amber-dark" : "text-primary"}`}>{d.fc.toFixed(0)}% FC</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Raccourcis */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pb-4">
          {[
            { href: "/rentabilite", label: "Saisir les ventes", icon: <Receipt size={17} /> },
            { href: "/orders", label: "Commandes", icon: <ShoppingCart size={17} /> },
            { href: "/inventaire?vue=inventaire", label: "Inventaire", icon: <Warehouse size={17} /> },
            { href: "/pertes", label: "Pertes", icon: <Trash2 size={17} /> },
          ].map((s) => (
            <Link key={s.href} href={s.href}
              className="glass-card rounded-xl px-4 py-3.5 flex items-center gap-3 hover:bg-primary/5 transition-all group">
              <span className="w-9 h-9 rounded-lg bg-surface-container-high text-on-surface-variant flex items-center justify-center shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">
                {s.icon}
              </span>
              <span className="text-xs font-bold text-on-surface truncate">{s.label}</span>
              <ArrowRight size={14} className="ml-auto text-on-surface-variant/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
            </Link>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}

/** Pastille d'évolution, lisible sur le fond vert de la carte vedette. */
function trendChipClass(pct: number): string {
  const base = "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold mb-1 ";
  return base + (pct >= 0 ? "bg-white/20 text-on-primary" : "bg-red/30 text-white");
}

/** Jauge de food cost : demi-anneau coloré + repère de l'objectif. */
function Gauge({ value, target }: { value: number | null; target: number }) {
  // Échelle jusqu'à 1,8× l'objectif (au moins 50 %) pour rester lisible.
  const max = Math.max(50, target * 1.8);
  const pct = value === null ? 0 : Math.min(1, Math.max(0, value / max));
  const targetPct = Math.min(1, target / max);
  const R = 78, CX = 100, CY = 92;
  const point = (t: number, radius = R) => {
    const a = Math.PI * (1 - t);
    return { x: CX + radius * Math.cos(a), y: CY - radius * Math.sin(a) };
  };
  const arc = (t: number) => {
    const s = point(0), e = point(t);
    return `M ${s.x} ${s.y} A ${R} ${R} 0 ${t > 0.5 ? 1 : 0} 1 ${e.x} ${e.y}`;
  };
  const tickOut = point(targetPct, R + 7);
  const tickIn = point(targetPct, R - 7);
  const color = value === null ? "#C3C9D6" : value <= target ? "#00694B" : value <= target * 1.2 ? "#F59E0B" : "#BA1A1A";

  return (
    <div className="relative py-2">
      <svg viewBox="0 0 200 104" className="w-full max-w-[240px] mx-auto overflow-visible" role="img"
        aria-label={value === null ? "Food cost non disponible" : `Food cost de ${value.toFixed(1)} pour cent, objectif ${target} pour cent`}>
        <path d={arc(1)} fill="none" stroke="#E0E3E5" strokeWidth="13" strokeLinecap="round" />
        {value !== null && pct > 0 && (
          <path d={arc(pct)} fill="none" stroke={color} strokeWidth="13" strokeLinecap="round" />
        )}
        <line x1={tickOut.x} y1={tickOut.y} x2={tickIn.x} y2={tickIn.y} stroke="#181C1E" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 pointer-events-none">
        <span className="text-4xl font-bold tabular-nums leading-none" style={{ color }}>
          {value === null ? "—" : `${value.toFixed(1)}%`}
        </span>
        <span className="text-[11px] text-on-surface-variant/60 mt-1">objectif {target}%</span>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, sub, accent = "default", bar }: {
  label: string; value: string; icon: React.ReactNode; sub?: string;
  accent?: "default" | "emerald" | "blue" | "amber"; bar?: number;
}) {
  const badge = {
    default: "bg-surface-container-high text-on-surface-variant",
    emerald: "bg-primary/10 text-primary",
    blue: "bg-secondary-container text-secondary",
    amber: "bg-amber-light text-amber-dark",
  }[accent];
  return (
    <div className="glass-card rounded-2xl p-5 hover:-translate-y-0.5 transition-transform duration-200">
      <div className="flex items-start justify-between mb-3 gap-2">
        <p className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest leading-tight">{label}</p>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${badge}`}>{icon}</span>
      </div>
      <p className="text-[27px] leading-none font-bold tracking-tight text-on-surface tabular-nums">{value}</p>
      {bar !== undefined && (
        <div className="mt-3 h-1.5 rounded-full bg-surface-container overflow-hidden flex">
          <div className="h-full bg-secondary" style={{ width: `${bar}%` }} />
          <div className="h-full bg-secondary/30" style={{ width: `${100 - bar}%` }} />
        </div>
      )}
      {sub && <p className="text-2xs text-on-surface-variant/70 mt-2">{sub}</p>}
    </div>
  );
}

/** Chiffre de contexte dans la bande compacte. */
function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <p className="text-2xs font-bold text-on-surface-variant/55 uppercase tracking-widest">{label}</p>
      <p className="text-lg font-bold text-on-surface tabular-nums mt-0.5">{value}</p>
      {hint && <p className="text-2xs text-on-surface-variant/55">{hint}</p>}
    </div>
  );
}
