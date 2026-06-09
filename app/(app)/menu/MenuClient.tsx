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

type SortKey = "name" | "cost" | "price" | "food_cost_pct" | "margin_pct" | "gross_profit";

function getStatus(foodCostPct: number, target: number): "green" | "amber" | "red" {
  if (foodCostPct <= target) return "green";
  if (foodCostPct <= target * 1.2) return "amber";
  return "red";
}

interface Props {
  restaurantId: string;
  targetFoodCostPct: number;
  initialRecipes: Recipe[];
}

export default function MenuClient({ restaurantId, targetFoodCostPct, initialRecipes }: Props) {
  const supabase = createClient();
  const [recipes, setRecipes] = useState<Recipe[]>(initialRecipes);
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterStatus, setFilterStatus] = useState<"all" | "green" | "amber" | "red">("all");

  function costPerPortion(r: Recipe) {
    return r.total_cost / (r.yield_portions || 1);
  }

  function foodCostPct(r: Recipe) {
    const price = r.menu_price;
    if (!price || price === 0) return null;
    return (costPerPortion(r) / price) * 100;
  }

  function marginPct(r: Recipe) {
    const fcp = foodCostPct(r);
    if (fcp === null) return null;
    return 100 - fcp;
  }

  function grossProfit(r: Recipe) {
    const price = r.menu_price;
    if (!price) return null;
    return price - costPerPortion(r);
  }

  function suggestedPrice(r: Recipe) {
    return costPerPortion(r) / (targetFoodCostPct / 100);
  }

  // Summary stats
  const stats = useMemo(() => {
    const priced = recipes.filter((r) => r.menu_price && r.menu_price > 0);
    if (priced.length === 0) return null;
    const avgFoodCost = priced.reduce((sum, r) => sum + (foodCostPct(r) ?? 0), 0) / priced.length;
    const belowTarget = priced.filter((r) => {
      const fcp = foodCostPct(r);
      return fcp !== null && fcp > targetFoodCostPct;
    }).length;
    const worst = priced.reduce((worst, r) => {
      const fcp = foodCostPct(r) ?? 0;
      const worstFcp = foodCostPct(worst) ?? 0;
      return fcp > worstFcp ? r : worst;
    }, priced[0]);
    return { avgFoodCost, belowTarget, worst };
  }, [recipes]);

  const sorted = useMemo(() => {
    let list = [...recipes];
    if (filterStatus !== "all") {
      list = list.filter((r) => {
        const fcp = foodCostPct(r);
        if (fcp === null) return false;
        return getStatus(fcp, targetFoodCostPct) === filterStatus;
      });
    }
    list.sort((a, b) => {
      let va: number, vb: number;
      switch (sortKey) {
        case "name": return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        case "cost": va = costPerPortion(a); vb = costPerPortion(b); break;
        case "price": va = a.menu_price ?? 0; vb = b.menu_price ?? 0; break;
        case "food_cost_pct": va = foodCostPct(a) ?? 999; vb = foodCostPct(b) ?? 999; break;
        case "margin_pct": va = marginPct(a) ?? -999; vb = marginPct(b) ?? -999; break;
        case "gross_profit": va = grossProfit(a) ?? -999; vb = grossProfit(b) ?? -999; break;
        default: return 0;
      }
      return sortAsc ? va - vb : vb - va;
    });
    return list;
  }, [recipes, sortKey, sortAsc, filterStatus]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  function startEditPrice(r: Recipe) {
    setEditingPriceId(r.id);
    setPriceInput(r.menu_price ? String(r.menu_price) : "");
  }

  async function savePrice(id: string) {
    const price = parseFloat(priceInput);
    if (isNaN(price) || price < 0) { setEditingPriceId(null); return; }
    await supabase.from("recipes").update({ menu_price: price }).eq("id", id);
    setRecipes((prev) => prev.map((r) => r.id === id ? { ...r, menu_price: price } : r));
    setEditingPriceId(null);
  }

  function SortTh({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k;
    return (
      <th
        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-800 select-none whitespace-nowrap"
        onClick={() => toggleSort(k)}
      >
        {label} {active ? (sortAsc ? "↑" : "↓") : ""}
      </th>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-gray-900">Menu</h1>
        <p className="text-sm text-gray-500 mt-0.5">Target food cost: {targetFoodCostPct}% · Click any price to edit it</p>
      </div>

      {/* Summary cards */}
      {stats && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white border border-[#E5E7EB] rounded-card p-4">
            <p className="text-xs text-gray-500 mb-1">Avg food-cost %</p>
            <p className={clsx("text-2xl font-medium", getStatus(stats.avgFoodCost, targetFoodCostPct) === "green" ? "text-emerald-600" : getStatus(stats.avgFoodCost, targetFoodCostPct) === "amber" ? "text-amber-500" : "text-red-500")}>
              {stats.avgFoodCost.toFixed(1)}%
            </p>
            <p className="text-xs text-gray-400 mt-0.5">vs {targetFoodCostPct}% target</p>
          </div>
          <div className="bg-white border border-[#E5E7EB] rounded-card p-4">
            <p className="text-xs text-gray-500 mb-1">Dishes over target</p>
            <p className={clsx("text-2xl font-medium", stats.belowTarget > 0 ? "text-red-500" : "text-emerald-600")}>
              {stats.belowTarget}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">of {recipes.filter((r) => r.menu_price).length} priced dishes</p>
          </div>
          <div className="bg-white border border-[#E5E7EB] rounded-card p-4">
            <p className="text-xs text-gray-500 mb-1">Worst performer</p>
            <p className="text-base font-medium text-red-500 truncate">{stats.worst.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{foodCostPct(stats.worst)?.toFixed(1)}% food cost</p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {(["all", "green", "amber", "red"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={clsx(
              "px-3 py-1.5 text-xs rounded-lg border transition",
              filterStatus === s
                ? s === "all" ? "bg-gray-900 text-white border-gray-900"
                  : s === "green" ? "bg-emerald-500 text-white border-emerald-500"
                  : s === "amber" ? "bg-amber-500 text-white border-amber-500"
                  : "bg-red-500 text-white border-red-500"
                : "bg-white text-gray-600 border-[#E5E7EB] hover:bg-gray-50"
            )}
          >
            {s === "all" ? "All dishes" : s === "green" ? "On target" : s === "amber" ? "Slightly over" : "Over budget"}
          </button>
        ))}
      </div>

      {/* Table */}
      {recipes.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-12 text-center">
          <div className="text-4xl mb-3">📋</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">No dishes yet</h2>
          <p className="text-sm text-gray-500 mb-5">Create recipes first, then set their menu prices here to see your margins.</p>
          <a href="/recipes" className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition inline-block">
            Go to Recipes →
          </a>
        </div>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-gray-50">
                <SortTh label="Dish" k="name" />
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Cat.</th>
                <SortTh label="Recipe cost" k="cost" />
                <SortTh label="Menu price" k="price" />
                <SortTh label="Food cost %" k="food_cost_pct" />
                <SortTh label="Margin %" k="margin_pct" />
                <SortTh label="Gross profit" k="gross_profit" />
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Suggested price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {sorted.map((recipe) => {
                const cpp = costPerPortion(recipe);
                const fcp = foodCostPct(recipe);
                const mp = marginPct(recipe);
                const gp = grossProfit(recipe);
                const sp = suggestedPrice(recipe);
                const status = fcp !== null ? getStatus(fcp, targetFoodCostPct) : null;

                return (
                  <tr
                    key={recipe.id}
                    className={clsx(
                      "transition",
                      status === "green" ? "bg-emerald-50/40 hover:bg-emerald-50" :
                      status === "amber" ? "bg-amber-50/40 hover:bg-amber-50" :
                      status === "red" ? "bg-red-50/40 hover:bg-red-50" :
                      "hover:bg-gray-50"
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{recipe.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500">{recipe.category}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">€{cpp.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {editingPriceId === recipe.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400 text-xs">€</span>
                          <input
                            autoFocus
                            type="number"
                            min="0"
                            step="0.01"
                            value={priceInput}
                            onChange={(e) => setPriceInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") savePrice(recipe.id); if (e.key === "Escape") setEditingPriceId(null); }}
                            className="w-20 px-2 py-1 text-sm border border-emerald-400 rounded outline-none"
                          />
                          <button onClick={() => savePrice(recipe.id)} className="text-emerald-600"><Check size={14} /></button>
                          <button onClick={() => setEditingPriceId(null)} className="text-gray-400"><X size={14} /></button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditPrice(recipe)}
                          className="flex items-center gap-1 group text-gray-900 hover:text-emerald-700"
                        >
                          {recipe.menu_price ? `€${Number(recipe.menu_price).toFixed(2)}` : <span className="text-gray-400 italic text-xs">Set price…</span>}
                          <Pencil size={11} className="text-gray-300 group-hover:text-emerald-500 transition" />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {fcp !== null ? (
                        <span className={clsx("font-medium", status === "green" ? "text-emerald-600" : status === "amber" ? "text-amber-600" : "text-red-600")}>
                          {fcp.toFixed(1)}%
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {mp !== null ? (
                        <span className={clsx("font-medium", mp >= 70 ? "text-emerald-600" : mp >= 50 ? "text-amber-600" : "text-red-600")}>
                          {mp.toFixed(1)}%
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {gp !== null ? (
                        <span className={clsx("font-medium", gp > 0 ? "text-emerald-600" : "text-red-600")}>
                          €{gp.toFixed(2)}
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-blue-600 font-medium">€{sp.toFixed(2)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
