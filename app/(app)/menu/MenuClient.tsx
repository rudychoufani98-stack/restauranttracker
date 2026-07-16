"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Pencil, Check, X, Gauge, AlertTriangle, TrendingDown } from "lucide-react";
import clsx from "clsx";

type Recipe = {
  id: string;
  name: string;
  category: string;
  total_cost: number;
  menu_price: number | null;
  yield_portions: number;
};

type SimpleProduct = {
  id: string;
  name: string;
  category: string;
  pack_price: number;
  selling_price: number;
  unit: string;
};

// Unified menu item (caisse-style)
type MenuItem = {
  key: string;
  id: string;
  name: string;
  category: string;
  type: "recipe" | "product";
  cost: number; // cost per portion (recipe) or pack price (product)
  price: number | null; // menu_price / selling_price
};

function getStatus(foodCostPct: number, target: number): "green" | "amber" | "red" {
  if (foodCostPct <= target) return "green";
  if (foodCostPct <= target * 1.2) return "amber";
  return "red";
}

interface Props {
  restaurantId: string;
  targetFoodCostPct: number;
  initialRecipes: Recipe[];
  simpleProducts: SimpleProduct[];
  categoryOrder: string[];
}

export default function MenuClient({ restaurantId: _restaurantId, targetFoodCostPct, initialRecipes, simpleProducts, categoryOrder }: Props) {
  // Category display order (caisse-like). Unknown categories appended alphabetically.
  const CATEGORY_ORDER = categoryOrder.length
    ? categoryOrder
    : ["Entrée", "Plat", "Accompagnement", "Dessert", "Boisson", "Menu"];
  const supabase = createClient();
  const [recipes, setRecipes] = useState<Recipe[]>(initialRecipes);
  const [products, setProducts] = useState<SimpleProduct[]>(simpleProducts);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "green" | "amber" | "red">("all");

  // Build unified items
  const items: MenuItem[] = useMemo(() => {
    const fromRecipes: MenuItem[] = recipes.map((r) => ({
      key: `r:${r.id}`,
      id: r.id,
      name: r.name,
      category: r.category || "Autre",
      type: "recipe",
      cost: r.total_cost / (r.yield_portions || 1),
      price: r.menu_price,
    }));
    const fromProducts: MenuItem[] = products.map((p) => ({
      key: `p:${p.id}`,
      id: p.id,
      name: p.name,
      category: p.category || "Autre",
      type: "product",
      cost: p.pack_price,
      price: p.selling_price ?? null,
    }));
    return [...fromRecipes, ...fromProducts];
  }, [recipes, products]);

  function foodCostPct(it: MenuItem) {
    if (!it.price || it.price === 0) return null;
    return (it.cost / it.price) * 100;
  }
  function marginPct(it: MenuItem) {
    const fcp = foodCostPct(it);
    return fcp === null ? null : 100 - fcp;
  }
  function grossProfit(it: MenuItem) {
    if (it.price === null) return null;
    return it.price - it.cost;
  }
  function suggestedPrice(it: MenuItem) {
    return it.cost / (targetFoodCostPct / 100);
  }

  // Summary stats across all priced items
  const stats = useMemo(() => {
    const priced = items.filter((it) => it.price && it.price > 0);
    if (priced.length === 0) return null;
    const avgFoodCost = priced.reduce((s, it) => s + (foodCostPct(it) ?? 0), 0) / priced.length;
    const offTarget = priced.filter((it) => (foodCostPct(it) ?? 0) > targetFoodCostPct).length;
    const worst = priced.reduce((w, it) => ((foodCostPct(it) ?? 0) > (foodCostPct(w) ?? 0) ? it : w), priced[0]);
    return { avgFoodCost, offTarget, worst, pricedCount: priced.length };
  }, [items]);

  // Filter + group by category
  const grouped = useMemo(() => {
    let list = items;
    if (filterStatus !== "all") {
      list = list.filter((it) => {
        const fcp = foodCostPct(it);
        return fcp !== null && getStatus(fcp, targetFoodCostPct) === filterStatus;
      });
    }
    const map = new Map<string, MenuItem[]>();
    for (const it of list) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    const cats = Array.from(map.keys()).sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return cats.map((cat) => ({
      category: cat,
      items: map.get(cat)!.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [items, filterStatus, categoryOrder]);

  function startEdit(it: MenuItem) {
    setEditingKey(it.key);
    setPriceInput(it.price ? String(it.price) : "");
  }

  async function savePrice(it: MenuItem) {
    const price = parseFloat(priceInput);
    if (isNaN(price) || price < 0) { setEditingKey(null); return; }
    if (it.type === "recipe") {
      await supabase.from("recipes").update({ menu_price: price }).eq("id", it.id);
      setRecipes((prev) => prev.map((r) => (r.id === it.id ? { ...r, menu_price: price } : r)));
    } else {
      await supabase.from("ingredients").update({ selling_price: price }).eq("id", it.id);
      setProducts((prev) => prev.map((p) => (p.id === it.id ? { ...p, selling_price: price } : p)));
    }
    setEditingKey(null);
  }

  const totalItems = items.length;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="mb-6">
        <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Menu</p>
        <h1 className="text-3xl font-extrabold text-primary tracking-tight">Carte & marges</h1>
        <p className="text-sm text-on-surface-variant/70 mt-1">
          Objectif food cost : <span className="font-semibold text-on-surface">{targetFoodCostPct}%</span> · {totalItems} article{totalItems !== 1 ? "s" : ""} · Cliquez sur un prix pour le modifier
        </p>
      </div>

      {/* KPI cards — all derived from already-computed stats (no placeholders) */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {(() => {
            const st = getStatus(stats.avgFoodCost, targetFoodCostPct);
            const barColor = st === "green" ? "bg-primary" : st === "amber" ? "bg-amber" : "bg-red";
            const valColor = st === "green" ? "text-primary" : st === "amber" ? "text-amber-dark" : "text-red";
            const accent = st === "green" ? "border-primary" : st === "amber" ? "border-amber" : "border-red";
            const barPct = Math.min(100, (stats.avgFoodCost / (targetFoodCostPct * 1.5)) * 100);
            return (
              <div className={clsx("glass-card rounded-2xl p-5 flex flex-col gap-3 border-l-4", accent)}>
                <div className="flex justify-between items-center">
                  <span className="text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60">Food cost moyen</span>
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary"><Gauge size={18} /></div>
                </div>
                <div className={clsx("text-2xl font-extrabold tabular-nums", valColor)}>{stats.avgFoodCost.toFixed(1)}%</div>
                <div className="flex items-center gap-2">
                  <div className="w-full bg-surface-container-highest rounded-full h-2">
                    <div className={clsx("h-full rounded-full transition-all", barColor)} style={{ width: `${barPct}%` }} />
                  </div>
                  <span className="text-2xs text-on-surface-variant/60 whitespace-nowrap">obj. {targetFoodCostPct}%</span>
                </div>
              </div>
            );
          })()}

          <div className={clsx("glass-card rounded-2xl p-5 flex flex-col gap-3 border-l-4", stats.offTarget > 0 ? "border-red" : "border-primary")}>
            <div className="flex justify-between items-center">
              <span className="text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60">Articles hors objectif</span>
              <div className={clsx("w-10 h-10 rounded-full flex items-center justify-center", stats.offTarget > 0 ? "bg-red/10 text-red" : "bg-primary/10 text-primary")}><AlertTriangle size={18} /></div>
            </div>
            <div className={clsx("text-2xl font-extrabold tabular-nums", stats.offTarget > 0 ? "text-red" : "text-primary")}>{stats.offTarget}</div>
            <p className="text-2xs text-on-surface-variant/60">sur {stats.pricedCount} article{stats.pricedCount !== 1 ? "s" : ""} tarifé{stats.pricedCount !== 1 ? "s" : ""}</p>
          </div>

          <div className="glass-card rounded-2xl p-5 flex flex-col gap-3 border-l-4 border-amber">
            <div className="flex justify-between items-center">
              <span className="text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60">Moins rentable</span>
              <div className="w-10 h-10 rounded-full bg-amber-light flex items-center justify-center text-amber-dark"><TrendingDown size={18} /></div>
            </div>
            <div className="text-lg font-bold text-on-surface truncate">{stats.worst.name}</div>
            <p className="text-2xs text-red font-semibold tabular-nums">{foodCostPct(stats.worst)?.toFixed(1)}% food cost</p>
          </div>
        </div>
      )}

      {/* Filter pills — real client-side filter over computed food-cost status */}
      <div className="flex flex-wrap gap-2 mb-5">
        {(["all", "green", "amber", "red"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={clsx(
              "px-4 py-2 rounded-full text-xs font-semibold transition",
              filterStatus === s
                ? "bg-primary text-on-primary nav-active-glow"
                : "bg-surface-container-low text-on-surface-variant/70 hover:bg-surface-container"
            )}
          >
            {s === "all" ? "Tous" : s === "green" ? "Dans l'objectif" : s === "amber" ? "Légèrement dépassé" : "Hors budget"}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {totalItems === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">📋</div>
          <h2 className="text-base font-semibold text-on-surface mb-1">Aucun article au menu</h2>
          <p className="text-sm text-on-surface-variant/70 mb-5">Créez des recettes (fiches techniques) ou marquez des ingrédients comme revendus directement.</p>
          <a href="/recipes" className="inline-block px-5 py-2.5 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:bg-primary-container transition">
            Aller aux recettes →
          </a>
        </div>
      ) : (
        <div className="space-y-7">
          {grouped.map(({ category, items: catItems }) => (
            <div key={category}>
              {/* Category section title */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-6 bg-primary rounded-full" />
                  <h2 className="text-lg font-bold text-on-surface">{category}</h2>
                </div>
                <span className="text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60">{catItems.length} article{catItems.length !== 1 ? "s" : ""}</span>
              </div>

              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-surface-container-low/50 border-b border-outline-variant/20">
                      <tr>
                        <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Article</th>
                        <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Coût</th>
                        <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Prix carte</th>
                        <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Food cost %</th>
                        <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Marge %</th>
                        <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Marge brute</th>
                        <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Prix suggéré</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {catItems.map((it) => {
                        const fcp = foodCostPct(it);
                        const mp = marginPct(it);
                        const gp = grossProfit(it);
                        const sp = suggestedPrice(it);
                        const status = fcp !== null ? getStatus(fcp, targetFoodCostPct) : null;
                        return (
                          <tr key={it.key} className="hover:bg-surface-container-low/40 transition-colors">
                            <td className="px-5 py-4 font-medium text-on-surface">
                              {it.name}
                              {it.type === "product" && <span className="ml-2 px-1.5 py-0.5 text-2xs rounded bg-blue-light text-blue uppercase tracking-wide">revente</span>}
                            </td>
                            <td className="px-5 py-4 text-right tabular-nums text-on-surface-variant/80">€{it.cost.toFixed(2)}</td>
                            <td className="px-5 py-4 text-right">
                              {editingKey === it.key ? (
                                <div className="flex items-center gap-1 justify-end">
                                  <span className="text-on-surface-variant/50 text-xs">€</span>
                                  <input
                                    autoFocus type="number" min="0" step="0.01" value={priceInput}
                                    onChange={(e) => setPriceInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") savePrice(it); if (e.key === "Escape") setEditingKey(null); }}
                                    className="w-20 px-2 py-1 text-sm bg-surface-container-low border border-primary rounded-lg outline-none focus:ring-2 focus:ring-primary/20"
                                  />
                                  <button onClick={() => savePrice(it)} className="text-primary"><Check size={14} /></button>
                                  <button onClick={() => setEditingKey(null)} className="text-on-surface-variant/50"><X size={14} /></button>
                                </div>
                              ) : (
                                <button onClick={() => startEdit(it)} className="flex items-center gap-1 group text-on-surface hover:text-primary ml-auto tabular-nums">
                                  {it.price ? `€${Number(it.price).toFixed(2)}` : <span className="text-on-surface-variant/50 italic text-xs">Saisir le prix…</span>}
                                  <Pencil size={11} className="text-on-surface-variant/30 group-hover:text-primary transition" />
                                </button>
                              )}
                            </td>
                            <td className="px-5 py-4 text-right">
                              {fcp !== null ? (
                                <span className={clsx("font-semibold tabular-nums", status === "green" ? "text-primary" : status === "amber" ? "text-amber-dark" : "text-red")}>{fcp.toFixed(1)}%</span>
                              ) : <span className="text-on-surface-variant/30">—</span>}
                            </td>
                            <td className="px-5 py-4 text-right">
                              {mp !== null ? (
                                <span className={clsx("font-semibold tabular-nums", mp >= 70 ? "text-primary" : mp >= 50 ? "text-amber-dark" : "text-red")}>{mp.toFixed(1)}%</span>
                              ) : <span className="text-on-surface-variant/30">—</span>}
                            </td>
                            <td className="px-5 py-4 text-right">
                              {gp !== null ? (
                                <span className={clsx("font-semibold tabular-nums", gp > 0 ? "text-primary" : "text-red")}>€{gp.toFixed(2)}</span>
                              ) : <span className="text-on-surface-variant/30">—</span>}
                            </td>
                            <td className="px-5 py-4 text-right">
                              <span className="text-blue font-semibold tabular-nums">€{sp.toFixed(2)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
