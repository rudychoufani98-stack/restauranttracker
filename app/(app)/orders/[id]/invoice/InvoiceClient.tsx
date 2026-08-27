"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Check, Loader2, FileText } from "lucide-react";
import { defaultPackType } from "@/lib/order-email";
import { revalueOnInvoice } from "@/lib/costing";
import { useConfirm, useAlert } from "@/components/ConfirmDialog";
import { eur } from "@/lib/format";

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

type OrderCond = Record<string, { type: string; detail: string; basePerPack?: number }>;
interface Props {
  po: PO;
  deliveryNote: DeliveryNote | null;          // la plus récente (n° BL, rattachement)
  deliveryNotes?: DeliveryNote[];             // TOUTES les réceptions validées (quantités)
  restaurantId: string;
  orderCond?: OrderCond;
  priorInvoice?: PriorInvoice | null;
}

// base units per colis (g/ml/unit): pack size × 1000 for weight/volume.
function baseFactor(unit: string, packQty: number) {
  const p = packQty || 1;
  return unit === "kg" || unit === "l" ? p * 1000 : p;
}

export default function InvoiceClient({ po, deliveryNote, deliveryNotes, restaurantId, orderCond = {}, priorInvoice = null }: Props) {
  const confirm = useConfirm();
  const notify = useAlert();
  // Lignes reçues agrégées sur TOUTES les réceptions validées (cumul par produit).
  const allDnLines: DNLine[] = (deliveryNotes ?? (deliveryNote ? [deliveryNote] : [])).flatMap((dn) => dn.delivery_note_lines ?? []);
  // Fallback : type déduit de l'unité (bidon / kg / colis), jamais l'unité brute.
  const condType = (ingredientId: string, unit: string, packQty?: number | null) =>
    orderCond[ingredientId]?.type || defaultPackType(unit, packQty);
  const router = useRouter();
  const supabase = createClient();
  const isEdit = !!priorInvoice;

  // Ingredient reference info (name, unit, pack size, cost) from the order + delivery note.
  const infoMap = new Map<string, Ingredient>();
  for (const l of po.purchase_order_lines) if (l.ingredient_id && l.ingredients) infoMap.set(l.ingredient_id, l.ingredients);
  for (const d of allDnLines) if (d.ingredient_id && d.ingredients) infoMap.set(d.ingredient_id, d.ingredients);

  // Starting quantities: prefer the last invoice (re-edit), then the delivery note
  // (what was received), then the order.
  const buildLines = (): InvoiceLine[] => {
    let source: { ingredient_id: string; qty: number; price?: number }[] = [];
    if (priorInvoice && priorInvoice.invoice_lines.length > 0) {
      source = priorInvoice.invoice_lines
        .filter((l) => l.ingredient_id)
        .map((l) => ({ ingredient_id: l.ingredient_id!, qty: Number(l.quantity), price: l.unit_price ?? undefined }));
    } else if (allDnLines.length > 0) {
      // Cumul par produit sur toutes les réceptions validées
      const byIng = new Map<string, number>();
      for (const d of allDnLines) {
        if (d.ingredient_id && Number(d.quantity_received) > 0)
          byIng.set(d.ingredient_id, (byIng.get(d.ingredient_id) ?? 0) + Number(d.quantity_received));
      }
      source = Array.from(byIng.entries()).map(([ingredient_id, qty]) => ({ ingredient_id, qty }));
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
    // Une quantité négative retirerait du stock sans que rien ne l'indique.
    const clean = val === "" || parseFloat(val) >= 0 ? val : "0";
    setLines((p) => { const n = [...p]; n[i] = { ...n[i], qty: clean }; return n; });
  }

  const linesTotal = lines.reduce((s, l) => s + (parseFloat(l.invoice_price) || 0) * (parseFloat(l.qty) || 0), 0);
  const misc = parseFloat(miscFees) || 0;
  const total = linesTotal + misc;

  async function handleValidate() {
    setError(null);

    if (!invoiceNumber.trim() && !(await confirm(
      "Aucun numéro de facture saisi.\n\nContinuer sans numéro ? (il sera difficile de retrouver ce document plus tard)"
    ))) return;

    // L'action réajuste stock, coût moyen ET prix produits : on l'annonce.
    if (!(await confirm(
      `${isEdit ? "Enregistrer les corrections" : "Valider la facture"} ?\n\n` +
      `Total HT ${eur(total)}\n\n` +
      "Le stock sera réajusté par différence, et les prix d'achat + coût moyen (CMUP) des produits seront mis à jour au prix facturé."
    ))) return;

    setSaving(true);

    // 1. Create the invoice as a DRAFT (validated only once everything is
    //    written) so a mid-flight failure never leaves an applied-looking
    //    invoice behind, and never becomes the next delta baseline.
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
        validated: false,
        validated_at: null,
      })
      .select()
      .single();
    if (invErr) { setError(invErr.message); setSaving(false); return; }

    // Best-effort cleanup of everything this attempt created.
    async function abort(msg: string) {
      await supabase.from("stock_movements").delete().eq("reference_id", invoice.id).eq("reference_type", "invoice");
      await supabase.from("invoice_lines").delete().eq("invoice_id", invoice.id);
      await supabase.from("invoices").delete().eq("id", invoice.id);
      setError(msg);
      setSaving(false);
    }

    try {
      // 2. Previously applied base quantity per ingredient (what the stock already
      //    reflects for this order): the last invoice if any, else the reception.
      const prevBase = new Map<string, number>();
      // Contenu d'UN colis en unités de base : priorité au conditionnement de
      // CE fournisseur (article), sinon celui de la fiche produit.
      const packBase = (id: string) => {
        const supplierBase = Number(orderCond[id]?.basePerPack ?? 0);
        if (supplierBase > 0) return supplierBase;
        const info = infoMap.get(id);
        return baseFactor(info?.unit ?? "unit", Number(info?.pack_quantity ?? 1) || 1);
      };
      const baseOf = (id: string, qtyColis: number) => qtyColis * packBase(id);
      // Cumul (jamais d'écrasement) : deux lignes du même produit s'additionnent.
      // On mémorise AUSSI la valeur déjà appliquée, pour connaître le prix
      // auquel cette marchandise est entrée en stock : sans lui, revaloriser
      // une facture inventerait de la valeur quand le stock contient plusieurs
      // lots à des prix différents (voir tests/periode-complete.test.ts).
      const prevValue = new Map<string, number>();
      if (priorInvoice) {
        for (const l of priorInvoice.invoice_lines) {
          if (!l.ingredient_id) continue;
          const q = Number(l.quantity) || 0;
          prevBase.set(l.ingredient_id, (prevBase.get(l.ingredient_id) ?? 0) + baseOf(l.ingredient_id, q));
          prevValue.set(l.ingredient_id, (prevValue.get(l.ingredient_id) ?? 0) + q * Number(l.unit_price ?? 0));
        }
      } else {
        for (const d of allDnLines) {
          if (!d.ingredient_id || !(Number(d.quantity_received) > 0)) continue;
          const q = Number(d.quantity_received);
          const prixColis = Number((d as any).actual_price ?? d.ingredients?.pack_price ?? 0);
          prevBase.set(d.ingredient_id, (prevBase.get(d.ingredient_id) ?? 0) + baseOf(d.ingredient_id, q));
          prevValue.set(d.ingredient_id, (prevValue.get(d.ingredient_id) ?? 0) + q * prixColis);
        }
      }
      /** Prix d'entrée en stock, par unité de base (null si inconnu). */
      const prevCostOf = (id: string): number | null => {
        const b = prevBase.get(id) ?? 0;
        const v = prevValue.get(id) ?? 0;
        return b > 0 && v > 0 ? v / b : null;
      };

      // 3. New target base quantity per ingredient (from the editable lines).
      const newBase = new Map<string, number>();
      for (const l of lines) newBase.set(l.ingredient_id, (newBase.get(l.ingredient_id) ?? 0) + baseOf(l.ingredient_id, parseFloat(l.qty) || 0));

      const allIds = Array.from(new Set([...Array.from(prevBase.keys()), ...Array.from(newBase.keys())]));

      // Current stock + cmup + prices for those ingredients (prev values kept for rollback).
      const { data: currentIngData } = await supabase
        .from("ingredients").select("id, stock_qty, cmup, pack_price, cost_per_base_unit").in("id", allIds);
      const ingStockMap = new Map((currentIngData ?? []).map((i) => [i.id, i]));

      // 4. Compute EVERYTHING up front — no write yet.
      const movements: any[] = [];
      const invoiceLines: any[] = [];
      const priceHistory: any[] = [];
      // Produits dont le prix facturé doit être répercuté sur le journal d'achat.
      const priceUpdates: { id: string; costPerBase: number }[] = [];
      const patches: { id: string; patch: any; prev: any }[] = [];

      for (const id of allIds) {
        const line = lines.find((l) => l.ingredient_id === id);
        const prev = prevBase.get(id) ?? 0;
        const target = newBase.get(id) ?? 0;
        const delta = target - prev;

        // Un prix facturé à 0 € (offert) est un vrai prix — seul un champ vide
        // retombe sur le prix prévu.
        const typedPrice = line ? parseFloat(line.invoice_price) : NaN;
        const invoicePrice = line ? (Number.isFinite(typedPrice) ? typedPrice : line.expected_price) : 0;
        const factor = packBase(id);
        const newCostPerBase = line && factor > 0 ? invoicePrice / factor : Number(infoMap.get(id)?.cost_per_base_unit ?? 0);

        const cur = ingStockMap.get(id);
        const curStock = Number(cur?.stock_qty ?? 0);
        const curCmup = Number(cur?.cmup ?? newCostPerBase);
        // La part déjà appliquée à la réception est revalorisée au prix facturé
        // (fonction partagée et couverte par les tests — lib/costing.ts).
        const { newStock, newCmup } = revalueOnInvoice({
          currentStock: curStock, currentCmup: cur?.cmup ?? null,
          prevBase: prev, targetBase: target,
          newCostPerBase, prevCostPerBase: prevCostOf(id),
          invoiced: !!line,
        });

        const patch: any = { stock_qty: newStock, cmup: newCmup, updated_at: new Date().toISOString() };
        if (line) {
          patch.cost_per_base_unit = newCostPerBase;
          // pack_price doit rester cohérent avec le colisage de la FICHE produit :
          // si la facture est dans le conditionnement du fournisseur, on convertit.
          const info = infoMap.get(id);
          const productFactor = baseFactor(info?.unit ?? "unit", Number(info?.pack_quantity ?? 1) || 1);
          patch.pack_price = factor === productFactor ? invoicePrice : newCostPerBase * productFactor;
        }
        patches.push({
          id, patch,
          prev: { stock_qty: cur?.stock_qty ?? null, cmup: cur?.cmup ?? null, pack_price: cur?.pack_price ?? null, cost_per_base_unit: cur?.cost_per_base_unit ?? null },
        });

        if (line) {
          priceUpdates.push({ id, costPerBase: newCostPerBase });
          invoiceLines.push({
            invoice_id: invoice.id, ingredient_id: id,
            quantity: parseFloat(line.qty) || 0, unit_price: invoicePrice,
            price_changed: Math.abs(invoicePrice - line.expected_price) > 0.001,
          });
          if (Math.abs(invoicePrice - line.expected_price) > 0.001) {
            priceHistory.push({
              ingredient_id: id, old_price: line.expected_price, new_price: invoicePrice,
              source: "invoice", delivery_note_id: deliveryNote?.id ?? null,
            });
          }
        }

        if (Math.abs(delta) > 0.0001) {
          movements.push({
            restaurant_id: restaurantId, ingredient_id: id,
            movement_type: delta > 0 ? "in" : "adjustment",
            // Retrait valorisé au coût moyen du stock, ajout au prix facturé
            qty: Math.abs(delta), unit_cost: delta > 0 ? newCostPerBase : curCmup,
            reference_type: "invoice", reference_id: invoice.id,
            notes: isEdit ? "Ajustement facture (correction)" : "Facture",
          });
        }
      }

      // 5. Writes that can be cleaned up, BEFORE any stock mutation.
      if (invoiceLines.length > 0) {
        const { error: ilErr } = await supabase.from("invoice_lines").insert(invoiceLines);
        if (ilErr) return abort(`Lignes de facture : ${ilErr.message}. Rien n'a été appliqué — réessaie.`);
      }
      if (movements.length > 0) {
        const { error: movErr } = await supabase.from("stock_movements").insert(movements);
        if (movErr) return abort(`Mouvements de stock : ${movErr.message}. Rien n'a été appliqué — réessaie.`);
      }
      if (priceHistory.length > 0) {
        await supabase.from("ingredient_price_history").insert(priceHistory); // best-effort (historique)
      }

      // 5 bis. Aligner le JOURNAL D'ACHAT sur le prix facturé.
      //   Une correction de prix sans changement de quantité n'écrit aucun
      //   mouvement (écart nul) : les « Achats du mois » et le journal
      //   restaient donc au prix de la livraison, pas au prix payé. On met à
      //   jour le coût unitaire des mouvements de réception concernés.
      const dnIds = (deliveryNotes ?? (deliveryNote ? [deliveryNote] : [])).map((d) => d.id).filter(Boolean);
      if (dnIds.length > 0) {
        for (const p of priceUpdates) {
          const { error: mvErr } = await supabase.from("stock_movements")
            .update({ unit_cost: p.costPerBase })
            .eq("restaurant_id", restaurantId)
            .eq("reference_type", "delivery")
            .eq("ingredient_id", p.id)
            .in("reference_id", dnIds);
          // Best-effort : le stock et les coûts produits sont déjà justes ;
          // seul le montant des achats du mois resterait à l'ancien prix.
          if (mvErr) console.error("[facture] journal d'achat non aligné:", mvErr.message);
        }
      }

      // 6. Stock updates; on failure, restore the ones already applied.
      const applied: typeof patches = [];
      for (const p of patches) {
        const { error: upErr } = await supabase.from("ingredients").update(p.patch).eq("id", p.id);
        if (upErr) {
          for (const a of applied) await supabase.from("ingredients").update(a.prev).eq("id", a.id);
          return abort(`Stock ingrédient : ${upErr.message}. Les modifications ont été annulées — réessaie.`);
        }
        applied.push(p);
      }

      // 7. Everything written: validate the invoice, then the PO.
      //    Si la validation échoue, la facture resterait un brouillon : la
      //    prochaine visite repartirait de la réception et rajouterait tout.
      const { error: valErr } = await supabase.from("invoices")
        .update({ validated: true, validated_at: new Date().toISOString() }).eq("id", invoice.id);
      if (valErr) {
        for (const a of applied) await supabase.from("ingredients").update(a.prev).eq("id", a.id);
        return abort(`Validation de la facture impossible : ${valErr.message}. Les prix et le stock ont été remis comme avant — réessaie.`);
      }
      const { error: poErr } = await supabase.from("purchase_orders").update({ status: "Invoiced" }).eq("id", po.id);

      // Recalculate recipes using these ingredients.
      let recalcOk = true;
      try {
        const r = await fetch("/api/recalculate-recipes", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurantId, changedIngredientIds: allIds }),
        });
        recalcOk = r.ok;
      } catch { recalcOk = false; }

      if (poErr || !recalcOk) {
        setSaving(false);
        notify(
          "La facture est enregistrée et le stock est à jour." +
          (poErr ? `\n\n• Le statut de la commande n'a pas suivi (${poErr.message}) — recharge la page, ne re-valide pas.` : "") +
          (!recalcOk ? "\n\n• Le recalcul des coûts de recettes a échoué : lance « Tout recalculer » depuis les recettes." : "")
        );
      }
      router.push("/orders?invoiced=1");
    } catch (e: any) {
      return abort(e.message);
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
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date de facture</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition" />
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
            const type = condType(line.ingredient_id, line.unit, line.pack_quantity);
            return (
              <div key={i} className={`px-5 py-4 ${qty === 0 ? "bg-gray-50/60" : ""}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${qty === 0 ? "bg-gray-300" : "bg-emerald-500"}`} />
                    <span className={`text-base font-bold ${qty === 0 ? "text-gray-400 line-through" : "text-gray-900"}`}>{line.ingredient_name}</span>
                  </div>
                  {qty === 0 && <span className="text-2xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Annulée</span>}
                </div>
                <div className="flex items-end gap-3">
                  <div className="w-28">
                    <label className="block text-xs text-gray-500 mb-1">Quantité ({type})</label>
                    <input type="number" min="0" step="any" value={line.qty}
                      onChange={(e) => updateQty(i, e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary transition" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">
                      Prix (€/{type})
                      {priceChanged && <span className="text-amber-500 ml-1">— prévu {eur(line.expected_price)}</span>}
                    </label>
                    <input type="number" min="0" step="0.01" value={line.invoice_price}
                      onChange={(e) => updatePrice(i, e.target.value)}
                      className={`w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 transition ${
                        priceChanged ? "border-amber-400 focus:border-amber-500 focus:ring-amber-300" : "border-[#E5E7EB] focus:border-primary focus:ring-primary"
                      }`} />
                  </div>
                  <div className="text-right text-xs text-gray-500 pb-2">
                    Sous-total<br />
                    <span className={`font-semibold text-sm ${priceChanged ? "text-amber-600" : "text-gray-900"}`}>{eur(lineTotal)}</span>
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
              className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-primary" />
            <div className="relative w-28">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">€</span>
              <input type="number" min="0" step="0.01" value={miscFees} onChange={(e) => setMiscFees(e.target.value)}
                placeholder="0.00"
                className="w-full pl-5 pr-2 py-2 text-sm text-right border border-[#E5E7EB] rounded-lg outline-none focus:border-primary" />
            </div>
          </div>
          <p className="text-2xs text-gray-400 mt-1.5">Ajouté au total, sans effet sur le stock.</p>
        </div>
        <div className="px-5 py-4 border-t border-[#E5E7EB] bg-gray-50 space-y-1">
          <div className="flex justify-between items-center text-sm text-gray-500">
            <span>Sous-total produits</span>
            <span>{eur(linesTotal)}</span>
          </div>
          {misc > 0 && (
            <div className="flex justify-between items-center text-sm text-gray-500">
              <span>{miscLabel.trim() || "Frais divers"}</span>
              <span>{eur(misc)}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-1">
            <span className="text-sm font-medium text-gray-700">Total HT</span>
            <span className="text-lg font-semibold text-gray-900">{eur(total)}</span>
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
