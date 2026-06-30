"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Check, Plus, Trash2, Loader2, Scale, ListChecks } from "lucide-react";
import clsx from "clsx";

type Ingredient = { id: string; name: string; cost_per_base_unit: number; unit: string; yield_pct?: number | null };
type RecipeRef = { id: string; name: string; total_cost: number; yield_portions: number; yield_unit: string; is_prep: boolean };
type RecipeLine = { ingredient_id: string | null; sub_recipe_id: string | null; quantity: number; unit: string };
type Recipe = {
  id: string; name: string; category: string; yield_portions: number; yield_unit: string;
  total_cost: number; menu_price: number | null; is_prep: boolean; allergens?: string[];
  recipe_lines: RecipeLine[];
};
type DraftLine = { type: "ingredient" | "sub_recipe"; ingredient_id: string; sub_recipe_id: string; quantity: string; unit: string };

const YIELD_UNITS = [
  { value: "portion", label: "portion(s)" }, { value: "kg", label: "kg" }, { value: "g", label: "g" },
  { value: "l", label: "L" }, { value: "ml", label: "ml" }, { value: "piece", label: "pièce(s)" },
];

const toBase = (qty: number, unit: string) => (unit === "kg" || unit === "l" ? qty * 1000 : qty);
const yieldInBase = (r: RecipeRef) => toBase(r.yield_portions || 1, r.yield_unit || "portion");

// Arrondi propre (supprime les zéros inutiles)
const fmtNum = (n: number, d = 3) => String(Math.round(n * 10 ** d) / 10 ** d);
// Quantité mise à l'échelle, avec conversion auto kg↔g / L↔ml pour rester lisible
function fmtScaled(qty: number, unit: string): string {
  if (!isFinite(qty) || qty === 0) return "—";
  if (unit === "kg") return qty < 1 ? `${fmtNum(qty * 1000, 1)} g` : `${fmtNum(qty, 3)} kg`;
  if (unit === "l")  return qty < 1 ? `${fmtNum(qty * 1000, 1)} ml` : `${fmtNum(qty, 3)} L`;
  if (unit === "g")  return qty >= 1000 ? `${fmtNum(qty / 1000, 3)} kg` : `${fmtNum(qty, 1)} g`;
  if (unit === "ml") return qty >= 1000 ? `${fmtNum(qty / 1000, 3)} L` : `${fmtNum(qty, 1)} ml`;
  if (unit === "unit" || unit === "piece") return fmtNum(qty, 2);
  return `${fmtNum(qty, 2)} ${unit}`;
}

function unitsForSubRecipe(yieldUnit: string): string[] {
  switch (yieldUnit) {
    case "kg": case "g": return ["g", "kg"];
    case "l": case "ml": return ["ml", "l"];
    case "piece": return ["piece"];
    default: return ["portion"];
  }
}

function calcLineCost(line: DraftLine, ingredients: Ingredient[], allRecipes: RecipeRef[]): number {
  const qty = parseFloat(line.quantity);
  if (!qty) return 0;
  if (line.type === "ingredient") {
    const ing = ingredients.find((i) => i.id === line.ingredient_id);
    if (!ing) return 0;
    let baseQty = qty;
    if (line.unit === "kg" && (ing.unit === "g" || ing.unit === "kg")) baseQty = qty * 1000;
    if (line.unit === "l" && (ing.unit === "ml" || ing.unit === "l")) baseQty = qty * 1000;
    const y = Number(ing.yield_pct ?? 100);
    const yf = y > 0 ? y / 100 : 1;
    return ing.cost_per_base_unit * (baseQty / yf);
  }
  const rec = allRecipes.find((r) => r.id === line.sub_recipe_id);
  if (!rec) return 0;
  return rec.total_cost * (toBase(qty, line.unit) / yieldInBase(rec));
}

const EMPTY_LINE: DraftLine = { type: "ingredient", ingredient_id: "", sub_recipe_id: "", quantity: "", unit: "g" };

interface Props {
  recipe: Recipe;
  restaurantId: string;
  ingredients: Ingredient[];
  allRecipes: RecipeRef[];
  menuCategories: string[];
  prepCategories: string[];
}

export default function RecipeClient({ recipe, restaurantId, ingredients, allRecipes, menuCategories, prepCategories }: Props) {
  const supabase = createClient();
  const router = useRouter();

  const [name, setName] = useState(recipe.name);
  const isPrep = recipe.is_prep; // type figé : MEP et recettes ont des pages séparées
  const [category, setCategory] = useState(recipe.category);
  const [yieldPortions, setYieldPortions] = useState(String(recipe.yield_portions));
  const [yieldUnit, setYieldUnit] = useState(recipe.yield_unit || "portion");
  const [targetQty, setTargetQty] = useState(String(recipe.yield_portions)); // outil de ratio
  const [targetUnit, setTargetUnit] = useState(recipe.yield_unit || "portion");
  const [lines, setLines] = useState<DraftLine[]>(
    recipe.recipe_lines.length > 0
      ? recipe.recipe_lines.map((l) => ({
          type: l.ingredient_id ? "ingredient" : "sub_recipe" as "ingredient" | "sub_recipe",
          ingredient_id: l.ingredient_id ?? "", sub_recipe_id: l.sub_recipe_id ?? "",
          quantity: String(l.quantity), unit: l.unit,
        }))
      : [{ ...EMPTY_LINE }]
  );
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cats = isPrep ? prepCategories : menuCategories;
  const subRecipeOptions = allRecipes.filter((r) => r.id !== recipe.id && r.is_prep);

  const totalCost = useMemo(() => lines.reduce((s, l) => s + calcLineCost(l, ingredients, allRecipes), 0), [lines, ingredients, allRecipes]);
  const yp = parseFloat(yieldPortions) || 1;

  // --- Outil de ratio (mise à l'échelle) ---
  const unitLabel = (u: string) => ({ kg: "kg", g: "g", l: "L", ml: "ml", portion: "portion(s)", piece: "pièce(s)" } as Record<string, string>)[u] ?? u;
  // unités proposées pour la cible, dans la même dimension que le rendement
  const ratioUnitOptions =
    yieldUnit === "kg" || yieldUnit === "g" ? ["kg", "g"]
    : yieldUnit === "l" || yieldUnit === "ml" ? ["l", "ml"]
    : yieldUnit === "piece" ? ["piece"] : ["portion"];
  const tUnit = ratioUnitOptions.includes(targetUnit) ? targetUnit : ratioUnitOptions[0];
  // raccourcis adaptés à la dimension
  const ratioPresets: { q: string; u: string }[] =
    yieldUnit === "kg" || yieldUnit === "g" ? [{ q: "500", u: "g" }, { q: "1", u: "kg" }, { q: "3", u: "kg" }]
    : yieldUnit === "l" || yieldUnit === "ml" ? [{ q: "500", u: "ml" }, { q: "1", u: "l" }, { q: "3", u: "l" }]
    : [{ q: "1", u: yieldUnit }, { q: "10", u: yieldUnit }, { q: "100", u: yieldUnit }];

  const yQtyNum = parseFloat(yieldPortions) || 0;
  const tQtyNum = parseFloat(targetQty) || 0;
  // facteur calculé en unités de base (g/ml) pour gérer kg↔g, L↔ml
  const ratioFactor = (() => {
    const yb = toBase(yQtyNum, yieldUnit);
    const tb = toBase(tQtyNum, tUnit);
    return yb > 0 ? tb / yb : 0;
  })();
  const scalableLines = lines.filter((l) => (l.ingredient_id || l.sub_recipe_id) && parseFloat(l.quantity) > 0);
  const lineName = (l: DraftLine) =>
    l.type === "ingredient"
      ? ingredients.find((i) => i.id === l.ingredient_id)?.name ?? "—"
      : allRecipes.find((r) => r.id === l.sub_recipe_id)?.name ?? "—";

  function updateLine(idx: number, field: keyof DraftLine, value: string) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "type") { next[idx].ingredient_id = ""; next[idx].sub_recipe_id = ""; next[idx].unit = value === "ingredient" ? "g" : "portion"; }
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
  const addLine = () => setLines((p) => [...p, { ...EMPTY_LINE }]);
  const removeLine = (idx: number) => setLines((p) => p.filter((_, i) => i !== idx));

  async function handleSave() {
    setError(null);
    if (!name.trim()) return setError("Le nom est requis.");
    if (yp <= 0) return setError("Le rendement doit être supérieur à 0.");
    const valid = lines.filter((l) => l.ingredient_id || l.sub_recipe_id);
    if (valid.length === 0) return setError("Ajoute au moins un ingrédient ou une mise en place.");
    setSaving(true);

    const { error: err } = await supabase.from("recipes").update({
      name: name.trim(), category, is_prep: isPrep,
      yield_portions: yp, yield_unit: yieldUnit, total_cost: totalCost,
    }).eq("id", recipe.id);
    if (err) { setError(err.message); setSaving(false); return; }

    await supabase.from("recipe_lines").delete().eq("recipe_id", recipe.id);
    await supabase.from("recipe_lines").insert(valid.map((l) => ({
      recipe_id: recipe.id,
      ingredient_id: l.type === "ingredient" ? l.ingredient_id : null,
      sub_recipe_id: l.type === "sub_recipe" ? l.sub_recipe_id : null,
      quantity: parseFloat(l.quantity), unit: l.unit,
    })));

    // Authoritative recompute (CMUP + allergens)
    await fetch("/api/recalculate-recipes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId }),
    }).catch(() => {});

    setSaving(false);
    setToast("Enregistré ✓");
    setTimeout(() => setToast(null), 2500);
    router.refresh();
  }

  const inputCls = "w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition";

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto pb-24">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-5">
        <Link href={isPrep ? "/mises-en-place" : "/recipes"} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
          <ArrowLeft size={16} /> {isPrep ? "Toutes les mises en place" : "Toutes les recettes"}
        </Link>
        <div className="flex items-center gap-2">
          {toast && <span className="text-sm text-emerald-600 font-medium">{toast}</span>}
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Enregistrer
          </button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      {/* Identity */}
      <div className="bg-white border border-gray-100 rounded-card shadow-card p-5 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Nom de la recette</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={clsx(inputCls, "text-base font-semibold")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Catégorie</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
              {Array.from(new Set([...cats, category].filter(Boolean))).map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Rendement */}
      <Section icon={<Scale size={16} />} title="Rendement / conditionnement" subtitle={isPrep ? "Quantité totale produite (ex. 2 kg de sauce)." : "Combien cette recette produit (souvent en portions)."}>
        <div className="flex gap-2 max-w-xs">
          <input type="number" min="0" step="any" value={yieldPortions} onChange={(e) => setYieldPortions(e.target.value)} className={clsx(inputCls, "w-28")} />
          <select value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} className={inputCls}>
            {YIELD_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
      </Section>

      {/* Ratio / mise à l'échelle */}
      <Section icon={<Scale size={16} />} title="Ratio / mise à l'échelle"
        subtitle={`Lot de base : ${fmtNum(yQtyNum)} ${unitLabel(yieldUnit)}. Choisis la quantité que tu veux produire — toutes les quantités se recalculent au prorata.`}>
        {scalableLines.length === 0 ? (
          <p className="text-xs text-gray-400">Ajoute des ingrédients avec des quantités pour utiliser le ratio.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-2 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Je veux produire</label>
                <div className="flex gap-2">
                  <input type="number" min="0" step="any" value={targetQty} onChange={(e) => setTargetQty(e.target.value)} className={clsx(inputCls, "w-28")} />
                  <select value={tUnit} onChange={(e) => setTargetUnit(e.target.value)} className={clsx(inputCls, "w-24")}>
                    {ratioUnitOptions.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-1.5 pb-0.5">
                {ratioPresets.map((p) => (
                  <button key={p.q + p.u} type="button" onClick={() => { setTargetQty(p.q); setTargetUnit(p.u); }}
                    className="px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
                    {p.q} {unitLabel(p.u)}
                  </button>
                ))}
              </div>
              <span className="ml-auto text-xs text-gray-400 pb-2">ratio ×{fmtNum(ratioFactor, 4)}</span>
            </div>
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-2xs text-gray-400 uppercase tracking-wide">
                    <th className="px-3 py-2 text-left font-semibold">Ingrédient</th>
                    <th className="px-3 py-2 text-right font-semibold">Lot {fmtNum(yQtyNum)} {unitLabel(yieldUnit)}</th>
                    <th className="px-3 py-2 text-right font-semibold">Pour {fmtNum(tQtyNum)} {unitLabel(tUnit)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {scalableLines.map((l, i) => {
                    const q = parseFloat(l.quantity);
                    return (
                      <tr key={i}>
                        <td className="px-3 py-2 text-gray-800">{lineName(l)}</td>
                        <td className="px-3 py-2 text-right text-gray-400">{fmtScaled(q, l.unit)}</td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-700">{fmtScaled(q * ratioFactor, l.unit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-2xs text-gray-400 mt-2">Outil de calcul uniquement — ne modifie pas la fiche enregistrée.</p>
          </>
        )}
      </Section>

      {/* Ingredients */}
      <Section icon={<ListChecks size={16} />} title="Ingrédients & mises en place" subtitle="Ajoute des ingrédients bruts et/ou des mises en place. Quand la recette est vendue, les ingrédients (y compris ceux des MEP) sont déstockés."
        action={<button onClick={addLine} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"><Plus size={13} /> Ligne</button>}>
        <div className="space-y-2">
          {lines.map((line, idx) => {
            const subUnits = line.type === "sub_recipe"
              ? unitsForSubRecipe(allRecipes.find((r) => r.id === line.sub_recipe_id)?.yield_unit || "portion")
              : ["g", "kg", "ml", "l", "unit"];
            return (
              <div key={idx} className="flex gap-2 items-start">
                <select value={line.type} onChange={(e) => updateLine(idx, "type", e.target.value)} className="px-2 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-emerald-500">
                  <option value="ingredient">Ingrédient</option>
                  <option value="sub_recipe">Mise en place</option>
                </select>
                {line.type === "ingredient" ? (
                  <select value={line.ingredient_id} onChange={(e) => updateLine(idx, "ingredient_id", e.target.value)} className="flex-1 px-2 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-emerald-500">
                    <option value="">Choisir…</option>
                    {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                ) : (
                  <select value={line.sub_recipe_id} onChange={(e) => updateLine(idx, "sub_recipe_id", e.target.value)} className="flex-1 px-2 py-2 text-sm border border-gray-200 rounded-lg bg-white outline-none focus:border-emerald-500">
                    <option value="">Choisir une mise en place…</option>
                    {subRecipeOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                )}
                <input type="number" min="0" step="any" value={line.quantity} onChange={(e) => updateLine(idx, "quantity", e.target.value)} placeholder="Qté" className="w-20 px-2 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                <select value={line.unit} onChange={(e) => updateLine(idx, "unit", e.target.value)} className="w-16 px-2 py-2 text-xs border border-gray-200 rounded-lg bg-white outline-none focus:border-emerald-500">
                  {subUnits.map((u) => <option key={u} value={u}>{u === "portion" ? "port." : u}</option>)}
                </select>
                <div className="w-16 text-right text-xs text-gray-500 pt-2.5">€{calcLineCost(line, ingredients, allRecipes).toFixed(3)}</div>
                <button onClick={() => removeLine(idx)} className="pt-2 text-gray-300 hover:text-red-400 transition"><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Allergènes (auto) */}
      <Section title="Allergènes" subtitle="Calculés automatiquement depuis les ingrédients (mis à jour à l'enregistrement).">
        {(recipe.allergens?.length ?? 0) > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {recipe.allergens!.map((a) => <span key={a} className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{a}</span>)}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Aucun allergène déclaré sur les ingrédients de cette recette.</p>
        )}
      </Section>
    </div>
  );
}

function Section({ icon, title, subtitle, action, children }: {
  icon?: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-card shadow-card p-5 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-2.5">
          {icon && <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 shrink-0">{icon}</div>}
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
