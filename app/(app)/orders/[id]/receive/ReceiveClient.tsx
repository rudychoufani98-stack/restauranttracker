"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Upload, AlertTriangle, Check, Loader2, Plus, Trash2, PackagePlus } from "lucide-react";
import clsx from "clsx";
import { defaultPackType } from "@/lib/order-email";
import { applyReception } from "@/lib/costing";

type IngredientInfo = { id: string; name: string; unit: string; pack_price: number; cost_per_base_unit: number; pack_quantity: number | null };
type POLine = { id: string; ingredient_id: string | null; quantity: number; expected_price: number | null; ingredients?: IngredientInfo | null };
type PO = { id: string; status?: string; supplier_id: string | null; suppliers?: { name: string; email: string | null } | null; purchase_order_lines: POLine[] };
type IngredientOption = { id: string; name: string; unit: string; pack_price: number; pack_quantity: number | null };

type ReceiveLine = {
  po_line_id: string | null; // null for a line added at reception (substitute / extra)
  ingredient_id: string;
  ingredient_name: string;
  expected_price: number;
  qty_ordered: number;
  qty_received: string;
  actual_price: string;
  unit: string;
  pack_quantity: number; // units per pack, in the ingredient's unit
  added?: boolean; // true when the user added it (not on the original order)
};

type OrderCond = Record<string, { type: string; detail: string; basePerPack?: number; packPrice?: number | null }>;
interface Props { po: PO; restaurantId: string; allIngredients: IngredientOption[]; orderCond: OrderCond }

export default function ReceiveClient({ po, restaurantId, allIngredients, orderCond }: Props) {
  // Label a purchase quantity in the supplier's order conditionnement (colis…).
  // Fallback : type déduit de l'unité (bidon / kg / colis), jamais l'unité brute.
  const condType = (ingredientId: string, unit: string, packQty?: number | null) =>
    orderCond[ingredientId]?.type || defaultPackType(unit, packQty);
  const condDetail = (ingredientId: string) => orderCond[ingredientId]?.detail || "";
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<ReceiveLine[]>(
    po.purchase_order_lines
      .filter((l) => l.ingredient_id && l.ingredients)
      .map((l) => {
        // Prix par défaut : celui du BDC, sinon l'article de CE fournisseur
        // (même colisage que la conversion stock), sinon la fiche produit.
        const supplierPrice = orderCond[l.ingredient_id!]?.packPrice;
        const price = l.expected_price ?? (supplierPrice != null && supplierPrice > 0 ? supplierPrice : l.ingredients!.pack_price);
        return {
          po_line_id: l.id,
          ingredient_id: l.ingredient_id!,
          ingredient_name: l.ingredients!.name,
          expected_price: price,
          qty_ordered: l.quantity,
          qty_received: String(l.quantity), // pre-fill with ordered qty; user corrects if partial
          actual_price: String(price),
          unit: l.ingredients!.unit,
          pack_quantity: Number(l.ingredients!.pack_quantity ?? 1) || 1,
        };
      })
  );

  const [blNumber, setBlNumber] = useState("");
  const [blFile, setBlFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  function updateLine(i: number, field: "qty_received" | "actual_price", val: string) {
    setLines((p) => { const n = [...p]; n[i] = { ...n[i], [field]: val }; return n; });
  }

  // Prix retenu pour une ligne : celui saisi/scanné sur le BL (0 € accepté),
  // sinon le prix prévu. La facture pourra encore le corriger ensuite.
  const actualOf = (l: ReceiveLine) => {
    const p = parseFloat(l.actual_price);
    return Number.isFinite(p) ? p : l.expected_price;
  };

  // Add an empty "produit reçu" line the user fills in (supplier sent something else / extra).
  function addLine() {
    setLines((p) => [...p, {
      po_line_id: null, ingredient_id: "", ingredient_name: "", expected_price: 0,
      qty_ordered: 0, qty_received: "", actual_price: "0", unit: "", pack_quantity: 1, added: true,
    }]);
  }

  function removeLine(i: number) {
    setLines((p) => p.filter((_, idx) => idx !== i));
  }

  // Pick the ingredient for an added line. Le prix par défaut est celui du
  // conditionnement de CE fournisseur (même colisage que la conversion stock),
  // sinon celui de la fiche produit.
  function pickIngredient(i: number, id: string) {
    const ing = allIngredients.find((a) => a.id === id);
    const supplierPrice = orderCond[id]?.packPrice;
    const price = supplierPrice != null && supplierPrice > 0 ? supplierPrice : (ing?.pack_price ?? 0);
    setLines((p) => {
      const n = [...p];
      n[i] = {
        ...n[i],
        ingredient_id: id,
        ingredient_name: ing?.name ?? "",
        unit: ing?.unit ?? "",
        expected_price: price,
        actual_price: String(price),
        pack_quantity: Number(ing?.pack_quantity ?? 1) || 1,
      };
      return n;
    });
  }

  async function handleScanBL() {
    if (!blFile) return;
    setScanning(true); setError(null); setScanMessage(null);

    const formData = new FormData();
    formData.append("file", blFile);
    formData.append("lines", JSON.stringify(lines.map((l) => ({ name: l.ingredient_name, expected_price: l.expected_price }))));

    try {
      const res = await fetch("/api/scan-bl", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Échec de l'analyse");

      // Merge scanned values
      const scanned: { name: string; price: number; quantity: number }[] = json.items ?? [];
      setLines((prev) =>
        prev.map((line) => {
          const match = scanned.find((s) =>
            s.name.toLowerCase().includes(line.ingredient_name.toLowerCase().slice(0, 4)) ||
            line.ingredient_name.toLowerCase().includes(s.name.toLowerCase().slice(0, 4))
          );
          if (!match) return line;
          return {
            ...line,
            actual_price: match.price ? String(match.price) : line.actual_price,
            qty_received: match.quantity ? String(match.quantity) : line.qty_received,
          };
        })
      );
      setScanMessage(`${scanned.length} ligne${scanned.length !== 1 ? "s" : ""} lue${scanned.length !== 1 ? "s" : ""} sur le bon de livraison. Vérifie et confirme ci-dessous.`);
    } catch (e: any) {
      setError(e.message);
    }
    setScanning(false);
  }

  async function handleValidate() {
    setValidating(true); setError(null);

    // 0. Garde anti-double réception : une réception déjà validée sur une
    //    commande qui n'est pas « partiellement reçue » signifie que le stock a
    //    déjà été ajouté — re-valider le compterait une seconde fois.
    const { data: priorDNs } = await supabase
      .from("delivery_notes").select("id").eq("po_id", po.id).eq("validated", true);
    if ((priorDNs?.length ?? 0) > 0 && po.status !== "Partially received") {
      const goOn = window.confirm(
        "⚠️ Une réception a DÉJÀ été validée pour cette commande : le stock a déjà été ajouté.\n\n" +
        "Continuer ajouterait ces quantités une DEUXIÈME fois au stock.\n\nContinuer quand même ?"
      );
      if (!goOn) { setValidating(false); return; }
    }

    // 1. Upload BL file if present.
    // Store the storage PATH (not a public URL) — the "invoices" bucket must be
    // private. Generate a short-lived signed URL on demand when viewing the file.
    let blPdfUrl: string | null = null;
    if (blFile) {
      const safeName = blFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `delivery-notes/${restaurantId}/${po.id}-${Date.now()}-${safeName}`;
      const { error: uploadErr } = await supabase.storage.from("invoices").upload(path, blFile);
      if (!uploadErr) {
        blPdfUrl = path;
      }
    }

    // 2. Create delivery note as a DRAFT (validated only at the very end, once
    //    stock + movements are safely written) so a mid-flight failure never
    //    leaves a "validated" reception with no stock behind it.
    const { data: dn, error: dnErr } = await supabase.from("delivery_notes").insert({
      po_id: po.id,
      restaurant_id: restaurantId,
      bl_number: blNumber.trim() || null,
      bl_pdf_url: blPdfUrl,
      validated: false,
      validated_at: null,
    }).select().single();

    if (dnErr) { setError(dnErr.message); setValidating(false); return; }

    // Best-effort cleanup when a later step fails: remove what this attempt created.
    async function abort(msg: string) {
      await supabase.from("stock_movements").delete().eq("reference_id", dn.id).eq("reference_type", "delivery");
      await supabase.from("delivery_note_lines").delete().eq("delivery_note_id", dn.id);
      await supabase.from("delivery_notes").delete().eq("id", dn.id);
      setError(msg);
      setValidating(false);
    }

    // 3. Insert delivery note lines (one batch). Includes lines added at
    //    reception (substitutes / extras). Skip un-chosen adds.
    const dnLines = lines
      .filter((l) => l.ingredient_id)
      .map((l) => ({
        delivery_note_id: dn.id,
        ingredient_id: l.ingredient_id,
        quantity_received: parseFloat(l.qty_received) || 0,
        actual_price: actualOf(l), // prix du BL (saisi ou scanné) ; la facture ajustera
        price_changed: Math.abs(actualOf(l) - l.expected_price) > 0.001,
      }));
    if (dnLines.length > 0) {
      const { error: dlErr } = await supabase.from("delivery_note_lines").insert(dnLines);
      if (dlErr) return abort(`Enregistrement des lignes impossible : ${dlErr.message}`);
    }

    // 4. Stock + CMUP. Movements are written FIRST (single insert) : if the
    //    database refuses them, no stock has been touched yet. Stock updates
    //    follow, with rollback of already-applied ones on failure.
    const stockedLines = lines.filter((l) => l.ingredient_id && (parseFloat(l.qty_received) || 0) > 0);
    const ingredientIds = stockedLines.map((l) => l.ingredient_id);
    if (ingredientIds.length > 0) {
      const { data: currentIngData } = await supabase
        .from("ingredients")
        .select("id, stock_qty, cmup")
        .in("id", ingredientIds);
      const ingStockMap = new Map((currentIngData ?? []).map((i) => [i.id, i]));

      // Compute everything up front (movements + per-ingredient patches).
      // Cumul par ingrédient d'abord : deux lignes du même produit ne doivent
      // pas s'écraser (le dernier patch gagnerait, le stock serait sous-compté).
      const movements: any[] = [];
      const totals = new Map<string, { baseQty: number; cost: number }>(); // cost = € total reçu
      for (const line of stockedLines) {
        const qtyReceived = parseFloat(line.qty_received) || 0;
        // Contenu d'UN colis en unités de base : priorité au conditionnement de
        // CE fournisseur (article), sinon celui de la fiche produit.
        const supplierBase = Number(orderCond[line.ingredient_id]?.basePerPack ?? 0);
        let baseQtyPerPack = supplierBase;
        if (!(baseQtyPerPack > 0)) {
          const packQty = line.pack_quantity || 1;
          baseQtyPerPack = line.unit === "kg" || line.unit === "l" ? packQty * 1000 : packQty;
        }
        const receivedBaseQty = qtyReceived * baseQtyPerPack;
        const costPerBase = actualOf(line) / (baseQtyPerPack || 1);

        const t = totals.get(line.ingredient_id) ?? { baseQty: 0, cost: 0 };
        t.baseQty += receivedBaseQty;
        t.cost += receivedBaseQty * costPerBase;
        totals.set(line.ingredient_id, t);

        movements.push({
          restaurant_id: restaurantId,
          ingredient_id: line.ingredient_id,
          movement_type: "in",
          qty: receivedBaseQty,
          unit_cost: costPerBase,
          reference_type: "delivery",
          reference_id: dn.id,
        });
      }

      const patches: { id: string; newStock: number; newCmup: number; prevStock: number | null; prevCmup: number | null }[] = [];
      for (const [ingId, t] of Array.from(totals.entries())) {
        const costPerBase = t.baseQty > 0 ? t.cost / t.baseQty : 0;
        const current = ingStockMap.get(ingId);
        const { newStock, newCmup } = applyReception(
          Number(current?.stock_qty ?? 0), current?.cmup ?? null, t.baseQty, costPerBase,
        );
        patches.push({ id: ingId, newStock, newCmup, prevStock: current?.stock_qty ?? null, prevCmup: current?.cmup ?? null });
      }

      // 4a. Movements first — single atomic insert, stock untouched if it fails.
      const { error: movErr } = await supabase.from("stock_movements").insert(movements);
      if (movErr) return abort(`Enregistrement des mouvements impossible : ${movErr.message}. Rien n'a été appliqué — corrige puis réessaie.`);

      // 4b. Then stock updates; on failure, restore the ones already applied.
      const applied: typeof patches = [];
      for (const p of patches) {
        const { error: updErr } = await supabase.from("ingredients").update({
          stock_qty: p.newStock, cmup: p.newCmup, updated_at: new Date().toISOString(),
        }).eq("id", p.id);
        if (updErr) {
          for (const a of applied) {
            await supabase.from("ingredients").update({ stock_qty: a.prevStock, cmup: a.prevCmup }).eq("id", a.id);
          }
          return abort(`Mise à jour du stock impossible : ${updErr.message}. Les modifications ont été annulées — réessaie.`);
        }
        applied.push(p);
      }
    }

    // 5. Everything is written: mark the delivery note validated, then the PO.
    await supabase.from("delivery_notes").update({ validated: true, validated_at: new Date().toISOString() }).eq("id", dn.id);
    const isPartial = lines.some((l) => l.po_line_id && parseFloat(l.qty_received) < l.qty_ordered);
    await supabase.from("purchase_orders").update({
      status: isPartial ? "Partially received" : "Received",
    }).eq("id", po.id);

    setValidating(false);
    router.push("/orders?validated=1");
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <a href="/orders" className="text-sm text-gray-400 hover:text-gray-600 mb-2 inline-block">← Bons de commande</a>
        <h1 className="text-xl font-medium text-gray-900">Réception de la commande</h1>
        <p className="text-sm text-gray-500 mt-0.5">Fournisseur : {po.suppliers?.name} · Confirme les quantités reçues — le stock est mis à jour immédiatement, les prix seront ajustés à la facture</p>
      </div>

      {/* BL number + upload + scan */}
      <div className="bg-white border border-[#E5E7EB] rounded-card p-5 mb-5">
        <h2 className="text-sm font-medium text-gray-900 mb-3">Bon de livraison</h2>
        <div className="mb-3 max-w-xs">
          <label className="block text-xs text-gray-500 mb-1">Numéro de bon de livraison (BL)</label>
          <input type="text" value={blNumber} onChange={(e) => setBlNumber(e.target.value)}
            placeholder="ex. BL-2026-0453"
            className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500" />
        </div>
        <p className="text-xs text-gray-400 mb-2">Pièce jointe (optionnel)</p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 px-4 py-2 text-sm border border-[#E5E7EB] rounded-lg cursor-pointer hover:bg-gray-50 transition">
            <Upload size={14} className="text-gray-400" />
            {blFile ? blFile.name : "Choisir un PDF ou une photo"}
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden"
              onChange={(e) => setBlFile(e.target.files?.[0] ?? null)} />
          </label>
          {blFile && (
            <button onClick={handleScanBL} disabled={scanning}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition">
              {scanning ? <><Loader2 size={14} className="animate-spin" /> Analyse…</> : "Scanner avec l'IA"}
            </button>
          )}
        </div>
        {scanMessage && (
          <div className="flex items-center gap-2 mt-3 text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            <Check size={14} /> {scanMessage}
          </div>
        )}
      </div>

      {/* Lines */}
      <div className="bg-white border border-[#E5E7EB] rounded-card overflow-hidden mb-5">
        <div className="px-5 py-3 border-b border-[#E5E7EB] bg-gray-50">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Lignes de livraison — confirme chaque produit</p>
        </div>
        {/* Column header */}
        <div className="hidden sm:grid grid-cols-12 gap-3 px-5 py-2 border-b border-gray-100 text-2xs font-semibold text-gray-400 uppercase tracking-wide">
          <div className="col-span-5">Produit</div>
          <div className="col-span-2 text-right">Commandé</div>
          <div className="col-span-3 text-right">Reçu</div>
          <div className="col-span-2 text-right">Prix / conditionnement</div>
        </div>
        <div className="divide-y divide-gray-100">
          {lines.map((line, i) => {
            const qtyReceived = parseFloat(line.qty_received);
            const qtyPartial = !line.added && qtyReceived < line.qty_ordered;
            const isZero = !line.added && qtyReceived === 0;
            const type = condType(line.ingredient_id, line.unit, line.pack_quantity);
            return (
              <div key={i} className={clsx("grid grid-cols-2 sm:grid-cols-12 gap-x-3 gap-y-2 items-center px-5 py-3", line.added && "border-l-2 border-l-blue-300")}>
                {/* Produit */}
                <div className="col-span-2 sm:col-span-5 min-w-0">
                  {line.added ? (
                    (() => {
                      const usedIds = new Set(lines.filter((_, idx) => idx !== i).map((l) => l.ingredient_id).filter(Boolean));
                      const options = allIngredients.filter((a) => a.id === line.ingredient_id || !usedIds.has(a.id));
                      return (
                        <select value={line.ingredient_id} onChange={(e) => pickIngredient(i, e.target.value)}
                          className="w-full px-2.5 py-1.5 text-sm border border-blue-200 rounded-lg bg-white outline-none focus:border-blue-500">
                          <option value="">— Choisir le produit reçu —</option>
                          {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      );
                    })()
                  ) : (
                    <p className={clsx("text-[15px] font-bold truncate", isZero ? "text-gray-400 line-through" : "text-gray-900")}>{line.ingredient_name}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {line.ingredient_id && condDetail(line.ingredient_id) && (
                      <span className="text-2xs text-gray-400">1 {type} = {condDetail(line.ingredient_id)}</span>
                    )}
                    {line.added && <span className="text-2xs text-blue-600">· ajouté</span>}
                    {qtyPartial && !isZero && <span className="text-2xs text-amber-600">· partiel</span>}
                    {isZero && <span className="text-2xs text-gray-400">· non reçu</span>}
                    {line.added && (
                      <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-400 transition" title="Retirer">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
                {/* Commandé */}
                <div className="sm:col-span-2 text-left sm:text-right text-sm text-gray-500">
                  <span className="sm:hidden text-2xs text-gray-400 uppercase mr-1">Cmd</span>
                  {line.added ? "—" : `${line.qty_ordered} ${type}`}
                </div>
                {/* Reçu */}
                <div className="sm:col-span-3 flex items-center sm:justify-end gap-1">
                  <input type="number" min="0" step="any" value={line.qty_received}
                    onChange={(e) => updateLine(i, "qty_received", e.target.value)}
                    className={clsx("w-20 px-2 py-1.5 text-sm text-right border rounded-lg outline-none focus:ring-1 transition",
                      qtyPartial ? "border-amber-400 focus:border-amber-500 focus:ring-amber-300" : "border-[#E5E7EB] focus:border-emerald-500 focus:ring-emerald-500"
                    )} />
                  <span className="text-2xs text-gray-400">{type}</span>
                </div>
                {/* Prix du BL (€/conditionnement) — modifiable, la facture ajustera encore */}
                <div className="sm:col-span-2 flex flex-col items-end gap-0.5">
                  <div className="relative w-24">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">€</span>
                    <input type="number" min="0" step="0.01" value={line.actual_price}
                      onChange={(e) => updateLine(i, "actual_price", e.target.value)}
                      className={clsx("w-full pl-5 pr-2 py-1.5 text-sm text-right border rounded-lg outline-none focus:ring-1 transition",
                        Math.abs(actualOf(line) - line.expected_price) > 0.001
                          ? "border-amber-400 focus:border-amber-500 focus:ring-amber-300"
                          : "border-[#E5E7EB] focus:border-emerald-500 focus:ring-emerald-500")} />
                  </div>
                  {Math.abs(actualOf(line) - line.expected_price) > 0.001 && (
                    <span className="text-2xs text-amber-600">prévu €{line.expected_price.toFixed(2)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-[#E5E7EB] bg-gray-50">
          <button onClick={addLine}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition">
            <Plus size={14} /> Ajouter un produit reçu
          </button>
          <p className="text-xs text-gray-400 mt-2">Si le fournisseur a livré un produit différent : ajoute le produit réellement reçu ici, et mets la quantité du produit commandé à <b>0</b>.</p>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">{error}</div>}

      <div className="flex gap-3">
        <a href="/orders" className="flex-1 py-2 text-center text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition">Annuler</a>
        <button onClick={handleValidate} disabled={validating}
          className="flex-1 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition flex items-center justify-center gap-2">
          {validating ? <><Loader2 size={14} className="animate-spin" /> Enregistrement…</> : <><Check size={14} /> Valider la réception</>}
        </button>
      </div>
    </div>
  );
}
