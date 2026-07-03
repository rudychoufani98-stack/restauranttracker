"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Plus, Minus, Trash2, Loader2, Check, Search, ShoppingCart, Package, Send } from "lucide-react";
import clsx from "clsx";

type Article = {
  supplier_id: string | null; supplier_reference: string | null;
  pack_units: number | null; unit_size: number | null; unit: string | null;
  pack_price: number | null; pack_label: string | null; pack_type?: string | null;
};
type Ingredient = {
  id: string; name: string; unit: string; category?: string | null; pack_price: number; pack_units?: number | null; unit_size?: number | null; pack_quantity?: number | null;
  supplier_id?: string | null; supplier_reference?: string | null; ingredient_suppliers?: Article[];
};
type Supplier = { id: string; name: string; email: string | null; min_order_amount?: number | null; customer_reference?: string | null };

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
const packTypeOf = (a: Article | null) => a?.pack_type || "colis";
function condLabel(a: Article): string {
  if (a.pack_label) return a.pack_label;
  const u = Number(a.pack_units ?? 1), s = Number(a.unit_size ?? 0);
  return u > 1 ? `${u} × ${s} ${a.unit}` : `${s} ${a.unit}`;
}

type CartLine = { quantity: number; price: string };

interface Props {
  restaurantId: string; restaurantName: string; suppliers: Supplier[]; ingredients: Ingredient[];
  // Edit mode: an existing draft order to modify instead of creating a new one.
  orderId?: string;
  initialSupplierId?: string;
  initialCart?: Record<string, CartLine>;
}

export default function NewOrderClient({ restaurantId, restaurantName, suppliers, ingredients, orderId, initialSupplierId = "", initialCart }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const isEdit = !!orderId;
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [cart, setCart] = useState<Record<string, CartLine>>(initialCart ?? {});
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("Toutes");
  const [saving, setSaving] = useState<null | "draft" | "send">(null);
  const [error, setError] = useState<string | null>(null);

  const sup = suppliers.find((s) => s.id === supplierId);
  const franco = Number(sup?.min_order_amount ?? 0);

  // Products for the chosen supplier (fallback to all if none linked yet).
  const linked = supplierId ? ingredients.filter((ing) => articleFor(ing, supplierId)) : [];
  const usingFallback = supplierId !== "" && linked.length === 0;
  const products = supplierId ? (linked.length > 0 ? linked : ingredients) : [];

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map((p) => p.category || "Autre")));
    return ["Toutes", ...cats.sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => (filterCat === "Toutes" || (p.category || "Autre") === filterCat) && (!q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, search, filterCat]);

  function changeSupplier(sid: string) {
    setSupplierId(sid);
    setCart({});
    setSearch("");
    setFilterCat("Toutes");
  }

  function defaultPrice(ing: Ingredient): string {
    const art = articleFor(ing, supplierId);
    return String(art?.pack_price ?? ing.pack_price ?? "");
  }
  function addToCart(ing: Ingredient) {
    setCart((c) => {
      const cur = c[ing.id];
      return { ...c, [ing.id]: cur ? { ...cur, quantity: cur.quantity + 1 } : { quantity: 1, price: defaultPrice(ing) } };
    });
  }
  function setQty(id: string, n: number) {
    setCart((c) => {
      if (n <= 0) { const { [id]: _, ...rest } = c; return rest; }
      return { ...c, [id]: { ...c[id], quantity: n } };
    });
  }
  function setPrice(id: string, val: string) {
    setCart((c) => ({ ...c, [id]: { ...c[id], price: val } }));
  }

  const cartEntries = Object.entries(cart);
  const total = cartEntries.reduce((s, [, l]) => s + l.quantity * (parseFloat(l.price) || 0), 0);
  const itemCount = cartEntries.reduce((s, [, l]) => s + l.quantity, 0);

  async function handleCreate(send: boolean) {
    setError(null);
    if (!supplierId) return setError("Choisis un fournisseur.");
    const valid = cartEntries.filter(([, l]) => l.quantity > 0);
    if (valid.length === 0) return setError("Ajoute au moins un produit.");
    setSaving(send ? "send" : "draft");

    // Always save as Draft first; we only mark "Sent" once the email really goes out.
    let poId = orderId;
    if (isEdit) {
      const { error: upErr } = await supabase.from("purchase_orders").update({
        supplier_id: supplierId, status: "Draft", sent_at: null, expected_total: total,
      }).eq("id", orderId);
      if (upErr) { setError(upErr.message); setSaving(null); return; }
      await supabase.from("purchase_order_lines").delete().eq("po_id", orderId);
    } else {
      // Sequential order number BDC-YEAR-NNNN so it's visible from creation.
      const year = new Date().getFullYear();
      const { count } = await supabase
        .from("purchase_orders")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId);
      const orderNumber = `BDC-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
      const { data: po, error: poErr } = await supabase.from("purchase_orders").insert({
        restaurant_id: restaurantId, supplier_id: supplierId,
        order_number: orderNumber, status: "Draft", expected_total: total,
      }).select().single();
      if (poErr || !po) { setError(poErr?.message ?? "Erreur"); setSaving(null); return; }
      poId = po.id;
    }

    await supabase.from("purchase_order_lines").insert(valid.map(([ingredient_id, l]) => ({
      po_id: poId, ingredient_id, quantity: l.quantity, expected_price: parseFloat(l.price) || null,
    })));

    if (!send) { router.push("/orders"); return; }

    // Sending: the email must succeed before the order is marked "Sent".
    if (!sup?.email) {
      setSaving(null);
      setError("Ce fournisseur n'a pas d'email — la commande est enregistrée en brouillon. Ajoute son email dans sa fiche pour l'envoyer.");
      return;
    }
    let emailErr = "";
    try {
      const res = await fetch("/api/send-order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poId, restaurantName }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); emailErr = j?.error ?? `Erreur ${res.status}`; }
    } catch (e: any) { emailErr = e?.message ?? "Réseau"; }

    if (emailErr) {
      setSaving(null);
      setError(`Commande enregistrée en brouillon, mais l'email n'a pas pu être envoyé : ${emailErr}. Vérifie la configuration d'envoi (Resend).`);
      return;
    }

    await supabase.from("purchase_orders").update({ status: "Sent", sent_at: new Date().toISOString() }).eq("id", poId);
    router.push("/orders?sent=1");
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto pb-28">
      <div className="flex items-center justify-between mb-5">
        <Link href="/orders" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
          <ArrowLeft size={16} /> Bons de commande
        </Link>
      </div>

      <div className="mb-5">
        <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Opérations</p>
        <h1 className="text-2xl font-bold text-gray-900">{isEdit ? "Modifier la commande" : "Nouvelle commande"}</h1>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      {/* Supplier */}
      <div className="bg-white border border-gray-100 rounded-card shadow-card p-5 mb-5">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Fournisseur</label>
        <select value={supplierId} onChange={(e) => changeSupplier(e.target.value)}
          className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500">
          <option value="">Choisir un fournisseur…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.email ? ` (${s.email})` : ""}</option>)}
        </select>
        {sup?.customer_reference && <p className="text-xs text-gray-400 mt-1.5">Ta référence client : <b>{sup.customer_reference}</b></p>}
      </div>

      {!supplierId ? (
        <p className="text-sm text-gray-400 text-center py-16 border border-dashed border-gray-200 rounded-card">
          Choisis un fournisseur pour parcourir ses produits.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          {/* Catalogue */}
          <div className="lg:col-span-2 space-y-3">
            {usingFallback && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Aucun produit n&apos;est encore rattaché à ce fournisseur — tous tes produits sont affichés. Astuce : rattache-les via la fiche produit (section « Conditionnement de commande — articles fournisseurs »).
              </p>
            )}

            {/* Search + categories */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un produit…"
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => (
                <button key={cat} onClick={() => setFilterCat(cat)}
                  className={clsx("px-3 py-1.5 text-xs rounded-full border transition", filterCat === cat ? "bg-emerald-500 text-white border-emerald-500" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50")}>
                  {cat}
                </button>
              ))}
            </div>

            {/* Tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {filteredProducts.length === 0 && (
                <p className="col-span-full text-sm text-gray-400 text-center py-10">Aucun produit ne correspond.</p>
              )}
              {filteredProducts.map((p) => {
                const art = articleFor(p, supplierId);
                const qty = cart[p.id]?.quantity ?? 0;
                const price = art?.pack_price ?? p.pack_price ?? 0;
                const active = qty > 0;
                return (
                  <button key={p.id} onClick={() => addToCart(p)}
                    className={clsx("relative text-left rounded-xl border p-3 transition",
                      active ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300" : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm")}>
                    {active && (
                      <span className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1 flex items-center justify-center rounded-full text-xs font-bold text-white bg-emerald-500 shadow">
                        {qty}
                      </span>
                    )}
                    <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">{p.name}</p>
                    <p className="text-2xs text-gray-400 mt-1">
                      {art ? <>1 {packTypeOf(art)} = <b className="text-gray-500">{condLabel(art)}</b></> : (p.category || "Autre")}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-800">€{Number(price).toFixed(2)}</span>
                      <span className="text-2xs text-emerald-600 font-medium flex items-center gap-0.5"><Plus size={11} /> Ajouter</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Panier */}
          <div className="lg:sticky lg:top-6 bg-white border border-gray-100 rounded-card shadow-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <ShoppingCart size={16} className="text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-900">Ma commande</h2>
              {itemCount > 0 && <span className="text-xs text-gray-400">{itemCount} article{itemCount !== 1 ? "s" : ""}</span>}
            </div>

            {cartEntries.length === 0 ? (
              <div className="text-center py-8">
                <Package size={24} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Clique sur un produit pour l&apos;ajouter.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[24rem] overflow-y-auto pr-1 -mr-1">
                {cartEntries.map(([id, l]) => {
                  const ing = ingredients.find((g) => g.id === id);
                  if (!ing) return null;
                  const art = articleFor(ing, supplierId);
                  const sub = l.quantity * (parseFloat(l.price) || 0);
                  return (
                    <div key={id} className="border border-gray-200 rounded-lg p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 leading-snug">{ing.name}</p>
                          {art && <p className="text-2xs text-gray-400">{packTypeOf(art)} · {condLabel(art)}</p>}
                        </div>
                        <button onClick={() => setQty(id, 0)} className="text-gray-300 hover:text-red-500 transition shrink-0"><Trash2 size={14} /></button>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setQty(id, l.quantity - 1)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Minus size={13} /></button>
                          <input type="number" min="0" step="any" value={l.quantity}
                            onChange={(e) => setQty(id, parseFloat(e.target.value) || 0)}
                            className="w-12 px-1 py-1 text-sm text-center border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                          <button onClick={() => setQty(id, l.quantity + 1)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"><Plus size={13} /></button>
                          <span className="text-2xs text-gray-400 ml-0.5">{packTypeOf(art)}</span>
                        </div>
                        <div className="relative w-20 ml-auto">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">€</span>
                          <input type="number" min="0" step="0.01" value={l.price}
                            onChange={(e) => setPrice(id, e.target.value)}
                            className="w-full pl-5 pr-1.5 py-1 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                        </div>
                      </div>
                      <p className="text-right text-xs font-semibold text-gray-900 mt-1.5">€{sub.toFixed(2)}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Total + franco */}
            <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Total prévisionnel</span>
                <span className="text-lg font-bold text-gray-900">€{total.toFixed(2)}</span>
              </div>
              {franco > 0 && (() => {
                const reached = total >= franco;
                return (
                  <>
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className={clsx("h-full rounded-full transition-all", reached ? "bg-emerald-500" : "bg-amber-400")} style={{ width: `${Math.min(100, franco ? (total / franco) * 100 : 0)}%` }} />
                    </div>
                    <p className={clsx("text-xs", reached ? "text-emerald-600" : "text-amber-600")}>
                      {reached ? `✓ Franco atteint (€${franco.toFixed(0)})` : `Franco à €${franco.toFixed(0)} — il manque €${(franco - total).toFixed(2)}`}
                    </p>
                  </>
                );
              })()}
              <button onClick={() => handleCreate(true)} disabled={saving !== null || cartEntries.length === 0}
                className="w-full mt-1 py-2.5 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition flex items-center justify-center gap-1.5">
                {saving === "send" ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {sup?.email ? "Envoyer la commande" : "Valider la commande"}
              </button>
              <button onClick={() => handleCreate(false)} disabled={saving !== null || cartEntries.length === 0}
                className="w-full py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition flex items-center justify-center gap-1.5">
                {saving === "draft" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {isEdit ? "Enregistrer le brouillon" : "Enregistrer en brouillon"}
              </button>
              {sup?.email
                ? <p className="text-2xs text-gray-400 text-center">La commande sera envoyée à {sup.email} puis tu seras redirigé.</p>
                : <p className="text-2xs text-gray-400 text-center">Ce fournisseur n&apos;a pas d&apos;email — la commande sera marquée envoyée sans email.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
