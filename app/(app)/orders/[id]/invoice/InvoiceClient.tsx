"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Check, Loader2, FileText } from "lucide-react";

type Ingredient = { id: string; name: string; unit: string; pack_price: number; cost_per_base_unit: number; pack_quantity: number };
type POLine = { id: string; ingredient_id: string | null; quantity: number; expected_price: number | null; ingredients?: Ingredient | null };
type PO = { id: string; order_number?: string | null; suppliers?: { name: string; email: string | null } | null; purchase_order_lines: POLine[] };
type DNLine = { ingredient_id: string | null; quantity_received: number; ingredients?: Ingredient | null };
type DeliveryNote = { id: string; bl_number?: string | null; delivery_note_lines: DNLine[] };
type PriorInvoiceLine = { ingredient_id: string | null; quantity: number; unit_price: number | null };
type PriorInvoice = { id: string; misc_fees?: number | null; misc_fees_label?: string | null; invoice_lines: PriorInvoiceLine[] };

type InvoiceLine = {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  qty: string;           // editable — number of colis
  expected_price: number;
  invoice_price: string; // editable — price per colis
  pack_quantity: number;
  cost_per_base_unit: number;
};

type OrderCond = Record<string, { type: string; detail: string }>;
interface Props {
  po: PO;
  deliveryNote: DeliveryNote | null;
  restaurantId: string;
  orderCond?: OrderCond;
  priorInvoice?: PriorInvoice | null;
}

// base units per colis (g/ml/unit): pack size × 1000 for weight/volume.
function baseFactor(unit: string, packQty: number) {
  const p = packQty || 1;
  return unit === "kg" || unit === "l" ? p * 1000 : p;
}

export default function InvoiceClient({ po, deliveryNote, restaurantId, orderCond = {}, priorInvoice = null }: Props) {
  const condType = (ingredientId: string, fallback: string) => orderCond[ingredientId]?.type || fallback || "colis";
  const router = useRouter();
  const supabase = createClient();
  const isEdit = !!priorInvoice;

  // Ingredient reference info (name, unit, pack size, cost) from the order + delivery note.
  const infoMap = new Map<string, Ingredient>();
  for (const l of po.purchase_order_lines) if (l.ingredient_id && l.ingredients) infoMap.set(l.ingredient_id, l.ingredients);
  for (const d of deliveryNote?.delivery_note_lines ?? []) if (d.ingredient_id && d.ingredients) infoMap.set(d.ingredient_id, d.ingredients);

  // Starting quantities: prefer the last invoice (re-edit), then the delivery note
  // (what was received), then the order.
  const buildLines = (): InvoiceLine[] => {
    let source: { ingredient_id: string; qty: number; price?: number }[] = [];
    if (priorInvoice && priorInvoice.invoice_lines.length > 0) {
      source = priorInvoice.invoice_lines
        .filter((l) => l.ingredient_id)
        .map((l) => ({ ingredient_id: l.ingredient_id!, qty: Number(l.quantity), price: l.unit_price ?? undefined }));
    } else if ((deliveryNote?.delivery_note_lines ?? []).length > 0) {
      source = deliveryNote!.delivery_note_lines
        .filter((d) => d.ingredient_id && Number(d.quantity_received) > 0)
        .map((d) => ({ ingredient_id: d.ingredient_id!, qty: Number(d.quantity_received) }));
    } else {
      source = po.purchase_order_lines
        .filter((l) => l.ingredient_id)
        .map((l) => ({ ingredient_id: l.ingredient_id!, qty: Number(l.quantity) }));
    }
    return source.map((s) => {
      const info = infoMap.get(s.ingredient_id);
      const poLine = po.purchase_order_lines.find((l) => l.ingredient_id === s.ingredient_id);
      const expectedPrice = poLine?.expected_price ?? info?.pack_price ?? 0;
      const price = s.price ?? expectedPrice;
      return {
        ingredient_id: s.ingredient_id,
        ingredient_name: info?.name ?? "—",
        unit: info?.unit ?? "unit",
        qty: String(s.qty),
        expected_price: expectedPrice,
        invoice_price: String(price),
        pack_quantity: Number(info?.pack_quantity ?? 1) || 1,
        cost_per_base_unit: Number(info?.cost_per_base_unit ?? 0),
      };
    });
  };

  const [lines, setLines] = useState<InvoiceLine[]>(buildLines);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [miscFees, setMiscFees] = useState(priorInvoice?.misc_fees ? String(priorInvoice.misc_fees) : "");
  const [miscLabel, setMiscLabel] = useState(priorInvoice?.misc_fees_label || "Frais divers");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updatePrice(i: number, val: string) {
    setLines((p) => { const n = [...p]; n[i] = { ...n[i], invoice_price: val }; return n; });
  }
  function updateQty(i: number, val: string) {
    setLines((p) => { const n = [...p]; n[i] = { ...n[i], qty: val }; return n; });
  }

  const linesTotal = lines.reduce((s, l) => s + (parseFloat(l.invoice_price) || 0) * (parseFloat(l.qty) || 0), 0);
  const misc = parseFloat(miscFees) || 0;
  const total = linesTotal + misc;

  async function handleValidate() {
    setSaving(true);
    setError(null);

    try {
      // 1. Create the invoice record (each validation is a new invoice; the delta
      //    vs the previously applied quantities is what moves the stock).
      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          po_id: po.id,
          restaurant_id: restaurantId,
          delivery_note_id: deliveryNote?.id ?? null,
          invoice_number: invoiceNumber || null,
          invoice_date: invoiceDate,
          total_ht: total,
          misc_fees: misc,
          misc_fees_label: misc > 0 ? (miscLabel.trim() || "Frais divers") : null,
          validated: true,
          validated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (invErr) throw new Error(invErr.message);

      // 2. Previously applied base quantity per ingredient (what the stock already
      //    reflects for this order): the last invoice if any, else the reception.
      const prevBase = new Map<string, number>();
      const baseOf = (id: string, qtyColis: number) => {
        const info = infoMap.get(id);
        return qtyColis * baseFactor(info?.unit ?? "unit", Number(info?.pack_quantity ?? 1) || 1);
      };
      if (priorInvoice) {
        for (const l of priorInvoice.invoice_lines) if (l.ingredient_id) prevBase.set(l.ingredient_id, baseOf(l.ingredient_id, Number(l.quantity)));
      } else {
        for (const d of deliveryNote?.delivery_note_lines ?? []) {
          if (d.ingredient_id && Number(d.quantity_received) > 0) prevBase.set(d.ingredient_id, baseOf(d.ingredient_id, Number(d.quantity_received)));
        }
      }

      // 3. New target base quantity per ingredient (from the editable lines).
      const newBase = new Map<string, number>();
      for (const l of lines) newBase.set(l.ingredient_id, baseOf(l.ingredient_id, parseFloat(l.qty) || 0));

      const allIds = Array.from(new Set([...Array.from(prevBase.keys()), ...Array.from(newBase.keys())]));

      // Current stock + cmup for those ingredients.
      const { data: currentIngData } = await supabase
        .from("ingredients").select("id, stock_qty, cmup").in("id", allIds);
      const ingStockMap = new Map((currentIngData ?? []).map((i) => [i.id, i]));

      const movements: any[] = [];

      for (const id of allIds) {
        const line = lines.find((l) => l.ingredient_id === id);
        const prev = prevBase.get(id) ?? 0;
        const target = newBase.get(id) ?? 0;
        const delta = target - prev;

        const invoicePrice = line ? (parseFloat(line.invoice_price) || line.expected_price) : 0;
        const factor = baseFactor(infoMap.get(id)?.unit ?? "unit", Number(infoMap.get(id)?.pack_quantity ?? 1) || 1);
        const newCostPerBase = line && factor > 0 ? invoicePrice / factor : Number(infoMap.get(id)?.cost_per_base_unit ?? 0);

        const cur = ingStockMap.get(id);
        const curStock = Number(cur?.stock_qty ?? 0);
        const curCmup = Number(cur?.cmup ?? newCostPerBase);
        let newStock = curStock + delta;
        if (newStock < 0) newStock = 0;

        let newCmup = curCmup;
        if (delta > 0) newCmup = newStock > 0 ? (curStock * curCmup + delta * newCostPerBase) / newStock : newCostPerBase;

        const patch: any = { stock_qty: newStock, cmup: newCmup, updated_at: new Date().toISOString() };
        if (line) { patch.pack_price = invoicePrice; patch.cost_per_base_unit = newCostPerBase; }
        const { error: upErr } = await supabase.from("ingredients").update(patch).eq("id", id);
        if (upErr) throw new Error(`Stock ingrédient : ${upErr.message}`);

        // Invoice line (record the billed qty + price)
        if (line) {
          await supabase.from("invoice_lines").insert({
            invoice_id: invoice.id, ingredient_id: id,
            quantity: parseFloat(line.qty) || 0, unit_price: invoicePrice,
            price_changed: Math.abs(invoicePrice - line.expected_price) > 0.001,
          });
          if (Math.abs(invoicePrice - line.expected_price) > 0.001) {
            await supabase.from("ingredient_price_history").insert({
              ingredient_id: id, old_price: line.expected_price, new_price: invoicePrice,
              source: "invoice", delivery_note_id: deliveryNote?.id ?? null,
            });
          }
        }

        // Stock movement for the reconciliation delta.
        if (Math.abs(delta) > 0.0001) {
          movements.push({
            restaurant_id: restaurantId, ingredient_id: id,
            movement_type: delta > 0 ? "in" : "adjustment",
            qty: Math.abs(delta), unit_cost: newCostPerBase,
            reference_type: "invoice", reference_id: invoice.id,
            notes: isEdit ? "Ajustement facture (correction)" : "Facture",
          });
        }
      }

      if (movements.length > 0) {
        const { error: movErr } = await supabase.from("stock_movements").insert(movements);
        if (movErr) throw new Error(`Mouvements de stock : ${movErr.message}`);
      }

      // Recalculate recipes using these ingredients.
      await fetch("/api/recalculate-recipes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, changedIngredientIds: allIds }),
      });

      await supabase.from("purchase_orders").update({ status: "Invoiced" }).eq("id", po.id);
      router.push("/orders?invoiced=1");
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <a href="/orders" className="text-sm text-gray-400 hover:text-gray-600 mb-2 inline-block">
          &larr; Bons de commande
        </a>
        <h1 className="text-xl font-medium text-gray-900">{isEdit ? "Modifier la facture" : "Saisie de facture"}</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {po.suppliers?.name} · BDC {po.order_number ?? po.id.slice(0, 8)} — {isEdit ? "corrige les quantités et prix, le stock est réajusté" : "confirme les quantités et prix de la facture"}
        </p>
      </div>

      {/* Invoice header */}
      <div className="bg-white border border-[#E5E7EB] rounded-card p-5 mb-5">
        <h2 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
          <FileText size={15} className="text-gray-400" /> Informations facture
        </h2>
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg px-2.5 py-1">
            Bon de commande : <b>{po.order_number ?? po.id.slice(0, 8)}</b>
          </span>
          {deliveryNote?.bl_number && (
            <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-lg px-2.5 py-1">
              Bon de livraison : <b>{deliveryNote.bl_number}</b>
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Numéro de facture</label>
            <input type="text" placeholder="FAC-2024-001" value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date de facture</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
          </div>
        </div>
      </div>

      {/* Invoice lines */}
      <div className="bg-white border border-[#E5E7EB] rounded-card overflow-hidden mb-5">
        <div className="px-5 py-3 border-b border-[#E5E7EB] bg-gray-50">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Lignes — ajuste la quantité et le prix (mets 0 pour annuler une ligne)
          </p>
        </div>
        <div className="divide-y divide-[#E5E7EB]">
          {lines.map((line, i) => {
            const invoicePrice = parseFloat(line.invoice_price) || 0;
            const qty = parseFloat(line.qty) || 0;
            const priceChanged = Math.abs(invoicePrice - line.expected_price) > 0.001;
            const lineTotal = invoicePrice * qty;
            const type = condType(line.ingredient_id, line.unit);
            return (
              <div key={i} className={`px-5 py-4 ${qty === 0 ? "bg-gray-50/60" : ""}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`font-medium text-sm ${qty === 0 ? "text-gray-400 line-through" : "text-gray-900"}`}>{line.ingredient_name}</span>
                  {qty === 0 && <span className="text-2xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Annulée</span>}
                </div>
                <div className="flex items-end gap-3">
                  <div className="w-28">
                    <label className="block text-xs text-gray-500 mb-1">Quantité ({type})</label>
                    <input type="number" min="0" step="any" value={line.qty}
                      onChange={(e) => updateQty(i, e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">
                      Prix (€/{type})
                      {priceChanged && <span className="text-amber-500 ml-1">— prévu €{line.expected_price.toFixed(2)}</span>}
                    </label>
                    <input type="number" min="0" step="0.01" value={line.invoice_price}
                      onChange={(e) => updatePrice(i, e.target.value)}
                      className={`w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 transition ${
                        priceChanged ? "border-amber-400 focus:border-amber-500 focus:ring-amber-300" : "border-[#E5E7EB] focus:border-emerald-500 focus:ring-emerald-500"
                      }`} />
                  </div>
                  <div className="text-right text-xs text-gray-500 pb-2">
                    Sous-total<br />
                    <span className={`font-semibold text-sm ${priceChanged ? "text-amber-600" : "text-gray-900"}`}>€{lineTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {/* Frais divers (optionnel) — taxes alcool, livraison… n'affecte pas le stock */}
        <div className="px-5 py-4 border-t border-[#E5E7EB]">
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Frais divers (optionnel)</label>
          <div className="flex items-center gap-2">
            <input type="text" value={miscLabel} onChange={(e) => setMiscLabel(e.target.value)}
              placeholder="ex. Taxe alcool, frais de livraison…"
              className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500" />
            <div className="relative w-28">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">€</span>
              <input type="number" min="0" step="0.01" value={miscFees} onChange={(e) => setMiscFees(e.target.value)}
                placeholder="0.00"
                className="w-full pl-5 pr-2 py-2 text-sm text-right border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500" />
            </div>
          </div>
          <p className="text-2xs text-gray-400 mt-1.5">Ajouté au total, sans effet sur le stock.</p>
        </div>
        <div className="px-5 py-4 border-t border-[#E5E7EB] bg-gray-50 space-y-1">
          <div className="flex justify-between items-center text-sm text-gray-500">
            <span>Sous-total produits</span>
            <span>€{linesTotal.toFixed(2)}</span>
          </div>
          {misc > 0 && (
            <div className="flex justify-between items-center text-sm text-gray-500">
              <span>{miscLabel.trim() || "Frais divers"}</span>
              <span>€{misc.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-1">
            <span className="text-sm font-medium text-gray-700">Total HT</span>
            <span className="text-lg font-semibold text-gray-900">€{total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">{error}</div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-5 text-xs text-blue-700">
        Le stock est réajusté selon <b>l&apos;écart</b> entre cette facture et ce qui a déjà été appliqué (réception ou facture précédente). Tu peux revenir modifier cette facture plus tard : le stock se réajustera à nouveau. Mettre une quantité à <b>0</b> annule sa contribution au stock.
      </div>

      <div className="flex gap-3">
        <a href="/orders" className="flex-1 py-2 text-center text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition">Annuler</a>
        <button onClick={handleValidate} disabled={saving}
          className="flex-1 py-2 text-sm text-white bg-purple-500 rounded-lg hover:bg-purple-600 disabled:opacity-50 transition flex items-center justify-center gap-2">
          {saving ? <><Loader2 size={14} className="animate-spin" /> Validation…</> : <><Check size={14} /> {isEdit ? "Enregistrer les corrections" : "Valider la facture"}</>}
        </button>
      </div>
    </div>
  );
}
