"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Plus, Trash2, X, ChevronDown, ChevronUp, RefreshCw, Copy } from "lucide-react";
import clsx from "clsx";


type Ingredient = { id: string; name: string; cost_per_base_unit: number; unit: string; yield_pct?: number | null };
type RecipeLine = {
  id?: string;
  ingredient_id: string | null;
  sub_recipe_id: string | null;
  quantity: number;
  unit: string;
  ingredients?: { name: string; cost_per_base_unit: number; unit: string } | null;
  sub_recipe?: { name: string; total_cost: number; yield_portions: number } | null;
};
type Recipe = {
  id: string;
  name: string;
  category: string;
  yield_portions: number;
  yield_unit: string;
  total_cost: number;
  menu_price: number | null;
  is_prep: boolean;
  allergens?: string[];
  recipe_lines: RecipeLine[];
};

type DraftLine = {
  type: "ingredient" | "sub_recipe";
  ingredient_id: string;
  sub_recipe_id: string;
  quantity: string;
  unit: string;
};

// Yield units a recipe / MEP can be conditioned in.
const YIELD_UNITS: { value: string; label: string }[] = [
  { value: "portion", label: "portion(s)" },
  { value: "kg", label: "kg" },
  { value: "g", label: "g" },
  { value: "l", label: "L" },
  { value: "ml", label: "ml" },
  { value: "piece", label: "pièce(s)" },
];

// Convert a quantity in kg/l to base units (g/ml); rest unchanged.
const toBase = (qty: number, unit: string): number =>
  unit === "kg" || unit === "l" ? qty * 1000 : qty;

// Total a recipe yields, in base units.
const yieldInBase = (r: Recipe): number => toBase(r.yield_portions || 1, r.yield_unit || "portion");

// Which line units make sense when consuming a sub-recipe, given its yield unit.
function unitsForSubRecipe(yieldUnit: string): string[] {
  switch (yieldUnit) {
    case "kg": case "g": return ["g", "kg"];
    case "l": case "ml": return ["ml", "l"];
    case "piece": return ["piece"];
    default: return ["portion"];
  }
}

const EMPTY_LINE: DraftLine = { type: "ingredient", ingredient_id: "", sub_recipe_id: "", quantity: "", unit: "g" };

function calcLineCost(line: DraftLine, ingredients: Ingredient[], allRecipes: Recipe[]): number {
  const qty = parseFloat(line.quantity);
  if (!qty) return 0;
  if (line.type === "ingredient") {
    const ing = ingredients.find((i) => i.id === line.ingredient_id);
    if (!ing) return 0;
    // Convert qty to base unit
    let baseQty = qty;
    if (line.unit === "kg" && (ing.unit === "g" || ing.unit === "kg")) baseQty = qty * 1000;
    if (line.unit === "l" && (ing.unit === "ml" || ing.unit === "l")) baseQty = qty * 1000;
    // qty is NET; real gross drawn = net / yield → cost follows gross
    const y = Number(ing.yield_pct ?? 100);
    const yf = y > 0 ? y / 100 : 1;
    return ing.cost_per_base_unit * (baseQty / yf);
  } else {
    const rec = allRecipes.find((r) => r.id === line.sub_recipe_id);
    if (!rec) return 0;
    // Fraction of the sub-recipe batch consumed: e.g. 100 g out of a 2 kg batch.
    const fraction = toBase(qty, line.unit) / yieldInBase(rec);
    return rec.total_cost * fraction;
  }
}

interface Props {
  restaurantId: string;
  initialRecipes: Recipe[];
  ingredients: Ingredient[];
  allRecipes: Recipe[];
  menuCategories: string[];
  prepCategories: string[];
}

export default function RecipesClient({ restaurantId, initialRecipes, ingredients, allRecipes: allRecipesProp, menuCategories, prepCategories }: Props) {
  const supabase = createClient();
  const [recipes, setRecipes] = useState<Recipe[]>(initialRecipes);
  const [allRecipes, setAllRecipes] = useState<Recipe[]>(allRecipesProp);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [recalcing, setRecalcing] = useState(false);
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);

  const [tab, setTab] = useState<"recipe" | "prep">("recipe");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Plat");
  const [isPrep, setIsPrep] = useState(false);
  const [yieldPortions, setYieldPortions] = useState("1");
  const [yieldUnit, setYieldUnit] = useState("portion");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  // Split recipes by type
  const menuRecipes = useMemo(() => recipes.filter((r) => !r.is_prep), [recipes]);
  const prepRecipes = useMemo(() => recipes.filter((r) => r.is_prep), [recipes]);
  const visibleRecipes = tab === "recipe" ? menuRecipes : prepRecipes;

  const totalCost = useMemo(() =>
    lines.reduce((sum, l) => sum + calcLineCost(l, ingredients, allRecipes), 0),
    [lines, ingredients, allRecipes]
  );
  const costPerPortion = totalCost / (parseFloat(yieldPortions) || 1);

  function openAdd() {
    setEditingId(null);
    const prep = tab === "prep";
    setIsPrep(prep);
    setName("");
    setCategory((prep ? prepCategories : menuCategories)[0] ?? "");
    setYieldPortions("1");
    setYieldUnit(prep ? "kg" : "portion");
    setLines([{ ...EMPTY_LINE }]);
    setError(null);
    setShowForm(true);
  }

  function openEdit(recipe: Recipe) {
    setEditingId(recipe.id);
    setName(recipe.name);
    setIsPrep(recipe.is_prep);
    setCategory(recipe.category);
    setYieldPortions(String(recipe.yield_portions));
    setYieldUnit(recipe.yield_unit || "portion");
    setLines(
      recipe.recipe_lines.length > 0
        ? recipe.recipe_lines.map((l) => ({
            type: l.ingredient_id ? "ingredient" : "sub_recipe" as "ingredient" | "sub_recipe",
            ingredient_id: l.ingredient_id ?? "",
            sub_recipe_id: l.sub_recipe_id ?? "",
            quantity: String(l.quantity),
            unit: l.unit,
          }))
        : [{ ...EMPTY_LINE }]
    );
    setError(null);
    setShowForm(true);
  }

  function updateLine(idx: number, field: keyof DraftLine, value: string) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "type") {
        next[idx].ingredient_id = "";
        next[idx].sub_recipe_id = "";
        next[idx].unit = value === "ingredient" ? "g" : "portion";
      }
      if (field === "ingredient_id") {
        const ing = ingredients.find((i) => i.id === value);
        if (ing) next[idx].unit = ing.unit === "kg" ? "g" : ing.unit === "l" ? "ml" : ing.unit;
      }
      if (field === "sub_recipe_id") {
        const sub = allRecipes.find((r) => r.id === value);
        next[idx].unit = unitsForSubRecipe(sub?.yield_unit || "portion")[0];
      }
      return next;
    });
  }

  function addLine() { setLines((p) => [...p, { ...EMPTY_LINE }]); }
  function removeLine(idx: number) { setLines((p) => p.filter((_, i) => i !== idx)); }

  async function handleSave() {
    setError(null);
    if (!name.trim()) return setError("Le nom de la recette est requis.");
    const yp = parseFloat(yieldPortions);
    if (isNaN(yp) || yp <= 0) return setError("Le nombre de portions doit être supérieur à 0.");
    const validLines = lines.filter((l) => l.ingredient_id || l.sub_recipe_id);
    if (validLines.length === 0) return setError("Ajoutez au moins un ingrédient ou une sous-recette.");

    setSaving(true);
    const recipePayload = {
      restaurant_id: restaurantId,
      name: name.trim(),
      category,
      is_prep: isPrep,
      yield_portions: yp,
      yield_unit: yieldUnit,
      total_cost: totalCost,
    };

    let recipeId = editingId;

    if (editingId) {
      const { error: err } = await supabase.from("recipes").update(recipePayload).eq("id", editingId);
      if (err) { setError(err.message); setSaving(false); return; }
      // Delete old lines
      await supabase.from("recipe_lines").delete().eq("recipe_id", editingId);
    } else {
      const { data, error: err } = await supabase.from("recipes").insert(recipePayload).select().single();
      if (err) { setError(err.message); setSaving(false); return; }
      recipeId = data.id;
    }

    // Insert new lines
    const linePayload = validLines.map((l) => ({
      recipe_id: recipeId,
      ingredient_id: l.type === "ingredient" ? l.ingredient_id : null,
      sub_recipe_id: l.type === "sub_recipe" ? l.sub_recipe_id : null,
      quantity: parseFloat(l.quantity),
      unit: l.unit,
    }));
    const { error: lineErr } = await supabase.from("recipe_lines").insert(linePayload);
    if (lineErr) { setError(lineErr.message); setSaving(false); return; }

    // Build local recipe object to update UI immediately (no reload needed)
    const builtLines = validLines.map((l) => {
      const ing = ingredients.find((i) => i.id === l.ingredient_id);
      return {
        ingredient_id: l.ingredient_id || null,
        sub_recipe_id: l.sub_recipe_id || null,
        quantity: parseFloat(l.quantity),
        unit: l.unit,
        ingredients: ing ? { name: ing.name, cost_per_base_unit: ing.cost_per_base_unit, unit: ing.unit } : null,
        sub_recipe: null,
      };
    });

    const builtRecipe: Recipe = {
      id: recipeId!,
      name: name.trim(),
      category,
      is_prep: isPrep,
      yield_portions: yp,
      yield_unit: yieldUnit,
      total_cost: totalCost,
      menu_price: editingId ? (recipes.find((r) => r.id === editingId)?.menu_price ?? null) : null,
      allergens: editingId ? (recipes.find((r) => r.id === editingId)?.allergens ?? []) : [],
      recipe_lines: builtLines,
    };

    if (editingId) {
      setRecipes((p) => p.map((r) => r.id === editingId ? builtRecipe : r));
      setAllRecipes((p) => p.map((r) => r.id === editingId ? builtRecipe : r));
    } else {
      setRecipes((p) => [...p, builtRecipe].sort((a, b) => a.name.localeCompare(b.name)));
      setAllRecipes((p) => [...p, builtRecipe].sort((a, b) => a.name.localeCompare(b.name)));
    }

    setSaving(false);
    setShowForm(false);

    // Recompute authoritative costs server-side (uses CMUP, flattens sub-recipes)
    fetch("/api/recalculate-recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId }),
    }).catch(() => {});
  }

  async function handleRecalcAll() {
    setRecalcing(true);
    setRecalcMsg(null);
    try {
      const res = await fetch("/api/recalculate-recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId }),
      });
      if (!res.ok) throw new Error();
      setRecalcMsg("Coûts et allergènes recalculés. Recharge la page pour voir les valeurs à jour.");
    } catch {
      setRecalcMsg("Échec du recalcul. Réessaie.");
    }
    setRecalcing(false);
  }

  async function handleDuplicate(recipe: Recipe) {
    setDuplicatingId(recipe.id);
    // 1) Insert the copied recipe
    const { data: created, error: err } = await supabase
      .from("recipes")
      .insert({
        restaurant_id: restaurantId,
        name: `${recipe.name} (copie)`,
        category: recipe.category,
        is_prep: recipe.is_prep,
        yield_portions: recipe.yield_portions,
        yield_unit: recipe.yield_unit,
        total_cost: recipe.total_cost,
        menu_price: null,
      })
      .select()
      .single();
    if (err || !created) { setDuplicatingId(null); return; }

    // 2) Copy the lines
    const linePayload = recipe.recipe_lines
      .filter((l) => l.ingredient_id || l.sub_recipe_id)
      .map((l) => ({
        recipe_id: created.id,
        ingredient_id: l.ingredient_id ?? null,
        sub_recipe_id: l.sub_recipe_id ?? null,
        quantity: l.quantity,
        unit: l.unit,
      }));
    if (linePayload.length > 0) {
      await supabase.from("recipe_lines").insert(linePayload);
    }

    // 3) Update local state
    const builtRecipe: Recipe = {
      ...recipe,
      id: created.id,
      name: `${recipe.name} (copie)`,
      menu_price: null,
      allergens: recipe.allergens ?? [],
    };
    setRecipes((p) => [...p, builtRecipe].sort((a, b) => a.name.localeCompare(b.name)));
    setAllRecipes((p) => [...p, builtRecipe].sort((a, b) => a.name.localeCompare(b.name)));
    setDuplicatingId(null);

    // 4) Open it for editing right away
    openEdit(builtRecipe);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await supabase.from("recipes").delete().eq("id", id);
    setRecipes((p) => p.filter((r) => r.id !== id));
    setAllRecipes((p) => p.filter((r) => r.id !== id));
    setDeletingId(null);
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-5 pb-5 border-b border-gray-200">
        <div>
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Catalogue</p>
          <h1 className="text-2xl font-bold text-gray-900">Recettes</h1>
          <p className="text-sm text-gray-500 mt-1">
            {menuRecipes.length} fiche{menuRecipes.length !== 1 ? "s" : ""} technique{menuRecipes.length !== 1 ? "s" : ""} · {prepRecipes.length} mise{prepRecipes.length !== 1 ? "s" : ""} en place
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRecalcAll}
            disabled={recalcing}
            title="Recalcule les coûts et allergènes de toutes les recettes"
            className="flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition shadow-sm disabled:opacity-50"
          >
            <RefreshCw size={14} className={clsx("text-gray-400", recalcing && "animate-spin")} />
            {recalcing ? "Recalcul…" : "Tout recalculer"}
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition shadow-sm"
          >
            <Plus size={15} />
            {tab === "prep" ? "Nouvelle mise en place" : "Nouvelle recette"}
          </button>
        </div>
      </div>

      {recalcMsg && (
        <div className="mb-5 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          {recalcMsg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-gray-100 rounded-lg w-fit">
        {([
          { key: "recipe" as const, label: "Fiches techniques", count: menuRecipes.length },
          { key: "prep" as const, label: "Mises en place", count: prepRecipes.length },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "px-4 py-2 text-sm font-medium rounded-md transition",
              tab === t.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            {t.label} <span className={clsx("ml-1 text-xs", tab === t.key ? "text-emerald-600" : "text-gray-400")}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Recipe form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-card border border-[#E5E7EB] w-full max-w-2xl shadow-xl my-8">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-base font-medium text-gray-900">{editingId ? "Modifier la recette" : "Nouvelle recette"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-5">
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nom de la recette</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Velouté de tomates"
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Catégorie</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                    {Array.from(new Set([...(isPrep ? prepCategories : menuCategories), category].filter(Boolean))).map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Rendement / conditionnement</label>
                  <div className="flex gap-2">
                    <input type="number" min="0" step="any" value={yieldPortions} onChange={(e) => setYieldPortions(e.target.value)}
                      className="w-28 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
                    <select value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)}
                      className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                      {YIELD_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {isPrep
                      ? "Quantité totale produite par cette mise en place (ex. 2 kg de sauce). Les fiches techniques en consommeront une fraction."
                      : "Combien cette recette produit (généralement en portions pour un plat vendu)."}
                  </p>
                </div>
              </div>

              {/* Type toggle */}
              <label className="flex items-start gap-3 px-4 py-3 rounded-lg border border-[#E5E7EB] bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPrep}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setIsPrep(v);
                    setCategory((v ? prepCategories : menuCategories)[0] ?? "");
                  }}
                  className="mt-0.5 w-4 h-4 accent-emerald-600"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-800">Mise en place (sous-recette)</span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Préparation de base (sauce, fond, pâte…) qui alimente d'autres fiches techniques. N'apparaît pas au menu.
                  </span>
                </span>
              </label>

              {/* Ingredient lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Ingrédients et sous-recettes</label>
                  <button onClick={addLine} className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
                    <Plus size={12} /> Ajouter une ligne
                  </button>
                </div>

                <div className="space-y-2">
                  {lines.map((line, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <select value={line.type} onChange={(e) => updateLine(idx, "type", e.target.value)}
                        className="px-2 py-2 text-xs border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                        <option value="ingredient">Ingrédient</option>
                        <option value="sub_recipe">Sous-recette</option>
                      </select>

                      {line.type === "ingredient" ? (
                        <select value={line.ingredient_id} onChange={(e) => updateLine(idx, "ingredient_id", e.target.value)}
                          className="flex-1 px-2 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                          <option value="">Choisir un ingrédient…</option>
                          {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </select>
                      ) : (
                        <select value={line.sub_recipe_id} onChange={(e) => updateLine(idx, "sub_recipe_id", e.target.value)}
                          className="flex-1 px-2 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                          <option value="">Choisir une recette…</option>
                          {allRecipes.filter((r) => r.id !== editingId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      )}

                      <input type="number" min="0" step="any" value={line.quantity}
                        onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                        placeholder="Qty"
                        className="w-20 px-2 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />

                      {line.type === "ingredient" ? (
                        <select value={line.unit} onChange={(e) => updateLine(idx, "unit", e.target.value)}
                          className="w-16 px-2 py-2 text-xs border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                          {["g","kg","ml","l","unit"].map((u) => <option key={u}>{u}</option>)}
                        </select>
                      ) : (() => {
                        const sub = allRecipes.find((r) => r.id === line.sub_recipe_id);
                        const opts = unitsForSubRecipe(sub?.yield_unit || "portion");
                        return (
                          <select value={line.unit} onChange={(e) => updateLine(idx, "unit", e.target.value)}
                            disabled={!sub}
                            className="w-16 px-2 py-2 text-xs border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition disabled:bg-gray-50 disabled:text-gray-400">
                            {opts.map((u) => <option key={u} value={u}>{u === "portion" ? "port." : u}</option>)}
                          </select>
                        );
                      })()}

                      <div className="w-16 text-right text-xs text-gray-500 pt-2.5">
                        €{calcLineCost(line, ingredients, allRecipes).toFixed(3)}
                      </div>

                      <button onClick={() => removeLine(idx)} className="pt-2 text-gray-300 hover:text-red-400 transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cost summary */}
              <div className="bg-gray-50 border border-[#E5E7EB] rounded-lg px-4 py-3 flex justify-between items-center">
                <div>
                  <p className="text-xs text-gray-500">Coût total de la recette</p>
                  <p className="text-lg font-medium text-gray-900">€{totalCost.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">
                    Coût par {YIELD_UNITS.find((u) => u.value === yieldUnit)?.label ?? yieldUnit}
                    {" "}(rendement {yieldPortions || 1})
                  </p>
                  <p className="text-lg font-medium text-emerald-700">€{costPerPortion.toFixed(2)}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-[#E5E7EB]">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-2 text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition">
                Annuler
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition">
                {saving ? "Enregistrement…" : editingId ? "Enregistrer" : "Créer la recette"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recipe list */}
      {visibleRecipes.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-12 text-center">
          <div className="text-4xl mb-3">{tab === "prep" ? "🥣" : "👨‍🍳"}</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">
            {tab === "prep" ? "Aucune mise en place" : "Aucune fiche technique"}
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            {tab === "prep"
              ? "Créez vos préparations de base (sauces, fonds, pâtes…) réutilisables dans vos fiches techniques."
              : "Créez votre première recette pour connaître le vrai coût de chaque plat."}
          </p>
          <button onClick={openAdd} className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition">
            {tab === "prep" ? "Créer la première mise en place" : "Créer la première recette"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRecipes.map((recipe) => {
            const isExpanded = expandedId === recipe.id;
            const costPerPortion = recipe.total_cost / (recipe.yield_portions || 1);
            const yUnit = YIELD_UNITS.find((u) => u.value === (recipe.yield_unit || "portion"))?.label ?? recipe.yield_unit;
            return (
              <div key={recipe.id} className="bg-white border border-[#E5E7EB] rounded-card overflow-hidden">
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition"
                  onClick={() => setExpandedId(isExpanded ? null : recipe.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{recipe.name}</span>
                      <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-500">{recipe.category}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">Rendement {recipe.yield_portions} {yUnit} · {recipe.category}</p>
                    {(recipe.allergens?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {recipe.allergens!.map((a) => (
                          <span key={a} className="px-1.5 py-0.5 text-2xs rounded bg-amber-100 text-amber-700 font-medium">{a}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">€{recipe.total_cost.toFixed(2)} total</p>
                    <p className="text-xs text-emerald-600">€{costPerPortion.toFixed(2)} / {yUnit}</p>

                  </div>
                  <div className="flex items-center gap-1">
                    <Link href={`/recipes/${recipe.id}`} onClick={(e) => e.stopPropagation()}
                      className="px-3 py-1.5 text-xs text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-100 transition">
                      Ouvrir
                    </Link>
                    <button onClick={(e) => { e.stopPropagation(); handleDuplicate(recipe); }}
                      disabled={duplicatingId === recipe.id}
                      title="Dupliquer"
                      className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition disabled:opacity-50">
                      <Copy size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(recipe.id); }}
                      disabled={deletingId === recipe.id}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition">
                      <Trash2 size={14} />
                    </button>
                    {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-[#E5E7EB] px-5 py-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 uppercase">
                          <th className="text-left pb-2">Ingrédient / Sous-recette</th>
                          <th className="text-right pb-2">Quantité</th>
                          <th className="text-right pb-2">Coût</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F3F4F6]">
                        {recipe.recipe_lines.map((line, i) => {
                          const label = line.ingredients?.name ?? line.sub_recipe?.name ?? "—";
                          const isSubRecipe = !!line.sub_recipe_id;
                          const lineCost = line.ingredients
                            ? line.ingredients.cost_per_base_unit * line.quantity
                            : line.sub_recipe
                            ? (line.sub_recipe.total_cost / (line.sub_recipe.yield_portions || 1)) * line.quantity
                            : 0;
                          return (
                            <tr key={i}>
                              <td className="py-1.5 text-gray-700">
                                {isSubRecipe && <span className="text-xs text-blue-500 mr-1">[sous-recette]</span>}
                                {label}
                              </td>
                              <td className="text-right text-gray-500">{line.quantity} {line.unit}</td>
                              <td className="text-right text-gray-900">€{lineCost.toFixed(3)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-[#E5E7EB]">
                          <td className="pt-2 text-xs font-medium text-gray-500">Total recette</td>
                          <td />
                          <td className="pt-2 text-right font-medium text-gray-900">€{recipe.total_cost.toFixed(2)}</td>
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
