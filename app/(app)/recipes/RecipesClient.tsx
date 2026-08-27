"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Plus, Trash2, X, ChevronDown, ChevronUp, RefreshCw, Copy, Search, ChefHat, Percent, Coins, Layers, ClipboardCheck } from "lucide-react";
import clsx from "clsx";
import { Pastille, BadgeType, LegendeTypes } from "@/components/TypeIdentite";
import { TYPE_IDENTITE, typeDeRecette } from "@/lib/type-article";
import { normaliseRefCaisse, refCaisseEnDouble } from "@/lib/references";
import { foodCostPct, estAlcool, tauxDeVente, TVA_DEFAUT, type ReglagesTva } from "@/lib/vat";
import { useConfirm, useAlert } from "@/components/ConfirmDialog";
import { eur } from "@/lib/format";


type Ingredient = { id: string; name: string; cost_per_base_unit: number; cmup?: number | null; unit: string; yield_pct?: number | null; is_active?: boolean };
type RecipeLine = {
  id?: string;
  ingredient_id: string | null;
  sub_recipe_id: string | null;
  quantity: number;
  unit: string;
  ingredients?: { name: string; cost_per_base_unit: number; cmup?: number | null; unit: string } | null;
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
  /** Touche de caisse qui vend ce plat — sert à rapprocher les ventes des fiches. */
  pos_ref?: string | null;
  is_prep: boolean;
  countable_in_inventory?: boolean;
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
    // qty is NET; real gross drawn = net / yield → cost follows gross.
    // CMUP (coût moyen du stock) en priorité — même base que le serveur.
    const y = Number(ing.yield_pct ?? 100);
    const yf = y > 0 ? y / 100 : 1;
    return Number(ing.cmup ?? ing.cost_per_base_unit ?? 0) * (baseQty / yf);
  } else {
    const rec = allRecipes.find((r) => r.id === line.sub_recipe_id);
    if (!rec) return 0;
    // Fraction of the sub-recipe batch consumed: e.g. 100 g out of a 2 kg batch.
    const fraction = toBase(qty, line.unit) / yieldInBase(rec);
    return rec.total_cost * fraction;
  }
}

// Coût d'une ligne DÉJÀ enregistrée (même maths que calcLineCost : conversion
// kg/l → base, rendement de l'ingrédient, fraction du batch pour une MEP).
function savedLineCost(line: RecipeLine, ingredients: Ingredient[], allRecipes: Recipe[]): number {
  const qty = Number(line.quantity) || 0;
  if (!qty) return 0;
  if (line.ingredient_id) {
    const full = ingredients.find((i) => i.id === line.ingredient_id);
    const info = full ?? line.ingredients;
    if (!info) return 0;
    let baseQty = qty;
    if (line.unit === "kg" && (info.unit === "g" || info.unit === "kg")) baseQty = qty * 1000;
    if (line.unit === "l" && (info.unit === "ml" || info.unit === "l")) baseQty = qty * 1000;
    const y = Number(full?.yield_pct ?? 100);
    const yf = y > 0 ? y / 100 : 1;
    return Number(info.cmup ?? info.cost_per_base_unit ?? 0) * (baseQty / yf);
  }
  if (line.sub_recipe_id) {
    const rec = allRecipes.find((r) => r.id === line.sub_recipe_id);
    if (rec) return rec.total_cost * (toBase(qty, line.unit) / yieldInBase(rec));
  }
  return 0;
}

interface Props {
  restaurantId: string;
  tva?: ReglagesTva;
  initialRecipes: Recipe[];
  ingredients: Ingredient[];
  allRecipes: Recipe[];
  menuCategories: string[];
  prepCategories: string[];
  lockMode?: "recipe" | "prep"; // when set, this page only shows that type (no tab switch)
}

export default function RecipesClient({ tva = TVA_DEFAUT, restaurantId, initialRecipes, ingredients, allRecipes: allRecipesProp, menuCategories, prepCategories, lockMode }: Props) {
  const notify = useAlert();
  const confirm = useConfirm();
  const supabase = createClient();
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>(initialRecipes);
  const [allRecipes, setAllRecipes] = useState<Recipe[]>(allRecipesProp);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [recalcing, setRecalcing] = useState(false);
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);

  const [tab, setTab] = useState<"recipe" | "prep">(lockMode ?? "recipe");

  // Après un recalcul serveur (router.refresh), les coûts arrivent par les
  // props : on resynchronise, sinon l'écran garderait les coûts provisoires.
  useEffect(() => { setRecipes(initialRecipes); }, [initialRecipes]);
  useEffect(() => { setAllRecipes(allRecipesProp); }, [allRecipesProp]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Plat");
  const [isPrep, setIsPrep] = useState(false);
  const [yieldPortions, setYieldPortions] = useState("1");
  const [posRef, setPosRef] = useState("");
  const [yieldUnit, setYieldUnit] = useState("portion");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  // Split recipes by type
  const menuRecipes = useMemo(() => recipes.filter((r) => !r.is_prep), [recipes]);
  const prepRecipes = useMemo(() => recipes.filter((r) => r.is_prep), [recipes]);
  const visibleRecipes = useMemo(() => {
    const base = tab === "recipe" ? menuRecipes : prepRecipes;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) => r.name.toLowerCase().includes(q) || (r.category ?? "").toLowerCase().includes(q));
  }, [tab, menuRecipes, prepRecipes, search]);

  // ── Read-only stat cards, all derived from the live recipes (no placeholders) ──
  const statBase = tab === "recipe" ? menuRecipes : prepRecipes;
  const pricedRecipes = statBase.filter((r) => Number(r.menu_price ?? 0) > 0);
  const avgFoodCost = pricedRecipes.length
    ? pricedRecipes.reduce((s, r) => s + (foodCostPct(
        r.total_cost / (r.yield_portions || 1),
        Number(r.menu_price),
        tauxDeVente("dine_in", estAlcool(r), tva),
      ) ?? 0), 0) / pricedRecipes.length
    : null;
  const avgCostPerPortion = statBase.length
    ? statBase.reduce((s, r) => s + r.total_cost / (r.yield_portions || 1), 0) / statBase.length
    : 0;

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
    setPosRef("");
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
    setPosRef(recipe.pos_ref ?? "");
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

  // Unified picker: "mep:<id>" (mise en place) or "ing:<id>" (ingrédient)
  function selectItem(idx: number, value: string) {
    setLines((prev) => prev.map((l, i) => {
      if (i !== idx) return l;
      if (value.startsWith("mep:")) {
        const id = value.slice(4);
        const sub = allRecipes.find((r) => r.id === id);
        return { ...l, type: "sub_recipe", sub_recipe_id: id, ingredient_id: "", unit: unitsForSubRecipe(sub?.yield_unit || "portion")[0] };
      }
      if (value.startsWith("ing:")) {
        const id = value.slice(4);
        const ing = ingredients.find((g) => g.id === id);
        const unit = ing ? (ing.unit === "kg" ? "g" : ing.unit === "l" ? "ml" : ing.unit) : "g";
        return { ...l, type: "ingredient", ingredient_id: id, sub_recipe_id: "", unit };
      }
      return { ...l, type: "ingredient", ingredient_id: "", sub_recipe_id: "" };
    }));
  }
  const lineValue = (l: DraftLine) => l.sub_recipe_id ? `mep:${l.sub_recipe_id}` : l.ingredient_id ? `ing:${l.ingredient_id}` : "";

  async function handleSave() {
    setError(null);
    if (!name.trim()) return setError("Le nom de la recette est requis.");
    const yp = parseFloat(yieldPortions);
    if (isNaN(yp) || yp <= 0) return setError("Le nombre de portions doit être supérieur à 0.");
    const chosen = lines.filter((l) => l.ingredient_id || l.sub_recipe_id);
    if (chosen.length === 0) return setError("Ajoutez au moins un ingrédient ou une mise en place.");
    // Une ligne choisie sans quantité enverrait NaN → quantité nulle en base.
    const sansQte = chosen.find((l) => !(parseFloat(l.quantity) > 0));
    if (sansQte) {
      const nom = ingredients.find((i) => i.id === sansQte.ingredient_id)?.name
        ?? allRecipes.find((r) => r.id === sansQte.sub_recipe_id)?.name ?? "une ligne";
      return setError(`Indique une quantité pour « ${nom} » (ou retire la ligne).`);
    }
    const validLines = chosen;

    setSaving(true);
    const recipePayload = {
      restaurant_id: restaurantId,
      name: name.trim(),
      category,
      is_prep: isPrep,
      yield_portions: yp,
      yield_unit: yieldUnit,
      total_cost: totalCost,
      pos_ref: normaliseRefCaisse(posRef) || null,
    };

    let recipeId = editingId;

    // Anciennes lignes conservées : si la réécriture échoue on les remet.
    let previousLines: any[] = [];

    if (editingId) {
      const { error: err } = await supabase.from("recipes").update(recipePayload).eq("id", editingId);
      if (err) { setError(err.message); setSaving(false); return; }
      const { data: oldLines } = await supabase
        .from("recipe_lines").select("ingredient_id, sub_recipe_id, quantity, unit").eq("recipe_id", editingId);
      previousLines = (oldLines ?? []).map((l) => ({ ...l, recipe_id: editingId }));
      const { error: delErr } = await supabase.from("recipe_lines").delete().eq("recipe_id", editingId);
      if (delErr) {
        setError(`Mise à jour des ingrédients impossible : ${delErr.message}. La recette n'a pas été modifiée.`);
        setSaving(false); return;
      }
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
    if (lineErr) {
      // Ne jamais laisser la recette sans ingrédients : on restaure l'ancienne version.
      if (previousLines.length > 0) await supabase.from("recipe_lines").insert(previousLines);
      setError(`Enregistrement des ingrédients impossible : ${lineErr.message}. ${previousLines.length > 0 ? "La version précédente a été rétablie." : ""}`);
      setSaving(false); return;
    }

    // Build local recipe object to update UI immediately (no reload needed)
    const builtLines = validLines.map((l) => {
      const ing = ingredients.find((i) => i.id === l.ingredient_id);
      return {
        ingredient_id: l.ingredient_id || null,
        sub_recipe_id: l.sub_recipe_id || null,
        quantity: parseFloat(l.quantity),
        unit: l.unit,
        ingredients: ing ? { name: ing.name, cost_per_base_unit: ing.cost_per_base_unit, cmup: ing.cmup ?? null, unit: ing.unit } : null,
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
      pos_ref: normaliseRefCaisse(posRef) || null,
      allergens: editingId ? (recipes.find((r) => r.id === editingId)?.allergens ?? []) : [],
      // Conserver le drapeau inventaire, sinon le bouton « Inventaire ✓ »
      // repassait à « + Inventaire » après une modification.
      countable_in_inventory: editingId ? (recipes.find((r) => r.id === editingId)?.countable_in_inventory ?? false) : false,
      recipe_lines: builtLines,
    };

    if (editingId) {
      setRecipes((p) => p.map((r) => r.id === editingId ? builtRecipe : r));
      setAllRecipes((p) => p.map((r) => r.id === editingId ? builtRecipe : r));
    } else {
      setRecipes((p) => [...p, builtRecipe].sort((a, b) => a.name.localeCompare(b.name)));
      setAllRecipes((p) => [...p, builtRecipe].sort((a, b) => a.name.localeCompare(b.name)));
    }

    // Recompute authoritative costs server-side (CMUP, sous-recettes en cascade)
    // — attendu AVANT de rendre la main, sinon un départ de page laisse un
    // total_cost provisoire en base.
    const recalc = await recalcServer();

    setSaving(false);
    setShowForm(false);
    if (!recalc.ok) {
      notify(
        "La recette est enregistrée, mais le recalcul des coûts au CMUP a échoué " +
        `(${recalc.message}).\n\nUtilise le bouton « Tout recalculer » pour obtenir les coûts définitifs.`
      );
    }
    router.refresh();
  }

  // Recalcul serveur (CMUP + cascade des MEP) avec un vrai retour d'erreur.
  async function recalcServer(): Promise<{ ok: boolean; message: string; skipped?: string[] }> {
    try {
      const res = await fetch("/api/recalculate-recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, message: json?.error ?? `erreur ${res.status}` };
      return { ok: true, message: "", skipped: json?.skipped };
    } catch {
      return { ok: false, message: "connexion interrompue" };
    }
  }

  async function handleRecalcAll() {
    setRecalcing(true);
    setRecalcMsg(null);
    const r = await recalcServer();
    setRecalcing(false);
    if (!r.ok) { setRecalcMsg(`Échec du recalcul : ${r.message}. Réessaie.`); return; }
    if (r.skipped && r.skipped.length > 0) {
      setRecalcMsg(`Coûts recalculés, sauf ${r.skipped.length} recette(s) : une mise en place s'utilise elle-même (boucle). Corrige ces fiches.`);
    } else {
      setRecalcMsg("Coûts et allergènes recalculés ✓");
    }
    router.refresh();
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
    if (err || !created) {
      setDuplicatingId(null);
      notify(`Duplication impossible : ${err?.message ?? "réessaie."}`);
      return;
    }

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
      const { error: cpErr } = await supabase.from("recipe_lines").insert(linePayload);
      if (cpErr) {
        // Une copie sans ingrédients afficherait un coût fantôme : on annule.
        await supabase.from("recipes").delete().eq("id", created.id);
        setDuplicatingId(null);
        notify(`Duplication impossible : ${cpErr.message}. Rien n'a été créé.`);
        return;
      }
    }

    // 3) Update local state
    const builtRecipe: Recipe = {
      ...recipe,
      id: created.id,
      name: `${recipe.name} (copie)`,
      menu_price: null,
      allergens: recipe.allergens ?? [],
      // La copie n'hérite PAS du comptage d'inventaire (non copié en base)
      countable_in_inventory: false,
    };
    setRecipes((p) => [...p, builtRecipe].sort((a, b) => a.name.localeCompare(b.name)));
    setAllRecipes((p) => [...p, builtRecipe].sort((a, b) => a.name.localeCompare(b.name)));
    setDuplicatingId(null);

    // 4) Open it for editing right away
    openEdit(builtRecipe);
  }

  async function handleDelete(id: string) {
    const name = recipes.find((r) => r.id === id)?.name ?? (tab === "prep" ? "cette mise en place" : "cette recette");
    // Utilisée comme MEP dans d'autres fiches ? Le dire AVANT de supprimer.
    const usedIn = allRecipes.filter((r) => r.id !== id && (r.recipe_lines ?? []).some((l) => l.sub_recipe_id === id));
    const extra = usedIn.length > 0
      ? [
          `Utilisée dans ${usedIn.length} fiche${usedIn.length > 1 ? "s" : ""} : ${usedIn.slice(0, 5).map((r) => r.name).join(", ")}${usedIn.length > 5 ? "…" : ""}.`,
          "Leur coût sera recalculé sans cet élément.",
        ]
      : undefined;
    if (!(await confirm({
      title: `Supprimer « ${name} » ?`,
      message: "Cette action est irréversible.",
      consequences: extra,
      tone: "danger",
    }))) return;
    setDeletingId(id);
    const { error: delErr } = await supabase.from("recipes").delete().eq("id", id);
    setDeletingId(null);
    if (delErr) { notify(`Suppression impossible : ${delErr.message}`); return; }
    setRecipes((p) => p.filter((r) => r.id !== id));
    setAllRecipes((p) => p.filter((r) => r.id !== id));
    // Les parents doivent perdre le coût de l'élément supprimé.
    if (usedIn.length > 0) await recalcServer();
    router.refresh();
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">
            Ma cuisine <span className="text-on-surface-variant/40">/</span> {lockMode === "prep" ? "Mises en place" : "Recettes"}
          </p>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">
            {lockMode === "prep" ? "Mises en place" : "Fiches Techniques"}
          </h1>
          <p className="text-sm text-on-surface-variant/70 mt-1">
            {lockMode === "prep"
              ? `${prepRecipes.length} mise${prepRecipes.length !== 1 ? "s" : ""} en place (sauces, fonds, bases…)`
              : lockMode === "recipe"
              ? `${menuRecipes.length} fiche${menuRecipes.length !== 1 ? "s" : ""} technique${menuRecipes.length !== 1 ? "s" : ""}`
              : `${menuRecipes.length} fiche${menuRecipes.length !== 1 ? "s" : ""} technique${menuRecipes.length !== 1 ? "s" : ""} · ${prepRecipes.length} mise${prepRecipes.length !== 1 ? "s" : ""} en place`}
          </p>
          {/* Sans legende, la couleur reste une devinette. */}
          <div className="mt-2">
            <LegendeTypes types={lockMode === "prep" ? ["mep"] : lockMode === "recipe" ? ["recette"] : ["mep", "recette"]} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRecalcAll}
            disabled={recalcing}
            title="Recalcule les coûts et allergènes de toutes les recettes"
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-on-surface-variant bg-surface-container-low border border-outline-variant/40 rounded-xl hover:bg-surface-container-high transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={clsx(recalcing && "animate-spin")} />
            {recalcing ? "Recalcul…" : "Tout recalculer"}
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition shadow-lg hover:nav-active-glow active:scale-[0.98]"
          >
            <Plus size={15} />
            {tab === "prep" ? "Nouvelle mise en place" : "Nouvelle recette"}
          </button>
        </div>
      </div>

      {recalcMsg && (
        <div className="mb-6 flex items-center gap-2 text-sm text-primary bg-emerald-50 border border-primary/20 rounded-xl px-4 py-2.5">
          {recalcMsg}
        </div>
      )}

      {/* Stats row — all derived from live recipes */}
      {statBase.length > 0 && (
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="glass-card rounded-2xl p-5 flex flex-col gap-3 border-l-4 border-primary">
            <div className="flex justify-between items-center">
              <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">
                {tab === "prep" ? "Mises en place" : "Fiches techniques"}
              </span>
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary"><Layers size={18} /></div>
            </div>
            <h3 className="text-2xl font-extrabold text-primary tabular-nums">{statBase.length}</h3>
          </div>

          <div className="glass-card rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Food cost moyen</span>
              <div className="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center text-secondary"><Percent size={18} /></div>
            </div>
            <div>
              <h3 className="text-2xl font-extrabold text-on-surface tabular-nums">
                {avgFoodCost === null ? "—" : `${avgFoodCost.toFixed(1)}%`}
              </h3>
              <p className="text-2xs text-on-surface-variant/60 mt-1">
                {avgFoodCost === null ? "Aucun prix de vente renseigné" : `Sur ${pricedRecipes.length} recette${pricedRecipes.length !== 1 ? "s" : ""} avec prix`}
              </p>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">{tab === "prep" ? "Coût moyen / unité de rendement" : "Coût moyen / portion"}</span>
              <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary-container"><Coins size={18} /></div>
            </div>
            <h3 className="text-2xl font-extrabold text-on-surface tabular-nums">{eur(avgCostPerPortion)}</h3>
          </div>
        </section>
      )}

      {/* Tabs — hidden when the page is locked to a single type */}
      {!lockMode && (
        <div className="glass-card rounded-2xl p-2 mb-4 flex flex-wrap gap-1 w-fit">
          {([
            { key: "recipe" as const, label: "Fiches techniques", count: menuRecipes.length },
            { key: "prep" as const, label: "Mises en place", count: prepRecipes.length },
          ]).map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={clsx(
                  "px-4 py-2 rounded-xl text-2xs font-bold uppercase tracking-wider transition-all duration-300",
                  active ? "bg-primary-container text-on-primary-container nav-active-glow" : "text-on-surface-variant/60 hover:bg-surface-container-low"
                )}
              >
                {t.label} <span className={clsx("ml-1", active ? "text-on-primary-container/80" : "text-on-surface-variant/40")}>({t.count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Recipe form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className={clsx("bg-white rounded-card border border-[#E5E7EB] w-full max-w-2xl shadow-xl my-8 border-l-4", TYPE_IDENTITE[isPrep ? "mep" : "recette"].bordure)}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <div className="flex items-center gap-2.5">
                <Pastille type={isPrep ? "mep" : "recette"} taille="sm" />
                <h2 className="text-base font-medium text-gray-900">
                  {editingId ? "Modifier" : "Nouveau"} {isPrep ? "— mise en place" : "— fiche technique"}
                </h2>
              </div>
              <button onClick={() => setShowForm(false)} title="Fermer" aria-label="Fermer" className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-5">
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nom de la recette</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Velouté de tomates"
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Catégorie</label>
                  <select value={category} onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-primary bg-white transition">
                    {Array.from(new Set([...(isPrep ? prepCategories : menuCategories), category].filter(Boolean))).map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                {!isPrep && (
                  <div className="col-span-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Référence de caisse <span className="font-normal text-gray-400">(optionnel)</span>
                    </label>
                    <input
                      value={posRef}
                      onChange={(e) => setPosRef(e.target.value)}
                      placeholder="ex. PLT12"
                      className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition" />
                    <p className="text-xs text-gray-400 mt-1">
                      Le code de la touche qui vend ce plat sur ta caisse. C’est lui qui permettra de rapprocher
                      automatiquement tes ventes et tes fiches techniques.
                    </p>
                    {refCaisseEnDouble(
                      allRecipes
                        .filter((r) => r.id !== editingId)
                        .concat([{ id: "en-cours", name: name.trim() || "cette recette", pos_ref: posRef } as any]),
                    ).length > 0 && (
                      <p className="text-xs text-red-600 mt-1">
                        Cette touche est déjà utilisée par une autre recette — deux plats ne peuvent pas partager la même.
                      </p>
                    )}
                  </div>
                )}
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Rendement / conditionnement</label>
                  <div className="flex gap-2">
                    <input type="number" min="0" step="any" value={yieldPortions} onChange={(e) => setYieldPortions(e.target.value)}
                      className="w-28 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition" />
                    <select value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)}
                      className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-primary bg-white transition">
                      {/* Un plat VENDU se compte en portions/pièces : avec un
                          rendement en kg, une vente ne déstockerait qu'une
                          fraction infime des ingrédients. */}
                      {(isPrep ? YIELD_UNITS : YIELD_UNITS.filter((u) => u.value === "portion" || u.value === "piece"))
                        .map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {isPrep
                      ? "Quantité totale produite par cette mise en place (ex. 2 kg de sauce). Les fiches techniques en consommeront une fraction."
                      : "Combien cette recette produit (généralement en portions pour un plat vendu)."}
                  </p>
                </div>
              </div>

              {/* Type toggle — hidden when the page is locked to a single type */}
              {!lockMode && (
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
                    <span className="block text-sm font-medium text-gray-800">Mise en place</span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      Préparation de base (sauce, fond, pâte…) qui alimente d'autres fiches techniques. N'apparaît pas au menu.
                    </span>
                  </span>
                </label>
              )}

              {/* Ingredient lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Ingrédients et mises en place</label>
                  <button onClick={addLine} className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
                    <Plus size={12} /> Ajouter une ligne
                  </button>
                </div>

                <div className="space-y-2">
                  {lines.map((line, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <select value={lineValue(line)} onChange={(e) => selectItem(idx, e.target.value)}
                        className="flex-1 px-2 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-primary bg-white transition">
                        <option value="">Choisir un ingrédient ou une mise en place…</option>
                        {(() => {
                          const meps = allRecipes.filter((r) => r.id !== editingId && r.is_prep);
                          return meps.length > 0 ? (
                            <optgroup label="Mises en place">
                              {meps.map((r) => <option key={r.id} value={`mep:${r.id}`}>{r.name}</option>)}
                            </optgroup>
                          ) : null;
                        })()}
                        <optgroup label="Ingrédients">
                          {/* Un produit désactivé ne peut plus être AJOUTÉ. On le garde tout de même
                              dans la liste s’il est déjà choisi sur cette ligne : sinon le sélecteur
                              s’afficherait vide et un enregistrement effacerait la ligne sans le dire. */}
                          {ingredients
                            .filter((i) => i.is_active !== false || line.ingredient_id === i.id)
                            .map((i) => (
                              <option key={i.id} value={`ing:${i.id}`}>
                                {i.name}{i.is_active === false ? " — inactif, à remplacer" : ""}
                              </option>
                            ))}
                        </optgroup>
                      </select>

                      <input type="number" min="0" step="any" value={line.quantity}
                        onChange={(e) => updateLine(idx, "quantity", e.target.value)}
                        placeholder="Qty"
                        className="w-20 px-2 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition" />

                      {line.type === "ingredient" ? (() => {
                        // Unités limitées à la dimension du produit (kg → g/kg, L → ml/l…)
                        const iu = ingredients.find((g) => g.id === line.ingredient_id)?.unit;
                        const opts = iu === "g" || iu === "kg" ? ["g", "kg"]
                          : iu === "ml" || iu === "l" ? ["ml", "l"]
                          : iu === "unit" || iu === "piece" ? ["unit"]
                          : ["g", "kg", "ml", "l", "unit"];
                        return (
                          <select value={line.unit} onChange={(e) => updateLine(idx, "unit", e.target.value)}
                            className="w-16 px-2 py-2 text-xs border border-[#E5E7EB] rounded-lg outline-none focus:border-primary bg-white transition">
                            {opts.map((u) => <option key={u}>{u}</option>)}
                          </select>
                        );
                      })() : (() => {
                        const sub = allRecipes.find((r) => r.id === line.sub_recipe_id);
                        const opts = unitsForSubRecipe(sub?.yield_unit || "portion");
                        return (
                          <select value={line.unit} onChange={(e) => updateLine(idx, "unit", e.target.value)}
                            disabled={!sub}
                            className="w-16 px-2 py-2 text-xs border border-[#E5E7EB] rounded-lg outline-none focus:border-primary bg-white transition disabled:bg-gray-50 disabled:text-gray-400">
                            {opts.map((u) => <option key={u} value={u}>{u === "portion" ? "port." : u}</option>)}
                          </select>
                        );
                      })()}

                      <div className="w-16 text-right text-xs text-gray-500 pt-2.5">
                        {calcLineCost(line, ingredients, allRecipes).toFixed(3)} €
                      </div>

                      <button onClick={() => removeLine(idx)} title="Retirer cette ligne" aria-label="Retirer cette ligne" className="pt-2 text-gray-300 hover:text-red-400 transition">
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
                  <p className="text-lg font-medium text-gray-900">{eur(totalCost)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">
                    Coût par {YIELD_UNITS.find((u) => u.value === yieldUnit)?.label ?? yieldUnit}
                    {" "}(rendement {yieldPortions || 1})
                  </p>
                  <p className="text-lg font-medium text-emerald-700">{eur(costPerPortion)}</p>
                </div>
              </div>
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-[#E5E7EB]">
              <button onClick={() => setShowForm(false)} title="Fermer" aria-label="Fermer"
                className="flex-1 py-2 text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition">
                Annuler
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-container disabled:opacity-50 transition">
                {saving ? "Enregistrement…" : editingId ? "Enregistrer" : "Créer la recette"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="glass-card rounded-2xl p-2 mb-4 flex items-center">
        <div className="relative w-full max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "prep" ? "Rechercher une mise en place…" : "Rechercher une recette…"}
            className="w-full pl-9 pr-8 py-2 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface-variant/40"
          />
          {search && (
            <button onClick={() => setSearch("")} title="Effacer la recherche" aria-label="Effacer la recherche" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-on-surface-variant">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Recipe list */}
      {visibleRecipes.length === 0 ? (
        search.trim() ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <p className="text-sm text-on-surface-variant/70">Aucun résultat pour « {search} ».</p>
          </div>
        ) : (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">{tab === "prep" ? "🥣" : "👨‍🍳"}</div>
          <h2 className="text-base font-semibold text-on-surface mb-1">
            {tab === "prep" ? "Aucune mise en place" : "Aucune fiche technique"}
          </h2>
          <p className="text-sm text-on-surface-variant/70 mb-5">
            {tab === "prep"
              ? "Créez vos préparations de base (sauces, fonds, pâtes…) réutilisables dans vos fiches techniques."
              : "Créez votre première recette pour connaître le vrai coût de chaque plat."}
          </p>
          <button onClick={openAdd} className="inline-block px-5 py-2.5 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:bg-primary-container transition">
            {tab === "prep" ? "Créer la première mise en place" : "Créer la première recette"}
          </button>
        </div>
        )
      ) : (
        <div className="space-y-3">
          {visibleRecipes.map((recipe) => {
            const isExpanded = expandedId === recipe.id;
            const costPerPortion = recipe.total_cost / (recipe.yield_portions || 1);
            const yUnit = YIELD_UNITS.find((u) => u.value === (recipe.yield_unit || "portion"))?.label ?? recipe.yield_unit;
            // Coût HT sur CA HT : sans retirer la TVA du prix de carte, le
            // food cost serait systématiquement sous-estimé.
            const foodCost = foodCostPct(
              costPerPortion,
              Number(recipe.menu_price ?? 0),
              tauxDeVente("dine_in", estAlcool(recipe), tva),
            );
            const highCost = foodCost !== null && foodCost > 35;
            return (
              <div key={recipe.id} className="glass-card rounded-2xl overflow-hidden">
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-white/80 transition group"
                  onClick={() => setExpandedId(isExpanded ? null : recipe.id)}
                >
                  <Pastille type={typeDeRecette(recipe)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-primary truncate">{recipe.name}</span>
                      <BadgeType type={typeDeRecette(recipe)} court />
                      <span className="inline-flex px-2 py-0.5 rounded bg-surface-container-low text-on-surface-variant/70 text-[10px] font-bold uppercase tracking-wide">{recipe.category}</span>
                    </div>
                    <p className="text-xs text-on-surface-variant/60 mt-0.5">Rendement {recipe.yield_portions} {yUnit}</p>
                    {(recipe.allergens?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {recipe.allergens!.map((a) => (
                          <span key={a} className="px-1.5 py-0.5 text-2xs rounded bg-amber-light text-amber-dark font-bold">{a}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {foodCost !== null && (
                    <span className={clsx(
                      "text-2xs font-bold rounded-full whitespace-nowrap",
                      highCost ? "px-2.5 py-1 bg-error-container text-red" : "px-2.5 py-1 bg-emerald-50 text-primary border border-primary/10"
                    )}>
                      {foodCost.toFixed(1)}% FC
                    </span>
                  )}
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-on-surface tabular-nums">{eur(recipe.total_cost)}</p>
                    <p className="text-xs text-primary tabular-nums">{eur(costPerPortion)} / {yUnit}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link href={`${recipe.is_prep ? "/mises-en-place" : "/recipes"}/${recipe.id}`} onClick={(e) => e.stopPropagation()}
                      className="px-3 py-1.5 text-2xs font-semibold text-on-surface-variant border border-outline-variant/40 rounded-lg hover:bg-surface-container-high transition">
                      Ouvrir
                    </Link>
                    <button onClick={(e) => { e.stopPropagation(); handleDuplicate(recipe); }}
                      disabled={duplicatingId === recipe.id}
                      title="Dupliquer"
                      className="p-2 rounded-lg text-on-surface-variant/50 hover:bg-surface-container-high hover:text-primary transition disabled:opacity-50">
                      <Copy size={14} />
                    </button>
                    {/* Recette comptable à l'inventaire (facultatif — les MEP le sont toujours) */}
                    {!recipe.is_prep && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const next = !recipe.countable_in_inventory;
                          setRecipes((p) => p.map((r) => r.id === recipe.id ? { ...r, countable_in_inventory: next } : r));
                          const { error: tErr } = await supabase.from("recipes").update({ countable_in_inventory: next }).eq("id", recipe.id);
                          if (tErr) {
                            setRecipes((p) => p.map((r) => r.id === recipe.id ? { ...r, countable_in_inventory: !next } : r));
                            notify(`Impossible de modifier : ${tErr.message}`);
                          }
                        }}
                        title={recipe.countable_in_inventory ? "Cette recette est comptée à l'inventaire — clique pour la retirer" : "Ajouter au comptage d'inventaire"}
                        className={clsx("flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-2xs font-bold uppercase tracking-wide transition whitespace-nowrap",
                          recipe.countable_in_inventory
                            ? "text-on-primary bg-primary hover:bg-primary-container"
                            : "text-on-surface-variant/60 border border-outline-variant/40 hover:bg-surface-container-low hover:text-primary")}>
                        <ClipboardCheck size={13} />
                        {recipe.countable_in_inventory ? "Inventaire ✓" : "+ Inventaire"}
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(recipe.id); }}
                      disabled={deletingId === recipe.id}
                      title="Supprimer"
                      className="p-2 rounded-lg text-on-surface-variant/50 hover:text-red hover:bg-red-light transition disabled:opacity-50">
                      <Trash2 size={14} />
                    </button>
                    {isExpanded ? <ChevronUp size={16} className="text-on-surface-variant/40" /> : <ChevronDown size={16} className="text-on-surface-variant/40" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-outline-variant/20 bg-surface-container-low/30 px-5 py-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-2xs text-on-surface-variant/50 uppercase tracking-wide">
                          <th className="text-left pb-2">Ingrédient / Mise en place</th>
                          <th className="text-right pb-2">Quantité</th>
                          <th className="text-right pb-2">Coût</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant/10">
                        {recipe.recipe_lines.map((line, i) => {
                          const label = line.ingredients?.name ?? line.sub_recipe?.name ?? "—";
                          const isSubRecipe = !!line.sub_recipe_id;
                          const lineCost = savedLineCost(line, ingredients, allRecipes);
                          return (
                            <tr key={i}>
                              <td className="py-1.5 text-on-surface-variant">
                                {isSubRecipe && <span className="text-2xs font-bold text-blue mr-1">[mise en place]</span>}
                                {label}
                              </td>
                              <td className="text-right text-on-surface-variant/70">{line.quantity} {line.unit}</td>
                              <td className="text-right text-on-surface tabular-nums">{lineCost.toFixed(3)} €</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-outline-variant/20">
                          <td className="pt-2 text-2xs font-bold text-on-surface-variant/50 uppercase tracking-wide">Total recette</td>
                          <td />
                          <td className="pt-2 text-right font-semibold text-on-surface tabular-nums">{eur(recipe.total_cost)}</td>
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
