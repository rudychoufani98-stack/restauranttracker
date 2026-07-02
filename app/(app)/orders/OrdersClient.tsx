"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Plus, Trash2, X, Send, Download, ChevronDown, ChevronUp, Zap, Check, Pencil } from "lucide-react";
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

// Status filter buckets (French label → which DB statuses it matches).
const STATUS_FILTERS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "all", label: "Toutes", match: () => true },
  { key: "Draft", label: "Brouillon", match: (s) => s === "Draft" },
  { key: "Sent", label: "Envoyée", match: (s) => s === "Sent" },
  { key: "received", label: "Reçue", match: (s) => s === "Received" || s === "Partially received" },
  { key: "Invoiced", label: "Facturée", match: (s) => s === "Invoiced" },
];

// Date period presets for the orders filter.
const PERIODS: { key: string; label: string }[] = [
  { key: "all", label: "Toutes les dates" },
  { key: "7d", label: "7 derniers jours" },
  { key: "30d", label: "30 derniers jours" },
  { key: "month", label: "Ce mois-ci" },
  { key: "lastmonth", label: "Mois dernier" },
];
function inPeriod(createdAt: string, period: string): boolean {
  if (period === "all") return true;
  const d = new Date(createdAt);
  const now = new Date();
  const day = 86_400_000;
  if (period === "7d") return d >= new Date(now.getTime() - 7 * day);
  if (period === "30d") return d >= new Date(now.getTime() - 30 * day);
  if (period === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  if (period === "lastmonth") {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth();
  }
  return true;
}

// DB stores English statuses; display them in French (single source of truth).
const STATUS_LABELS: Record<string, string> = {
  Draft: "Brouillon",
  Sent: "Envoyée",
  "Partially received": "Partiellement reçue",
  Received: "Reçue",
  Invoiced: "Facturée",
  Cancelled: "Annulée",
};

type Article = {
  supplier_id: string | null; supplier_reference: string | null;
  pack_units: number | null; unit_size: number | null; unit: string | null;
  pack_price: number | null; pack_label: string | null; pack_type?: string | null; is_preferred?: boolean;
};
type Ingredient = {
  id: string; name: string; unit: string; pack_price: number; pack_quantity: number; cost_per_base_unit: number;
  pack_units?: number | null; unit_size?: number | null;
  stock_qty?: number | null; reorder_threshold?: number | null; supplier_id?: string | null;
  supplier_reference?: string | null; suppliers?: { name: string } | null;
  ingredient_suppliers?: Article[];
};

// The purchasable article of a product for a given supplier (from ingredient_suppliers,
// falling back to the product's main fields). Null if this supplier doesn't carry it.
function articleFor(ing: Ingredient, supplierId: string): Article | null {
  const match = (ing.ingredient_suppliers ?? []).find((a) => a.supplier_id === supplierId);
  if (match) return { ...match, unit: match.unit ?? ing.unit };
  if (ing.supplier_id === supplierId) {
    return { supplier_id: ing.supplier_id, supplier_reference: ing.supplier_reference ?? null,
      pack_units: ing.pack_units ?? 1, unit_size: ing.unit_size ?? ing.pack_quantity ?? null,
      unit: ing.unit, pack_price: ing.pack_price ?? null, pack_label: null, pack_type: "colis" };
  }
  return null;
}
const packTypeOf = (a: Article) => a.pack_type || "colis";
function condLabel(a: Article): string {
  if (a.pack_label) return a.pack_label;
  const u = Number(a.pack_units ?? 1), s = Number(a.unit_size ?? 0);
  return u > 1 ? `${u} × ${s} ${a.unit}` : `${s} ${a.unit}`;
}
type Supplier = { id: string; name: string; email: string | null; min_order_amount?: number | null; customer_reference?: string | null };
type POLine = { id?: string; ingredient_id: string | null; quantity: number; expected_price: number | null; ingredients?: { name: string; unit: string } | null };
type DeliveryNoteRef = { validated_at: string | null; created_at: string };
type PO = { id: string; order_number?: string | null; supplier_id: string | null; status: string; expected_total: number | null; created_at: string; sent_at: string | null; suppliers?: { name: string } | null; delivery_notes?: DeliveryNoteRef[]; purchase_order_lines: POLine[] };

// Reception month for grouping: latest delivery note date, else the order date.
function receptionDate(o: PO): string {
  const dates = (o.delivery_notes ?? []).map((d) => d.validated_at || d.created_at).filter(Boolean) as string[];
  dates.sort();
  return dates.length ? dates[dates.length - 1] : o.created_at;
}
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function monthLabelFr(monthKey: string) {
  const [y, m] = monthKey.split("-");
  return `${MONTHS_FR[parseInt(m, 10) - 1] ?? m} ${y}`;
}

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
  const params = useSearchParams();
  const flash = params.get("sent") ? "Commande envoyée ✓"
    : params.get("validated") ? "Réception validée ✓ — stock mis à jour"
    : params.get("invoiced") ? "Facture validée ✓ — coûts mis à jour"
    : null;
  const [orders, setOrders] = useState<PO[]>(initialOrders);
  const [statusFilter, setStatusFilter] = useState("all");
  const [period, setPeriod] = useState("all");
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

  // Only the products this supplier actually carries
  const supplierProducts = supplierId ? ingredients.filter((ing) => articleFor(ing, supplierId)) : [];

  function changeSupplier(sid: string) {
    setSupplierId(sid);
    setLines([{ ingredient_id: "", quantity: "", expected_price: "" }]); // reset stale lines
  }
  function addLine() { setLines((p) => [...p, { ingredient_id: "", quantity: "", expected_price: "" }]); }
  function removeLine(i: number) { setLines((p) => p.filter((_, idx) => idx !== i)); }
  function updateLine(i: number, field: keyof DraftLine, val: string) {
    setLines((p) => {
      const next = [...p];
      next[i] = { ...next[i], [field]: val };
      if (field === "ingredient_id") {
        const ing = ingredients.find((g) => g.id === val);
        const art = ing ? articleFor(ing, supplierId) : null;
        if (art) next[i].expected_price = String(art.pack_price ?? "");
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
    const o = orders.find((x) => x.id === id);
    // Only draft orders may be deleted. Sent/received/invoiced orders have (or
    // will have) affected stock — they can only be corrected via the invoice.
    if (o && o.status !== "Draft") {
      window.alert("Cette commande a déjà été envoyée : elle ne peut pas être supprimée. Pour l'annuler, va dans « Facturer » et mets les quantités à 0 — le stock sera réajusté.");
      return;
    }
    const label = o?.suppliers?.name ? `la commande « ${o.suppliers.name} »` : "cette commande";
    if (!window.confirm(`Supprimer ${label} ? Cette action est irréversible.`)) return;
    await supabase.from("purchase_orders").delete().eq("id", id);
    setOrders((p) => p.filter((o) => o.id !== id));
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {flash && (
        <div className="mb-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          <Check size={15} /> {flash}
        </div>
      )}
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
          <Link href="/orders/new"
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition shadow-sm">
            <Plus size={15} /> Nouvelle commande
          </Link>
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
                <select value={supplierId} onChange={(e) => changeSupplier(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                  <option value="">Choisir un fournisseur…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.email ? ` (${s.email})` : ""}</option>)}
                </select>
              </div>

              {!supplierId ? (
                <p className="text-sm text-gray-400 text-center py-8 border border-dashed border-gray-200 rounded-lg">
                  Choisis un fournisseur pour voir les produits qu'il fournit.
                </p>
              ) : supplierProducts.length === 0 ? (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-center">
                  Aucun produit n'a d'article chez ce fournisseur.<br />
                  <span className="text-xs text-amber-600">Ajoute-le sur la fiche produit → section « Articles ».</span>
                </p>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-gray-600">Produits à commander</label>
                    <button onClick={addLine} className="text-xs text-emerald-600 hover:underline flex items-center gap-1"><Plus size={12} /> Ajouter une ligne</button>
                  </div>
                  <div className="space-y-2.5">
                    {lines.map((line, i) => {
                      const ing = ingredients.find((g) => g.id === line.ingredient_id);
                      const art = ing ? articleFor(ing, supplierId) : null;
                      const sub = (parseFloat(line.quantity) || 0) * (parseFloat(line.expected_price) || 0);
                      return (
                        <div key={i} className="border border-gray-200 rounded-lg p-2.5 bg-gray-50/40">
                          <div className="flex gap-2 items-center">
                            <select value={line.ingredient_id} onChange={(e) => updateLine(i, "ingredient_id", e.target.value)}
                              className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-500 bg-white transition">
                              <option value="">Choisir un produit…</option>
                              {supplierProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <button onClick={() => removeLine(i)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition shrink-0"><Trash2 size={14} /></button>
                          </div>
                          {art && (
                            <p className="text-2xs text-gray-500 mt-1.5 ml-0.5">
                              1 {packTypeOf(art)} = <b>{condLabel(art)}</b>{art.supplier_reference ? <> · réf. <b>{art.supplier_reference}</b></> : null}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <div className="flex items-center gap-1">
                              <input type="number" min="0" step="any" value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)}
                                placeholder="0" className="w-16 px-2 py-1.5 text-sm text-right border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                              <span className="text-xs text-gray-400">{art ? packTypeOf(art) : "colis"}</span>
                            </div>
                            <span className="text-gray-300">×</span>
                            <div className="relative w-28">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">€</span>
                              <input type="number" min="0" step="0.01" value={line.expected_price} onChange={(e) => updateLine(i, "expected_price", e.target.value)}
                                placeholder="prix/colis" className="w-full pl-5 pr-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                            </div>
                            <span className="ml-auto text-sm font-semibold text-gray-900">€{sub.toFixed(2)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(() => {
                const sup = suppliers.find((s) => s.id === supplierId);
                const franco = Number(sup?.min_order_amount ?? 0);
                const reached = franco > 0 && expectedTotal >= franco;
                const missing = franco - expectedTotal;
                return (
                  <div className="px-4 py-3 bg-gray-50 rounded-lg border border-[#E5E7EB] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Total prévisionnel</span>
                      <span className="text-base font-medium text-gray-900">€{expectedTotal.toFixed(2)}</span>
                    </div>
                    {franco > 0 && (
                      <>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className={clsx("h-full rounded-full transition-all", reached ? "bg-emerald-500" : "bg-amber-400")}
                            style={{ width: `${Math.min(100, (expectedTotal / franco) * 100)}%` }} />
                        </div>
                        <p className={clsx("text-xs", reached ? "text-emerald-600" : "text-amber-600")}>
                          {reached
                            ? `✓ Franco atteint (€${franco.toFixed(0)}) — livraison gratuite`
                            : `Franco à €${franco.toFixed(0)} — il manque €${missing.toFixed(2)}`}
                        </p>
                      </>
                    )}
                  </div>
                );
              })()}
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

      {/* Filters — statut + date */}
      {orders.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => {
              const count = f.key === "all" ? orders.length : orders.filter((o) => f.match(o.status)).length;
              return (
                <button key={f.key} onClick={() => setStatusFilter(f.key)}
                  className={clsx("px-3 py-1.5 text-xs rounded-full border transition", statusFilter === f.key ? "bg-emerald-500 text-white border-emerald-500" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50")}>
                  {f.label} <span className={clsx("ml-0.5", statusFilter === f.key ? "text-emerald-100" : "text-gray-400")}>{count}</span>
                </button>
              );
            })}
          </div>
          <select value={period} onChange={(e) => setPeriod(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500 text-gray-600">
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
      )}

      {/* Orders list */}
      {orders.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-card p-12 text-center">
          <div className="text-4xl mb-3">📦</div>
          <h2 className="text-base font-medium text-gray-900 mb-1">Aucune commande</h2>
          <p className="text-sm text-gray-500 mb-5">Créez un bon de commande pour l'envoyer à vos fournisseurs.</p>
          <Link href="/orders/new" className="inline-block px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition">Créer la première commande</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {(() => {
            const match = STATUS_FILTERS.find((f) => f.key === statusFilter)?.match ?? (() => true);
            const visibleOrders = orders.filter((o) => match(o.status) && inPeriod(o.created_at, period));
            if (visibleOrders.length === 0) {
              return <p className="text-sm text-gray-400 text-center py-10 border border-dashed border-gray-200 rounded-card">Aucune commande pour ce filtre.</p>;
            }
            // Group by reception month (latest delivery note, else order date).
            const groups = new Map<string, PO[]>();
            for (const o of visibleOrders) {
              const key = receptionDate(o).slice(0, 7);
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(o);
            }
            const months = Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
            return months.map(([month, list]) => (
              <div key={month}>
                <h3 className="text-sm font-bold text-gray-800 capitalize mt-5 first:mt-0 mb-2">{monthLabelFr(month)}</h3>
                <div className="space-y-3">
                {list.map((order) => {
            const isExpanded = expandedId === order.id;
            return (
              <div key={order.id} className="bg-white border border-[#E5E7EB] rounded-card overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition"
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{order.suppliers?.name ?? "Fournisseur inconnu"}</span>
                      <span className={clsx("px-2 py-0.5 text-xs rounded-full font-medium", STATUS_COLORS[order.status] ?? "bg-gray-100 text-gray-500")}>
                        {STATUS_LABELS[order.status] ?? order.status}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {order.order_number && <span className="font-semibold text-emerald-700">{order.order_number}</span>}
                      {order.order_number && " · "}
                      {new Date(order.created_at).toLocaleDateString("fr-FR")} · {order.purchase_order_lines.length} ligne{order.purchase_order_lines.length !== 1 ? "s" : ""}
                    </p>
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
                      <a
                        href={`/orders/${order.id}/edit`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
                        <Pencil size={12} /> Modifier
                      </a>
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
                    {order.status === "Invoiced" && (
                      <a href={`/orders/${order.id}/invoice`}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 transition">
                        <Pencil size={12} /> Modifier la facture
                      </a>
                    )}
                    {/* Only draft orders can be deleted */}
                    {order.status === "Draft" && (
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(order.id); }}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition" title="Supprimer le brouillon"><Trash2 size={14} /></button>
                    )}
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
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
