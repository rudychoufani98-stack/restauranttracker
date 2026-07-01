"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Check, Loader2, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus } from "lucide-react";
import clsx from "clsx";

type Recipe = {
  id: string;
  name: string;
  category: string;
  total_cost: number;
  yield_portions: number;
  menu_price: number | null;
};

type SimpleProduct = {
  id: string;
  name: string;
  category: string;
  pack_price: number;
  selling_price: number;
  unit: string;
};

type SalesLine = { recipe_id?: string; ingredient_id?: string; qty_sold: number };
type Period = {
  id: string;
  month: string; // "2025-06"
  notes: string | null;
  sales_lines: SalesLine[];
};

type DraftLine = { recipe_id: string; qty_sold: string };

interface Props {
  restaurantId: string;
  targetFoodCostPct: number;
  recipes: Recipe[];
  simpleProducts: SimpleProduct[];
  initialPeriods: Period[];
}

function monthLabel(month: string) {
  const [year, m] = month.split("-");
  const date = new Date(parseInt(year), parseInt(m) - 1);
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function calcPeriodStats(period: Period, recipes: Recipe[], simpleProducts: SimpleProduct[]) {
  let ca = 0, coutMatiere = 0;
  for (const line of period.sales_lines) {
    if (line.recipe_id) {
      const recipe = recipes.find((r) => r.id === line.recipe_id);
      if (!recipe || !recipe.menu_price) continue;
      const cpp = recipe.total_cost / (recipe.yield_portions || 1);
      ca += line.qty_sold * recipe.menu_price;
      coutMatiere += line.qty_sold * cpp;
    } else if (line.ingredient_id) {
      const prod = simpleProducts.find((p) => p.id === line.ingredient_id);
      if (!prod) continue;
      ca += line.qty_sold * prod.selling_price;
      coutMatiere += line.qty_sold * prod.pack_price;
    }
  }
  const margeB = ca - coutMatiere;
  const foodCostPct = ca > 0 ? (coutMatiere / ca) * 100 : null;
  const totalCouverts = period.sales_lines.reduce((s, l) => s + l.qty_sold, 0);
  return { ca, coutMatiere, margeB, foodCostPct, totalCouverts };
}

export default function RentabiliteClient({ restaurantId, targetFoodCostPct, recipes, simpleProducts, initialPeriods }: Props) {
  const supabase = createClient();
  const [periods, setPeriods] = useState<Period[]>(initialPeriods);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const currentMonth = new Date().toISOString().slice(0, 7); // "2025-06"
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [notes, setNotes] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([
    ...recipes.map((r) => ({ recipe_id: r.id, qty_sold: "" })),
    ...simpleProducts.map((p) => ({ recipe_id: `__sp__${p.id}`, qty_sold: "" })),
  ]);

  const [saleSearch, setSaleSearch] = useState("");
  const [saleCat, setSaleCat] = useState("all");

  function updateQty(recipeId: string, val: string) {
    setDraftLines((p) => p.map((l) => l.recipe_id === recipeId ? { ...l, qty_sold: val } : l));
  }
  function qtyOf(key: string) { return parseFloat(draftLines.find((l) => l.recipe_id === key)?.qty_sold || "0") || 0; }
  function inc(key: string, step = 1) { updateQty(key, String(Math.max(0, qtyOf(key) + step))); }

  // Unified sellable items (recipes + resale products) like the caisse
  const saleItems = useMemo(() => {
    const fromR = recipes
      .filter((r) => r.menu_price && r.menu_price > 0)
      .map((r) => ({ key: r.id, name: r.name, category: r.category || "Autre", price: Number(r.menu_price), cost: r.total_cost / (r.yield_portions || 1), resale: false }));
    const fromP = simpleProducts
      .filter((p) => p.selling_price && p.selling_price > 0)
      .map((p) => ({ key: `__sp__${p.id}`, name: p.name, category: p.category || "Autre", price: Number(p.selling_price), cost: Number(p.pack_price || 0), resale: true }));
    return [...fromR, ...fromP];
  }, [recipes, simpleProducts]);

  const saleCategories = useMemo(() => Array.from(new Set(saleItems.map((i) => i.category))).sort(), [saleItems]);
  const filteredSaleItems = useMemo(() => {
    const q = saleSearch.trim().toLowerCase();
    return saleItems.filter((i) => (saleCat === "all" || i.category === saleCat) && (!q || i.name.toLowerCase().includes(q)));
  }, [saleItems, saleSearch, saleCat]);
  const groupedSaleItems = useMemo(() => {
    const map = new Map<string, typeof saleItems>();
    for (const it of filteredSaleItems) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cat, items]) => ({ cat, items: items.sort((x, y) => x.name.localeCompare(y.name)) }));
  }, [filteredSaleItems]);

  // Live preview of totals while filling the form
  const preview = useMemo(() => {
    let ca = 0, cout = 0, couverts = 0;
    for (const dl of draftLines) {
      const qty = parseFloat(dl.qty_sold) || 0;
      if (qty === 0) continue;
      if (dl.recipe_id.startsWith("__sp__")) {
        const prodId = dl.recipe_id.replace("__sp__", "");
        const prod = simpleProducts.find((p) => p.id === prodId);
        if (!prod) continue;
        ca += qty * prod.selling_price;
        cout += qty * prod.pack_price;
        couverts += qty;
      } else {
        const recipe = recipes.find((r) => r.id === dl.recipe_id);
        if (!recipe || !recipe.menu_price) continue;
        const cpp = recipe.total_cost / (recipe.yield_portions || 1);
        ca += qty * recipe.menu_price;
        cout += qty * cpp;
        couverts += qty;
      }
    }
    return { ca, cout, margeB: ca - cout, foodCostPct: ca > 0 ? (cout / ca) * 100 : null, couverts };
  }, [draftLines, recipes, simpleProducts]);

  function openForm() {
    setSelectedMonth(currentMonth);
    setNotes("");
    setDraftLines([
      ...recipes.map((r) => ({ recipe_id: r.id, qty_sold: "" })),
      ...simpleProducts.map((p) => ({ recipe_id: `__sp__${p.id}`, qty_sold: "" })),
    ]);
    setError(null);
    setShowForm(true);
  }

  async function handleSave() {
    const hasData = draftLines.some((l) => parseFloat(l.qty_sold) > 0);
    if (!hasData) return setError("Saisissez au moins une quantité vendue.");
    setSaving(true);
    setError(null);

    // Check if period already exists for this month
    const existing = periods.find((p) => p.month === selectedMonth);

    let periodId: string;

    if (existing) {
      // Update: delete old lines, insert new ones
      periodId = existing.id;
      await supabase.from("sales_periods").update({ notes: notes || null }).eq("id", periodId);
      await supabase.from("sales_lines").delete().eq("period_id", periodId);
    } else {
      const { data: period, error: pErr } = await supabase
        .from("sales_periods")
        .insert({ restaurant_id: restaurantId, month: selectedMonth, notes: notes || null })
        .select()
        .single();
      if (pErr) { setError(pErr.message); setSaving(false); return; }
      periodId = period.id;
    }

    // Insert sales lines (only non-zero)
    const linesToInsert = draftLines
      .filter((l) => parseFloat(l.qty_sold) > 0)
      .map((l) => {
        if (l.recipe_id.startsWith("__sp__")) {
          return { period_id: periodId, ingredient_id: l.recipe_id.replace("__sp__", ""), recipe_id: null, qty_sold: parseFloat(l.qty_sold) };
        }
        return { period_id: periodId, recipe_id: l.recipe_id, ingredient_id: null, qty_sold: parseFloat(l.qty_sold) };
      });

    const { error: lErr } = await supabase.from("sales_lines").insert(linesToInsert);
    if (lErr) { setError(lErr.message); setSaving(false); return; }

    // Trigger stock deductions for sold items
    await fetch("/api/record-sale-movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantId,
        periodId,
        salesLines: linesToInsert.map((l) => ({
          recipe_id: l.recipe_id ?? undefined,
          ingredient_id: l.ingredient_id ?? undefined,
          qty_sold: l.qty_sold,
        })),
      }),
    });

    // Rebuild period object for local state
    const newPeriod: Period = {
      id: periodId,
      month: selectedMonth,
      notes: notes || null,
      sales_lines: linesToInsert.map((l) => ({ recipe_id: l.recipe_id ?? undefined, ingredient_id: l.ingredient_id ?? undefined, qty_sold: l.qty_sold })),
    };

    setPeriods((p) => {
      const filtered = p.filter((x) => x.id !== periodId);
      return [newPeriod, ...filtered].sort((a, b) => b.month.localeCompare(a.month));
    });

    setSaving(false);
    setShowForm(false);
  }

  // Trend arrow between last two periods
  const trend = useMemo(() => {
    if (periods.length < 2) return null;
    const s0 = calcPeriodStats(periods[0], recipes, simpleProducts);
    const s1 = calcPeriodStats(periods[1], recipes, simpleProducts);
    if (s1.margeB === 0) return null;
    return ((s0.margeB - s1.margeB) / Math.abs(s1.margeB)) * 100;
  }, [periods, recipes]);

  const pricedRecipes = recipes.filter((r) => r.menu_price && r.menu_price > 0);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-6 pb-5 border-b border-gray-200">
        <div>
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Analyse</p>
          <h1 className="text-2xl font-bold text-gray-900">Rentabilité</h1>
          <p className="text-sm text-gray-500 mt-1">Saisissez vos ventes mensuelles pour calculer vos marges réelles</p>
        </div>
        <button
          onClick={openForm}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition shadow-sm"
        >
          <Plus size={15} /> Saisir un mois
        </button>
      </div>

      {pricedRecipes.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700 mb-5">
          Aucune recette n&apos;a de prix de vente. Définissez les prix dans la page <a href="/menu" className="underline font-medium">Menu</a> d&apos;abord.
        </div>
      )}

      {/* Sales entry form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-card border border-[#E5E7EB] w-full max-w-5xl shadow-xl my-8">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-base font-medium text-gray-900">Saisie des ventes</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="p-5 space-y-4">
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Mois</label>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optionnel)</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="ex. Juillet — haute saison"
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 transition"
                  />
                </div>
              </div>

              {/* Caisse-like interactive tiles */}
              <div>
                <p className="text-xs text-gray-500 mb-2">Cliquez sur un plat pour ajouter <span className="font-medium">+1 vente</span>. Utilisez − / + ou le champ pour ajuster.</p>

                {/* Search + category filter */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <input
                    type="text"
                    value={saleSearch}
                    onChange={(e) => setSaleSearch(e.target.value)}
                    placeholder="Rechercher un plat…"
                    className="flex-1 min-w-[180px] px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 transition"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setSaleCat("all")}
                      className={clsx("px-3 py-1.5 text-xs rounded-full border transition", saleCat === "all" ? "bg-emerald-500 text-white border-emerald-500" : "bg-white text-gray-600 border-[#E5E7EB] hover:bg-gray-50")}>
                      Tout
                    </button>
                    {saleCategories.map((cat) => (
                      <button key={cat} onClick={() => setSaleCat(cat)}
                        className={clsx("px-3 py-1.5 text-xs rounded-full border transition", saleCat === cat ? "bg-emerald-500 text-white border-emerald-500" : "bg-white text-gray-600 border-[#E5E7EB] hover:bg-gray-50")}>
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tile grid grouped by category */}
                <div className="max-h-[26rem] overflow-y-auto pr-1 space-y-4">
                  {groupedSaleItems.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">Aucun plat ne correspond.</p>
                  )}
                  {groupedSaleItems.map(({ cat, items }) => (
                    <div key={cat}>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{cat}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                        {items.map((it) => {
                          const qty = qtyOf(it.key);
                          const active = qty > 0;
                          const marginPct = it.price > 0 ? ((it.price - it.cost) / it.price) * 100 : 0;
                          return (
                            <div
                              key={it.key}
                              onClick={() => inc(it.key, 1)}
                              className={clsx(
                                "relative cursor-pointer select-none rounded-xl border p-3 transition text-left",
                                active
                                  ? (it.resale ? "border-blue-400 bg-blue-50 ring-1 ring-blue-300" : "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300")
                                  : "border-[#E5E7EB] bg-white hover:border-gray-300 hover:shadow-sm"
                              )}
                            >
                              {active && (
                                <span className={clsx("absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1 flex items-center justify-center rounded-full text-xs font-bold text-white shadow", it.resale ? "bg-blue-500" : "bg-emerald-500")}>
                                  {qty}
                                </span>
                              )}
                              <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">{it.name}</p>
                              <div className="mt-1.5 flex items-center justify-between">
                                <span className="text-sm font-semibold text-gray-800">€{it.price.toFixed(2)}</span>
                                <span className={clsx("text-2xs font-medium", marginPct >= 60 ? "text-emerald-600" : marginPct >= 30 ? "text-amber-600" : "text-red-500")}>
                                  {marginPct.toFixed(0)}% marge
                                </span>
                              </div>
                              {/* Steppers */}
                              <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => inc(it.key, -1)} disabled={qty <= 0}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#E5E7EB] text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition text-base leading-none">−</button>
                                <input type="number" min="0" step="1" value={draftLines.find((l) => l.recipe_id === it.key)?.qty_sold ?? ""}
                                  onChange={(e) => updateQty(it.key, e.target.value)} placeholder="0"
                                  className="flex-1 w-full px-2 py-1 text-sm text-center border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 transition" />
                                <button onClick={() => inc(it.key, 1)}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#E5E7EB] text-gray-600 hover:bg-gray-50 transition text-base leading-none">+</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Live preview */}
              {preview.couverts > 0 && (
                <div className="grid grid-cols-4 gap-3 p-4 bg-gray-50 border border-[#E5E7EB] rounded-lg">
                  <div>
                    <p className="text-xs text-gray-500">Couverts</p>
                    <p className="text-lg font-semibold text-gray-900">{preview.couverts}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">CA total</p>
                    <p className="text-lg font-semibold text-gray-900">€{preview.ca.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Coût matière</p>
                    <p className="text-lg font-semibold text-red-500">€{preview.cout.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Marge brute</p>
                    <p className={clsx("text-lg font-semibold", preview.margeB >= 0 ? "text-emerald-600" : "text-red-500")}>
                      €{preview.margeB.toFixed(2)}
                    </p>
                    {preview.foodCostPct !== null && (
                      <p className={clsx("text-xs mt-0.5", preview.foodCostPct <= targetFoodCostPct ? "text-emerald-500" : "text-red-500")}>
                        Food cost {preview.foodCostPct.toFixed(1)}% (obj. {targetFoodCostPct}%)
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-[#E5E7EB]">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition">Annuler</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition flex items-center justify-center gap-2">
                {saving ? <><Loader2 size={14} className="animate-spin" /> Enregistrement…</> : <><Check size={14} /> Enregistrer</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      {periods.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-12 text-center">
          <div className="text-4xl mb-3">📊</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">Aucune donnée de vente</h2>
          <p className="text-sm text-gray-500 mb-5">Saisissez vos ventes du mois pour calculer votre rentabilité réelle.</p>
          <button onClick={openForm} className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition">
            Saisir le premier mois
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Trend banner if 2+ months */}
          {trend !== null && (
            <div className={clsx(
              "flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium",
              trend > 0 ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
              trend < 0 ? "bg-red-50 border-red-200 text-red-700" :
              "bg-gray-50 border-gray-200 text-gray-600"
            )}>
              {trend > 0 ? <TrendingUp size={16} /> : trend < 0 ? <TrendingDown size={16} /> : <Minus size={16} />}
              Marge brute {trend > 0 ? "en hausse" : trend < 0 ? "en baisse" : "stable"} de {Math.abs(trend).toFixed(1)}% vs le mois précédent
            </div>
          )}

          {periods.map((period) => {
            const stats = calcPeriodStats(period, recipes, simpleProducts);
            const isExpanded = expandedId === period.id;
            const fcStatus = stats.foodCostPct === null ? null :
              stats.foodCostPct <= targetFoodCostPct ? "green" :
              stats.foodCostPct <= targetFoodCostPct * 1.2 ? "amber" : "red";
            const fcBarColor = fcStatus === "green" ? "bg-emerald-400" : fcStatus === "amber" ? "bg-amber-400" : fcStatus === "red" ? "bg-red-400" : "bg-gray-200";

            return (
              <div key={period.id} className="bg-white border border-gray-200 rounded-card shadow-card overflow-hidden">
                {/* Color bar top */}
                <div className={`h-1 w-full ${fcBarColor}`} />
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50/70 transition"
                  onClick={() => setExpandedId(isExpanded ? null : period.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900 capitalize text-base">{monthLabel(period.month)}</span>
                      {period.notes && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">· {period.notes}</span>}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{stats.totalCouverts} couvert{stats.totalCouverts !== 1 ? "s" : ""}</p>
                  </div>

                  {/* Mini stats */}
                  <div className="hidden md:flex items-center gap-5 text-sm">
                    <div className="text-right">
                      <p className="text-2xs text-gray-400 uppercase tracking-wide font-medium">CA</p>
                      <p className="font-bold text-gray-900">€{stats.ca.toFixed(0)}</p>
                    </div>
                    <div className="w-px h-8 bg-gray-100" />
                    <div className="text-right">
                      <p className="text-2xs text-gray-400 uppercase tracking-wide font-medium">Coût</p>
                      <p className="font-semibold text-red-500">€{stats.coutMatiere.toFixed(0)}</p>
                    </div>
                    <div className="w-px h-8 bg-gray-100" />
                    <div className="text-right">
                      <p className="text-2xs text-gray-400 uppercase tracking-wide font-medium">Marge</p>
                      <p className={clsx("font-bold", stats.margeB >= 0 ? "text-emerald-600" : "text-red-500")}>
                        €{stats.margeB.toFixed(0)}
                      </p>
                    </div>
                    {stats.foodCostPct !== null && (
                      <>
                        <div className="w-px h-8 bg-gray-100" />
                        <div className="text-right">
                          <p className="text-2xs text-gray-400 uppercase tracking-wide font-medium mb-1">Food cost</p>
                          <span className={clsx(
                            "inline-block px-2 py-0.5 rounded-full text-xs font-bold",
                            fcStatus === "green" ? "bg-emerald-100 text-emerald-700" :
                            fcStatus === "amber" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                          )}>
                            {stats.foodCostPct.toFixed(1)}%
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {isExpanded ? <ChevronUp size={16} className="text-gray-400 ml-2" /> : <ChevronDown size={16} className="text-gray-400 ml-2" />}
                </div>

                {isExpanded && (
                  <div className="border-t border-[#E5E7EB] px-5 py-4">
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      {[
                        { label: "Couverts", value: stats.totalCouverts.toString(), color: "text-gray-900" },
                        { label: "Chiffre d'affaires", value: `€${stats.ca.toFixed(2)}`, color: "text-gray-900" },
                        { label: "Coût matière", value: `€${stats.coutMatiere.toFixed(2)}`, color: "text-red-500" },
                        { label: "Marge brute", value: `€${stats.margeB.toFixed(2)}`, color: stats.margeB >= 0 ? "text-emerald-600" : "text-red-500" },
                      ].map((s) => (
                        <div key={s.label} className="bg-gray-50 rounded-lg p-3">
                          <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                          <p className={clsx("text-lg font-semibold", s.color)}>{s.value}</p>
                        </div>
                      ))}
                    </div>

                    {stats.foodCostPct !== null && (
                      <div className="mb-4 px-4 py-3 rounded-lg border flex items-center justify-between"
                        style={{
                          backgroundColor: fcStatus === "green" ? "#f0fdf4" : fcStatus === "amber" ? "#fffbeb" : "#fef2f2",
                          borderColor: fcStatus === "green" ? "#bbf7d0" : fcStatus === "amber" ? "#fde68a" : "#fecaca",
                        }}>
                        <span className="text-sm font-medium text-gray-700">Food cost global ce mois</span>
                        <span className={clsx("text-lg font-bold",
                          fcStatus === "green" ? "text-emerald-600" :
                          fcStatus === "amber" ? "text-amber-500" : "text-red-500"
                        )}>
                          {stats.foodCostPct.toFixed(1)}% <span className="text-sm font-normal text-gray-400">/ objectif {targetFoodCostPct}%</span>
                        </span>
                      </div>
                    )}

                    {/* Detail per dish */}
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 uppercase">
                          <th className="text-left pb-2">Plat</th>
                          <th className="text-right pb-2">Qté</th>
                          <th className="text-right pb-2">Prix</th>
                          <th className="text-right pb-2">CA</th>
                          <th className="text-right pb-2">Coût matière</th>
                          <th className="text-right pb-2">Marge</th>
                          <th className="text-right pb-2">Food cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F3F4F6]">
                        {period.sales_lines
                          .filter((l) => l.qty_sold > 0)
                          .map((line) => {
                            const recipe = recipes.find((r) => r.id === line.recipe_id);
                            if (!recipe || !recipe.menu_price) return null;
                            const cpp = recipe.total_cost / (recipe.yield_portions || 1);
                            const lineCA = line.qty_sold * recipe.menu_price;
                            const lineCout = line.qty_sold * cpp;
                            const lineMarge = lineCA - lineCout;
                            const lineFCP = (lineCout / lineCA) * 100;
                            return (
                              <tr key={line.recipe_id}>
                                <td className="py-1.5 text-gray-700 font-medium">{recipe.name}</td>
                                <td className="text-right text-gray-500">{line.qty_sold}</td>
                                <td className="text-right text-gray-500">€{Number(recipe.menu_price).toFixed(2)}</td>
                                <td className="text-right text-gray-900">€{lineCA.toFixed(2)}</td>
                                <td className="text-right text-red-500">€{lineCout.toFixed(2)}</td>
                                <td className="text-right font-medium text-emerald-600">€{lineMarge.toFixed(2)}</td>
                                <td className="text-right">
                                  <span className={clsx("text-xs font-medium",
                                    lineFCP <= targetFoodCostPct ? "text-emerald-600" :
                                    lineFCP <= targetFoodCostPct * 1.2 ? "text-amber-500" : "text-red-500"
                                  )}>
                                    {lineFCP.toFixed(1)}%
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-gray-200 font-semibold">
                          <td className="pt-2 text-gray-900">Total</td>
                          <td className="text-right pt-2 text-gray-700">{stats.totalCouverts}</td>
                          <td />
                          <td className="text-right pt-2 text-gray-900">€{stats.ca.toFixed(2)}</td>
                          <td className="text-right pt-2 text-red-500">€{stats.coutMatiere.toFixed(2)}</td>
                          <td className="text-right pt-2 text-emerald-600">€{stats.margeB.toFixed(2)}</td>
                          <td className="text-right pt-2">
                            {stats.foodCostPct !== null && (
                              <span className={clsx("text-sm",
                                fcStatus === "green" ? "text-emerald-600" :
                                fcStatus === "amber" ? "text-amber-500" : "text-red-500"
                              )}>
                                {stats.foodCostPct.toFixed(1)}%
                              </span>
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
