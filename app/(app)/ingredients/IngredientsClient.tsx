"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Search, Pencil, Trash2, Check, ChevronDown } from "lucide-react";
import { PageHeader, Card, Button, Input, Select, Modal, Alert, Table, Th, Td, EmptyState } from "@/components/ui";
import clsx from "clsx";

const UNITS = ["g", "kg", "ml", "l", "unit"];

// 14 allergènes à déclaration obligatoire (règlement UE 1169/2011)
const ALLERGENS = [
  "Gluten", "Crustacés", "Œufs", "Poisson", "Arachides", "Soja", "Lait",
  "Fruits à coque", "Céleri", "Moutarde", "Sésame", "Sulfites", "Lupin", "Mollusques",
];

// Common EU VAT rates — user can type any value too
const VAT_PRESETS = [
  { label: "0% — Exonéré", value: "0" },
  { label: "5,5% — Produits alimentaires", value: "5.5" },
  { label: "10% — Restauration", value: "10" },
  { label: "20% — Taux normal", value: "20" },
];

type TagInfo = { id: string; name: string; color: string };
type Supplier = { id: string; name: string };
type Ingredient = {
  id: string; name: string; category: string; supplier_id: string | null;
  pack_description: string | null; pack_price: number; pack_quantity: number;
  unit: string; cost_per_base_unit: number; vat_rate: number;
  selling_price: number | null;
  pack_units?: number | null; unit_size?: number | null; yield_pct?: number | null;
  allergens?: string[] | null;
  suppliers?: { name: string } | null;
  ingredient_tags?: { tag_id: string; tags: TagInfo }[];
};

const EMPTY_FORM = {
  name: "", category: "Légumes/Fruits", supplier_id: "",
  pack_description: "", pack_price: "",
  pack_units: "1", unit_size: "", unit: "g",
  yield_pct: "100", vat_rate: "0", selling_price: "",
};

function toBaseUnits(qty: number, unit: string): number {
  return unit === "kg" || unit === "l" ? qty * 1000 : qty;
}

// Total quantity of one purchase pack, in the usage unit (e.g. 6 × 0.75 L = 4.5 L).
function packTotal(packUnits: number, unitSize: number): number {
  return (packUnits || 0) * (unitSize || 0);
}

// GROSS cost per base unit (g/ml/piece) — used for stock valuation. Yield is
// applied later at consumption, not here.
function calcCostPerBase(packPrice: number, packUnits: number, unitSize: number, unit: string): number {
  const totalBase = toBaseUnits(packTotal(packUnits, unitSize), unit);
  if (!totalBase) return 0;
  return packPrice / totalBase;
}

function baseUnitLabel(unit: string) {
  return unit === "kg" ? "g" : unit === "l" ? "ml" : unit;
}

function priceTTC(priceHT: number, vatRate: number) {
  return priceHT * (1 + vatRate / 100);
}

interface Props {
  restaurantId: string;
  initialIngredients: Ingredient[];
  suppliers: Supplier[];
  allTags: TagInfo[];
  categories: string[];
}

export default function IngredientsClient({ restaurantId, initialIngredients, suppliers, allTags, categories: CATEGORIES }: Props) {
  const supabase = createClient();
  const [ingredients, setIngredients] = useState<Ingredient[]>(initialIngredients);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterTagId, setFilterTagId] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedAllergens, setSelectedAllergens] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showTagDropdown, setShowTagDropdown] = useState(false);

  // Live calculations
  const priceHT = parseFloat(form.pack_price) || 0;
  const vatRate = parseFloat(form.vat_rate) || 0;
  const packUnits = parseFloat(form.pack_units) || 0;
  const unitSize = parseFloat(form.unit_size) || 0;
  const yieldPct = parseFloat(form.yield_pct) || 100;
  const packQty = packTotal(packUnits, unitSize);
  const priceTTCVal = priceTTC(priceHT, vatRate);
  const previewCostPerBase = priceHT && packQty ? calcCostPerBase(priceHT, packUnits, unitSize, form.unit) : null;
  // Net cost = gross / yield (real cost of an usable base unit, loss included)
  const previewNetCost = previewCostPerBase !== null && yieldPct > 0 ? previewCostPerBase / (yieldPct / 100) : previewCostPerBase;

  const filtered = useMemo(() =>
    ingredients.filter((i) => {
      const matchSearch = i.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = filterCategory === "All" || i.category === filterCategory;
      const matchTag = filterTagId === "All" || (i.ingredient_tags ?? []).some((it) => it.tag_id === filterTagId);
      return matchSearch && matchCat && matchTag;
    }), [ingredients, search, filterCategory, filterTagId]);

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, category: CATEGORIES[0] ?? EMPTY_FORM.category });
    setSelectedTagIds([]);
    setSelectedAllergens([]);
    setError(null);
    setShowForm(true);
  }

  function openEdit(ing: Ingredient) {
    setEditingId(ing.id);
    setForm({
      name: ing.name, category: ing.category, supplier_id: ing.supplier_id ?? "",
      pack_description: ing.pack_description ?? "", pack_price: String(ing.pack_price),
      pack_units: String(ing.pack_units ?? 1),
      unit_size: String(ing.unit_size ?? ing.pack_quantity ?? ""),
      unit: ing.unit,
      yield_pct: String(ing.yield_pct ?? 100),
      vat_rate: String(ing.vat_rate ?? 0),
      selling_price: ing.selling_price != null ? String(ing.selling_price) : "",
    });
    setSelectedTagIds((ing.ingredient_tags ?? []).map((it) => it.tag_id));
    setSelectedAllergens(ing.allergens ?? []);
    setError(null);
    setShowForm(true);
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }

  function toggleAllergen(a: string) {
    setSelectedAllergens((prev) =>
      prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]
    );
  }

  async function handleSave() {
    setError(null);
    const price = parseFloat(form.pack_price);
    const pUnits = parseFloat(form.pack_units);
    const uSize = parseFloat(form.unit_size);
    const yld = parseFloat(form.yield_pct);
    const vat = parseFloat(form.vat_rate) || 0;
    if (!form.name.trim()) return setError("Le nom est requis.");
    if (isNaN(price) || price < 0) return setError("Saisissez un prix d'achat HT valide.");
    if (isNaN(pUnits) || pUnits <= 0) return setError("Le nombre d'unités par colis doit être supérieur à 0.");
    if (isNaN(uSize) || uSize <= 0) return setError("La contenance par unité doit être supérieure à 0.");
    if (isNaN(yld) || yld <= 0 || yld > 100) return setError("Le rendement doit être entre 1 et 100 %.");
    setSaving(true);

    const qty = packTotal(pUnits, uSize); // total du colis, dans l'unité d'usage
    const cost_per_base_unit = calcCostPerBase(price, pUnits, uSize, form.unit);
    const selling = form.selling_price !== "" ? parseFloat(form.selling_price) : null;
    const payload = {
      name: form.name.trim(), category: form.category,
      supplier_id: form.supplier_id || null,
      pack_description: form.pack_description || null,
      pack_price: price, pack_quantity: qty, unit: form.unit,
      pack_units: pUnits, unit_size: uSize, yield_pct: yld,
      cost_per_base_unit, vat_rate: vat,
      selling_price: selling,
      allergens: selectedAllergens,
      restaurant_id: restaurantId,
      updated_at: new Date().toISOString(),
    };

    let ingredientId = editingId;

    if (editingId) {
      const old = ingredients.find((i) => i.id === editingId);
      const { data, error: err } = await supabase
        .from("ingredients").update(payload).eq("id", editingId)
        .select("*, suppliers(name)").single();
      if (err) { setError(err.message); setSaving(false); return; }
      if (old && Math.abs(old.pack_price - price) > 0.0001) {
        await supabase.from("ingredient_price_history").insert({
          ingredient_id: editingId, old_price: old.pack_price, new_price: price, source: "manual",
        });
      }
      // Update tags: delete all then re-insert
      await supabase.from("ingredient_tags").delete().eq("ingredient_id", editingId);
      if (selectedTagIds.length > 0) {
        await supabase.from("ingredient_tags").insert(
          selectedTagIds.map((tag_id) => ({ ingredient_id: editingId, tag_id }))
        );
      }
      // Re-fetch with tags
      const { data: withTags } = await supabase
        .from("ingredients")
        .select("*, suppliers(name), ingredient_tags(tag_id, tags(id, name, color))")
        .eq("id", editingId).single();
      setIngredients((p) => p.map((i) => i.id === editingId ? (withTags ?? data) : i));
    } else {
      const { data, error: err } = await supabase
        .from("ingredients").insert(payload)
        .select("*, suppliers(name)").single();
      if (err) { setError(err.message); setSaving(false); return; }
      ingredientId = data.id;
      await supabase.from("ingredient_price_history").insert({
        ingredient_id: data.id, old_price: null, new_price: price, source: "manual",
      });
      if (selectedTagIds.length > 0) {
        await supabase.from("ingredient_tags").insert(
          selectedTagIds.map((tag_id) => ({ ingredient_id: ingredientId, tag_id }))
        );
      }
      const { data: withTags } = await supabase
        .from("ingredients")
        .select("*, suppliers(name), ingredient_tags(tag_id, tags(id, name, color))")
        .eq("id", data.id).single();
      setIngredients((p) => [...p, withTags ?? data]);
    }

    setSaving(false);
    setShowForm(false);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await supabase.from("ingredients").delete().eq("id", id);
    setIngredients((p) => p.filter((i) => i.id !== id));
    setDeletingId(null);
  }

  return (
    <div className="p-7 max-w-6xl mx-auto">
      <PageHeader
        eyebrow="Catalogue"
        title="Ingrédients"
        subtitle={`${ingredients.length} ingrédient${ingredients.length !== 1 ? "s" : ""} dans votre bibliothèque`}
        action={<Button variant="primary" onClick={openAdd}><Plus size={14} /> Ajouter un ingrédient</Button>}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2.5 mb-5">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…"
            className="pl-8 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition w-52" />
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green transition">
          <option value="All">Toutes les catégories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        {allTags.length > 0 && (
          <select value={filterTagId} onChange={(e) => setFilterTagId(e.target.value)}
            className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green transition">
            <option value="All">Tous les tags</option>
            {allTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {/* Modal */}
      {showForm && (
        <Modal
          title={editingId ? "Modifier l'ingrédient" : "Ajouter un ingrédient"}
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowForm(false)} className="flex-1 justify-center">Annuler</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving} className="flex-1 justify-center">
                {saving ? "Enregistrement…" : editingId ? "Enregistrer" : "Ajouter"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {error && <Alert>{error}</Alert>}

            <div className="grid grid-cols-2 gap-3">
              <Input label="Nom" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="ex. Huile d'olive" className="col-span-2" />

              <Select label="Catégorie" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Array.from(new Set([...CATEGORIES, form.category].filter(Boolean))).map((c) => <option key={c}>{c}</option>)}
              </Select>

              <Select label="Fournisseur (optionnel)" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">Sans fournisseur</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>

              <Input label="Description du colis (optionnel)" value={form.pack_description}
                onChange={(e) => setForm({ ...form, pack_description: e.target.value })}
                placeholder="ex. sac 5kg, carton de 12" className="col-span-2" />
            </div>

            {/* Price + VAT section */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3 border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Prix</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Prix d&apos;achat HT (€)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                    <input type="number" min="0" step="0.01" value={form.pack_price}
                      onChange={(e) => setForm({ ...form, pack_price: e.target.value })}
                      placeholder="0.00"
                      className="w-full pl-6 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">TVA</label>
                  <select value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green transition">
                    {VAT_PRESETS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Prix TTC (€)</label>
                  <div className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 font-medium">
                    €{priceTTCVal.toFixed(2)}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Calculé automatiquement</p>
                </div>
              </div>

            </div>

            {/* Conditionnement d'achat (façon Yokitup) */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3 border border-gray-200">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Conditionnement d&apos;achat</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Unités / colis</label>
                  <input type="number" min="1" step="any" value={form.pack_units}
                    onChange={(e) => setForm({ ...form, pack_units: e.target.value })}
                    placeholder="ex. 6"
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition" />
                  <p className="text-xs text-gray-400 mt-1">bouteilles, œufs… (1 si vrac)</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Contenance / unité</label>
                  <input type="number" min="0" step="any" value={form.unit_size}
                    onChange={(e) => setForm({ ...form, unit_size: e.target.value })}
                    placeholder="ex. 0.75"
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Unité d&apos;usage</label>
                  <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green transition">
                    {UNITS.map((u) => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Rendement matière (%)</label>
                  <div className="relative">
                    <input type="number" min="1" max="100" step="any" value={form.yield_pct}
                      onChange={(e) => setForm({ ...form, yield_pct: e.target.value })}
                      placeholder="100"
                      className="w-full pr-7 pl-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">part utilisable après épluchage/parage</p>
                </div>

                {previewCostPerBase !== null && (
                  <div className="px-3 py-2.5 bg-green/5 border border-green/20 rounded-lg">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-400">Colis = {packQty || 0} {form.unit}</p>
                      <Check size={13} className="text-green shrink-0" />
                    </div>
                    <p className="text-sm font-semibold text-green mt-0.5">
                      €{(previewNetCost ?? 0).toFixed(4)} / {baseUnitLabel(form.unit)} réel
                    </p>
                    {yieldPct < 100 && (
                      <p className="text-2xs text-gray-400">brut €{previewCostPerBase.toFixed(4)} · rendement {yieldPct}%</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Prix de vente (produit revendu directement) */}
            <div className="bg-blue-50 rounded-lg p-4 space-y-2 border border-blue-100">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Revente directe (optionnel)</p>
              <p className="text-xs text-blue-500">Remplissez si ce produit est revendu tel quel (canette, bouteille…). Laissez vide pour les ingrédients de recettes.</p>
              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Prix de vente TTC (€)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                    <input type="number" min="0" step="0.01" value={form.selling_price}
                      onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                      placeholder="ex. 2.00"
                      className="w-full pl-6 pr-3 py-2 text-sm bg-white border border-blue-200 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition" />
                  </div>
                </div>
                {form.selling_price && parseFloat(form.selling_price) > 0 && priceHT > 0 && (
                  <div className="px-3 py-2.5 bg-white border border-blue-200 rounded-lg">
                    <p className="text-xs text-gray-400">Marge unitaire</p>
                    <p className="text-sm font-semibold text-emerald-600">
                      €{(parseFloat(form.selling_price) - priceHT).toFixed(2)}
                      <span className="text-xs text-gray-400 font-normal ml-1">
                        ({priceHT > 0 ? (((parseFloat(form.selling_price) - priceHT) / parseFloat(form.selling_price)) * 100).toFixed(0) : 0}%)
                      </span>
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Allergènes */}
            <div className="bg-amber-50 rounded-lg p-4 border border-amber-100">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Allergènes</p>
              <p className="text-xs text-amber-600 mb-3">14 allergènes réglementaires UE. Les recettes hériteront automatiquement de ceux-ci.</p>
              <div className="flex flex-wrap gap-1.5">
                {ALLERGENS.map((a) => {
                  const on = selectedAllergens.includes(a);
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => toggleAllergen(a)}
                      className={clsx(
                        "px-2.5 py-1 rounded-full text-xs font-medium border transition",
                        on
                          ? "bg-amber-500 text-white border-amber-500"
                          : "bg-white text-gray-600 border-gray-200 hover:border-amber-300"
                      )}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tags section */}
            {allTags.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Tags ingrédient</label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowTagDropdown((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition"
                  >
                    <div className="flex flex-wrap gap-1.5 min-h-[22px]">
                      {selectedTagIds.length === 0 ? (
                        <span className="text-gray-400">Choisir des tags…</span>
                      ) : (
                        selectedTagIds.map((id) => {
                          const tag = allTags.find((t) => t.id === id);
                          if (!tag) return null;
                          return (
                            <span key={id} className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                              style={{ backgroundColor: tag.color }}>
                              {tag.name}
                            </span>
                          );
                        })
                      )}
                    </div>
                    <ChevronDown size={14} className="text-gray-400 shrink-0 ml-2" />
                  </button>

                  {showTagDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-modal z-10 py-1 max-h-48 overflow-y-auto">
                      {allTags.map((tag) => {
                        const selected = selectedTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => { toggleTag(tag.id); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 transition text-left"
                          >
                            <div className={clsx("w-4 h-4 rounded border-2 flex items-center justify-center transition",
                              selected ? "border-transparent" : "border-gray-300")}
                              style={selected ? { backgroundColor: tag.color } : {}}>
                              {selected && <Check size={10} className="text-white" />}
                            </div>
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                            <span className="text-sm text-gray-700">{tag.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {showTagDropdown && (
                  <div className="fixed inset-0 z-[9]" onClick={() => setShowTagDropdown(false)} />
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon="🥦"
            title={ingredients.length === 0 ? "Aucun ingrédient" : "Aucun résultat"}
            description={ingredients.length === 0
              ? "Ajoutez votre premier ingrédient pour commencer à construire des recettes et suivre vos coûts."
              : "Essayez de modifier votre recherche ou vos filtres."}
            action={ingredients.length === 0
              ? <Button variant="primary" onClick={openAdd}><Plus size={14} /> Ajouter le premier ingrédient</Button>
              : undefined}
          />
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Nom</Th>
              <Th>Catégorie</Th>
              <Th>Tags</Th>
              <Th>Colis</Th>
              <Th right>Prix HT</Th>
              <Th right>TVA</Th>
              <Th right>Prix TTC</Th>
              <Th right>Coût / unité de base</Th>
              <Th right>Prix vente</Th>
              <Th right>Marge</Th>
              <Th>Fournisseur</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((ing) => {
              const ttc = priceTTC(ing.pack_price, ing.vat_rate ?? 0);
              const tags = (ing.ingredient_tags ?? []).map((it) => it.tags).filter(Boolean);
              return (
                <tr key={ing.id} className="row-hover">
                  <Td><span className="font-medium text-gray-900">{ing.name}</span></Td>
                  <Td>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      {ing.category}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {tags.length > 0
                        ? tags.map((tag) => (
                            <span key={tag.id} className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                              style={{ backgroundColor: tag.color }}>
                              {tag.name}
                            </span>
                          ))
                        : <span className="text-gray-300 text-xs">—</span>}
                    </div>
                  </Td>
                  <Td muted>
                    {(ing.pack_units ?? 1) > 1
                      ? <>{ing.pack_units} × {ing.unit_size ?? ing.pack_quantity} {ing.unit}</>
                      : <>{ing.unit_size ?? ing.pack_quantity} {ing.unit}</>}
                    {(ing.yield_pct ?? 100) < 100 && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-2xs font-medium">rdt {ing.yield_pct}%</span>
                    )}
                    {ing.pack_description && <span className="text-gray-300 ml-1">· {ing.pack_description}</span>}
                  </Td>
                  <Td right><span className="text-gray-700">€{Number(ing.pack_price).toFixed(2)}</span></Td>
                  <Td right><span className="text-gray-500">{ing.vat_rate ?? 0}%</span></Td>
                  <Td right><span className="text-gray-700">€{ttc.toFixed(2)}</span></Td>
                  <Td right>
                    {(() => {
                      const y = Number(ing.yield_pct ?? 100);
                      const net = y > 0 ? Number(ing.cost_per_base_unit) / (y / 100) : Number(ing.cost_per_base_unit);
                      return (
                        <span className="font-medium text-green">
                          €{net.toFixed(4)}/{baseUnitLabel(ing.unit)}
                          {y < 100 && <span className="block text-2xs text-gray-400 font-normal">brut €{Number(ing.cost_per_base_unit).toFixed(4)}</span>}
                        </span>
                      );
                    })()}
                  </Td>
                  <Td right>
                    {ing.selling_price != null
                      ? <span className="text-gray-700">€{Number(ing.selling_price).toFixed(2)}</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </Td>
                  <Td right>
                    {ing.selling_price != null
                      ? (() => {
                          const marge = ing.selling_price - ing.pack_price;
                          const pct = ing.selling_price > 0 ? (marge / ing.selling_price) * 100 : 0;
                          return (
                            <span className={marge >= 0 ? "font-medium text-emerald-600" : "font-medium text-red-500"}>
                              €{marge.toFixed(2)} <span className="text-xs text-gray-400">({pct.toFixed(0)}%)</span>
                            </span>
                          );
                        })()
                      : <span className="text-gray-300 text-xs">—</span>}
                  </Td>
                  <Td muted>{ing.suppliers?.name ?? "—"}</Td>
                  <Td right>
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEdit(ing)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleDelete(ing.id)} disabled={deletingId === ing.id}
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
