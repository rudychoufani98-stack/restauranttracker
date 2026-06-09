"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Search, Pencil, Trash2, X, Check } from "lucide-react";
import clsx from "clsx";

const CATEGORIES = ["Produce", "Meat", "Fish", "Dairy", "Dry goods", "Beverage", "Other"];
const UNITS = ["g", "kg", "ml", "l", "unit"];

type Supplier = { id: string; name: string };
type Ingredient = {
  id: string;
  name: string;
  category: string;
  supplier_id: string | null;
  pack_description: string | null;
  pack_price: number;
  pack_quantity: number;
  unit: string;
  cost_per_base_unit: number;
  suppliers?: { name: string } | null;
};

const EMPTY_FORM = {
  name: "",
  category: "Produce",
  supplier_id: "",
  pack_description: "",
  pack_price: "",
  pack_quantity: "",
  unit: "g",
};

function calcCostPerBase(packPrice: number, packQty: number, unit: string): number {
  if (!packQty || packQty === 0) return 0;
  // Convert to base unit (g or ml), kg→g, l→ml
  let qty = packQty;
  if (unit === "kg") qty = packQty * 1000;
  if (unit === "l") qty = packQty * 1000;
  return packPrice / qty;
}

function formatCost(cost: number, unit: string): string {
  const baseUnit = unit === "kg" ? "g" : unit === "l" ? "ml" : unit;
  return `€${cost.toFixed(4)}/${baseUnit}`;
}

interface Props {
  restaurantId: string;
  initialIngredients: Ingredient[];
  suppliers: Supplier[];
}

export default function IngredientsClient({ restaurantId, initialIngredients, suppliers }: Props) {
  const supabase = createClient();
  const [ingredients, setIngredients] = useState<Ingredient[]>(initialIngredients);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Live cost preview
  const previewCost = useMemo(() => {
    const price = parseFloat(form.pack_price);
    const qty = parseFloat(form.pack_quantity);
    if (!price || !qty) return null;
    return calcCostPerBase(price, qty, form.unit);
  }, [form.pack_price, form.pack_quantity, form.unit]);

  const filtered = useMemo(() => {
    return ingredients.filter((i) => {
      const matchSearch = i.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = filterCategory === "All" || i.category === filterCategory;
      return matchSearch && matchCat;
    });
  }, [ingredients, search, filterCategory]);

  function openAdd() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setError(null);
    setShowForm(true);
  }

  function openEdit(ing: Ingredient) {
    setEditingId(ing.id);
    setForm({
      name: ing.name,
      category: ing.category,
      supplier_id: ing.supplier_id ?? "",
      pack_description: ing.pack_description ?? "",
      pack_price: String(ing.pack_price),
      pack_quantity: String(ing.pack_quantity),
      unit: ing.unit,
    });
    setError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setError(null);
  }

  async function handleSave() {
    setError(null);
    const price = parseFloat(form.pack_price);
    const qty = parseFloat(form.pack_quantity);
    if (!form.name.trim()) return setError("Name is required.");
    if (isNaN(price) || price < 0) return setError("Enter a valid pack price.");
    if (isNaN(qty) || qty <= 0) return setError("Enter a valid pack quantity.");

    setSaving(true);
    const cost_per_base_unit = calcCostPerBase(price, qty, form.unit);
    const payload = {
      name: form.name.trim(),
      category: form.category,
      supplier_id: form.supplier_id || null,
      pack_description: form.pack_description || null,
      pack_price: price,
      pack_quantity: qty,
      unit: form.unit,
      cost_per_base_unit,
      restaurant_id: restaurantId,
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      // Get old price for history
      const old = ingredients.find((i) => i.id === editingId);
      const oldPrice = old?.pack_price ?? null;

      const { data, error: err } = await supabase
        .from("ingredients")
        .update(payload)
        .eq("id", editingId)
        .select("*, suppliers(name)")
        .single();

      if (err) { setError(err.message); setSaving(false); return; }

      // Write price history if price changed
      if (old && oldPrice !== price) {
        await supabase.from("ingredient_price_history").insert({
          ingredient_id: editingId,
          old_price: oldPrice,
          new_price: price,
          source: "manual",
        });
      }

      setIngredients((prev) => prev.map((i) => (i.id === editingId ? data : i)));
    } else {
      const { data, error: err } = await supabase
        .from("ingredients")
        .insert(payload)
        .select("*, suppliers(name)")
        .single();

      if (err) { setError(err.message); setSaving(false); return; }

      // Write initial price history
      await supabase.from("ingredient_price_history").insert({
        ingredient_id: data.id,
        old_price: null,
        new_price: price,
        source: "manual",
      });

      setIngredients((prev) => [...prev, data]);
    }

    setSaving(false);
    closeForm();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await supabase.from("ingredients").delete().eq("id", id);
    setIngredients((prev) => prev.filter((i) => i.id !== id));
    setDeletingId(null);
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Ingredients</h1>
          <p className="text-sm text-gray-500 mt-0.5">{ingredients.length} ingredient{ingredients.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 transition"
        >
          <Plus size={15} />
          Add ingredient
        </button>
      </div>

      {/* Search + filter */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ingredients…"
            className="w-full pl-8 pr-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition"
        >
          <option value="All">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Modal form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-card border border-[#E5E7EB] w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-base font-medium text-gray-900">
                {editingId ? "Edit ingredient" : "New ingredient"}
              </h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Olive oil"
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition"
                  >
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Supplier (optional)</label>
                  <select
                    value={form.supplier_id}
                    onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition"
                  >
                    <option value="">No supplier</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Pack description (optional)</label>
                  <input
                    value={form.pack_description}
                    onChange={(e) => setForm({ ...form, pack_description: e.target.value })}
                    placeholder="e.g. 5kg bag, case of 12"
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Pack price (€)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.pack_price}
                    onChange={(e) => setForm({ ...form, pack_price: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Pack quantity + unit</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={form.pack_quantity}
                      onChange={(e) => setForm({ ...form, pack_quantity: e.target.value })}
                      placeholder="1"
                      className="flex-1 min-w-0 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                    />
                    <select
                      value={form.unit}
                      onChange={(e) => setForm({ ...form, unit: e.target.value })}
                      className="px-2 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition"
                    >
                      {UNITS.map((u) => <option key={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Live cost preview */}
              {previewCost !== null && (
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg">
                  <Check size={14} className="text-emerald-600" />
                  <span className="text-sm text-emerald-700">
                    Cost per base unit: <strong>{formatCost(previewCost, form.unit)}</strong>
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2 px-5 py-4 border-t border-[#E5E7EB]">
              <button
                onClick={closeForm}
                className="flex-1 py-2 text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition"
              >
                {saving ? "Saving…" : editingId ? "Save changes" : "Add ingredient"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-12 text-center">
          <div className="text-4xl mb-3">🥦</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">
            {ingredients.length === 0 ? "No ingredients yet" : "No results found"}
          </h2>
          <p className="text-sm text-gray-500 mb-5">
            {ingredients.length === 0
              ? "Add your first ingredient to start building recipes and tracking costs."
              : "Try a different search or filter."}
          </p>
          {ingredients.length === 0 && (
            <button
              onClick={openAdd}
              className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition"
            >
              Add first ingredient
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Pack</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Pack price</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Cost / base unit</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Supplier</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {filtered.map((ing) => (
                <tr key={ing.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900">{ing.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{ing.category}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {ing.pack_quantity} {ing.unit}
                    {ing.pack_description && <span className="text-gray-400 ml-1">({ing.pack_description})</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-900">€{Number(ing.pack_price).toFixed(2)}</td>
                  <td className="px-4 py-3 font-medium text-emerald-700">{formatCost(ing.cost_per_base_unit, ing.unit)}</td>
                  <td className="px-4 py-3 text-gray-500">{ing.suppliers?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => openEdit(ing)}
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(ing.id)}
                        disabled={deletingId === ing.id}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
