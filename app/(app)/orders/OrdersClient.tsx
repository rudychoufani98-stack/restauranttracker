"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Plus, Trash2, X, Send, Download, ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-600",
  Sent: "bg-blue-50 text-blue-600",
  "Partially received": "bg-amber-50 text-amber-600",
  Received: "bg-emerald-50 text-emerald-600",
  Cancelled: "bg-red-50 text-red-500",
};

type Ingredient = { id: string; name: string; unit: string; pack_price: number; pack_quantity: number; cost_per_base_unit: number };
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
    if (!supplierId) return setError("Select a supplier.");
    const valid = lines.filter((l) => l.ingredient_id && parseFloat(l.quantity) > 0);
    if (valid.length === 0) return setError("Add at least one ingredient line.");
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-medium text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">{orders.length} order{orders.length !== 1 ? "s" : ""}</p>
        </div>
        <button onClick={() => { setShowForm(true); setError(null); }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white text-sm font-medium rounded-lg hover:bg-emerald-600 transition">
          <Plus size={15} /> New order
        </button>
      </div>

      {/* New PO form */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-card border border-[#E5E7EB] w-full max-w-2xl shadow-xl my-8">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB]">
              <h2 className="text-base font-medium text-gray-900">New purchase order</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Supplier</label>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                  <option value="">Select supplier…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.email ? ` (${s.email})` : ""}</option>)}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Order lines</label>
                  <button onClick={addLine} className="text-xs text-emerald-600 hover:underline flex items-center gap-1"><Plus size={12} /> Add line</button>
                </div>
                <div className="space-y-2">
                  {lines.map((line, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <select value={line.ingredient_id} onChange={(e) => updateLine(i, "ingredient_id", e.target.value)}
                        className="flex-1 px-2 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                        <option value="">Select ingredient…</option>
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
                <span className="text-sm text-gray-600">Expected total</span>
                <span className="text-base font-medium text-gray-900">€{expectedTotal.toFixed(2)}</span>
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-[#E5E7EB]">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="flex-1 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition">
                {saving ? "Creating…" : "Create order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Orders list */}
      {orders.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-12 text-center">
          <div className="text-4xl mb-3">📦</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">No orders yet</h2>
          <p className="text-sm text-gray-500 mb-5">Create a purchase order to send to your suppliers.</p>
          <button onClick={() => setShowForm(true)} className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition">Create first order</button>
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
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(order.created_at).toLocaleDateString()} · {order.purchase_order_lines.length} line{order.purchase_order_lines.length !== 1 ? "s" : ""}</p>
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

                    {order.status === "Draft" && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSend(order); }}
                        disabled={sending === order.id}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition">
                        <Send size={12} />{sending === order.id ? "Envoi…" : "Envoyer"}
                      </button>
                    )}
                    {order.status === "Sent" && (
                      <a href={`/orders/${order.id}/receive`}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition">
                        Réceptionner
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
                          <th className="text-left pb-2">Ingredient</th>
                          <th className="text-right pb-2">Quantity</th>
                          <th className="text-right pb-2">Expected price</th>
                          <th className="text-right pb-2">Line total</th>
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
                      <p className="text-xs text-gray-400 mt-3">Sent on {new Date(order.sent_at).toLocaleString()}</p>
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
