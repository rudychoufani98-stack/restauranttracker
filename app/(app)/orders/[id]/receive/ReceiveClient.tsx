"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Upload, AlertTriangle, Check, Loader2, Plus, Trash2, PackagePlus } from "lucide-react";
import clsx from "clsx";

type IngredientInfo = { id: string; name: string; unit: string; pack_price: number; cost_per_base_unit: number; pack_quantity: number | null };
type POLine = { id: string; ingredient_id: string | null; quantity: number; expected_price: number | null; ingredients?: IngredientInfo | null };
type PO = { id: string; supplier_id: string | null; suppliers?: { name: string; email: string | null } | null; purchase_order_lines: POLine[] };
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

type OrderCond = Record<string, { type: string; detail: string }>;
interface Props { po: PO; restaurantId: string; allIngredients: IngredientOption[]; orderCond: OrderCond }

export default function ReceiveClient({ po, restaurantId, allIngredients, orderCond }: Props) {
  // Label a purchase quantity in the supplier's order conditionnement (colis…).
  const condType = (ingredientId: string, fallback: string) => orderCond[ingredientId]?.type || fallback || "colis";
  const condDetail = (ingredientId: string) => orderCond[ingredientId]?.detail || "";
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<ReceiveLine[]>(
    po.purchase_order_lines
      .filter((l) => l.ingredient_id && l.ingredients)
      .map((l) => ({
        po_line_id: l.id,
        ingredient_id: l.ingredient_id!,
        ingredient_name: l.ingredients!.name,
        expected_price: l.expected_price ?? l.ingredients!.pack_price,
        qty_ordered: l.quantity,
        qty_received: String(l.quantity), // pre-fill with ordered qty; user corrects if partial
        actual_price: String(l.expected_price ?? l.ingredients!.pack_price),
        unit: l.ingredients!.unit,
        pack_quantity: Number(l.ingredients!.pack_quantity ?? 1) || 1,
      }))
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

  // Pick the ingredient for an added line.
  function pickIngredient(i: number, id: string) {
    const ing = allIngredients.find((a) => a.id === id);
    setLines((p) => {
      const n = [...p];
      n[i] = {
        ...n[i],
        ingredient_id: id,
        ingredient_name: ing?.name ?? "",
        unit: ing?.unit ?? "",
        expected_price: ing?.pack_price ?? 0,
        actual_price: String(ing?.pack_price ?? 0),
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

    // 2. Create delivery note
    const { data: dn, error: dnErr } = await supabase.from("delivery_notes").insert({
      po_id: po.id,
      restaurant_id: restaurantId,
      bl_number: blNumber.trim() || null,
      bl_pdf_url: blPdfUrl,
      validated: true,
      validated_at: new Date().toISOString(),
    }).select().single();

    if (dnErr) { setError(dnErr.message); setValidating(false); return; }

    // 3. Insert delivery note lines. Includes lines added at reception
    //    (substitutes / extras). Skip un-chosen adds.
    for (const line of lines) {
      if (!line.ingredient_id) continue;
      const qtyReceived = parseFloat(line.qty_received) || 0;
      await supabase.from("delivery_note_lines").insert({
        delivery_note_id: dn.id,
        ingredient_id: line.ingredient_id,
        quantity_received: qtyReceived,
        actual_price: line.expected_price, // expected price for now; invoice will adjust
        price_changed: false,
      });
    }

    // 4. Update stock + CMUP right away (Option B). The invoice step later only
    //    ADJUSTS prices, it does not re-add these quantities. Uses the expected
    //    price; base qty = qté reçue × conditionnement (×1000 for kg/L).
    const stockedLines = lines.filter((l) => l.ingredient_id && (parseFloat(l.qty_received) || 0) > 0);
    const ingredientIds = stockedLines.map((l) => l.ingredient_id);
    if (ingredientIds.length > 0) {
      const { data: currentIngData } = await supabase
        .from("ingredients")
        .select("id, stock_qty, cmup")
        .in("id", ingredientIds);
      const ingStockMap = new Map((currentIngData ?? []).map((i) => [i.id, i]));

      const movements: any[] = [];
      for (const line of stockedLines) {
        const qtyReceived = parseFloat(line.qty_received) || 0;
        const packQty = line.pack_quantity || 1;
        let baseQtyPerPack = packQty;
        if (line.unit === "kg" || line.unit === "l") baseQtyPerPack = packQty * 1000;
        const receivedBaseQty = qtyReceived * baseQtyPerPack;
        const costPerBase = line.expected_price / (baseQtyPerPack || 1);

        const current = ingStockMap.get(line.ingredient_id);
        const currentStock = Number(current?.stock_qty ?? 0);
        const currentCmup = Number(current?.cmup ?? costPerBase);
        const newStock = currentStock + receivedBaseQty;
        const newCmup = newStock > 0
          ? (currentStock * currentCmup + receivedBaseQty * costPerBase) / newStock
          : costPerBase;

        const { error: updErr } = await supabase.from("ingredients").update({
          stock_qty: newStock,
          cmup: newCmup,
          updated_at: new Date().toISOString(),
        }).eq("id", line.ingredient_id);
        if (updErr) { setError(`Mise à jour du stock impossible : ${updErr.message}`); setValidating(false); return; }

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
      if (movements.length > 0) {
        const { error: movErr } = await supabase.from("stock_movements").insert(movements);
        if (movErr) { setError(`Enregistrement des mouvements impossible : ${movErr.message}`); setValidating(false); return; }
      }
    }

    // 5. Update PO status — partial if any ORDERED line received less than ordered
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
        <div className="divide-y divide-[#E5E7EB]">
          {lines.map((line, i) => {
            const qtyReceived = parseFloat(line.qty_received);
            const qtyPartial = !line.added && qtyReceived < line.qty_ordered;
            const isZero = !line.added && qtyReceived === 0;
            return (
              <div key={i} className={clsx("px-5 py-4", line.added && "bg-blue-50/40", isZero && "bg-gray-50/60")}>
                <div className="flex items-center justify-between mb-2 gap-2">
                  {line.added ? (
                    (() => {
                      // Hide products already on the reception (ordered lines + other added lines),
                      // but keep this line's own current selection.
                      const usedIds = new Set(lines.filter((_, idx) => idx !== i).map((l) => l.ingredient_id).filter(Boolean));
                      const options = allIngredients.filter((a) => a.id === line.ingredient_id || !usedIds.has(a.id));
                      return (
                        <select value={line.ingredient_id} onChange={(e) => pickIngredient(i, e.target.value)}
                          className="flex-1 px-3 py-2 text-sm border border-blue-200 rounded-lg bg-white outline-none focus:border-blue-500">
                          <option value="">— Choisir le produit reçu —</option>
                          {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      );
                    })()
                  ) : (
                    <span className={clsx("font-medium text-sm", isZero ? "text-gray-400 line-through" : "text-gray-900")}>{line.ingredient_name}</span>
                  )}
                  <div className="flex items-center gap-2 shrink-0">
                    {line.added && <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full"><PackagePlus size={11} /> Ajouté</span>}
                    {qtyPartial && !isZero && (
                      <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                        <AlertTriangle size={11} /> Partiel
                      </span>
                    )}
                    {isZero && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Non reçu</span>}
                    {line.added && (
                      <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-400 transition" title="Retirer cette ligne">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {line.ingredient_id && condDetail(line.ingredient_id) && (
                  <p className="text-2xs text-gray-500 mb-1.5">1 {condType(line.ingredient_id, line.unit)} = <b>{condDetail(line.ingredient_id)}</b></p>
                )}
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Quantité reçue ({condType(line.ingredient_id, line.unit)})</label>
                    <input type="number" min="0" step="any" value={line.qty_received}
                      onChange={(e) => updateLine(i, "qty_received", e.target.value)}
                      className={clsx("w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 transition",
                        qtyPartial ? "border-amber-400 focus:border-amber-500 focus:ring-amber-300" : "border-[#E5E7EB] focus:border-emerald-500 focus:ring-emerald-500"
                      )} />
                    {!line.added && <p className="text-xs text-gray-400 mt-0.5">Commandé : {line.qty_ordered} {condType(line.ingredient_id, line.unit)}</p>}
                  </div>
                  <div className="text-right text-xs text-gray-400 pt-4">
                    Prix attendu / {condType(line.ingredient_id, line.unit)} :<br />
                    <span className="text-gray-600 font-medium">€{line.expected_price.toFixed(2)}</span>
                  </div>
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
