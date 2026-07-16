"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Plus, Trash2, X, Send, Download, ChevronDown, ChevronUp, Zap, Check, Pencil, Truck, Search, TrendingUp, Hourglass, Star, ArrowRight } from "lucide-react";
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
  { key: "custom", label: "Plage personnalisée…" },
];
function inPeriod(dateStr: string, period: string, from?: string, to?: string): boolean {
  if (period === "all") return true;
  if (period === "custom") {
    const d = (dateStr ?? "").slice(0, 10); // YYYY-MM-DD
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }
  const d = new Date(dateStr);
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

// Glass-pill styling per status: background/text/border + the leading status dot.
const STATUS_PILL: Record<string, { cls: string; dot: string }> = {
  Draft: { cls: "bg-surface-container-highest text-on-surface-variant border-outline-variant/40", dot: "bg-on-surface-variant/50" },
  Sent: { cls: "bg-secondary-container/50 text-secondary border-secondary/20", dot: "bg-secondary" },
  "Partially received": { cls: "bg-amber-light text-amber-dark border-amber/30", dot: "bg-amber" },
  Received: { cls: "bg-emerald-50 text-primary border-primary/20", dot: "bg-primary animate-pulse" },
  Invoiced: { cls: "bg-primary-container/15 text-primary-container border-primary-container/30", dot: "bg-primary-container" },
  Cancelled: { cls: "bg-red-light text-red border-red/20", dot: "bg-red" },
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
type DeliveryNoteRef = { validated_at: string | null; created_at: string; bl_number?: string | null };
type InvoiceRef = { created_at: string; invoice_number: string | null };
type OrderEvent = { po_id: string; type: string; detail: string | null; created_at: string };
type PO = { id: string; order_number?: string | null; supplier_id: string | null; status: string; expected_total: number | null; created_at: string; sent_at: string | null; suppliers?: { name: string } | null; delivery_notes?: DeliveryNoteRef[]; invoices?: InvoiceRef[]; purchase_order_lines: POLine[] };

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
const dateTimeFr = (s: string) => new Date(s).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

type TimelineItem = { label: string; detail?: string | null; date: string; color: string };
// Build the full history of an order from its timestamps + edit events.
function buildTimeline(o: PO, events: OrderEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [
    { label: "Commande créée", date: o.created_at, color: "bg-gray-400" },
  ];
  if (o.sent_at) items.push({ label: "Envoyée au fournisseur", date: o.sent_at, color: "bg-blue-500" });
  for (const dn of o.delivery_notes ?? []) {
    const d = dn.validated_at || dn.created_at;
    if (d) items.push({ label: "Réceptionnée", detail: dn.bl_number ? `BL ${dn.bl_number}` : null, date: d, color: "bg-emerald-500" });
  }
  const invs = (o.invoices ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  invs.forEach((inv, i) => items.push({
    label: i === 0 ? "Facturée" : "Facture modifiée",
    detail: inv.invoice_number, date: inv.created_at, color: "bg-purple-500",
  }));
  for (const ev of events) {
    if (ev.po_id !== o.id) continue;
    items.push({ label: ev.type === "edited" ? "Commande modifiée" : ev.type, detail: ev.detail, date: ev.created_at, color: "bg-amber-500" });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

type DraftLine = { ingredient_id: string; quantity: string; expected_price: string };

interface Props {
  restaurantId: string;
  restaurantName: string;
  initialOrders: PO[];
  suppliers: Supplier[];
  ingredients: Ingredient[];
  orderEvents?: OrderEvent[];
}

export default function OrdersClient({ restaurantId, restaurantName, initialOrders, suppliers, ingredients, orderEvents = [] }: Props) {
  const supabase = createClient();
  const params = useSearchParams();
  const flash = params.get("sent") ? "Commande envoyée ✓"
    : params.get("validated") ? "Réception validée ✓ — stock mis à jour"
    : params.get("invoiced") ? "Facture validée ✓ — coûts mis à jour"
    : null;
  const [orders, setOrders] = useState<PO[]>(initialOrders);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
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
    const supplier = suppliers.find((s) => s.id === po.supplier_id);

    if (!supplier?.email) {
      setSending(null);
      window.alert("Ce fournisseur n'a pas d'adresse email. Ajoute-la dans sa fiche (Fournisseurs) pour lui envoyer la commande par email.");
      return;
    }

    // Send the email first; only mark as Sent if it actually goes out.
    let emailOk = false;
    let emailErr = "";
    try {
      const res = await fetch("/api/send-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId: po.id, restaurantName }),
      });
      const json = await res.json().catch(() => ({}));
      emailOk = res.ok;
      if (!res.ok) emailErr = json?.error ?? `Erreur ${res.status}`;
    } catch (e: any) {
      emailErr = e?.message ?? "Réseau";
    }

    if (!emailOk) {
      setSending(null);
      window.alert(`L'email n'a pas pu être envoyé : ${emailErr}\n\nLa commande reste en brouillon. Vérifie la configuration d'envoi (Resend) ou l'email du fournisseur.`);
      return;
    }

    await supabase.from("purchase_orders").update({ status: "Sent", sent_at: new Date().toISOString() }).eq("id", po.id);

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

  // ── Live filtered list (status + period + free-text search) ──
  const searchLc = search.trim().toLowerCase();
  const statusMatch = STATUS_FILTERS.find((f) => f.key === statusFilter)?.match ?? (() => true);
  const visibleOrders = orders.filter((o) =>
    statusMatch(o.status) &&
    inPeriod(receptionDate(o), period, fromDate, toDate) &&
    (searchLc === "" ||
      (o.suppliers?.name ?? "").toLowerCase().includes(searchLc) ||
      (o.order_number ?? "").toLowerCase().includes(searchLc))
  );

  // ── Stat cards, all derived from the live orders (no placeholders) ──
  const now = new Date();
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const curKey = monthKey(now);
  const lastKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const spendIn = (key: string) =>
    orders.filter((o) => receptionDate(o).slice(0, 7) === key).reduce((s, o) => s + Number(o.expected_total ?? 0), 0);
  const spendThis = spendIn(curKey);
  const spendLast = spendIn(lastKey);
  const spendDelta = spendLast > 0 ? Math.round(((spendThis - spendLast) / spendLast) * 100) : null;
  const spendBarPct = spendThis + spendLast > 0 ? (spendThis / Math.max(spendThis, spendLast)) * 100 : 0;

  const PENDING = new Set(["Draft", "Sent", "Partially received"]);
  const pendingCount = orders.filter((o) => PENDING.has(o.status)).length;
  const pendingBarPct = orders.length ? (pendingCount / orders.length) * 100 : 0;

  const supplierTally = new Map<string, { name: string; count: number }>();
  for (const o of orders) {
    const id = o.supplier_id ?? "?";
    const e = supplierTally.get(id) ?? { name: o.suppliers?.name ?? "Fournisseur inconnu", count: 0 };
    e.count += 1;
    supplierTally.set(id, e);
  }
  const topSupplier = Array.from(supplierTally.values()).sort((a, b) => b.count - a.count)[0] ?? null;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {flash && (
        <div className="mb-4 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          <Check size={15} /> {flash}
        </div>
      )}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-1">Opérations</p>
          <h1 className="text-3xl font-extrabold text-primary tracking-tight">Gestion des commandes</h1>
          <p className="text-sm text-on-surface-variant/70 mt-1">Suivez et gérez vos approvisionnements en temps réel.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowRestock(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-amber-dark bg-amber-light border border-amber/30 rounded-xl hover:brightness-95 transition">
            <Zap size={15} /> Réapprovisionner
            {restockGroups.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber text-white text-2xs">{restockGroups.reduce((s, g) => s + g.items.length, 0)}</span>
            )}
          </button>
          <Link href="/orders/new"
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-on-primary text-sm font-semibold rounded-xl hover:bg-primary-container transition shadow-lg hover:nav-active-glow active:scale-[0.98]">
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

      {/* Filters — glass card: status pills · search · period */}
      {orders.length > 0 && (
        <div className="glass-card rounded-2xl p-2 mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => {
              const count = f.key === "all" ? orders.length : orders.filter((o) => f.match(o.status)).length;
              const active = statusFilter === f.key;
              return (
                <button key={f.key} onClick={() => setStatusFilter(f.key)}
                  className={clsx(
                    "px-4 py-2 rounded-xl text-2xs font-bold uppercase tracking-wider transition-all duration-300",
                    active ? "bg-primary-container text-on-primary-container nav-active-glow" : "text-on-surface-variant/60 hover:bg-surface-container-low"
                  )}>
                  {f.label} <span className={clsx("ml-1", active ? "text-on-primary-container/80" : "text-on-surface-variant/40")}>({count})</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher…"
                className="w-44 md:w-56 pl-9 pr-3 py-2 text-sm bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface-variant/40" />
            </div>
            {period === "custom" && (
              <div className="flex items-center gap-1.5">
                <span className="text-2xs text-on-surface-variant/40">Du</span>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                  className="px-2 py-2 text-xs bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-on-surface-variant" />
                <span className="text-2xs text-on-surface-variant/40">au</span>
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                  className="px-2 py-2 text-xs bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-on-surface-variant" />
              </div>
            )}
            <select value={period} onChange={(e) => setPeriod(e.target.value)}
              className="px-3 py-2 text-xs bg-surface-container-low border-none rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-on-surface-variant">
              {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Orders list */}
      {orders.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">📦</div>
          <h2 className="text-base font-semibold text-on-surface mb-1">Aucune commande</h2>
          <p className="text-sm text-on-surface-variant/70 mb-5">Créez un bon de commande pour l'envoyer à vos fournisseurs.</p>
          <Link href="/orders/new" className="inline-block px-5 py-2.5 text-sm font-semibold text-on-primary bg-primary rounded-xl hover:bg-primary-container transition">Créer la première commande</Link>
        </div>
      ) : (
        <>
          {/* Main order table (glass) */}
          <div className="glass-card rounded-2xl overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead className="bg-surface-container-low/50 border-b border-outline-variant/20">
                  <tr>
                    <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">N°</th>
                    <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Fournisseur</th>
                    <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Statut</th>
                    <th className="px-5 py-3 text-left text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Date</th>
                    <th className="px-5 py-3 text-center text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Articles</th>
                    <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Total</th>
                    <th className="px-5 py-3 text-right text-2xs font-bold uppercase tracking-wider text-on-surface-variant/60">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/10">
                  {visibleOrders.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-12 text-sm text-on-surface-variant/50">Aucune commande pour ce filtre.</td></tr>
                  ) : (() => {
                    // Group by reception month (latest delivery note, else order date).
                    const groups = new Map<string, PO[]>();
                    for (const o of visibleOrders) {
                      const key = receptionDate(o).slice(0, 7);
                      if (!groups.has(key)) groups.set(key, []);
                      groups.get(key)!.push(o);
                    }
                    const months = Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
                    return months.map(([month, list]) => (
                      <Fragment key={month}>
                        <tr>
                          <td colSpan={7} className="bg-surface-container-low/40 px-5 py-2 text-2xs font-bold uppercase tracking-widest text-on-surface-variant/60 capitalize">
                            {monthLabelFr(month)}
                          </td>
                        </tr>
                        {list.map((order) => {
                          const isExpanded = expandedId === order.id;
                          const pill = STATUS_PILL[order.status] ?? STATUS_PILL.Draft;
                          return (
                            <Fragment key={order.id}>
                              <tr onClick={() => setExpandedId(isExpanded ? null : order.id)}
                                className="cursor-pointer transition-colors hover:bg-surface-container-low/40">
                                <td className="px-5 py-4 text-sm font-semibold text-on-surface tabular-nums whitespace-nowrap">
                                  {order.order_number ?? `#${order.id.slice(0, 8)}`}
                                </td>
                                <td className="px-5 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-tertiary-fixed flex items-center justify-center text-primary shrink-0">
                                      <Truck size={15} />
                                    </div>
                                    <span className="font-semibold text-primary whitespace-nowrap">{order.suppliers?.name ?? "Fournisseur inconnu"}</span>
                                  </div>
                                </td>
                                <td className="px-5 py-4">
                                  <span className={clsx("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-2xs font-bold uppercase tracking-wide w-fit whitespace-nowrap", pill.cls)}>
                                    <span className={clsx("w-1.5 h-1.5 rounded-full", pill.dot)} />
                                    {STATUS_LABELS[order.status] ?? order.status}
                                  </span>
                                </td>
                                <td className="px-5 py-4 text-sm text-on-surface-variant/80 whitespace-nowrap">{new Date(order.created_at).toLocaleDateString("fr-FR")}</td>
                                <td className="px-5 py-4 text-center text-sm text-on-surface-variant/80">{order.purchase_order_lines.length}</td>
                                <td className="px-5 py-4 text-right text-sm font-bold text-on-surface tabular-nums whitespace-nowrap">€{Number(order.expected_total ?? 0).toFixed(2)}</td>
                                <td className="px-5 py-4">
                                  <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                    <a href={`/api/orders/${order.id}/pdf`} target="_blank" rel="noopener noreferrer" title="Télécharger le PDF"
                                      className="flex items-center gap-1 px-2.5 py-1.5 text-2xs font-semibold text-on-surface-variant border border-outline-variant/40 rounded-lg hover:bg-surface-container-low transition">
                                      <Download size={12} /> PDF
                                    </a>
                                    {order.status === "Draft" && (<>
                                      <a href={`/orders/${order.id}/edit`} title="Modifier"
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-2xs font-semibold text-on-surface-variant border border-outline-variant/40 rounded-lg hover:bg-surface-container-low transition">
                                        <Pencil size={12} /> Modifier
                                      </a>
                                      <button onClick={() => handleMarkSent(order.id)} disabled={sending === order.id}
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-2xs font-semibold text-on-surface-variant border border-outline-variant/40 rounded-lg hover:bg-surface-container-low disabled:opacity-50 transition">
                                        {sending === order.id ? "…" : "Envoyé"}
                                      </button>
                                      <button onClick={() => handleSend(order)} disabled={sending === order.id}
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-2xs font-semibold text-on-primary bg-primary rounded-lg hover:bg-primary-container disabled:opacity-50 transition">
                                        <Send size={12} />{sending === order.id ? "Envoi…" : "Envoyer"}
                                      </button>
                                    </>)}
                                    {(order.status === "Sent" || order.status === "Partially received") && (
                                      <a href={`/orders/${order.id}/receive`}
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-2xs font-semibold text-on-primary bg-primary rounded-lg hover:bg-primary-container transition">
                                        Réceptionner
                                      </a>
                                    )}
                                    {(order.status === "Received" || order.status === "Partially received") && (
                                      <a href={`/orders/${order.id}/invoice`}
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-2xs font-semibold text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition">
                                        Facturer
                                      </a>
                                    )}
                                    {order.status === "Invoiced" && (
                                      <a href={`/orders/${order.id}/invoice`}
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-2xs font-semibold text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 transition">
                                        <Pencil size={12} /> Facture
                                      </a>
                                    )}
                                    {order.status === "Draft" && (
                                      <button onClick={() => handleDelete(order.id)} title="Supprimer le brouillon"
                                        className="p-1.5 text-on-surface-variant/50 hover:text-red hover:bg-red-light rounded-lg transition"><Trash2 size={14} /></button>
                                    )}
                                    {isExpanded ? <ChevronUp size={16} className="text-on-surface-variant/40" /> : <ChevronDown size={16} className="text-on-surface-variant/40" />}
                                  </div>
                                </td>
                              </tr>

                              {isExpanded && (
                                <tr>
                                  <td colSpan={7} className="bg-surface-container-low/30 px-5 py-4 border-t border-outline-variant/10">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="text-2xs text-on-surface-variant/50 uppercase tracking-wide">
                                          <th className="text-left pb-2">Ingrédient</th>
                                          <th className="text-right pb-2">Quantité</th>
                                          <th className="text-right pb-2">Prix prévu</th>
                                          <th className="text-right pb-2">Sous-total</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-outline-variant/10">
                                        {order.purchase_order_lines.map((line, i) => (
                                          <tr key={i}>
                                            <td className="py-1.5 text-on-surface-variant">{line.ingredients?.name ?? "—"}</td>
                                            <td className="text-right text-on-surface-variant/70">{line.quantity} {line.ingredients?.unit}</td>
                                            <td className="text-right text-on-surface-variant/70">€{Number(line.expected_price ?? 0).toFixed(2)}</td>
                                            <td className="text-right font-semibold text-on-surface tabular-nums">€{(line.quantity * Number(line.expected_price ?? 0)).toFixed(2)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>

                                    {/* Historique de la commande */}
                                    <div className="mt-5 pt-4 border-t border-outline-variant/10">
                                      <p className="text-2xs font-bold text-on-surface-variant/50 uppercase tracking-wide mb-3">Historique</p>
                                      <ol className="space-y-2.5">
                                        {buildTimeline(order, orderEvents).map((it, i) => (
                                          <li key={i} className="flex items-start gap-3">
                                            <span className={clsx("mt-1 w-2 h-2 rounded-full shrink-0", it.color)} />
                                            <div className="flex-1 min-w-0">
                                              <p className="text-sm text-on-surface">
                                                {it.label}
                                                {it.detail && <span className="text-on-surface-variant/50"> · {it.detail}</span>}
                                              </p>
                                              <p className="text-2xs text-on-surface-variant/40">{dateTimeFr(it.date)}</p>
                                            </div>
                                          </li>
                                        ))}
                                      </ol>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 bg-surface-container-low/30 border-t border-outline-variant/20 text-sm text-on-surface-variant/60">
              {visibleOrders.length} commande{visibleOrders.length !== 1 ? "s" : ""} affichée{visibleOrders.length !== 1 ? "s" : ""} sur {orders.length}
            </div>
          </div>

          {/* Stats row — all derived from live orders */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-card rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Dépenses ce mois</span>
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary"><TrendingUp size={18} /></div>
              </div>
              <div>
                <h3 className="text-2xl font-extrabold text-primary tabular-nums">€{spendThis.toFixed(2)}</h3>
                <p className="text-2xs text-on-surface-variant/60 mt-1">
                  {spendDelta === null ? "Pas d'historique le mois dernier" : `${spendDelta >= 0 ? "+" : ""}${spendDelta}% par rapport au mois dernier`}
                </p>
              </div>
              <div className="w-full bg-surface-container-highest rounded-full h-2">
                <div className="bg-primary h-full rounded-full transition-all" style={{ width: `${spendBarPct}%` }} />
              </div>
            </div>

            <div className="glass-card rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Commandes en attente</span>
                <div className="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center text-secondary"><Hourglass size={18} /></div>
              </div>
              <div>
                <h3 className="text-2xl font-extrabold text-on-surface tabular-nums">{pendingCount}</h3>
                <p className="text-2xs text-on-surface-variant/60 mt-1">Brouillons, envoyées ou partiellement reçues</p>
              </div>
              <div className="w-full bg-surface-container-highest rounded-full h-2">
                <div className="bg-secondary h-full rounded-full transition-all" style={{ width: `${pendingBarPct}%` }} />
              </div>
            </div>

            <div className="glass-card rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-2xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Fournisseur top</span>
                <div className="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary-container"><Star size={18} /></div>
              </div>
              {topSupplier ? (
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-tertiary-fixed flex items-center justify-center text-primary shrink-0"><Truck size={22} /></div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-on-surface truncate">{topSupplier.name}</h3>
                    <p className="text-2xs text-on-surface-variant/60">{topSupplier.count} commande{topSupplier.count !== 1 ? "s" : ""}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-on-surface-variant/50">Aucune commande</p>
              )}
              <Link href="/suppliers" className="mt-auto text-primary font-bold text-2xs uppercase tracking-wide flex items-center gap-1 hover:gap-2 transition-all w-fit">
                Voir les fournisseurs <ArrowRight size={14} />
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
