"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Trash2, X, ChevronDown, ChevronUp } from "lucide-react";

const CATEGORIES = ["Entrée", "Plat", "Dessert", "Accompagnement", "Boisson"];

type Ingredient = { id: string; name: string; cost_per_base_unit: number; unit: string };
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
  total_cost: number;
  menu_price: number | null;
  recipe_lines: RecipeLine[];
};

type DraftLine = {
  type: "ingredient" | "sub_recipe";
  ingredient_id: string;
  sub_recipe_id: string;
  quantity: string;
  unit: string;
};

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
    return ing.cost_per_base_unit * baseQty;
  } else {
    const rec = allRecipes.find((r) => r.id === line.sub_recipe_id);
    if (!rec) return 0;
    const costPerPortion = rec.total_cost / (rec.yield_portions || 1);
    return costPerPortion * qty;
  }
}

interface Props {
  restaurantId: string;
  initialRecipes: Recipe[];
  ingredients: Ingredient[];
  allRecipes: Recipe[];
}

export default function RecipesClient({ restaurantId, initialRecipes, ingredients, allRecipes: allRecipesProp }: Props) {
  const supabase = createClient();
  const [recipes, setRecipes] = useState<Recipe[]>(initialRecipes);
  const [allRecipes, setAllRecipes] = useState<Recipe[]>(allRecipesProp);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState("Main");
  const [yieldPortions, setYieldPortions] = useState("1");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  const totalCost = useMemo(() =>
    lines.reduce((sum, l) => sum + calcLineCost(l, ingredients, allRecipes), 0),
    [lines, ingredients, allRecipes]
  );
  const costPerPortion = totalCost / (parseFloat(yieldPortions) || 1);

  function openAdd() {
    setEditingId(null);
    setName(""); setCategory("Main"); setYieldPortions("1");
    setLines([{ ...EMPTY_LINE }]);
    setError(null);
    setShowForm(true);
  }

  function openEdit(recipe: Recipe) {
    setEditingId(recipe.id);
    setName(recipe.name);
    setCategory(recipe.category);
    setYieldPortions(String(recipe.yield_portions));
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
      yield_portions: yp,
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
      yield_portions: yp,
      total_cost: totalCost,
      menu_price: null,
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
      <div className="flex items-end justify-between mb-6 pb-5 border-b border-gray-200">
        <div>
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Catalogue</p>
          <h1 className="text-2xl font-bold text-gray-900">Recettes</h1>
          <p className="text-sm text-gray-500 mt-1">{recipes.length} recette{recipes.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition shadow-sm"
        >
          <Plus size={15} />
          Nouvelle recette
        </button>
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
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de portions</label>
                  <input type="number" min="1" step="1" value={yieldPortions} onChange={(e) => setYieldPortions(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
                  <p className="text-xs text-gray-400 mt-1">Combien de portions donne cette recette ?</p>
                </div>
              </div>

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
                      ) : (
                        <div className="w-16 px-2 py-2 text-xs text-gray-400 border border-[#E5E7EB] rounded-lg bg-gray-50 text-center">
                          portions
                        </div>
                      )}

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
                  <p className="text-xs text-gray-500">Coût par portion ({yieldPortions || 1} portion{parseFloat(yieldPortions) !== 1 ? "s" : ""})</p>
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
      {recipes.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-12 text-center">
          <div className="text-4xl mb-3">👨‍🍳</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">Aucune recette</h2>
          <p className="text-sm text-gray-500 mb-5">Créez votre première recette pour connaître le vrai coût de chaque plat.</p>
          <button onClick={openAdd} className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition">
            Créer la première recette
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {recipes.map((recipe) => {
            const isExpanded = expandedId === recipe.id;
            const costPerPortion = recipe.total_cost / (recipe.yield_portions || 1);
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
                    <p className="text-xs text-gray-500 mt-0.5">{recipe.yield_portions} portion{recipe.yield_portions !== 1 ? "s" : ""} · {recipe.category}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">€{recipe.total_cost.toFixed(2)} total</p>
                    <p className="text-xs text-emerald-600">€{costPerPortion.toFixed(2)} / portion</p>

                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={(e) => { e.stopPropagation(); openEdit(recipe); }}
                      className="px-3 py-1.5 text-xs text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-100 transition">
                      Modifier
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
