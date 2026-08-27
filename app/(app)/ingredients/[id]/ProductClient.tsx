"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Check, Plus, Trash2, Loader2, Package, Boxes, GitMerge, Pencil, ChefHat, Soup, Link2 } from "lucide-react";
import clsx from "clsx";
import {
  UNIT_OPTIONS, VAT_PRESETS, ALLERGENS, packTotal, calcCostPerBase, unitShort,
  displayUnitLabel, perDisplayUnit, priceTTC,
  qtyToDisplay, qtyFromDisplay, fmtNum,
} from "@/lib/ingredient-helpers";
import { eur } from "@/lib/format";

type Supplier = { id: string; name: string };
type Article = {
  id?: string;
  supplier_id: string;
  supplier_reference: string;
  pack_units: string;
  unit_size: string;
  pack_price: string;
  vat_rate: string;
  pack_type: string;
  pack_label: string;
  is_preferred: boolean;
};

const PACK_TYPES = ["colis", "caisse", "carton", "sac", "bidon", "cagette", "barquette", "bouteille", "pièce", "palette"];
type Ingredient = {
  id: string; name: string; category: string; unit: string;
  supplier_id: string | null; supplier_reference: string | null;
  pack_price: number; pack_units: number | null; unit_size: number | null;
  pack_quantity: number; vat_rate: number; yield_pct: number | null;
  reorder_threshold: number | null; selling_price: number | null;
  cost_per_base_unit: number; cmup: number | null; stock_qty: number | null;
  allergens: string[] | null;
  ingredient_suppliers?: any[];
};

type UsageRef = { id: string; name: string; category: string | null; is_prep: boolean };
interface Props {
  ingredient: Ingredient;
  suppliers: Supplier[];
  categories: string[];
  allIngredients: { id: string; name: string; unit: string }[];
  usedIn?: UsageRef[];
}

// Build the initial article list: from ingredient_suppliers if present,
// otherwise synthesize one preferred article from the legacy ingredient fields.
function initialArticles(ing: Ingredient): Article[] {
  const rows = ing.ingredient_suppliers ?? [];
  if (rows.length > 0) {
    const arts = rows.map((s: any) => ({
      id: s.id,
      supplier_id: s.supplier_id ?? "",
      supplier_reference: s.supplier_reference ?? "",
      pack_units: String(s.pack_units ?? 1),
      unit_size: String(s.unit_size ?? ""),
      pack_price: String(s.pack_price ?? ""),
      vat_rate: String(s.vat_rate ?? 0),
      pack_type: s.pack_type ?? "colis",
      pack_label: s.pack_label ?? "",
      is_preferred: !!s.is_preferred,
    }));
    if (!arts.some((a) => a.is_preferred)) arts[0].is_preferred = true;
    return arts;
  }
  // Legacy: one article from the ingredient's own purchase fields
  return [{
    supplier_id: ing.supplier_id ?? "",
    supplier_reference: ing.supplier_reference ?? "",
    pack_units: String(ing.pack_units ?? 1),
    unit_size: String(ing.unit_size ?? ing.pack_quantity ?? ""),
    pack_price: String(ing.pack_price ?? ""),
    vat_rate: String(ing.vat_rate ?? 0),
    pack_type: "colis",
    pack_label: "",
    is_preferred: true,
  }];
}

export default function ProductClient({ ingredient, suppliers, categories, allIngredients, usedIn = [] }: Props) {
  const supabase = createClient();
  const router = useRouter();

  const [name, setName] = useState(ingredient.name);
  const [category, setCategory] = useState(ingredient.category);
  const [unit, setUnit] = useState(ingredient.unit || "kg");
  const [yieldPct, setYieldPct] = useState(String(ingredient.yield_pct ?? 100));
  const [reorder, setReorder] = useState(String(qtyToDisplay(Number(ingredient.reorder_threshold ?? 0), ingredient.unit || "kg")));
  const [sellingPrice, setSellingPrice] = useState(ingredient.selling_price != null ? String(ingredient.selling_price) : "");
  const [allergens, setAllergens] = useState<string[]>(ingredient.allergens ?? []);
  const [articles, setArticles] = useState<Article[]>(initialArticles(ingredient));
  // Conditionnement secondaire (optionnel) : « 1 bouteille = 0,75 L » —
  // permet de compter l'inventaire (et libeller les commandes sans article)
  // dans ce conditionnement plutôt qu'en unité de base.
  const [secLabel, setSecLabel] = useState<string>((ingredient as any).secondary_unit_label ?? "");
  const [secSize, setSecSize] = useState<string>((ingredient as any).secondary_unit_size != null ? String((ingredient as any).secondary_unit_size) : "");

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [merging, setMerging] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const yPct = parseFloat(yieldPct) || 100;

  // Ancien produit en g/ml qu'on passe en kg/L : les tailles saisies étaient
  // en g/ml → ÷1000 pour rester honnête (1000 g → 1 kg). Partagé entre
  // l'aperçu live et la sauvegarde pour que les deux affichent le même coût.
  const legacyRescale =
    (ingredient.unit === "g" && unit === "kg") || (ingredient.unit === "ml" && unit === "l") ? 1000 : 1;
  const sizeOf = (a: Article) => (parseFloat(a.unit_size) || 0) / legacyRescale;

  // €/display-unit of an article (for the live "revient à" hint)
  const articleGross = (a: Article) => calcCostPerBase(parseFloat(a.pack_price) || 0, parseFloat(a.pack_units) || 1, sizeOf(a), unit);

  function toggleAllergen(a: string) {
    setAllergens((p) => p.includes(a) ? p.filter((x) => x !== a) : [...p, a]);
  }
  function addArticle() {
    setArticles((p) => [...p, {
      supplier_id: "", supplier_reference: "", pack_units: "1", unit_size: "",
      pack_price: "", vat_rate: "5.5", pack_type: "colis", pack_label: "", is_preferred: false,
    }]);
  }
  function updateArticle(i: number, f: keyof Article, v: string | boolean) {
    setArticles((p) => p.map((a, idx) => idx === i ? { ...a, [f]: v } : a));
  }
  function removeArticle(i: number) {
    setArticles((p) => p.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) return setError("Le nom est requis.");
    if (yPct <= 0 || yPct > 100) return setError("Le rendement doit être entre 1 et 100 %.");
    const secSizeNum = parseFloat(secSize) || 0;
    if (secLabel.trim() && secSizeNum <= 0) return setError("Conditionnement secondaire : indique sa taille (ex. 0,75).");
    if (!secLabel.trim() && secSizeNum > 0) return setError("Conditionnement secondaire : indique son nom (ex. bouteille).");
    // Un article incomplet serait silencieusement supprimé à l'enregistrement.
    const incomplet = articles.findIndex((a) => (a.supplier_id || a.supplier_reference || a.pack_price || a.unit_size) && !(parseFloat(a.pack_price) >= 0 && sizeOf(a) > 0));
    if (incomplet >= 0) {
      return setError(`Article n°${incomplet + 1} incomplet : renseigne le prix ET la contenance (ou retire la ligne).`);
    }
    // Garde-fou numérique : une valeur négative fausserait le coût par unité.
    const negatif = articles.find((a) => parseFloat(a.pack_units) < 0 || parseFloat(a.unit_size) < 0 || parseFloat(a.pack_price) < 0);
    if (negatif) return setError("Les quantités et prix des articles doivent être positifs.");
    const reorderNum = parseFloat(reorder);
    if (reorder !== "" && (isNaN(reorderNum) || reorderNum < 0)) return setError("Le seuil d'alerte doit être un nombre positif.");
    if (sellingPrice !== "" && !(parseFloat(sellingPrice) >= 0)) return setError("Le prix de vente doit être un nombre positif.");

    const validArticles = articles.filter((a) => parseFloat(a.pack_price) >= 0 && sizeOf(a) > 0);
    setSaving(true);

    // Reference article = cheapest priced one (drives the fallback cost +
    // the "main" supplier on the product; the real recipe cost follows CMUP).
    const priced = validArticles.filter((a) => (parseFloat(a.pack_price) || 0) > 0);
    const pref = (priced.length > 0 ? [...priced].sort((a, b) => articleGross(a) - articleGross(b))[0] : validArticles[0]);
    const pUnits = pref ? parseFloat(pref.pack_units) || 1 : 1;
    const uSize = pref ? sizeOf(pref) : 0;
    const pPrice = pref ? parseFloat(pref.pack_price) || 0 : 0;
    const vat = pref ? parseFloat(pref.vat_rate) || 0 : 0;
    const cost_per_base_unit = pref ? calcCostPerBase(pPrice, pUnits, uSize, unit) : 0;

    const payload = {
      name: name.trim(), category, unit,
      supplier_id: pref?.supplier_id || null,
      supplier_reference: pref?.supplier_reference || null,
      pack_price: pPrice, pack_units: pUnits, unit_size: uSize, pack_quantity: packTotal(pUnits, uSize),
      vat_rate: vat, cost_per_base_unit,
      yield_pct: yPct, reorder_threshold: qtyFromDisplay(parseFloat(reorder) || 0, unit),
      selling_price: sellingPrice !== "" ? parseFloat(sellingPrice) : null,
      allergens,
      secondary_unit_label: secLabel.trim() || null,
      secondary_unit_size: secSizeNum > 0 ? secSizeNum / legacyRescale : null,
      updated_at: new Date().toISOString(),
    };
    const { error: err } = await supabase.from("ingredients").update(payload).eq("id", ingredient.id);
    if (err) { setError(err.message); setSaving(false); return; }

    // Réécriture des articles : on garde l'existant pour pouvoir le remettre,
    // sinon un échec d'insertion effacerait tous les prix fournisseurs.
    const { data: beforeArticles } = await supabase
      .from("ingredient_suppliers").select("*").eq("ingredient_id", ingredient.id);
    const { error: delArtErr } = await supabase.from("ingredient_suppliers").delete().eq("ingredient_id", ingredient.id);
    if (delArtErr) {
      setError(`Mise à jour des articles impossible : ${delArtErr.message}. Aucun article n'a été modifié.`);
      setSaving(false); return;
    }
    const rows = validArticles.map((a) => ({
      ingredient_id: ingredient.id,
      supplier_id: a.supplier_id || null,
      supplier_reference: a.supplier_reference || null,
      pack_units: parseFloat(a.pack_units) || 1,
      unit_size: sizeOf(a) || 1,
      unit,
      pack_price: parseFloat(a.pack_price) || 0,
      vat_rate: parseFloat(a.vat_rate) || 0,
      pack_type: a.pack_type || "colis",
      pack_label: a.pack_label || null,
      is_preferred: a === pref,
    }));
    if (rows.length > 0) {
      const { error: insArtErr } = await supabase.from("ingredient_suppliers").insert(rows);
      if (insArtErr) {
        // Restauration : ne jamais laisser le produit sans ses articles.
        if ((beforeArticles ?? []).length > 0) await supabase.from("ingredient_suppliers").insert(beforeArticles!);
        setError(`Enregistrement des articles impossible : ${insArtErr.message}. La version précédente a été rétablie.`);
        setSaving(false); return;
      }
    }

    // Historique de prix (comme sur l'écran Ingrédients) : une hausse manuelle
    // doit rester traçable et apparaître dans le récap hebdo.
    if (Math.abs(Number(ingredient.pack_price ?? 0) - pPrice) > 0.0001) {
      await supabase.from("ingredient_price_history").insert({
        ingredient_id: ingredient.id, old_price: ingredient.pack_price ?? null, new_price: pPrice, source: "manual",
      });
    }

    // Le coût des recettes dépend de ce produit : recalcul serveur.
    let recalcOk = true;
    try {
      const res = await fetch("/api/recalculate-recipes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId: (ingredient as any).restaurant_id }),
      });
      recalcOk = res.ok;
    } catch { recalcOk = false; }

    setSaving(false);
    if (recalcOk) {
      setToast("Enregistré ✓");
      setTimeout(() => setToast(null), 2500);
    } else {
      setError("Produit enregistré, mais le recalcul des coûts de recettes a échoué. Lance « Tout recalculer » depuis les recettes.");
    }
    router.refresh();
  }

  async function handleMerge() {
    if (!mergeTargetId) return;
    setError(null);
    setMerging(true);
    const src = ingredient;
    const targetId = mergeTargetId;

    // Échec en cours de route = données à moitié déplacées : chaque étape est
    // vérifiée et on n'efface le produit source qu'en toute dernière étape.
    function fail(msg: string) {
      setMerging(false);
      setError(`Fusion interrompue : ${msg}. Le produit « ${src.name} » n'a PAS été supprimé — relance la fusion.`);
      return false;
    }

    const { data: tgt, error: tgtErr } = await supabase
      .from("ingredients").select("stock_qty, cmup, cost_per_base_unit, allergens").eq("id", targetId).maybeSingle();
    if (tgtErr || !tgt) return fail(tgtErr?.message ?? "produit cible introuvable");

    const { error: rlErr } = await supabase.from("recipe_lines").update({ ingredient_id: targetId }).eq("ingredient_id", src.id);
    if (rlErr) return fail(`recettes non transférées (${rlErr.message})`);

    const { error: isErr } = await supabase.from("ingredient_suppliers").update({ ingredient_id: targetId }).eq("ingredient_id", src.id);
    if (isErr) return fail(`articles fournisseurs non transférés (${isErr.message})`);

    if (src.supplier_id) {
      await supabase.from("ingredient_suppliers").insert({
        ingredient_id: targetId, supplier_id: src.supplier_id, supplier_reference: src.supplier_reference,
        pack_units: src.pack_units ?? 1, unit_size: src.unit_size ?? src.pack_quantity ?? 1, unit: src.unit,
        pack_price: src.pack_price ?? 0, vat_rate: src.vat_rate ?? 0,
      }); // best-effort : doublon d'article possible, sans impact sur le stock
    }

    const { error: smErr } = await supabase.from("stock_movements").update({ ingredient_id: targetId }).eq("ingredient_id", src.id);
    if (smErr) return fail(`historique des mouvements non transféré (${smErr.message})`);

    await supabase.from("ingredient_price_history").update({ ingredient_id: targetId }).eq("ingredient_id", src.id);

    const tStock = Number(tgt?.stock_qty ?? 0), sStock = Number(src.stock_qty ?? 0);
    const tC = Number(tgt?.cmup ?? tgt?.cost_per_base_unit ?? 0), sC = Number(src.cmup ?? src.cost_per_base_unit ?? 0);
    const newStock = tStock + sStock;
    const newCmup = newStock > 0 ? (tStock * tC + sStock * sC) / newStock : (tC || sC);
    const mergedAllergens = Array.from(new Set([...((tgt?.allergens as string[]) ?? []), ...(src.allergens ?? [])]));
    const { error: updErr } = await supabase.from("ingredients")
      .update({ stock_qty: newStock, cmup: newCmup, allergens: mergedAllergens }).eq("id", targetId);
    if (updErr) return fail(`stock cumulé non enregistré (${updErr.message})`);

    // Tout est transféré : on DÉSACTIVE le doublon au lieu de l’effacer.
    // Le supprimer emporterait ce qui n’a pas pu être transféré (lignes de
    // commande, de facture, de bon de livraison) et laisserait des trous
    // dans l’historique d’achat.
    const { error: delErr } = await supabase.from("ingredients").update({ is_active: false }).eq("id", src.id);
    if (delErr) {
      setMerging(false);
      setError(`Les données ont été transférées vers « ${mergeTargets.find((t) => t.id === targetId)?.name ?? "le produit cible"} », mais l'ancien produit n'a pas pu être supprimé (${delErr.message}). Supprime-le manuellement.`);
      return;
    }

    await fetch("/api/recalculate-recipes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId: (ingredient as any).restaurant_id }),
    }).catch(() => {});
    router.push(`/ingredients/${targetId}`);
  }

  const mergeTargets = allIngredients.filter((i) => i.unit === ingredient.unit);
  const inputCls = "w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition";
  const uLabel = displayUnitLabel(unit);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto pb-24">
      <datalist id="pack-types">{PACK_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-5">
        <Link href="/ingredients" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
          <ArrowLeft size={16} /> Tous les produits
        </Link>
        <div className="flex items-center gap-2">
          {toast && <span className="text-sm text-emerald-600 font-medium">{toast}</span>}
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-container disabled:opacity-50 transition">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Enregistrer
          </button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      {/* Identity */}
      <div className="bg-white border border-gray-100 rounded-card shadow-card p-5 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {editingName ? (
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
                onBlur={() => setEditingName(false)} onKeyDown={(e) => { if (e.key === "Enter") setEditingName(false); }}
                className={clsx(inputCls, "text-xl font-bold")} />
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900 truncate">{name || "Sans nom"}</h1>
                <button onClick={() => setEditingName(true)} className="p-1 text-gray-300 hover:text-gray-600 transition" title="Modifier le nom">
                  <Pencil size={14} />
                </button>
              </div>
            )}
          </div>
          <div className="w-44 shrink-0">
            <label className="block text-2xs font-medium text-gray-500 uppercase tracking-wide mb-1">Catégorie</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={clsx(inputCls, "py-1.5")}>
              {Array.from(new Set([...categories, category].filter(Boolean))).map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* 1. Conditionnement d'usage */}
      <Section teinte="usage" icon={<Package size={16} />} title="Conditionnement d'usage — recettes & inventaires" subtitle="L'unité dans laquelle tu l'utilises en recette et la comptes en inventaire (kg, L ou pièce). C'est la base de tout. Le conditionnement de commande (colis) se règle plus bas, il ne sert qu'aux commandes.">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unité d'usage</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
              {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              {/* Ancien produit pas encore migré (g/ml) : on montre son unité réelle, convertie à l'enregistrement du script de migration */}
              {!UNIT_OPTIONS.some((u) => u.value === unit) && <option value={unit}>{unit} (ancien format)</option>}
            </select>
            <p className="text-2xs text-gray-400 mt-1">recettes & inventaires dans cette unité</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Part utilisable (%)</label>
            <input type="number" min="1" max="100" step="any" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} className={inputCls} />
            <p className="text-2xs text-gray-400 mt-1">après épluchage/parage</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Alerte stock sous</label>
            <div className="relative">
              <input type="number" min="0" step="any" value={reorder} onChange={(e) => setReorder(e.target.value)} className={clsx(inputCls, "pr-9")} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{uLabel}</span>
            </div>
            <p className="text-2xs text-gray-400 mt-1">« à commander » si stock ≤</p>
          </div>
        </div>

        {/* Conditionnement secondaire — compter en bouteilles/boîtes plutôt qu'en kg/L */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-600 mb-2">
            Conditionnement secondaire <span className="text-gray-400 font-normal">(optionnel)</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-500">1</span>
            <input list="sec-units" value={secLabel} onChange={(e) => setSecLabel(e.target.value)}
              placeholder="ex. bouteille" className={clsx(inputCls, "w-36")} />
            <span className="text-sm text-gray-500">=</span>
            <div className="relative w-28">
              <input type="number" min="0" step="any" value={secSize} onChange={(e) => setSecSize(e.target.value)}
                placeholder="0.75" className={clsx(inputCls, "pr-9")} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{uLabel}</span>
            </div>
            {secLabel.trim() && (parseFloat(secSize) || 0) > 0 && (
              <button onClick={() => { setSecLabel(""); setSecSize(""); }}
                className="text-2xs text-gray-400 hover:text-red-500 underline">retirer</button>
            )}
          </div>
          <datalist id="sec-units">
            {["bouteille", "boîte", "pot", "barquette", "sachet", "portion", "pièce"].map((t) => <option key={t} value={t} />)}
          </datalist>
          <p className="text-2xs text-gray-400 mt-1.5">
            Pour compter l&apos;inventaire dans ce conditionnement plutôt qu&apos;en {uLabel} — ex. « 1 bouteille = 0,75 L » : tu saisiras « 12 bouteilles » et le stock sera converti automatiquement.
          </p>
        </div>
      </Section>

      {/* 2. Articles */}
      <Section teinte="achat" icon={<Boxes size={16} />} title="Conditionnement de commande — articles fournisseurs"
        subtitle="Un article par fournisseur : sa référence, son conditionnement de commande (colis / caisse…) et son prix. Sert uniquement pour passer les commandes et le bon de commande — jamais pour les recettes ni l'inventaire."
        action={<button onClick={addArticle} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"><Plus size={13} /> Ajouter un article</button>}>
        {articles.length === 0 ? (
          <p className="text-xs text-gray-400">Aucun article. Ajoute la référence d'achat d'au moins un fournisseur.</p>
        ) : (
          <div className="space-y-3">
            {articles.map((a, i) => {
              const cpb = parseFloat(a.pack_price) >= 0 && parseFloat(a.unit_size) > 0 ? perDisplayUnit(articleGross(a), unit) : 0;
              const ttc = priceTTC(parseFloat(a.pack_price) || 0, parseFloat(a.vat_rate) || 0);
              return (
                <div key={i} className="border border-gray-200 bg-gray-50/40 rounded-lg p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-semibold text-gray-400 shrink-0">#{i + 1}</span>
                    <select value={a.supplier_id} onChange={(e) => updateArticle(i, "supplier_id", e.target.value)} className={clsx(inputCls, "flex-1 py-1.5")}>
                      <option value="">Choisir un fournisseur…</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button onClick={() => removeArticle(i)} title="Supprimer cet article" aria-label="Supprimer cet article" className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition shrink-0"><Trash2 size={14} /></button>
                  </div>

                  <p className="text-2xs font-medium text-gray-400 uppercase tracking-wide">Conditionnement de commande (colissage)</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <span className="text-xs text-gray-500 pb-2">1</span>
                    <input list="pack-types" value={a.pack_type} onChange={(e) => updateArticle(i, "pack_type", e.target.value)} placeholder="colis" className="w-24 px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary" />
                    <span className="text-xs text-gray-500 pb-2">=</span>
                    <input type="number" min="1" step="any" value={a.pack_units} onChange={(e) => updateArticle(i, "pack_units", e.target.value)} placeholder="1" className="w-16 px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary" />
                    <span className="text-gray-400 pb-2">×</span>
                    <input type="number" min="0" step="any" value={a.unit_size} onChange={(e) => updateArticle(i, "unit_size", e.target.value)} placeholder="18" className="w-20 px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary" />
                    <span className="text-sm text-gray-500 pb-2">{unitShort(unit)}</span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <div className="relative w-28">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">€</span>
                      <input type="number" min="0" step="0.01" value={a.pack_price} onChange={(e) => updateArticle(i, "pack_price", e.target.value)} placeholder="prix HT" className="w-full pl-5 pr-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary" />
                    </div>
                    <select value={a.vat_rate} onChange={(e) => updateArticle(i, "vat_rate", e.target.value)} className="w-36 px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary">
                      {VAT_PRESETS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                    <input value={a.supplier_reference} onChange={(e) => updateArticle(i, "supplier_reference", e.target.value)} placeholder="réf. / code article" className="flex-1 min-w-[120px] px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-primary" />
                  </div>
                  <input value={a.pack_label} onChange={(e) => updateArticle(i, "pack_label", e.target.value)} placeholder="Conditionnement (texte libre, ex. « 75 cl / bouteille », « sac 18 kg »)" className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg outline-none focus:border-primary" />

                  {cpb > 0 && (
                    <p className="text-xs text-gray-500">
                      1 {a.pack_type || "colis"} = <b>{fmtNum(packTotal(parseFloat(a.pack_units) || 1, sizeOf(a)))} {unitShort(unit)}</b> · TTC {eur(ttc)} ·
                      <span className="text-emerald-600 font-medium"> {eur(cpb)}/{uLabel}</span>
                    </p>
                  )}
                </div>
              );
            })}
            <p className="text-2xs text-gray-400">Le coût des recettes suit le prix réellement payé (CMUP). En commande, chaque fournisseur propose son article avec son colissage et son prix.</p>
          </div>
        )}
      </Section>

      {/* 3. Allergènes */}
      <Section title="Allergènes" subtitle="14 allergènes réglementaires UE — hérités automatiquement par les recettes.">
        <div className="flex flex-wrap gap-1.5">
          {ALLERGENS.map((a) => {
            const on = allergens.includes(a);
            return (
              <button key={a} onClick={() => toggleAllergen(a)}
                className={clsx("px-2.5 py-1 rounded-full text-xs font-medium border transition",
                  on ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-600 border-gray-200 hover:border-amber-300")}>
                {a}
              </button>
            );
          })}
        </div>
      </Section>

      {/* 4. Revente directe */}
      <Section teinte="vente" title="Revente directe (optionnel)" subtitle="Si ce produit est vendu tel quel (canette, bouteille…).">
        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Prix de vente TTC</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
              <input type="number" min="0" step="0.01" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} placeholder="ex. 2.00" className={clsx(inputCls, "pl-6")} />
            </div>
          </div>
        </div>
      </Section>

      {/* Utilisé dans — recettes & mises en place */}
      <Section teinte="lien" icon={<Link2 size={16} />} title="Utilisé dans" subtitle={`${usedIn.length} recette(s) / mise(s) en place utilisent ce produit`}>
        {usedIn.length === 0 ? (
          <p className="text-sm text-gray-400">Ce produit n&apos;est utilisé dans aucune recette ni mise en place pour l&apos;instant.</p>
        ) : (
          <div className="space-y-4">
            {usedIn.some((u) => u.is_prep) && (
              <div>
                <p className="text-2xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Soup size={13} /> Mises en place</p>
                <div className="flex flex-wrap gap-2">
                  {usedIn.filter((u) => u.is_prep).map((m) => (
                    <Link key={m.id} href={`/mises-en-place/${m.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition">
                      <Soup size={13} /> {m.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {usedIn.some((u) => !u.is_prep) && (
              <div>
                <p className="text-2xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><ChefHat size={13} /> Recettes</p>
                <div className="flex flex-wrap gap-2">
                  {usedIn.filter((u) => !u.is_prep).map((r) => (
                    <Link key={r.id} href={`/recipes/${r.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition">
                      <ChefHat size={13} /> {r.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* 5. Fusionner */}
      <Section teinte="danger" icon={<GitMerge size={16} />} title="Fusionner avec un autre produit" subtitle="Réunit deux produits identiques (même unité) en un seul. Les articles, recettes et stock sont regroupés.">
        <button onClick={() => { setShowMerge(true); setMergeTargetId(""); }} disabled={mergeTargets.length === 0}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition">
          Fusionner ce produit…
        </button>
        {mergeTargets.length === 0 && <p className="text-xs text-gray-400 mt-2">Aucun autre produit en {uLabel} avec lequel fusionner.</p>}
      </Section>

      {/* Merge modal */}
      {showMerge && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-card border border-gray-200 w-full max-w-md shadow-xl my-12">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Fusionner « {ingredient.name} »</h2>
              <button onClick={() => setShowMerge(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-600">
                Choisis le produit <b>conservé</b>. « {ingredient.name} » sera supprimé et tous ses articles, recettes et stock basculés dessus.
              </p>
              <select value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)} className={inputCls}>
                <option value="">Choisir le produit à conserver…</option>
                {mergeTargets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠️ Action irréversible. Stocks additionnés, CMUP en moyenne pondérée.
              </p>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setShowMerge(false)} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">Annuler</button>
              <button onClick={handleMerge} disabled={merging || !mergeTargetId}
                className="flex-1 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-container disabled:opacity-50 transition flex items-center justify-center gap-1.5">
                {merging ? <Loader2 size={15} className="animate-spin" /> : <GitMerge size={15} />} Fusionner
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Teintes des sections d'une fiche produit. Elles ne décorent pas : chacune
 * dit à quoi sert le bloc, et surtout d'où vient le chiffre.
 *
 *   usage    marine  — l'unité de tes recettes et de tes inventaires
 *   achat    orange  — l'argent qui sort, le colisage du fournisseur
 *   vente    vert    — l'argent qui rentre
 *   lien     bleu    — ce qui relie ce produit à tes fiches
 *   danger   rouge   — une action difficile à défaire
 */
const TEINTES = {
  usage:  { bord: "border-l-4 border-l-primary",     pastille: "bg-tertiary-fixed text-primary",   titre: "text-primary" },
  achat:  { bord: "border-l-4 border-l-brand-orange", pastille: "bg-brand-orange/10 text-brand-orange-deep", titre: "text-brand-orange-deep" },
  vente:  { bord: "border-l-4 border-l-green",       pastille: "bg-green-light text-green-dark",   titre: "text-green-dark" },
  lien:   { bord: "border-l-4 border-l-blue",        pastille: "bg-blue-light text-blue-dark",     titre: "text-blue-dark" },
  danger: { bord: "border-l-4 border-l-red",         pastille: "bg-red-light text-red",            titre: "text-red" },
  neutre: { bord: "",                              pastille: "bg-gray-100 text-gray-500",        titre: "text-gray-900" },
} as const;

function Section({ icon, title, subtitle, action, teinte = "neutre", children }: {
  icon?: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode;
  teinte?: keyof typeof TEINTES; children: React.ReactNode;
}) {
  const t = TEINTES[teinte];
  return (
    <div className={clsx("bg-white border border-gray-100 rounded-card shadow-card p-5 mb-4", t.bord)}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-2.5">
          {icon && <div className={clsx("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", t.pastille)}>{icon}</div>}
          <div>
            <h2 className={clsx("text-sm font-semibold", t.titre)}>{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
