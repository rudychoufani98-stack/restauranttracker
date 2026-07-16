"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TrendingUp, ShoppingCart, Trash2, Percent, Warehouse, Receipt, Utensils, ArrowRight } from "lucide-react";

type Recipe = { id: string; name: string; category: string; total_cost: number; menu_price: number | null; yield_portions: number };
type Ingredient = { id: string; name: string; category: string; stock_qty: number | null; cmup: number | null; cost_per_base_unit: number | null; pack_price: number | null; selling_price: number | null };
type SalesLine = { recipe_id: string | null; ingredient_id: string | null; qty_sold: number };
type Period = { id: string; month: string; sales_lines: SalesLine[] };
type Movement = { movement_type: string; qty: number; unit_cost: number | null; created_at: string; ingredient_id: string | null };

interface Props {
  restaurantName: string;
  targetFoodCost: number;
  recipes: Recipe[];
  ingredients: Ingredient[];
  periods: Period[];
  movements: Movement[];
  fournitureIds: string[];
}

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const monthKey = (s: string) => (s ?? "").slice(0, 7); // "YYYY-MM"
const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  const mi = parseInt(m, 10) - 1;
  return mi >= 0 && mi < 12 ? `${MONTHS_FR[mi]} ${y}` : key;
};
const eur = (n: number) => `€${n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const eur2 = (n: number) => `€${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DashboardClient({ restaurantName, targetFoodCost, recipes, ingredients, periods, movements, fournitureIds }: Props) {
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
          if (!r) continue;
          out.push({ month: mk, category: r.category || "Autre", name: r.name, revenue: qty * Number(r.menu_price || 0), cost: qty * (Number(r.total_cost || 0) / (r.yield_portions || 1)), qty });
        } else if (l.ingredient_id) {
          const i = ingMap.get(l.ingredient_id);
          if (!i) continue;
          out.push({ month: mk, category: i.category || "Autre", name: i.name, revenue: qty * Number(i.selling_price || 0), cost: qty * Number(i.pack_price || 0), qty });
        }
      }
    }
    return out;
  }, [periods, recipeMap, ingMap]);

  // Flatten purchases + losses
  const moveEvents = useMemo(() => movements.map((m) => {
    const i = m.ingredient_id ? ingMap.get(m.ingredient_id) : null;
    return { month: monthKey(m.created_at), day: (m.created_at ?? "").slice(0, 10), category: i?.category || "Autre", type: m.movement_type, value: Number(m.qty) * Number(m.unit_cost || 0), isFourniture: m.ingredient_id ? fournitureSet.has(m.ingredient_id) : false };
  }), [movements, ingMap, fournitureSet]);

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
  const achatsFood = moveEvents.filter((e) => e.type === "in" && !e.isFourniture && matchMove(e) && matchC(e.category)).reduce((s, e) => s + e.value, 0);
  const achatsFournitures = moveEvents.filter((e) => e.type === "in" && e.isFourniture && matchMove(e) && matchC(e.category)).reduce((s, e) => s + e.value, 0);
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

  const hasSales = saleEvents.length > 0;
  const fcColor = foodCost === 0 ? "text-gray-400" : foodCost <= targetFoodCost ? "text-emerald-600" : foodCost <= targetFoodCost * 1.2 ? "text-amber-600" : "text-red-600";

  return (
    <div className="min-h-screen bg-surface">
      {/* Top app bar */}
      <header className="flex flex-wrap justify-between items-center gap-4 px-6 lg:px-8 py-4 border-b border-outline-variant bg-surface/80 backdrop-blur-md sticky top-0 z-30">
        <div className="flex flex-col">
          <span className="text-2xs font-bold text-primary tracking-widest uppercase">Tableau de bord</span>
          <h1 className="text-2xl font-semibold text-on-surface tracking-tight">{restaurantName}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)} disabled={rangeActive}
            className="px-3 py-2 text-sm bg-surface-container-lowest border border-outline-variant rounded-full outline-none focus:border-primary disabled:opacity-50">
            <option value="all">Toute la période</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          {/* Custom date range */}
          <div className="flex items-center gap-1.5 bg-surface-container-lowest border border-outline-variant rounded-full px-3 py-1.5">
            <span className="text-2xs text-on-surface-variant/60">Du</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              className="text-xs outline-none text-on-surface-variant bg-transparent" />
            <span className="text-2xs text-on-surface-variant/60">au</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              className="text-xs outline-none text-on-surface-variant bg-transparent" />
            {rangeActive && (
              <button onClick={() => { setFromDate(""); setToDate(""); }} className="text-on-surface-variant/50 hover:text-on-surface text-sm leading-none ml-0.5" title="Effacer la plage">×</button>
            )}
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="px-3 py-2 text-sm bg-surface-container-lowest border border-outline-variant rounded-full outline-none focus:border-primary">
            <option value="all">Toutes catégories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </header>

      <div className="p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Kpi label="Chiffre d'affaires" value={eur(ca)} icon={<Receipt size={15} />} accent="emerald" sub={`${platsVendus} vente${platsVendus !== 1 ? "s" : ""}`} big />
          <Kpi label="Marge brute" value={eur(marge)} icon={<TrendingUp size={15} />} accent="emerald" sub={ca > 0 ? `${(100 - foodCost).toFixed(0)}% du CA` : "—"} />
          <Kpi label="Food cost" value={hasSales && ca > 0 ? `${foodCost.toFixed(1)}%` : "—"} icon={<Percent size={15} />} valueClass={fcColor} sub={`objectif ${targetFoodCost}%`} />
          <Kpi label="Coût matière" value={eur(coutMatiere)} icon={<Utensils size={15} />} sub="des ventes" />
          <Kpi label="Achats food" value={eur(achatsFood)} icon={<ShoppingCart size={15} />} accent="blue" sub="hors fournitures" />
          <Kpi label="Fournitures" value={eur(achatsFournitures)} icon={<ShoppingCart size={15} />} accent="default" sub="couverts, emballages…" />
          <Kpi label="Coût total achats" value={eur(achatsTotal)} icon={<Receipt size={15} />} accent="blue" sub="food + fournitures" />
          <Kpi label="Pertes" value={eur(pertes)} icon={<Trash2 size={15} />} accent={pertes > 0 ? "amber" : "default"} sub="gaspillage/casse" />
          <Kpi label="Valeur du stock" value={eur(stockValue)} icon={<Warehouse size={15} />} sub="au CMUP" />
          <Kpi label="Marge nette est." value={eur(marge - pertes)} icon={<TrendingUp size={15} />} accent="emerald" sub="marge − pertes" />
        </div>

        {!hasSales && (
          <div className="bg-white border border-gray-100 rounded-card shadow-card p-6 mb-6 text-center">
            <p className="text-sm text-gray-600 mb-2">Aucune vente enregistrée pour l'instant — le CA et le food cost s'afficheront dès que tu saisis tes ventes.</p>
            <Link href="/rentabilite" className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition">
              Saisir les ventes du mois <ArrowRight size={14} />
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Ventes par catégorie */}
          <div className="glass-card rounded-xl p-6">
            <h2 className="text-lg font-semibold text-on-surface mb-5">Ventes par catégorie</h2>
            {byCat.length === 0 ? (
              <p className="text-sm text-on-surface-variant/60 py-6 text-center">Pas encore de ventes sur la période.</p>
            ) : (
              <div className="space-y-5">
                {byCat.map((c) => (
                  <div key={c.cat} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-on-surface font-bold">{c.cat}</span>
                      <span className="text-on-surface font-semibold">{eur(c.revenue)}</span>
                    </div>
                    <div className="h-3 bg-surface-container rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${(c.revenue / maxCatRev) * 100}%`, boxShadow: "0 0 10px rgba(0, 150, 109, 0.4)" }} />
                    </div>
                    <div className="flex justify-between text-[11px] text-on-surface-variant/70">
                      <span>{c.qty} vendu{c.qty !== 1 ? "s" : ""}</span>
                      <span className={c.fc > 0 && c.fc <= targetFoodCost ? "text-primary" : c.fc > targetFoodCost ? "text-amber-dark" : ""}>
                        {c.fc > 0 ? `food cost ${c.fc.toFixed(0)}%` : "coût à définir"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top plats */}
          <div className="glass-card rounded-xl overflow-hidden flex flex-col">
            <div className="p-6 pb-4 border-b border-outline-variant/40">
              <h2 className="text-lg font-semibold text-on-surface">Meilleures ventes</h2>
            </div>
            {topDishes.length === 0 ? (
              <p className="text-sm text-on-surface-variant/60 py-10 text-center">Aucune vente sur la sélection.</p>
            ) : (
              <div className="divide-y divide-outline-variant/30">
                {topDishes.map((d, i) => (
                  <div key={d.name} className="px-6 py-4 flex items-center justify-between hover:bg-surface-container-low/50 transition-colors group">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-surface-container-high flex items-center justify-center font-bold text-on-surface-variant group-hover:bg-primary group-hover:text-white transition-all shrink-0">
                        {i + 1}
                      </div>
                      <p className="text-sm font-bold text-on-surface truncate">{d.name}</p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-bold text-on-surface">{eur(d.revenue)}</p>
                      <p className="text-xs text-on-surface-variant/70">×{d.qty} unités</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Raccourcis / barre d'actions */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pb-4">
          {[
            { href: "/rentabilite", label: "Saisir les ventes", icon: <Receipt size={28} />, danger: false },
            { href: "/orders", label: "Commandes", icon: <ShoppingCart size={28} />, danger: false },
            { href: "/inventaire", label: "Inventaire", icon: <Warehouse size={28} />, danger: false },
            { href: "/pertes", label: "Pertes", icon: <Trash2 size={28} />, danger: true },
          ].map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className={`glass-card rounded-xl p-5 flex flex-col items-center gap-2 transition-all group ${s.danger ? "hover:bg-red hover:text-white" : "hover:bg-primary hover:text-white"}`}
            >
              <span className="group-hover:scale-110 transition-transform">{s.icon}</span>
              <span className="text-2xs font-bold uppercase tracking-widest">{s.label}</span>
            </Link>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, sub, accent = "default", valueClass, big }: {
  label: string; value: string; icon: React.ReactNode; sub?: string;
  accent?: "default" | "emerald" | "blue" | "amber"; valueClass?: string; big?: boolean;
}) {
  const bg = {
    default: "bg-surface-container-high text-on-surface-variant",
    emerald: "bg-primary/10 text-primary",
    blue: "bg-secondary-container text-secondary",
    amber: "bg-amber-light text-amber-dark",
  }[accent];
  return (
    <div className={`glass-card ${accent === "emerald" ? "metric-gradient" : ""} rounded-xl p-5 relative overflow-hidden group hover:-translate-y-1 transition-all duration-300 ${big ? "lg:col-span-1" : ""}`}>
      {accent === "emerald" && (
        <div className="absolute -top-4 -right-4 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors" />
      )}
      <div className="relative flex items-start justify-between mb-3">
        <p className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">{label}</p>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${bg}`}>{icon}</span>
      </div>
      <p className={`relative text-[26px] leading-none font-bold tracking-tight ${valueClass ?? "text-on-surface"}`}>{value}</p>
      {sub && <p className="relative text-2xs text-on-surface-variant/70 mt-2">{sub}</p>}
    </div>
  );
}
