"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Pencil, Trash2, X } from "lucide-react";

const CATEGORIES = ["Légumes/Fruits", "Viande", "Poisson", "Produits laitiers", "Épicerie", "Boissons", "Autre"];

type Supplier = { id: string; name: string; email: string | null; contact: string | null; category: string | null; min_order_amount: number | null; customer_reference: string | null };
const EMPTY = { name: "", email: "", contact: "", category: "Autre", min_order_amount: "", customer_reference: "" };

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
    setForm({ name: s.name, email: s.email ?? "", contact: s.contact ?? "", category: s.category ?? "Autre",
      min_order_amount: s.min_order_amount != null ? String(s.min_order_amount) : "", customer_reference: s.customer_reference ?? "" });
    setError(null); setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return setError("Le nom du fournisseur est requis.");
    setSaving(true);
    const payload = {
      name: form.name.trim(), email: form.email || null, contact: form.contact || null, category: form.category,
      min_order_amount: parseFloat(form.min_order_amount) || 0,
      customer_reference: form.customer_reference || null,
      restaurant_id: restaurantId,
    };

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
    const name = suppliers.find((s) => s.id === id)?.name ?? "ce fournisseur";
    if (!window.confirm(`Supprimer « ${name} » ? Cette action est irréversible.`)) return;
    await supabase.from("suppliers").delete().eq("id", id);
    setSuppliers((p) => p.filter((s) => s.id !== id));
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-end justify-between mb-6 pb-5 border-b border-gray-200">
        <div>
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Opérations</p>
          <h1 className="text-2xl font-bold text-gray-900">Fournisseurs</h1>
          <p className="text-sm text-gray-500 mt-1">{suppliers.length} fournisseur{suppliers.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition shadow-sm">
          <Plus size={15} /> Ajouter un fournisseur
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-card border border-[#E5E7EB] w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-base font-medium text-gray-900">{editingId ? "Modifier le fournisseur" : "Nouveau fournisseur"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
              {[
                { label: "Nom du fournisseur", key: "name", placeholder: "ex. Metro Cash & Carry" },
                { label: "Email (pour l'envoi des commandes)", key: "email", placeholder: "commandes@fournisseur.com" },
                { label: "Personne de contact", key: "contact", placeholder: "Jean Dupont" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input value={(form as any)[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder}
                    className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Franco / minimum (€)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                    <input type="number" min="0" step="0.01" value={form.min_order_amount}
                      onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })} placeholder="0"
                      className="w-full pl-6 pr-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 transition" />
                  </div>
                  <p className="text-2xs text-gray-400 mt-1">montant mini pour livraison gratuite</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Référence client</label>
                  <input value={form.customer_reference} onChange={(e) => setForm({ ...form, customer_reference: e.target.value })}
                    placeholder="ton n° de compte" className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 transition" />
                  <p className="text-2xs text-gray-400 mt-1">apparaît sur le bon de commande</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Catégorie</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-[#E5E7EB]">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition">Annuler</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition">
                {saving ? "Enregistrement…" : editingId ? "Enregistrer" : "Ajouter"}
              </button>
            </div>
          </div>
        </div>
      )}

      {suppliers.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-12 text-center">
          <div className="text-4xl mb-3">🚚</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">Aucun fournisseur</h2>
          <p className="text-sm text-gray-500 mb-5">Ajoutez vos fournisseurs pour lier les ingrédients et envoyer des bons de commande.</p>
          <button onClick={openAdd} className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition">Ajouter le premier fournisseur</button>
        </div>
      ) : (
        <div className="glass-card rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant/20 bg-surface-container-low/50">
                <th className="text-left px-5 py-3.5 text-2xs font-bold text-outline uppercase tracking-wider">Nom</th>
                <th className="text-left px-5 py-3.5 text-2xs font-bold text-outline uppercase tracking-wider">Catégorie</th>
                <th className="text-left px-5 py-3.5 text-2xs font-bold text-outline uppercase tracking-wider">Email</th>
                <th className="text-right px-5 py-3.5 text-2xs font-bold text-outline uppercase tracking-wider">Franco</th>
                <th className="text-left px-5 py-3.5 text-2xs font-bold text-outline uppercase tracking-wider">Réf. client</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {suppliers.map((s) => {
                const palette = ["#00694b", "#555f71", "#525f5a", "#8a6530", "#3b82f6"];
                const color = palette[(s.name?.charCodeAt(0) ?? 0) % palette.length];
                return (
                <tr key={s.id} className="group hover:bg-primary/[0.04] transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white text-sm shrink-0"
                        style={{ backgroundColor: color }}>
                        {(s.name?.[0] ?? "?").toUpperCase()}
                      </div>
                      <span className="font-semibold text-on-surface">{s.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5"><span className="px-2.5 py-0.5 text-xs rounded-full bg-surface-container text-on-surface-variant">{s.category ?? "—"}</span></td>
                  <td className="px-5 py-3.5 text-on-surface-variant/70">{s.email ?? "—"}</td>
                  <td className="px-5 py-3.5 text-right text-on-surface-variant">{s.min_order_amount ? `€${Number(s.min_order_amount).toFixed(0)}` : "—"}</td>
                  <td className="px-5 py-3.5 text-on-surface-variant/70">{s.customer_reference ?? "—"}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(s)} className="p-1.5 text-on-surface-variant/50 hover:text-primary hover:bg-surface-container-high rounded-lg transition"><Pencil size={15} /></button>
                      <button onClick={() => handleDelete(s.id)} className="p-1.5 text-on-surface-variant/50 hover:text-red hover:bg-red-light rounded-lg transition"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
