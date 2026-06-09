"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Search, Pencil, Trash2, Check, ChevronDown } from "lucide-react";
import { PageHeader, Card, Button, Input, Select, Modal, Alert, Table, Th, Td, EmptyState } from "@/components/ui";
import clsx from "clsx";

const CATEGORIES = ["Légumes/Fruits", "Viande", "Poisson", "Produits laitiers", "Épicerie", "Boissons", "Autre"];
const UNITS = ["g", "kg", "ml", "l", "unit"];

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
  suppliers?: { name: string } | null;
  ingredient_tags?: { tag_id: string; tags: TagInfo }[];
};

const EMPTY_FORM = {
  name: "", category: "Légumes/Fruits", supplier_id: "",
  pack_description: "", pack_price: "", pack_quantity: "",
  unit: "g", vat_rate: "0", selling_price: "",
};

function calcCostPerBase(packPrice: number, packQty: number, unit: string): number {
  if (!packQty) return 0;
  let qty = packQty;
  if (unit === "kg") qty = packQty * 1000;
  if (unit === "l") qty = packQty * 1000;
  return packPrice / qty;
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
}

export default function IngredientsClient({ restaurantId, initialIngredients, suppliers, allTags }: Props) {
  const supabase = createClient();
  const [ingredients, setIngredients] = useState<Ingredient[]>(initialIngredients);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [filterTagId, setFilterTagId] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showTagDropdown, setShowTagDropdown] = useState(false);

  // Live calculations
  const priceHT = parseFloat(form.pack_price) || 0;
  const vatRate = parseFloat(form.vat_rate) || 0;
  const packQty = parseFloat(form.pack_quantity) || 0;
  const priceTTCVal = priceTTC(priceHT, vatRate);
  const previewCostPerBase = priceHT && packQty ? calcCostPerBase(priceHT, packQty, form.unit) : null;

  const filtered = useMemo(() =>
    ingredients.filter((i) => {
      const matchSearch = i.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = filterCategory === "All" || i.category === filterCategory;
      const matchTag = filterTagId === "All" || (i.ingredient_tags ?? []).some((it) => it.tag_id === filterTagId);
      return matchSearch && matchCat && matchTag;
    }), [ingredients, search, filterCategory, filterTagId]);

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setSelectedTagIds([]);
    setError(null);
    setShowForm(true);
  }

  function openEdit(ing: Ingredient) {
    setEditingId(ing.id);
    setForm({
      name: ing.name, category: ing.category, supplier_id: ing.supplier_id ?? "",
      pack_description: ing.pack_description ?? "", pack_price: String(ing.pack_price),
      pack_quantity: String(ing.pack_quantity), unit: ing.unit,
      vat_rate: String(ing.vat_rate ?? 0),
      selling_price: ing.selling_price != null ? String(ing.selling_price) : "",
    });
    setSelectedTagIds((ing.ingredient_tags ?? []).map((it) => it.tag_id));
    setError(null);
    setShowForm(true);
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }

  async function handleSave() {
    setError(null);
    const price = parseFloat(form.pack_price);
    const qty = parseFloat(form.pack_quantity);
    const vat = parseFloat(form.vat_rate) || 0;
    if (!form.name.trim()) return setError("Le nom est requis.");
    if (isNaN(price) || price < 0) return setError("Saisissez un prix d'achat HT valide.");
    if (isNaN(qty) || qty <= 0) return setError("La quantité du colis doit être supérieure à 0.");
    setSaving(true);

    const cost_per_base_unit = calcCostPerBase(price, qty, form.unit);
    const selling = form.selling_price !== "" ? parseFloat(form.selling_price) : null;
    const payload = {
      name: form.name.trim(), category: form.category,
      supplier_id: form.supplier_id || null,
      pack_description: form.pack_description || null,
      pack_price: price, pack_quantity: qty, unit: form.unit,
      cost_per_base_unit, vat_rate: vat,
      selling_price: selling,
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
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Quantité par colis</label>
                  <div className="flex gap-2">
                    <input type="number" min="0" step="any" value={form.pack_quantity}
                      onChange={(e) => setForm({ ...form, pack_quantity: e.target.value })}
                      placeholder="1"
                      className="flex-1 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition" />
                    <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                      className="w-16 px-2 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green transition">
                      {UNITS.map((u) => <option key={u}>{u}</option>)}
                    </select>
                  </div>
                </div>

                {previewCostPerBase !== null && (
                  <div className="flex items-end">
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-green/5 border border-green/20 rounded-lg w-full">
                      <Check size={13} className="text-green shrink-0" />
                      <div>
                        <p className="text-xs text-gray-400">Coût / {baseUnitLabel(form.unit)} (HT)</p>
                        <p className="text-sm font-semibold text-green">
                          €{previewCostPerBase.toFixed(4)}
                        </p>
                      </div>
                    </div>
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
                    {ing.pack_quantity} {ing.unit}
                    {ing.pack_description && <span className="text-gray-300 ml-1">· {ing.pack_description}</span>}
                  </Td>
                  <Td right><span className="text-gray-700">€{Number(ing.pack_price).toFixed(2)}</span></Td>
                  <Td right><span className="text-gray-500">{ing.vat_rate ?? 0}%</span></Td>
                  <Td right><span className="text-gray-700">€{ttc.toFixed(2)}</span></Td>
                  <Td right>
                    <span className="font-medium text-green">
                      €{Number(ing.cost_per_base_unit).toFixed(4)}/{baseUnitLabel(ing.unit)}
                    </span>
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
