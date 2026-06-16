"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Pencil, Check, X } from "lucide-react";
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
      <div className="mb-6 pb-5 border-b border-gray-200">
        <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Menu</p>
        <h1 className="text-2xl font-bold text-gray-900">Carte & marges</h1>
        <p className="text-sm text-gray-500 mt-1">
          Objectif food cost : <span className="font-semibold text-gray-700">{targetFoodCostPct}%</span> · {totalItems} article{totalItems !== 1 ? "s" : ""} · Cliquez sur un prix pour le modifier
        </p>
      </div>

      {/* Summary cards */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {(() => {
            const st = getStatus(stats.avgFoodCost, targetFoodCostPct);
            const bar = st === "green" ? "bg-emerald-400" : st === "amber" ? "bg-amber-400" : "bg-red-400";
            const val = st === "green" ? "text-emerald-700" : st === "amber" ? "text-amber-700" : "text-red-600";
            return (
              <div className="bg-white border border-gray-200 rounded-card shadow-card overflow-hidden">
                <div className={`h-1 ${bar}`} />
                <div className="p-5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Food cost moyen</p>
                  <p className={`text-3xl font-bold ${val}`}>{stats.avgFoodCost.toFixed(1)}%</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, (stats.avgFoodCost / (targetFoodCostPct * 1.5)) * 100)}%` }} />
                    </div>
                    <span className="text-xs text-gray-400">obj. {targetFoodCostPct}%</span>
                  </div>
                </div>
              </div>
            );
          })()}
          <div className="bg-white border border-gray-200 rounded-card shadow-card overflow-hidden">
            <div className={`h-1 ${stats.offTarget > 0 ? "bg-red-400" : "bg-emerald-400"}`} />
            <div className="p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Articles hors objectif</p>
              <p className={`text-3xl font-bold ${stats.offTarget > 0 ? "text-red-600" : "text-emerald-700"}`}>{stats.offTarget}</p>
              <p className="text-xs text-gray-400 mt-2">sur {stats.pricedCount} article{stats.pricedCount !== 1 ? "s" : ""} tarifé{stats.pricedCount !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-card shadow-card overflow-hidden">
            <div className="h-1 bg-orange-400" />
            <div className="p-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Moins rentable</p>
              <p className="text-base font-bold text-gray-900 truncate">{stats.worst.name}</p>
              <p className="text-xs text-red-500 mt-1 font-medium">{foodCostPct(stats.worst)?.toFixed(1)}% food cost</p>
            </div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {(["all", "green", "amber", "red"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={clsx(
              "px-4 py-2 text-xs font-semibold rounded-lg border transition",
              filterStatus === s
                ? s === "all" ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                  : s === "green" ? "bg-emerald-500 text-white border-emerald-500 shadow-sm"
                  : s === "amber" ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                  : "bg-red-500 text-white border-red-500 shadow-sm"
                : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700"
            )}
          >
            {s === "all" ? "Tous" : s === "green" ? "✓ Dans l'objectif" : s === "amber" ? "⚠ Légèrement dépassé" : "✗ Hors budget"}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {totalItems === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-12 text-center">
          <div className="text-4xl mb-3">📋</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">Aucun article au menu</h2>
          <p className="text-sm text-gray-500 mb-5">Créez des recettes (fiches techniques) ou marquez des ingrédients comme revendus directement.</p>
          <a href="/recipes" className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition inline-block">
            Aller aux recettes →
          </a>
        </div>
      ) : (
        <div className="space-y-7">
          {grouped.map(({ category, items: catItems }) => (
            <div key={category}>
              {/* Category header */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide flex items-center gap-2">
                  <span className="w-1.5 h-5 rounded-full bg-emerald-500 inline-block" />
                  {category}
                </h2>
                <span className="text-xs text-gray-400">{catItems.length} article{catItems.length !== 1 ? "s" : ""}</span>
              </div>

              <div className="bg-white border border-[#E5E7EB] rounded-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E5E7EB] bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Article</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Coût</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Prix carte</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Food cost %</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Marge %</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Marge brute</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Prix suggéré</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {catItems.map((it) => {
                      const fcp = foodCostPct(it);
                      const mp = marginPct(it);
                      const gp = grossProfit(it);
                      const sp = suggestedPrice(it);
                      const status = fcp !== null ? getStatus(fcp, targetFoodCostPct) : null;
                      return (
                        <tr key={it.key} className={clsx(
                          "transition",
                          status === "green" ? "bg-emerald-50/40 hover:bg-emerald-50" :
                          status === "amber" ? "bg-amber-50/40 hover:bg-amber-50" :
                          status === "red" ? "bg-red-50/40 hover:bg-red-50" : "hover:bg-gray-50"
                        )}>
                          <td className="px-4 py-3 font-medium text-gray-900">
                            {it.name}
                            {it.type === "product" && <span className="ml-2 px-1.5 py-0.5 text-2xs rounded bg-blue-50 text-blue-500 uppercase tracking-wide">revente</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">€{it.cost.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right">
                            {editingKey === it.key ? (
                              <div className="flex items-center gap-1 justify-end">
                                <span className="text-gray-400 text-xs">€</span>
                                <input
                                  autoFocus type="number" min="0" step="0.01" value={priceInput}
                                  onChange={(e) => setPriceInput(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") savePrice(it); if (e.key === "Escape") setEditingKey(null); }}
                                  className="w-20 px-2 py-1 text-sm border border-emerald-400 rounded outline-none"
                                />
                                <button onClick={() => savePrice(it)} className="text-emerald-600"><Check size={14} /></button>
                                <button onClick={() => setEditingKey(null)} className="text-gray-400"><X size={14} /></button>
                              </div>
                            ) : (
                              <button onClick={() => startEdit(it)} className="flex items-center gap-1 group text-gray-900 hover:text-emerald-700 ml-auto">
                                {it.price ? `€${Number(it.price).toFixed(2)}` : <span className="text-gray-400 italic text-xs">Saisir le prix…</span>}
                                <Pencil size={11} className="text-gray-300 group-hover:text-emerald-500 transition" />
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {fcp !== null ? (
                              <span className={clsx("font-medium", status === "green" ? "text-emerald-600" : status === "amber" ? "text-amber-600" : "text-red-600")}>{fcp.toFixed(1)}%</span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {mp !== null ? (
                              <span className={clsx("font-medium", mp >= 70 ? "text-emerald-600" : mp >= 50 ? "text-amber-600" : "text-red-600")}>{mp.toFixed(1)}%</span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {gp !== null ? (
                              <span className={clsx("font-medium", gp > 0 ? "text-emerald-600" : "text-red-600")}>€{gp.toFixed(2)}</span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-blue-600 font-medium">€{sp.toFixed(2)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
