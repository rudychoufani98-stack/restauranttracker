"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Search, Pencil, Trash2, Check } from "lucide-react";
import { PageHeader, Card, Badge, Button, Input, Select, Modal, Alert, Table, Th, Td, EmptyState } from "@/components/ui";

const CATEGORIES = ["Produce", "Meat", "Fish", "Dairy", "Dry goods", "Beverage", "Other"];
const UNITS = ["g", "kg", "ml", "l", "unit"];

type Supplier = { id: string; name: string };
type Ingredient = {
  id: string; name: string; category: string; supplier_id: string | null;
  pack_description: string | null; pack_price: number; pack_quantity: number;
  unit: string; cost_per_base_unit: number;
  suppliers?: { name: string } | null;
};

const EMPTY_FORM = { name: "", category: "Produce", supplier_id: "", pack_description: "", pack_price: "", pack_quantity: "", unit: "g" };

function calcCostPerBase(packPrice: number, packQty: number, unit: string): number {
  if (!packQty) return 0;
  let qty = packQty;
  if (unit === "kg") qty = packQty * 1000;
  if (unit === "l") qty = packQty * 1000;
  return packPrice / qty;
}

function formatCost(cost: number, unit: string): string {
  const base = unit === "kg" ? "g" : unit === "l" ? "ml" : unit;
  return `€${cost.toFixed(4)}/${base}`;
}

interface Props { restaurantId: string; initialIngredients: Ingredient[]; suppliers: Supplier[] }

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

  const previewCost = useMemo(() => {
    const price = parseFloat(form.pack_price);
    const qty = parseFloat(form.pack_quantity);
    if (!price || !qty) return null;
    return calcCostPerBase(price, qty, form.unit);
  }, [form.pack_price, form.pack_quantity, form.unit]);

  const filtered = useMemo(() =>
    ingredients.filter((i) => {
      const matchSearch = i.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = filterCategory === "All" || i.category === filterCategory;
      return matchSearch && matchCat;
    }), [ingredients, search, filterCategory]);

  function openAdd() { setEditingId(null); setForm({ ...EMPTY_FORM }); setError(null); setShowForm(true); }
  function openEdit(ing: Ingredient) {
    setEditingId(ing.id);
    setForm({ name: ing.name, category: ing.category, supplier_id: ing.supplier_id ?? "", pack_description: ing.pack_description ?? "", pack_price: String(ing.pack_price), pack_quantity: String(ing.pack_quantity), unit: ing.unit });
    setError(null); setShowForm(true);
  }

  async function handleSave() {
    setError(null);
    const price = parseFloat(form.pack_price);
    const qty = parseFloat(form.pack_quantity);
    if (!form.name.trim()) return setError("Name is required.");
    if (isNaN(price) || price < 0) return setError("Enter a valid pack price.");
    if (isNaN(qty) || qty <= 0) return setError("Pack quantity must be greater than 0.");
    setSaving(true);

    const cost_per_base_unit = calcCostPerBase(price, qty, form.unit);
    const payload = { name: form.name.trim(), category: form.category, supplier_id: form.supplier_id || null, pack_description: form.pack_description || null, pack_price: price, pack_quantity: qty, unit: form.unit, cost_per_base_unit, restaurant_id: restaurantId, updated_at: new Date().toISOString() };

    if (editingId) {
      const old = ingredients.find((i) => i.id === editingId);
      const { data, error: err } = await supabase.from("ingredients").update(payload).eq("id", editingId).select("*, suppliers(name)").single();
      if (err) { setError(err.message); setSaving(false); return; }
      if (old && Math.abs(old.pack_price - price) > 0.0001) {
        await supabase.from("ingredient_price_history").insert({ ingredient_id: editingId, old_price: old.pack_price, new_price: price, source: "manual" });
      }
      setIngredients((p) => p.map((i) => i.id === editingId ? data : i));
    } else {
      const { data, error: err } = await supabase.from("ingredients").insert(payload).select("*, suppliers(name)").single();
      if (err) { setError(err.message); setSaving(false); return; }
      await supabase.from("ingredient_price_history").insert({ ingredient_id: data.id, old_price: null, new_price: price, source: "manual" });
      setIngredients((p) => [...p, data]);
    }
    setSaving(false); setShowForm(false);
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
        title="Ingredients"
        subtitle={`${ingredients.length} ingredient${ingredients.length !== 1 ? "s" : ""} in your library`}
        action={<Button variant="primary" onClick={openAdd}><Plus size={14} /> Add ingredient</Button>}
      />

      {/* Search + filter */}
      <div className="flex gap-2.5 mb-5">
        <div className="relative w-64">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
            className="w-full pl-8 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition" />
        </div>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition">
          <option value="All">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Form modal */}
      {showForm && (
        <Modal
          title={editingId ? "Edit ingredient" : "Add ingredient"}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowForm(false)} className="flex-1 justify-center">Cancel</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving} className="flex-1 justify-center">
                {saving ? "Saving…" : editingId ? "Save changes" : "Add ingredient"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Olive oil, Chicken breast" />
            <div className="grid grid-cols-2 gap-3">
              <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
              <Select label="Supplier (optional)" value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })}>
                <option value="">No supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <Input label="Pack description (optional)" value={form.pack_description} onChange={(e) => setForm({ ...form, pack_description: e.target.value })} placeholder="e.g. 5kg bag, case of 12" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Pack price (€)" type="number" min="0" step="0.01" value={form.pack_price} onChange={(e) => setForm({ ...form, pack_price: e.target.value })} placeholder="0.00" />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Pack quantity + unit</label>
                <div className="flex gap-2">
                  <input type="number" min="0" step="any" value={form.pack_quantity} onChange={(e) => setForm({ ...form, pack_quantity: e.target.value })} placeholder="1"
                    className="flex-1 min-w-0 px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green focus:ring-1 focus:ring-green/30 transition" />
                  <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    className="w-16 px-2 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-green transition">
                    {UNITS.map((u) => <option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>
            {previewCost !== null && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-green/5 border border-green/20 rounded-lg">
                <Check size={13} className="text-green shrink-0" />
                <span className="text-sm text-green-dark">Cost per base unit: <strong>{formatCost(previewCost, form.unit)}</strong></span>
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
            title={ingredients.length === 0 ? "No ingredients yet" : "No results found"}
            description={ingredients.length === 0 ? "Add your first ingredient to start building recipes and tracking costs." : "Try adjusting your search or filter."}
            action={ingredients.length === 0 ? <Button variant="primary" onClick={openAdd}><Plus size={14} /> Add first ingredient</Button> : undefined}
          />
        </Card>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Category</Th>
              <Th>Pack</Th>
              <Th right>Pack price</Th>
              <Th right>Cost / base unit</Th>
              <Th>Supplier</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((ing) => (
              <tr key={ing.id} className="row-hover">
                <Td><span className="font-medium text-gray-900">{ing.name}</span></Td>
                <Td><Badge>{ing.category}</Badge></Td>
                <Td muted>
                  {ing.pack_quantity} {ing.unit}
                  {ing.pack_description && <span className="text-gray-300 ml-1">· {ing.pack_description}</span>}
                </Td>
                <Td right><span className="text-gray-700">€{Number(ing.pack_price).toFixed(2)}</span></Td>
                <Td right><span className="font-medium text-green">{formatCost(ing.cost_per_base_unit, ing.unit)}</span></Td>
                <Td muted>{ing.suppliers?.name ?? "—"}</Td>
                <Td right>
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => openEdit(ing)} className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"><Pencil size={13} /></button>
                    <button onClick={() => handleDelete(ing.id)} disabled={deletingId === ing.id} className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={13} /></button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
