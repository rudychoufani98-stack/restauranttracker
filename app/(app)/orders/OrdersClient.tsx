"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Trash2, X, Send, Download, ChevronDown, ChevronUp, Zap } from "lucide-react";
import clsx from "clsx";

const toBase = (qty: number, unit: string) => (unit === "kg" || unit === "l" ? qty * 1000 : qty);
function needsReorder(i: { stock_qty?: number | null; reorder_threshold?: number | null }) {
  const stock = Number(i.stock_qty ?? 0);
  const thr = Number(i.reorder_threshold ?? 0);
  return thr > 0 ? stock <= thr : stock <= 0;
}
// Suggest number of packs (colis) to bring stock back to ~2× the threshold.
function suggestColis(i: { stock_qty?: number | null; reorder_threshold?: number | null; pack_quantity?: number | null; unit: string }) {
  const stock = Number(i.stock_qty ?? 0);
  const thr = Number(i.reorder_threshold ?? 0);
  const packBase = toBase(Number(i.pack_quantity ?? 1) || 1, i.unit);
  if (packBase <= 0) return 1;
  const need = Math.max(thr * 2 - stock, thr - stock, packBase);
  return Math.max(1, Math.ceil(need / packBase));
}

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-600",
  Sent: "bg-blue-50 text-blue-600",
  "Partially received": "bg-amber-50 text-amber-600",
  Received: "bg-emerald-50 text-emerald-600",
  Invoiced: "bg-purple-50 text-purple-600",
  Cancelled: "bg-red-50 text-red-500",
};

type Ingredient = {
  id: string; name: string; unit: string; pack_price: number; pack_quantity: number; cost_per_base_unit: number;
  stock_qty?: number | null; reorder_threshold?: number | null; supplier_id?: string | null;
  supplier_reference?: string | null; suppliers?: { name: string } | null;
};
type Supplier = { id: string; name: string; email: string | null };
type POLine = { id?: string; ingredient_id: string | null; quantity: number; expected_price: number | null; ingredients?: { name: string; unit: string } | null };
type PO = { id: string; supplier_id: string | null; status: string; expected_total: number | null; created_at: string; sent_at: string | null; suppliers?: { name: string } | null; purchase_order_lines: POLine[] };

type DraftLine = { ingredient_id: string; quantity: string; expected_price: string };

interface Props {
  restaurantId: string;
  restaurantName: string;
  initialOrders: PO[];
  suppliers: Supplier[];
  ingredients: Ingredient[];
}

export default function OrdersClient({ restaurantId, restaurantName, initialOrders, suppliers, ingredients }: Props) {
  const supabase = createClient();
  const [orders, setOrders] = useState<PO[]>(initialOrders);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ingredient_id: "", quantity: "", expected_price: "" }]);
  const [showRestock, setShowRestock] = useState(false);
  const [restocking, setRestocking] = useState(false);

  // Group low-stock ingredients by supplier for the auto-restock preview
  const restockGroups = (() => {
    const low = ingredients.filter((i) => needsReorder(i) && i.supplier_id);
    const map = new Map<string, { supplierName: string; items: Ingredient[] }>();
    for (const ing of low) {
      const sid = ing.supplier_id!;
      if (!map.has(sid)) map.set(sid, { supplierName: ing.suppliers?.name ?? "Fournisseur", items: [] });
      map.get(sid)!.items.push(ing);
    }
    return Array.from(map.entries()).map(([supplier_id, g]) => ({ supplier_id, ...g }));
  })();
  const lowNoSupplier = ingredients.filter((i) => needsReorder(i) && !i.supplier_id);

  async function handleRestock() {
    setRestocking(true);
    for (const group of restockGroups) {
      const poLines = group.items.map((ing) => {
        const qty = suggestColis(ing);
        return { ingredient_id: ing.id, quantity: qty, expected_price: Number(ing.pack_price) || 0 };
      });
      const expected = poLines.reduce((s, l) => s + l.quantity * l.expected_price, 0);
      const { data: po, error: poErr } = await supabase.from("purchase_orders").insert({
        restaurant_id: restaurantId, supplier_id: group.supplier_id, status: "Draft", expected_total: expected,
      }).select().single();
      if (poErr || !po) continue;
      await supabase.from("purchase_order_lines").insert(poLines.map((l) => ({ po_id: po.id, ...l })));
    }
    const { data: updated } = await supabase
      .from("purchase_orders")
      .select("*, suppliers(name), purchase_order_lines(*, ingredients(name, unit))")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });
    setOrders(updated ?? []);
    setRestocking(false);
    setShowRestock(false);
  }

  function addLine() { setLines((p) => [...p, { ingredient_id: "", quantity: "", expected_price: "" }]); }
  function removeLine(i: number) { setLines((p) => p.filter((_, idx) => idx !== i)); }
  function updateLine(i: number, field: keyof DraftLine, val: string) {
    setLines((p) => {
      const next = [...p];
      next[i] = { ...next[i], [field]: val };
      if (field === "ingredient_id") {
        const ing = ingredients.find((g) => g.id === val);
        if (ing) next[i].expected_price = String(ing.pack_price);
      }
      return next;
    });
  }

  const expectedTotal = lines.reduce((sum, l) => {
    const qty = parseFloat(l.quantity) || 0;
    const price = parseFloat(l.expected_price) || 0;
    return sum + qty * price;
  }, 0);

  async function handleCreate() {
    setError(null);
    if (!supplierId) return setError("Veuillez sélectionner un fournisseur.");
    const valid = lines.filter((l) => l.ingredient_id && parseFloat(l.quantity) > 0);
    if (valid.length === 0) return setError("Ajoutez au moins une ligne d'ingrédient.");
    setSaving(true);

    const { data: po, error: poErr } = await supabase.from("purchase_orders").insert({
      restaurant_id: restaurantId,
      supplier_id: supplierId,
      status: "Draft",
      expected_total: expectedTotal,
    }).select().single();

    if (poErr) { setError(poErr.message); setSaving(false); return; }

    await supabase.from("purchase_order_lines").insert(
      valid.map((l) => ({
        po_id: po.id,
        ingredient_id: l.ingredient_id,
        quantity: parseFloat(l.quantity),
        expected_price: parseFloat(l.expected_price) || null,
      }))
    );

    // Reload
    const { data: updated } = await supabase
      .from("purchase_orders")
      .select("*, suppliers(name), purchase_order_lines(*, ingredients(name, unit))")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    setOrders(updated ?? []);
    setSaving(false);
    setShowForm(false);
    setSupplierId("");
    setLines([{ ingredient_id: "", quantity: "", expected_price: "" }]);
  }

  async function handleMarkSent(id: string) {
    setSending(id);
    await supabase.from("purchase_orders").update({ status: "Sent", sent_at: new Date().toISOString() }).eq("id", id);
    const { data: updated } = await supabase
      .from("purchase_orders")
      .select("*, suppliers(name), purchase_order_lines(*, ingredients(name, unit))")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });
    setOrders(updated ?? []);
    setSending(null);
  }

  async function handleSend(po: PO) {
    setSending(po.id);
    // Update status to Sent
    await supabase.from("purchase_orders").update({ status: "Sent", sent_at: new Date().toISOString() }).eq("id", po.id);

    // Send email via API route
    const supplier = suppliers.find((s) => s.id === po.supplier_id);
    if (supplier?.email) {
      await fetch("/api/send-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId: po.id, restaurantName }),
      });
    }

    const { data: updated } = await supabase
      .from("purchase_orders")
      .select("*, suppliers(name), purchase_order_lines(*, ingredients(name, unit))")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });
    setOrders(updated ?? []);
    setSending(null);
  }

  async function handleDelete(id: string) {
    await supabase.from("purchase_orders").delete().eq("id", id);
    setOrders((p) => p.filter((o) => o.id !== id));
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-6 pb-5 border-b border-gray-200">
        <div>
          <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Opérations</p>
          <h1 className="text-2xl font-bold text-gray-900">Bons de commande</h1>
          <p className="text-sm text-gray-500 mt-1">{orders.length} commande{orders.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowRestock(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition">
            <Zap size={15} /> Réapprovisionner
            {restockGroups.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-2xs">{restockGroups.reduce((s, g) => s + g.items.length, 0)}</span>
            )}
          </button>
          <button onClick={() => { setShowForm(true); setError(null); }}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition shadow-sm">
            <Plus size={15} /> Nouvelle commande
          </button>
        </div>
      </div>

      {/* Restock preview modal */}
      {showRestock && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-card border border-gray-200 w-full max-w-2xl shadow-xl my-8">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Réapprovisionnement automatique</h2>
              <button onClick={() => setShowRestock(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {restockGroups.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-3xl mb-2">✅</p>
                  <p className="text-sm text-gray-600">Aucun produit sous son seuil de réappro avec un fournisseur défini.</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-500">
                    {restockGroups.reduce((s, g) => s + g.items.length, 0)} produit(s) à commander chez {restockGroups.length} fournisseur(s). Quantités suggérées (en colis) — ajustables après création.
                  </p>
                  {restockGroups.map((g) => (
                    <div key={g.supplier_id} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-800">{g.supplierName}</span>
                        <span className="text-xs text-gray-400">{g.items.length} ligne(s)</span>
                      </div>
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-gray-50">
                          {g.items.map((ing) => {
                            const colis = suggestColis(ing);
                            return (
                              <tr key={ing.id}>
                                <td className="px-4 py-2 text-gray-700">{ing.name}
                                  {ing.supplier_reference && <span className="text-2xs text-gray-400 ml-1.5">réf. {ing.supplier_reference}</span>}
                                </td>
                                <td className="px-4 py-2 text-right text-gray-500">{colis} colis</td>
                                <td className="px-4 py-2 text-right font-medium text-gray-900">€{(colis * Number(ing.pack_price || 0)).toFixed(2)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  {lowNoSupplier.length > 0 && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      ⚠️ {lowNoSupplier.length} produit(s) sous le seuil sans fournisseur défini ({lowNoSupplier.map((i) => i.name).join(", ")}) — assigne-leur un fournisseur pour les inclure.
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setShowRestock(false)} className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">Annuler</button>
              <button onClick={handleRestock} disabled={restocking || restockGroups.length === 0}
                className="flex-1 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition">
                {restocking ? "Création…" : `Créer ${restockGroups.length} bon(s) de commande`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New PO form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-card border border-[#E5E7EB] w-full max-w-2xl shadow-xl my-8">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-base font-medium text-gray-900">Nouvelle commande</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Fournisseur</label>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                  <option value="">Choisir un fournisseur…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.email ? ` (${s.email})` : ""}</option>)}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Lignes de commande</label>
                  <button onClick={addLine} className="text-xs text-emerald-600 hover:underline flex items-center gap-1"><Plus size={12} /> Ajouter une ligne</button>
                </div>
                <div className="space-y-2">
                  {lines.map((line, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <select value={line.ingredient_id} onChange={(e) => updateLine(i, "ingredient_id", e.target.value)}
                        className="flex-1 px-2 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                        <option value="">Choisir un ingrédient…</option>
                        {ingredients.map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                      </select>
                      <input type="number" min="0" step="any" value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)}
                        placeholder="Qty" className="w-20 px-2 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 transition" />
                      <div className="relative w-28">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-sm">€</span>
                        <input type="number" min="0" step="0.01" value={line.expected_price} onChange={(e) => updateLine(i, "expected_price", e.target.value)}
                          placeholder="Price" className="w-full pl-5 pr-2 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 transition" />
                      </div>
                      <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-400 transition"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border border-[#E5E7EB]">
                <span className="text-sm text-gray-600">Total prévisionnel</span>
                <span className="text-base font-medium text-gray-900">€{expectedTotal.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-[#E5E7EB]">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition">Annuler</button>
              <button onClick={handleCreate} disabled={saving} className="flex-1 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition">
                {saving ? "Création…" : "Créer la commande"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Orders list */}
      {orders.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-12 text-center">
          <div className="text-4xl mb-3">📦</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">Aucune commande</h2>
          <p className="text-sm text-gray-500 mb-5">Créez un bon de commande pour l'envoyer à vos fournisseurs.</p>
          <button onClick={() => setShowForm(true)} className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition">Créer la première commande</button>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const isExpanded = expandedId === order.id;
            return (
              <div key={order.id} className="bg-white border border-[#E5E7EB] rounded-card overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition"
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{order.suppliers?.name ?? "Unknown supplier"}</span>
                      <span className={clsx("px-2 py-0.5 text-xs rounded-full font-medium", STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-500")}>
                        {order.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(order.created_at).toLocaleDateString("fr-FR")} · {order.purchase_order_lines.length} ligne{order.purchase_order_lines.length !== 1 ? "s" : ""}</p>
                  </div>
                  <span className="text-sm font-medium text-gray-900">€{Number(order.expected_total ?? 0).toFixed(2)}</span>
                  <div className="flex items-center gap-1">
                    {/* Download PDF — always available */}
                    <a
                      href={`/api/orders/${order.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
                    >
                      <Download size={12} /> PDF
                    </a>

                    {order.status === "Draft" && (<>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMarkSent(order.id); }}
                        disabled={sending === order.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition">
                        {sending === order.id ? "…" : "Marquer envoyé"}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSend(order); }}
                        disabled={sending === order.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition">
                        <Send size={12} />{sending === order.id ? "Envoi…" : "Envoyer"}
                      </button>
                    </>)}
                    {(order.status === "Sent" || order.status === "Partially received") && (
                      <a href={`/orders/${order.id}/receive`}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition">
                        Réceptionner
                      </a>
                    )}
                    {(order.status === "Received" || order.status === "Partially received") && (
                      <a href={`/orders/${order.id}/invoice`}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition">
                        Facturer
                      </a>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(order.id); }}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition"><Trash2 size={14} /></button>
                    {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-[#E5E7EB] px-5 py-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 uppercase">
                          <th className="text-left pb-2">Ingrédient</th>
                          <th className="text-right pb-2">Quantité</th>
                          <th className="text-right pb-2">Prix prévu</th>
                          <th className="text-right pb-2">Sous-total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#F3F4F6]">
                        {order.purchase_order_lines.map((line, i) => (
                          <tr key={i}>
                            <td className="py-1.5 text-gray-700">{line.ingredients?.name ?? "—"}</td>
                            <td className="text-right text-gray-500">{line.quantity} {line.ingredients?.unit}</td>
                            <td className="text-right text-gray-500">€{Number(line.expected_price ?? 0).toFixed(2)}</td>
                            <td className="text-right font-medium text-gray-900">€{(line.quantity * Number(line.expected_price ?? 0)).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {order.sent_at && (
                      <p className="text-xs text-gray-400 mt-3">Envoyé le {new Date(order.sent_at).toLocaleString("fr-FR")}</p>
                    )}
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
