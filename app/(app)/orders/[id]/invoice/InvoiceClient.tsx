"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Check, Loader2, FileText } from "lucide-react";

type Ingredient = { id: string; name: string; unit: string; pack_price: number; cost_per_base_unit: number; pack_quantity: number };
type POLine = { id: string; ingredient_id: string | null; quantity: number; expected_price: number | null; ingredients?: Ingredient | null };
type PO = { id: string; order_number?: string | null; suppliers?: { name: string; email: string | null } | null; purchase_order_lines: POLine[] };
type DNLine = { ingredient_id: string | null; quantity_received: number };
type DeliveryNote = { id: string; delivery_note_lines: DNLine[] };

type InvoiceLine = {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  qty_received: number;
  expected_price: number;
  invoice_price: string; // editable
  pack_quantity: number;
  cost_per_base_unit: number;
};

interface Props {
  po: PO;
  deliveryNote: DeliveryNote | null;
  restaurantId: string;
}

export default function InvoiceClient({ po, deliveryNote, restaurantId }: Props) {
  const router = useRouter();
  const supabase = createClient();

  // Build invoice lines: use delivery note quantities when available, else PO quantities
  const buildLines = (): InvoiceLine[] => {
    return po.purchase_order_lines
      .filter((l) => l.ingredient_id && l.ingredients)
      .map((l) => {
        const dnLine = deliveryNote?.delivery_note_lines.find((d) => d.ingredient_id === l.ingredient_id);
        const qty = dnLine ? dnLine.quantity_received : l.quantity;
        const expectedPrice = l.expected_price ?? l.ingredients!.pack_price;
        return {
          ingredient_id: l.ingredient_id!,
          ingredient_name: l.ingredients!.name,
          unit: l.ingredients!.unit,
          qty_received: qty,
          expected_price: expectedPrice,
          invoice_price: String(expectedPrice),
          pack_quantity: l.ingredients!.pack_quantity,
          cost_per_base_unit: l.ingredients!.cost_per_base_unit,
        };
      });
  };

  const [lines, setLines] = useState<InvoiceLine[]>(buildLines);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updatePrice(i: number, val: string) {
    setLines((p) => { const n = [...p]; n[i] = { ...n[i], invoice_price: val }; return n; });
  }

  const total = lines.reduce((s, l) => s + (parseFloat(l.invoice_price) || 0) * l.qty_received, 0);

  async function handleValidate() {
    setSaving(true);
    setError(null);

    try {
      // 1. Create invoice record
      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          po_id: po.id,
          restaurant_id: restaurantId,
          delivery_note_id: deliveryNote?.id ?? null,
          invoice_number: invoiceNumber || null,
          invoice_date: invoiceDate,
          total_ht: total,
          validated: true,
          validated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (invErr) throw new Error(invErr.message);

      // 2. Fetch current stock_qty + cmup for CMUP calculation
      const ingredientIds = lines.map((l) => l.ingredient_id);
      const { data: currentIngData } = await supabase
        .from("ingredients")
        .select("id, stock_qty, cmup")
        .in("id", ingredientIds);
      const ingStockMap = new Map((currentIngData ?? []).map((i) => [i.id, i]));

      // 3. Insert invoice lines + update ingredient costs + stock + CMUP
      const stockMovements: any[] = [];

      for (const line of lines) {
        const invoicePrice = parseFloat(line.invoice_price) || line.expected_price;
        const priceChanged = Math.abs(invoicePrice - line.expected_price) > 0.001;

        await supabase.from("invoice_lines").insert({
          invoice_id: invoice.id,
          ingredient_id: line.ingredient_id,
          quantity: line.qty_received,
          unit_price: invoicePrice,
          price_changed: priceChanged,
        });

        // Compute base qty received (in base units: g, ml, or unit)
        const packQty = line.pack_quantity || 1;
        let baseQtyPerPack = packQty;
        if (line.unit === "kg") baseQtyPerPack = packQty * 1000;
        else if (line.unit === "l") baseQtyPerPack = packQty * 1000;
        const receivedBaseQty = line.qty_received * baseQtyPerPack;

        const newCostPerBase = invoicePrice / (baseQtyPerPack || 1);

        // CMUP = (stock_actuel × cmup_actuel + qté_reçue × nouveau_coût) / (stock_actuel + qté_reçue)
        const current = ingStockMap.get(line.ingredient_id);
        const currentStock = Number(current?.stock_qty ?? 0);
        const currentCmup = Number(current?.cmup ?? newCostPerBase);
        const newStock = currentStock + receivedBaseQty;
        const newCmup = newStock > 0
          ? (currentStock * currentCmup + receivedBaseQty * newCostPerBase) / newStock
          : newCostPerBase;

        await supabase
          .from("ingredients")
          .update({
            pack_price: invoicePrice,
            cost_per_base_unit: newCostPerBase,
            stock_qty: newStock,
            cmup: newCmup,
            updated_at: new Date().toISOString(),
          })
          .eq("id", line.ingredient_id);

        if (priceChanged) {
          await supabase.from("ingredient_price_history").insert({
            ingredient_id: line.ingredient_id,
            old_price: line.expected_price,
            new_price: invoicePrice,
            source: "invoice",
            delivery_note_id: deliveryNote?.id ?? null,
          });
        }

        stockMovements.push({
          restaurant_id: restaurantId,
          ingredient_id: line.ingredient_id,
          movement_type: "in",
          qty: receivedBaseQty,
          unit_cost: newCmup,
          reference_type: "invoice",
          reference_id: invoice.id,
        });
      }

      // 4. Insert stock movements
      if (stockMovements.length > 0) {
        await supabase.from("stock_movements").insert(stockMovements);
      }

      // 5. Recalculate recipes that use these ingredients
      await fetch("/api/recalculate-recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, changedIngredientIds: ingredientIds }),
      });

      // 6. Mark PO as Invoiced
      await supabase
        .from("purchase_orders")
        .update({ status: "Invoiced" })
        .eq("id", po.id);

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
          &larr; Back to orders
        </a>
        <h1 className="text-xl font-medium text-gray-900">Saisie de facture</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {po.suppliers?.name} · BDC {po.order_number ?? po.id.slice(0, 8)} — Confirmez les prix de la facture
        </p>
      </div>

      {/* Invoice header */}
      <div className="bg-white border border-[#E5E7EB] rounded-card p-5 mb-5">
        <h2 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-2">
          <FileText size={15} className="text-gray-400" /> Informations facture
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Numéro de facture</label>
            <input
              type="text"
              placeholder="FAC-2024-001"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date de facture</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
            />
          </div>
        </div>
      </div>

      {/* Invoice lines */}
      <div className="bg-white border border-[#E5E7EB] rounded-card overflow-hidden mb-5">
        <div className="px-5 py-3 border-b border-[#E5E7EB] bg-gray-50">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Lignes — saisissez le prix unitaire de la facture
          </p>
        </div>
        <div className="divide-y divide-[#E5E7EB]">
          {lines.map((line, i) => {
            const invoicePrice = parseFloat(line.invoice_price) || 0;
            const priceChanged = Math.abs(invoicePrice - line.expected_price) > 0.001;
            const lineTotal = invoicePrice * line.qty_received;

            return (
              <div key={i} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900 text-sm">{line.ingredient_name}</span>
                  <span className="text-xs text-gray-400">
                    Qté reçue: <span className="font-medium text-gray-700">{line.qty_received} {line.unit}</span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">
                      Prix facture (€/{line.unit})
                      {priceChanged && (
                        <span className="text-amber-500 ml-1">
                          — prévu €{line.expected_price.toFixed(2)}
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.invoice_price}
                      onChange={(e) => updatePrice(i, e.target.value)}
                      className={`w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 transition ${
                        priceChanged
                          ? "border-amber-400 focus:border-amber-500 focus:ring-amber-300"
                          : "border-[#E5E7EB] focus:border-emerald-500 focus:ring-emerald-500"
                      }`}
                    />
                  </div>
                  <div className="text-right text-xs text-gray-500 pt-4">
                    Sous-total<br />
                    <span className={`font-semibold text-sm ${priceChanged ? "text-amber-600" : "text-gray-900"}`}>
                      €{lineTotal.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-4 border-t border-[#E5E7EB] bg-gray-50 flex justify-between items-center">
          <span className="text-sm font-medium text-gray-700">Total HT</span>
          <span className="text-lg font-semibold text-gray-900">€{total.toFixed(2)}</span>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
          {error}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-5 text-xs text-blue-700">
        En validant cette facture, les coûts des ingrédients seront mis à jour et les recettes recalculées automatiquement.
      </div>

      <div className="flex gap-3">
        <a
          href="/orders"
          className="flex-1 py-2 text-center text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition"
        >
          Annuler
        </a>
        <button
          onClick={handleValidate}
          disabled={saving}
          className="flex-1 py-2 text-sm text-white bg-purple-500 rounded-lg hover:bg-purple-600 disabled:opacity-50 transition flex items-center justify-center gap-2"
        >
          {saving ? (
            <><Loader2 size={14} className="animate-spin" /> Validation…</>
          ) : (
            <><Check size={14} /> Valider la facture &amp; mettre à jour les coûts</>
          )}
        </button>
      </div>
    </div>
  );
}
