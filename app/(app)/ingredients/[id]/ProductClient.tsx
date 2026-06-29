"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Check, Plus, Trash2, Loader2, Package, Boxes, Star, GitMerge } from "lucide-react";
import clsx from "clsx";
import {
  UNITS, VAT_PRESETS, ALLERGENS, packTotal, calcCostPerBase,
  displayUnitLabel, perDisplayUnit, priceTTC,
  qtyToDisplay, qtyFromDisplay, fmtNum,
} from "@/lib/ingredient-helpers";

type Supplier = { id: string; name: string };
type Article = {
  id?: string;
  supplier_id: string;
  supplier_reference: string;
  pack_units: string;
  unit_size: string;
  pack_price: string;
  vat_rate: string;
  is_preferred: boolean;
};
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

interface Props {
  ingredient: Ingredient;
  suppliers: Supplier[];
  categories: string[];
  allIngredients: { id: string; name: string; unit: string }[];
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
    is_preferred: true,
  }];
}

export default function ProductClient({ ingredient, suppliers, categories, allIngredients }: Props) {
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

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [merging, setMerging] = useState(false);

  const yPct = parseFloat(yieldPct) || 100;

  // Article cost helpers
  const articleGross = (a: Article) => calcCostPerBase(parseFloat(a.pack_price) || 0, parseFloat(a.pack_units) || 1, parseFloat(a.unit_size) || 0, unit);
  const preferred = articles.find((a) => a.is_preferred) ?? articles[0];
  const prefGross = preferred ? articleGross(preferred) : 0;
  const cmup = Number(ingredient.cmup ?? 0);
  const grossBase = cmup > 0 ? cmup : prefGross;
  const netBase = yPct > 0 ? grossBase / (yPct / 100) : grossBase;
  const coutReel = perDisplayUnit(netBase, unit);
  const stockValue = Number(ingredient.stock_qty ?? 0) * grossBase;

  function toggleAllergen(a: string) {
    setAllergens((p) => p.includes(a) ? p.filter((x) => x !== a) : [...p, a]);
  }
  function addArticle() {
    setArticles((p) => [...p, {
      supplier_id: "", supplier_reference: "", pack_units: "1", unit_size: "",
      pack_price: "", vat_rate: "5.5", is_preferred: p.length === 0,
    }]);
  }
  function updateArticle(i: number, f: keyof Article, v: string | boolean) {
    setArticles((p) => p.map((a, idx) => idx === i ? { ...a, [f]: v } : a));
  }
  function setPreferred(i: number) {
    setArticles((p) => p.map((a, idx) => ({ ...a, is_preferred: idx === i })));
  }
  function removeArticle(i: number) {
    setArticles((p) => {
      const next = p.filter((_, idx) => idx !== i);
      if (next.length > 0 && !next.some((a) => a.is_preferred)) next[0].is_preferred = true;
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    if (!name.trim()) return setError("Le nom est requis.");
    if (yPct <= 0 || yPct > 100) return setError("Le rendement doit être entre 1 et 100 %.");
    const validArticles = articles.filter((a) => parseFloat(a.pack_price) >= 0 && parseFloat(a.unit_size) > 0);
    setSaving(true);

    // Preferred article drives the product's purchase fields + cost
    const pref = validArticles.find((a) => a.is_preferred) ?? validArticles[0];
    const pUnits = pref ? parseFloat(pref.pack_units) || 1 : 1;
    const uSize = pref ? parseFloat(pref.unit_size) || 0 : 0;
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
      updated_at: new Date().toISOString(),
    };
    const { error: err } = await supabase.from("ingredients").update(payload).eq("id", ingredient.id);
    if (err) { setError(err.message); setSaving(false); return; }

    // Rewrite the article list
    await supabase.from("ingredient_suppliers").delete().eq("ingredient_id", ingredient.id);
    const rows = validArticles.map((a) => ({
      ingredient_id: ingredient.id,
      supplier_id: a.supplier_id || null,
      supplier_reference: a.supplier_reference || null,
      pack_units: parseFloat(a.pack_units) || 1,
      unit_size: parseFloat(a.unit_size) || 1,
      unit,
      pack_price: parseFloat(a.pack_price) || 0,
      vat_rate: parseFloat(a.vat_rate) || 0,
      is_preferred: a.is_preferred,
    }));
    if (rows.length > 0) await supabase.from("ingredient_suppliers").insert(rows);

    setSaving(false);
    setToast("Enregistré ✓");
    setTimeout(() => setToast(null), 2500);
    router.refresh();
  }

  async function handleMerge() {
    if (!mergeTargetId) return;
    setMerging(true);
    const src = ingredient;
    const targetId = mergeTargetId;
    const { data: tgt } = await supabase.from("ingredients").select("stock_qty, cmup, cost_per_base_unit, allergens").eq("id", targetId).single();
    await supabase.from("recipe_lines").update({ ingredient_id: targetId }).eq("ingredient_id", src.id);
    await supabase.from("ingredient_suppliers").update({ ingredient_id: targetId }).eq("ingredient_id", src.id);
    if (src.supplier_id) {
      await supabase.from("ingredient_suppliers").insert({
        ingredient_id: targetId, supplier_id: src.supplier_id, supplier_reference: src.supplier_reference,
        pack_units: src.pack_units ?? 1, unit_size: src.unit_size ?? 1, unit: src.unit,
        pack_price: src.pack_price ?? 0, vat_rate: src.vat_rate ?? 0,
      });
    }
    const tStock = Number(tgt?.stock_qty ?? 0), sStock = Number(src.stock_qty ?? 0);
    const tC = Number(tgt?.cmup ?? tgt?.cost_per_base_unit ?? 0), sC = Number(src.cmup ?? src.cost_per_base_unit ?? 0);
    const newStock = tStock + sStock;
    const newCmup = newStock > 0 ? (tStock * tC + sStock * sC) / newStock : (tC || sC);
    const mergedAllergens = Array.from(new Set([...((tgt?.allergens as string[]) ?? []), ...(src.allergens ?? [])]));
    await supabase.from("ingredients").update({ stock_qty: newStock, cmup: newCmup, allergens: mergedAllergens }).eq("id", targetId);
    await supabase.from("stock_movements").update({ ingredient_id: targetId }).eq("ingredient_id", src.id);
    await supabase.from("ingredient_price_history").update({ ingredient_id: targetId }).eq("ingredient_id", src.id);
    await supabase.from("ingredients").delete().eq("id", src.id);
    await fetch("/api/recalculate-recipes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId: (ingredient as any).restaurant_id }),
    }).catch(() => {});
    router.push(`/ingredients/${targetId}`);
  }

  const mergeTargets = allIngredients.filter((i) => i.unit === ingredient.unit);
  const inputCls = "w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition";
  const uLabel = displayUnitLabel(unit);

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto pb-24">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-5">
        <Link href="/ingredients" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
          <ArrowLeft size={16} /> Tous les produits
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
            <label className="block text-xs font-medium text-gray-600 mb-1">Nom du produit</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={clsx(inputCls, "text-base font-semibold")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Catégorie</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
              {Array.from(new Set([...categories, category].filter(Boolean))).map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Cost summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-gray-100 rounded-card shadow-card p-4">
          <p className="text-2xs text-gray-400 uppercase tracking-wide">Coût réel</p>
          <p className="text-lg font-bold text-emerald-600">€{coutReel.toFixed(2)}<span className="text-xs text-gray-400 font-normal">/{uLabel}</span></p>
        </div>
        <div className="bg-white border border-gray-100 rounded-card shadow-card p-4">
          <p className="text-2xs text-gray-400 uppercase tracking-wide">En stock</p>
          <p className="text-lg font-bold text-gray-900">{fmtNum(qtyToDisplay(Number(ingredient.stock_qty ?? 0), unit))} <span className="text-xs text-gray-400 font-normal">{uLabel}</span></p>
        </div>
        <div className="bg-white border border-gray-100 rounded-card shadow-card p-4">
          <p className="text-2xs text-gray-400 uppercase tracking-wide">Valeur stock</p>
          <p className="text-lg font-bold text-gray-900">€{stockValue.toFixed(2)}</p>
        </div>
      </div>

      {/* 1. Conditionnement de base */}
      <Section icon={<Package size={16} />} title="Conditionnement de base" subtitle="Comment tu l'utilises en recette et tu le comptes en stock.">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unité d'usage</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
            <p className="text-2xs text-gray-400 mt-1">les recettes s'expriment dans cette unité</p>
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
      </Section>

      {/* 2. Articles */}
      <Section icon={<Boxes size={16} />} title="Articles (références d'achat)"
        subtitle="Chaque article = une référence chez un fournisseur, avec son conditionnement et son prix. Plusieurs articles peuvent alimenter ce produit."
        action={<button onClick={addArticle} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"><Plus size={13} /> Ajouter un article</button>}>
        {articles.length === 0 ? (
          <p className="text-xs text-gray-400">Aucun article. Ajoute la référence d'achat d'au moins un fournisseur.</p>
        ) : (
          <div className="space-y-3">
            {articles.map((a, i) => {
              const cpb = parseFloat(a.pack_price) >= 0 && parseFloat(a.unit_size) > 0 ? perDisplayUnit(articleGross(a), unit) : 0;
              const ttc = priceTTC(parseFloat(a.pack_price) || 0, parseFloat(a.vat_rate) || 0);
              return (
                <div key={i} className={clsx("border rounded-lg p-3 space-y-2.5", a.is_preferred ? "border-emerald-300 bg-emerald-50/30" : "border-gray-200 bg-gray-50/40")}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPreferred(i)} title={a.is_preferred ? "Article principal" : "Définir comme principal"}
                      className={clsx("shrink-0", a.is_preferred ? "text-amber-500" : "text-gray-300 hover:text-amber-400")}>
                      <Star size={16} fill={a.is_preferred ? "currentColor" : "none"} />
                    </button>
                    <select value={a.supplier_id} onChange={(e) => updateArticle(i, "supplier_id", e.target.value)} className={clsx(inputCls, "flex-1 py-1.5")}>
                      <option value="">Choisir un fournisseur…</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button onClick={() => removeArticle(i)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition shrink-0"><Trash2 size={14} /></button>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <span className="text-xs text-gray-500 pb-2">1 colis =</span>
                    <input type="number" min="1" step="any" value={a.pack_units} onChange={(e) => updateArticle(i, "pack_units", e.target.value)} placeholder="1" className="w-16 px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                    <span className="text-gray-400 pb-2">×</span>
                    <input type="number" min="0" step="any" value={a.unit_size} onChange={(e) => updateArticle(i, "unit_size", e.target.value)} placeholder="18" className="w-20 px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                    <span className="text-sm text-gray-500 pb-2">{unit}</span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <div className="relative w-28">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">€</span>
                      <input type="number" min="0" step="0.01" value={a.pack_price} onChange={(e) => updateArticle(i, "pack_price", e.target.value)} placeholder="prix HT" className="w-full pl-5 pr-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                    </div>
                    <select value={a.vat_rate} onChange={(e) => updateArticle(i, "vat_rate", e.target.value)} className="w-36 px-2 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500">
                      {VAT_PRESETS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                    <input value={a.supplier_reference} onChange={(e) => updateArticle(i, "supplier_reference", e.target.value)} placeholder="réf. / code article" className="flex-1 min-w-[120px] px-2.5 py-1.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                  </div>

                  {cpb > 0 && (
                    <p className="text-xs text-gray-500">
                      1 colis = <b>{packTotal(parseFloat(a.pack_units) || 1, parseFloat(a.unit_size) || 0)} {unit}</b> · TTC €{ttc.toFixed(2)} ·
                      <span className="text-emerald-600 font-medium"> €{cpb.toFixed(2)}/{uLabel}</span>
                    </p>
                  )}
                </div>
              );
            })}
            <p className="text-2xs text-gray-400">⭐ L'article « principal » sert de prix de référence et est pré-sélectionné dans les bons de commande. Le coût des recettes suit le prix réellement payé (CMUP).</p>
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
      <Section title="Revente directe (optionnel)" subtitle="Si ce produit est vendu tel quel (canette, bouteille…).">
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

      {/* 5. Fusionner */}
      <Section icon={<GitMerge size={16} />} title="Fusionner avec un autre produit" subtitle="Réunit deux produits identiques (même unité) en un seul. Les articles, recettes et stock sont regroupés.">
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
                className="flex-1 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition flex items-center justify-center gap-1.5">
                {merging ? <Loader2 size={15} className="animate-spin" /> : <GitMerge size={15} />} Fusionner
              </button>
            </div>
          </div>
        </div>
      )}
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
