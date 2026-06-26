"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Check, Plus, Trash2, Loader2, Package, ShoppingCart, Users } from "lucide-react";
import clsx from "clsx";
import {
  UNITS, VAT_PRESETS, ALLERGENS, packTotal, calcCostPerBase,
  baseUnitLabel, displayUnitLabel, perDisplayUnit, priceTTC,
} from "@/lib/ingredient-helpers";

type Supplier = { id: string; name: string };
type SupplierLine = {
  id?: string;
  supplier_id: string; supplier_reference: string;
  pack_units: string; unit_size: string; unit: string;
  pack_price: string; vat_rate: string;
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
}

export default function ProductClient({ ingredient, suppliers, categories }: Props) {
  const supabase = createClient();
  const router = useRouter();

  const [name, setName] = useState(ingredient.name);
  const [category, setCategory] = useState(ingredient.category);
  const [unit, setUnit] = useState(ingredient.unit || "kg");
  const [supplierId, setSupplierId] = useState(ingredient.supplier_id ?? "");
  const [supplierRef, setSupplierRef] = useState(ingredient.supplier_reference ?? "");
  const [packUnits, setPackUnits] = useState(String(ingredient.pack_units ?? 1));
  const [unitSize, setUnitSize] = useState(String(ingredient.unit_size ?? ingredient.pack_quantity ?? ""));
  const [packPrice, setPackPrice] = useState(String(ingredient.pack_price ?? ""));
  const [vatRate, setVatRate] = useState(String(ingredient.vat_rate ?? 0));
  const [yieldPct, setYieldPct] = useState(String(ingredient.yield_pct ?? 100));
  const [reorder, setReorder] = useState(String(ingredient.reorder_threshold ?? 0));
  const [sellingPrice, setSellingPrice] = useState(ingredient.selling_price != null ? String(ingredient.selling_price) : "");
  const [allergens, setAllergens] = useState<string[]>(ingredient.allergens ?? []);
  const [lines, setLines] = useState<SupplierLine[]>(
    (ingredient.ingredient_suppliers ?? []).map((s) => ({
      id: s.id, supplier_id: s.supplier_id ?? "", supplier_reference: s.supplier_reference ?? "",
      pack_units: String(s.pack_units ?? 1), unit_size: String(s.unit_size ?? ""),
      unit: s.unit ?? ingredient.unit, pack_price: String(s.pack_price ?? ""), vat_rate: String(s.vat_rate ?? 0),
    }))
  );
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live values
  const priceHT = parseFloat(packPrice) || 0;
  const pUnits = parseFloat(packUnits) || 0;
  const uSize = parseFloat(unitSize) || 0;
  const yPct = parseFloat(yieldPct) || 100;
  const packQty = packTotal(pUnits, uSize);
  const ttc = priceTTC(priceHT, parseFloat(vatRate) || 0);
  const grossPerBase = priceHT && packQty ? calcCostPerBase(priceHT, pUnits, uSize, unit) : 0;
  const netPerBase = yPct > 0 ? grossPerBase / (yPct / 100) : grossPerBase;
  const stockValue = Number(ingredient.stock_qty ?? 0) * Number(ingredient.cmup ?? grossPerBase);

  function toggleAllergen(a: string) {
    setAllergens((p) => p.includes(a) ? p.filter((x) => x !== a) : [...p, a]);
  }
  function addLine() {
    setLines((p) => [...p, { supplier_id: "", supplier_reference: "", pack_units: "1", unit_size: unitSize, unit, pack_price: "", vat_rate: vatRate }]);
  }
  function updateLine(i: number, f: keyof SupplierLine, v: string) {
    setLines((p) => p.map((l, idx) => idx === i ? { ...l, [f]: v } : l));
  }
  function removeLine(i: number) { setLines((p) => p.filter((_, idx) => idx !== i)); }

  async function handleSave() {
    setError(null);
    if (!name.trim()) return setError("Le nom est requis.");
    if (isNaN(priceHT) || priceHT < 0) return setError("Prix d'achat invalide.");
    if (pUnits <= 0 || uSize <= 0) return setError("Conditionnement de commande invalide.");
    if (yPct <= 0 || yPct > 100) return setError("Le rendement doit être entre 1 et 100 %.");
    setSaving(true);

    const payload = {
      name: name.trim(), category, unit,
      supplier_id: supplierId || null,
      supplier_reference: supplierRef || null,
      pack_price: priceHT, pack_units: pUnits, unit_size: uSize,
      pack_quantity: packQty, vat_rate: parseFloat(vatRate) || 0,
      yield_pct: yPct, reorder_threshold: parseFloat(reorder) || 0,
      selling_price: sellingPrice !== "" ? parseFloat(sellingPrice) : null,
      cost_per_base_unit: grossPerBase,
      allergens,
      updated_at: new Date().toISOString(),
    };

    const { error: err } = await supabase.from("ingredients").update(payload).eq("id", ingredient.id);
    if (err) { setError(err.message); setSaving(false); return; }

    // Track price change
    if (Math.abs(Number(ingredient.pack_price) - priceHT) > 0.0001) {
      await supabase.from("ingredient_price_history").insert({
        ingredient_id: ingredient.id, old_price: ingredient.pack_price, new_price: priceHT, source: "manual",
      });
    }

    // Sync alternate suppliers
    await supabase.from("ingredient_suppliers").delete().eq("ingredient_id", ingredient.id);
    const rows = lines.filter((l) => l.supplier_id).map((l) => ({
      ingredient_id: ingredient.id, supplier_id: l.supplier_id,
      supplier_reference: l.supplier_reference || null,
      pack_units: parseFloat(l.pack_units) || 1, unit_size: parseFloat(l.unit_size) || 1,
      unit: l.unit || unit, pack_price: parseFloat(l.pack_price) || 0, vat_rate: parseFloat(l.vat_rate) || 0,
    }));
    if (rows.length > 0) await supabase.from("ingredient_suppliers").insert(rows);

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
        <Link href="/ingredients" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
          <ArrowLeft size={16} /> Tous les ingrédients
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

      {/* Coût résumé */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-gray-100 rounded-card shadow-card p-4">
          <p className="text-2xs text-gray-400 uppercase tracking-wide">Coût réel</p>
          <p className="text-lg font-bold text-emerald-600">€{perDisplayUnit(netPerBase, unit).toFixed(2)}<span className="text-xs text-gray-400 font-normal">/{displayUnitLabel(unit)}</span></p>
        </div>
        <div className="bg-white border border-gray-100 rounded-card shadow-card p-4">
          <p className="text-2xs text-gray-400 uppercase tracking-wide">En stock</p>
          <p className="text-lg font-bold text-gray-900">{Number(ingredient.stock_qty ?? 0).toLocaleString("fr-FR")} <span className="text-xs text-gray-400 font-normal">{baseUnitLabel(unit)}</span></p>
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
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">{baseUnitLabel(unit)}</span>
            </div>
            <p className="text-2xs text-gray-400 mt-1">« à commander » si stock ≤</p>
          </div>
        </div>
      </Section>

      {/* 2. Conditionnement de commande */}
      <Section icon={<ShoppingCart size={16} />} title="Conditionnement de commande" subtitle="Comment tu l'achètes chez ton fournisseur principal.">
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <span className="text-sm text-gray-500 pb-2">1 colis =</span>
          <div>
            <label className="block text-2xs text-gray-400 mb-1">Nombre</label>
            <input type="number" min="1" step="any" value={packUnits} onChange={(e) => setPackUnits(e.target.value)} placeholder="6" className={clsx(inputCls, "w-20")} />
          </div>
          <span className="text-gray-400 pb-2.5">×</span>
          <div>
            <label className="block text-2xs text-gray-400 mb-1">Contenance</label>
            <input type="number" min="0" step="any" value={unitSize} onChange={(e) => setUnitSize(e.target.value)} placeholder="0,75" className={clsx(inputCls, "w-24")} />
          </div>
          <div>
            <label className="block text-2xs text-gray-400 mb-1">en</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={clsx(inputCls, "w-20")}>
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Prix payé (HT)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
              <input type="number" min="0" step="0.01" value={packPrice} onChange={(e) => setPackPrice(e.target.value)} className={clsx(inputCls, "pl-6")} />
            </div>
            <p className="text-2xs text-gray-400 mt-1">pour 1 colis</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">TVA</label>
            <select value={vatRate} onChange={(e) => setVatRate(e.target.value)} className={inputCls}>
              {VAT_PRESETS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Fournisseur</label>
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
              <option value="">Sans fournisseur</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Référence</label>
            <input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} placeholder="code article" className={inputCls} />
          </div>
        </div>

        {grossPerBase > 0 && (
          <div className="mt-3 flex items-start gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
            <Check size={15} className="text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-sm text-emerald-800">
              1 colis = <b>{packQty || 0} {unit}</b> · TTC €{ttc.toFixed(2)} · revient à{" "}
              <b>€{perDisplayUnit(netPerBase, unit).toFixed(2)}/{displayUnitLabel(unit)}</b>
            </p>
          </div>
        )}
      </Section>

      {/* 3. Fournisseurs */}
      <Section icon={<Users size={16} />} title="Fournisseurs" subtitle="Autres fournisseurs pour ce même produit (prix + référence pour les commandes)."
        action={<button onClick={addLine} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"><Plus size={13} /> Ajouter</button>}>
        {lines.length === 0 ? (
          <p className="text-xs text-gray-400">Aucun autre fournisseur. Le coût des recettes suit le prix réellement payé (CMUP).</p>
        ) : (
          <div className="space-y-2.5">
            {lines.map((line, i) => {
              const cpb = parseFloat(line.pack_price) > 0 && parseFloat(line.unit_size) > 0
                ? perDisplayUnit(calcCostPerBase(parseFloat(line.pack_price), parseFloat(line.pack_units) || 1, parseFloat(line.unit_size), line.unit), line.unit) : 0;
              return (
                <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                  <div className="flex gap-2">
                    <select value={line.supplier_id} onChange={(e) => updateLine(i, "supplier_id", e.target.value)} className={clsx(inputCls, "flex-1 py-1.5")}>
                      <option value="">Choisir un fournisseur…</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button onClick={() => removeLine(i)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition shrink-0"><Trash2 size={14} /></button>
                  </div>
                  <div className="flex gap-2">
                    <input value={line.supplier_reference} onChange={(e) => updateLine(i, "supplier_reference", e.target.value)} placeholder="Référence / code article" className={clsx(inputCls, "flex-1 py-1.5")} />
                    <div className="relative w-28">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">€</span>
                      <input type="number" min="0" step="0.01" value={line.pack_price} onChange={(e) => updateLine(i, "pack_price", e.target.value)} placeholder="prix HT" className={clsx(inputCls, "pl-5 py-1.5")} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span>1 colis =</span>
                    <input type="number" min="1" step="any" value={line.pack_units} onChange={(e) => updateLine(i, "pack_units", e.target.value)} className="w-14 px-2 py-1 text-xs bg-white border border-gray-200 rounded outline-none" />
                    <span>×</span>
                    <input type="number" min="0" step="any" value={line.unit_size} onChange={(e) => updateLine(i, "unit_size", e.target.value)} className="w-16 px-2 py-1 text-xs bg-white border border-gray-200 rounded outline-none" />
                    <select value={line.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} className="px-1.5 py-1 text-xs bg-white border border-gray-200 rounded outline-none">
                      {UNITS.map((u) => <option key={u}>{u}</option>)}
                    </select>
                    {cpb > 0 && <span className="ml-auto text-emerald-600 font-medium">€{cpb.toFixed(2)}/{displayUnitLabel(line.unit)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 4. Allergènes */}
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

      {/* 5. Revente directe */}
      <Section title="Revente directe (optionnel)" subtitle="Si ce produit est vendu tel quel (canette, bouteille…).">
        <div className="grid grid-cols-2 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Prix de vente TTC</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
              <input type="number" min="0" step="0.01" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} placeholder="ex. 2.00" className={clsx(inputCls, "pl-6")} />
            </div>
          </div>
          {sellingPrice && parseFloat(sellingPrice) > 0 && priceHT > 0 && (
            <div className="px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
              <p className="text-xs text-gray-500">Marge unitaire</p>
              <p className="text-sm font-semibold text-emerald-600">€{(parseFloat(sellingPrice) - priceHT).toFixed(2)}</p>
            </div>
          )}
        </div>
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
