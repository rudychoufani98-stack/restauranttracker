"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Plus, Trash2, Loader2, Check } from "lucide-react";
import clsx from "clsx";

type Article = {
  supplier_id: string | null; supplier_reference: string | null;
  pack_units: number | null; unit_size: number | null; unit: string | null;
  pack_price: number | null; pack_label: string | null; pack_type?: string | null;
};
type Ingredient = {
  id: string; name: string; unit: string; pack_price: number; pack_units?: number | null; unit_size?: number | null; pack_quantity?: number | null;
  supplier_id?: string | null; supplier_reference?: string | null; ingredient_suppliers?: Article[];
};
type Supplier = { id: string; name: string; email: string | null; min_order_amount?: number | null; customer_reference?: string | null };
type DraftLine = { ingredient_id: string; quantity: string; expected_price: string };

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

interface Props { restaurantId: string; suppliers: Supplier[]; ingredients: Ingredient[]; }

export default function NewOrderClient({ restaurantId, suppliers, ingredients }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ingredient_id: "", quantity: "", expected_price: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Products with an article for the supplier; fall back to ALL products if none are linked yet.
  const linked = supplierId ? ingredients.filter((ing) => articleFor(ing, supplierId)) : [];
  const usingFallback = supplierId !== "" && linked.length === 0;
  const products = supplierId ? (linked.length > 0 ? linked : ingredients) : [];

  function changeSupplier(sid: string) {
    setSupplierId(sid);
    setLines([{ ingredient_id: "", quantity: "", expected_price: "" }]);
  }
  function addLine() { setLines((p) => [...p, { ingredient_id: "", quantity: "", expected_price: "" }]); }
  function removeLine(i: number) { setLines((p) => p.filter((_, idx) => idx !== i)); }
  function updateLine(i: number, f: keyof DraftLine, v: string) {
    setLines((p) => {
      const next = [...p];
      next[i] = { ...next[i], [f]: v };
      if (f === "ingredient_id") {
        const ing = ingredients.find((g) => g.id === v);
        const art = ing ? articleFor(ing, supplierId) : null;
        if (art?.pack_price != null) next[i].expected_price = String(art.pack_price);
        else if (ing) next[i].expected_price = String(ing.pack_price ?? "");
      }
      return next;
    });
  }

  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.expected_price) || 0), 0);
  const sup = suppliers.find((s) => s.id === supplierId);
  const franco = Number(sup?.min_order_amount ?? 0);

  async function handleCreate() {
    setError(null);
    if (!supplierId) return setError("Choisis un fournisseur.");
    const valid = lines.filter((l) => l.ingredient_id && parseFloat(l.quantity) > 0);
    if (valid.length === 0) return setError("Ajoute au moins un produit avec une quantité.");
    setSaving(true);
    const { data: po, error: poErr } = await supabase.from("purchase_orders").insert({
      restaurant_id: restaurantId, supplier_id: supplierId, status: "Draft", expected_total: total,
    }).select().single();
    if (poErr || !po) { setError(poErr?.message ?? "Erreur"); setSaving(false); return; }
    await supabase.from("purchase_order_lines").insert(valid.map((l) => ({
      po_id: po.id, ingredient_id: l.ingredient_id, quantity: parseFloat(l.quantity), expected_price: parseFloat(l.expected_price) || null,
    })));
    router.push("/orders");
  }

  const inputCls = "px-2.5 py-2 text-sm bg-white border border-gray-200 rounded-lg outline-none focus:border-emerald-500";

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-5">
        <Link href="/orders" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
          <ArrowLeft size={16} /> Bons de commande
        </Link>
      </div>

      <div className="mb-5">
        <p className="text-xs font-semibold text-emerald-600 uppercase tracking-widest mb-1">Opérations</p>
        <h1 className="text-2xl font-bold text-gray-900">Nouvelle commande</h1>
      </div>

      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

      {/* Supplier */}
      <div className="bg-white border border-gray-100 rounded-card shadow-card p-5 mb-4">
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Fournisseur</label>
        <select value={supplierId} onChange={(e) => changeSupplier(e.target.value)} className={clsx(inputCls, "w-full")}>
          <option value="">Choisir un fournisseur…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.email ? ` (${s.email})` : ""}</option>)}
        </select>
        {sup?.customer_reference && <p className="text-xs text-gray-400 mt-1.5">Ta référence client : <b>{sup.customer_reference}</b></p>}
      </div>

      {/* Lines */}
      {!supplierId ? (
        <p className="text-sm text-gray-400 text-center py-10 border border-dashed border-gray-200 rounded-card">
          Choisis un fournisseur pour ajouter des produits.
        </p>
      ) : (
        <div className="bg-white border border-gray-100 rounded-card shadow-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Produits à commander</h2>
            <button onClick={addLine} className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700"><Plus size={13} /> Ajouter une ligne</button>
          </div>

          {usingFallback && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              Aucun produit n'est encore rattaché à ce fournisseur — tous tes produits sont affichés. Astuce : rattache-les via la fiche produit (section « Articles ») pour les filtrer automatiquement.
            </p>
          )}

          <div className="space-y-2.5">
            {lines.map((line, i) => {
              const ing = ingredients.find((g) => g.id === line.ingredient_id);
              const art = ing ? articleFor(ing, supplierId) : null;
              const sub = (parseFloat(line.quantity) || 0) * (parseFloat(line.expected_price) || 0);
              return (
                <div key={i} className="border border-gray-200 rounded-lg p-2.5 bg-gray-50/40">
                  <div className="flex gap-2 items-center">
                    <select value={line.ingredient_id} onChange={(e) => updateLine(i, "ingredient_id", e.target.value)} className={clsx(inputCls, "flex-1")}>
                      <option value="">Choisir un produit…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
                      <input type="number" min="0" step="any" value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} placeholder="0" className="w-16 px-2 py-1.5 text-sm text-right border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                      <span className="text-xs text-gray-400">{packTypeOf(art)}</span>
                    </div>
                    <span className="text-gray-300">×</span>
                    <div className="relative w-28">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">€</span>
                      <input type="number" min="0" step="0.01" value={line.expected_price} onChange={(e) => updateLine(i, "expected_price", e.target.value)} placeholder="prix" className="w-full pl-5 pr-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-emerald-500" />
                    </div>
                    <span className="ml-auto text-sm font-semibold text-gray-900">€{sub.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total + franco */}
          <div className="mt-4 px-4 py-3 bg-gray-50 rounded-lg border border-gray-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Total prévisionnel</span>
              <span className="text-base font-bold text-gray-900">€{total.toFixed(2)}</span>
            </div>
            {franco > 0 && (() => {
              const reached = total >= franco;
              return (
                <>
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className={clsx("h-full rounded-full", reached ? "bg-emerald-500" : "bg-amber-400")} style={{ width: `${Math.min(100, (total / franco) * 100)}%` }} />
                  </div>
                  <p className={clsx("text-xs", reached ? "text-emerald-600" : "text-amber-600")}>
                    {reached ? `✓ Franco atteint (€${franco.toFixed(0)})` : `Franco à €${franco.toFixed(0)} — il manque €${(franco - total).toFixed(2)}`}
                  </p>
                </>
              );
            })()}
          </div>

          <div className="flex gap-2 mt-4">
            <Link href="/orders" className="flex-1 py-2.5 text-sm text-center text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition">Annuler</Link>
            <button onClick={handleCreate} disabled={saving}
              className="flex-1 py-2.5 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition flex items-center justify-center gap-1.5">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Créer la commande
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
