"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Pencil, Trash2, X } from "lucide-react";

const CATEGORIES = ["Produce", "Meat", "Fish", "Dairy", "Dry goods", "Beverage", "Other"];

type Supplier = { id: string; name: string; email: string | null; contact: string | null; category: string | null };
const EMPTY = { name: "", email: "", contact: "", category: "Other" };

interface Props { restaurantId: string; initialSuppliers: Supplier[] }

export default function SuppliersClient({ restaurantId, initialSuppliers }: Props) {
  const supabase = createClient();
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAdd() { setEditingId(null); setForm({ ...EMPTY }); setError(null); setShowForm(true); }
  function openEdit(s: Supplier) {
    setEditingId(s.id);
    setForm({ name: s.name, email: s.email ?? "", contact: s.contact ?? "", category: s.category ?? "Other" });
    setError(null); setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return setError("Supplier name is required.");
    setSaving(true);
    const payload = { name: form.name.trim(), email: form.email || null, contact: form.contact || null, category: form.category, restaurant_id: restaurantId };

    if (editingId) {
      const { data, error: err } = await supabase.from("suppliers").update(payload).eq("id", editingId).select().single();
      if (err) { setError(err.message); setSaving(false); return; }
      setSuppliers((p) => p.map((s) => s.id === editingId ? data : s));
    } else {
      const { data, error: err } = await supabase.from("suppliers").insert(payload).select().single();
      if (err) { setError(err.message); setSaving(false); return; }
      setSuppliers((p) => [...p, data]);
    }
    setSaving(false); setShowForm(false);
  }

  async function handleDelete(id: string) {
    await supabase.from("suppliers").delete().eq("id", id);
    setSuppliers((p) => p.filter((s) => s.id !== id));
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Suppliers</h1>
          <p className="text-sm text-gray-500 mt-0.5">{suppliers.length} supplier{suppliers.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 transition">
          <Plus size={15} /> Add supplier
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-card border border-[#E5E7EB] w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-base font-medium text-gray-900">{editingId ? "Edit supplier" : "New supplier"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
              {[
                { label: "Supplier name", key: "name", placeholder: "e.g. Metro Cash & Carry" },
                { label: "Email (for sending orders)", key: "email", placeholder: "orders@supplier.com" },
                { label: "Contact person", key: "contact", placeholder: "John Smith" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder}
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-[#E5E7EB]">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition">
                {saving ? "Saving…" : editingId ? "Save changes" : "Add supplier"}
              </button>
            </div>
          </div>
        </div>
      )}

      {suppliers.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-12 text-center">
          <div className="text-4xl mb-3">🚚</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">No suppliers yet</h2>
          <p className="text-sm text-gray-500 mb-5">Add your suppliers to link ingredients and send purchase orders.</p>
          <button onClick={openAdd} className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition">Add first supplier</button>
        </div>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Category</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Contact</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {suppliers.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">{s.category ?? "—"}</span></td>
                  <td className="px-4 py-3 text-gray-500">{s.email ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{s.contact ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEdit(s)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(s.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition"><Trash2 size={14} /></button>
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
