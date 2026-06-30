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

export default function DashboardClient({ restaurantName, targetFoodCost, recipes, ingredients, periods, movements }: Props) {
  const recipeMap = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

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
    return { month: monthKey(m.created_at), category: i?.category || "Autre", type: m.movement_type, value: Number(m.qty) * Number(m.unit_cost || 0) };
  }), [movements, ingMap]);

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

  const matchM = (m: string) => month === "all" || m === month;
  const matchC = (c: string) => category === "all" || c === category;

  // KPIs
  const sales = saleEvents.filter((e) => matchM(e.month) && matchC(e.category));
  const ca = sales.reduce((s, e) => s + e.revenue, 0);
  const coutMatiere = sales.reduce((s, e) => s + e.cost, 0);
  const marge = ca - coutMatiere;
  const foodCost = ca > 0 ? (coutMatiere / ca) * 100 : 0;
  const platsVendus = sales.reduce((s, e) => s + e.qty, 0);

  const achats = moveEvents.filter((e) => e.type === "in" && matchM(e.month) && matchC(e.category)).reduce((s, e) => s + e.value, 0);
  const pertes = moveEvents.filter((e) => e.type === "loss" && matchM(e.month) && matchC(e.category)).reduce((s, e) => s + e.value, 0);

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
  }, [saleEvents, month]);
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
    <div className="min-h-screen bg-[#F7F8FA] p-6 lg:p-8">
      {/* Header + filters */}
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-emerald-600 text-xs font-semibold uppercase tracking-widest mb-1">Tableau de bord</p>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{restaurantName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <select value={month} onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500">
              <option value="all">Toute la période</option>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500">
              <option value="all">Toutes catégories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* KPI grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Kpi label="Chiffre d'affaires" value={eur(ca)} icon={<Receipt size={15} />} accent="emerald" sub={`${platsVendus} vente${platsVendus !== 1 ? "s" : ""}`} big />
          <Kpi label="Marge brute" value={eur(marge)} icon={<TrendingUp size={15} />} accent="emerald" sub={ca > 0 ? `${(100 - foodCost).toFixed(0)}% du CA` : "—"} />
          <Kpi label="Food cost" value={hasSales && ca > 0 ? `${foodCost.toFixed(1)}%` : "—"} icon={<Percent size={15} />} valueClass={fcColor} sub={`objectif ${targetFoodCost}%`} />
          <Kpi label="Coût matière" value={eur(coutMatiere)} icon={<Utensils size={15} />} sub="des ventes" />
          <Kpi label="Achats" value={eur(achats)} icon={<ShoppingCart size={15} />} accent="blue" sub="réceptions" />
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
          <div className="bg-white border border-gray-100 rounded-card shadow-card p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Ventes par catégorie</h2>
            {byCat.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">Pas encore de ventes sur la période.</p>
            ) : (
              <div className="space-y-3">
                {byCat.map((c) => (
                  <div key={c.cat}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-700 font-medium">{c.cat}</span>
                      <span className="text-gray-900 font-semibold">{eur(c.revenue)}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(c.revenue / maxCatRev) * 100}%` }} />
                    </div>
                    <div className="flex justify-between text-2xs text-gray-400 mt-0.5">
                      <span>{c.qty} vendu{c.qty !== 1 ? "s" : ""}</span>
                      <span className={c.fc > 0 && c.fc <= targetFoodCost ? "text-emerald-600" : c.fc > targetFoodCost ? "text-amber-600" : ""}>
                        {c.fc > 0 ? `food cost ${c.fc.toFixed(0)}%` : "coût à définir"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top plats */}
          <div className="bg-white border border-gray-100 rounded-card shadow-card p-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">Meilleures ventes</h2>
            {topDishes.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">Aucune vente sur la sélection.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-50">
                  {topDishes.map((d, i) => (
                    <tr key={d.name}>
                      <td className="py-2 text-gray-400 w-6">{i + 1}</td>
                      <td className="py-2 text-gray-800 font-medium">{d.name}</td>
                      <td className="py-2 text-right text-gray-400 text-xs">×{d.qty}</td>
                      <td className="py-2 text-right font-semibold text-gray-900">{eur(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Raccourcis */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          {[
            { href: "/rentabilite", label: "Saisir les ventes", icon: <Receipt size={15} /> },
            { href: "/orders", label: "Commandes", icon: <ShoppingCart size={15} /> },
            { href: "/inventaire", label: "Inventaire", icon: <Warehouse size={15} /> },
            { href: "/pertes", label: "Pertes", icon: <Trash2 size={15} /> },
          ].map((s) => (
            <Link key={s.href} href={s.href} className="bg-white border border-gray-100 rounded-card shadow-card p-3.5 flex items-center gap-2.5 hover:shadow-card-hover transition group">
              <span className="text-gray-400 group-hover:text-emerald-600 transition">{s.icon}</span>
              <span className="text-sm font-medium text-gray-700">{s.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon, sub, accent = "default", valueClass, big }: {
  label: string; value: string; icon: React.ReactNode; sub?: string;
  accent?: "default" | "emerald" | "blue" | "amber"; valueClass?: string; big?: boolean;
}) {
  const bg = { default: "bg-gray-100 text-gray-500", emerald: "bg-emerald-50 text-emerald-600", blue: "bg-blue-50 text-blue-600", amber: "bg-amber-50 text-amber-600" }[accent];
  return (
    <div className={`bg-white border border-gray-100 rounded-card shadow-card p-4 ${big ? "lg:col-span-1" : ""}`}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-2xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${bg}`}>{icon}</span>
      </div>
      <p className={`text-xl font-bold tracking-tight ${valueClass ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-2xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}
