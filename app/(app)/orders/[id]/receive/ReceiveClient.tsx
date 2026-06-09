"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Upload, AlertTriangle, Check, Loader2 } from "lucide-react";
import clsx from "clsx";

type IngredientInfo = { id: string; name: string; unit: string; pack_price: number; cost_per_base_unit: number };
type POLine = { id: string; ingredient_id: string | null; quantity: number; expected_price: number | null; ingredients?: IngredientInfo | null };
type PO = { id: string; supplier_id: string | null; suppliers?: { name: string; email: string | null } | null; purchase_order_lines: POLine[] };

type ReceiveLine = {
  po_line_id: string;
  ingredient_id: string;
  ingredient_name: string;
  expected_price: number;
  qty_ordered: number;
  qty_received: string;
  actual_price: string;
  unit: string;
};

interface Props { po: PO; restaurantId: string }

export default function ReceiveClient({ po, restaurantId }: Props) {
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
        qty_received: String(l.quantity),
        actual_price: String(l.expected_price ?? l.ingredients!.pack_price),
        unit: l.ingredients!.unit,
      }))
  );

  const [blFile, setBlFile] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  function updateLine(i: number, field: "qty_received" | "actual_price", val: string) {
    setLines((p) => { const n = [...p]; n[i] = { ...n[i], [field]: val }; return n; });
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
      if (!res.ok) throw new Error(json.error ?? "Scan failed");

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
      setScanMessage(`Scanned ${scanned.length} line${scanned.length !== 1 ? "s" : ""} from the delivery note. Review and confirm below.`);
    } catch (e: any) {
      setError(e.message);
    }
    setScanning(false);
  }

  async function handleValidate() {
    setValidating(true); setError(null);

    // 1. Upload BL file if present
    let blPdfUrl: string | null = null;
    if (blFile) {
      const path = `delivery-notes/${restaurantId}/${po.id}-${Date.now()}-${blFile.name}`;
      const { error: uploadErr } = await supabase.storage.from("invoices").upload(path, blFile);
      if (!uploadErr) {
        const { data } = supabase.storage.from("invoices").getPublicUrl(path);
        blPdfUrl = data.publicUrl;
      }
    }

    // 2. Create delivery note
    const { data: dn, error: dnErr } = await supabase.from("delivery_notes").insert({
      po_id: po.id,
      restaurant_id: restaurantId,
      bl_pdf_url: blPdfUrl,
      validated: true,
      validated_at: new Date().toISOString(),
    }).select().single();

    if (dnErr) { setError(dnErr.message); setValidating(false); return; }

    // 3. Insert delivery note lines + update ingredient prices
    const changedIngredients: { id: string; oldPrice: number; newPrice: number; name: string }[] = [];

    for (const line of lines) {
      const actualPrice = parseFloat(line.actual_price);
      const qtyReceived = parseFloat(line.qty_received);
      const priceChanged = Math.abs(actualPrice - line.expected_price) > 0.001;

      await supabase.from("delivery_note_lines").insert({
        delivery_note_id: dn.id,
        ingredient_id: line.ingredient_id,
        quantity_received: qtyReceived,
        actual_price: actualPrice,
        price_changed: priceChanged,
      });

      if (priceChanged) {
        // Get current pack info to recalculate cost_per_base_unit
        const { data: ing } = await supabase.from("ingredients").select("pack_quantity, unit, pack_price").eq("id", line.ingredient_id).single();
        if (ing) {
          let base = ing.pack_quantity;
          if (ing.unit === "kg") base = ing.pack_quantity * 1000;
          if (ing.unit === "l") base = ing.pack_quantity * 1000;
          const newCostPerBase = actualPrice / base;

          await supabase.from("ingredients").update({
            pack_price: actualPrice,
            cost_per_base_unit: newCostPerBase,
            updated_at: new Date().toISOString(),
          }).eq("id", line.ingredient_id);

          await supabase.from("ingredient_price_history").insert({
            ingredient_id: line.ingredient_id,
            old_price: ing.pack_price,
            new_price: actualPrice,
            source: "delivery_note",
            delivery_note_id: dn.id,
          });

          changedIngredients.push({ id: line.ingredient_id, oldPrice: ing.pack_price, newPrice: actualPrice, name: line.ingredient_name });
        }
      }
    }

    // 4. Update PO status
    await supabase.from("purchase_orders").update({ status: "Received" }).eq("id", po.id);

    // 5. Ripple: recalculate recipes
    if (changedIngredients.length > 0) {
      await fetch("/api/recalculate-recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, changedIngredientIds: changedIngredients.map((c) => c.id) }),
      });
    }

    // 6. Store ripple summary in sessionStorage for dashboard display
    if (changedIngredients.length > 0) {
      sessionStorage.setItem("rippleSummary", JSON.stringify({ changedIngredients, deliveryId: dn.id }));
    }

    setValidating(false);
    router.push("/orders?validated=1");
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <a href="/orders" className="text-sm text-gray-400 hover:text-gray-600 mb-2 inline-block">← Back to orders</a>
        <h1 className="text-xl font-medium text-gray-900">Receive delivery</h1>
        <p className="text-sm text-gray-500 mt-0.5">From: {po.suppliers?.name} · Confirm quantities and prices from the bon de livraison</p>
      </div>

      {/* BL upload + scan */}
      <div className="bg-white border border-[#E5E7EB] rounded-card p-5 mb-5">
        <h2 className="text-sm font-medium text-gray-900 mb-3">Upload delivery note (optional)</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 px-4 py-2 text-sm border border-[#E5E7EB] rounded-lg cursor-pointer hover:bg-gray-50 transition">
            <Upload size={14} className="text-gray-400" />
            {blFile ? blFile.name : "Choose PDF or photo"}
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden"
              onChange={(e) => setBlFile(e.target.files?.[0] ?? null)} />
          </label>
          {blFile && (
            <button onClick={handleScanBL} disabled={scanning}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition">
              {scanning ? <><Loader2 size={14} className="animate-spin" /> Scanning…</> : "Scan with AI"}
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
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Delivery lines — confirm each item</p>
        </div>
        <div className="divide-y divide-[#E5E7EB]">
          {lines.map((line, i) => {
            const priceChanged = Math.abs(parseFloat(line.actual_price) - line.expected_price) > 0.001;
            return (
              <div key={i} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900 text-sm">{line.ingredient_name}</span>
                  {priceChanged && (
                    <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      <AlertTriangle size={11} /> Price changed
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Quantity received ({line.unit})</label>
                    <input type="number" min="0" step="any" value={line.qty_received}
                      onChange={(e) => updateLine(i, "qty_received", e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition" />
                    <p className="text-xs text-gray-400 mt-0.5">Ordered: {line.qty_ordered}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Price on BL (€)
                      {priceChanged && <span className="text-amber-500 ml-1">— was €{line.expected_price.toFixed(2)}</span>}
                    </label>
                    <input type="number" min="0" step="0.01" value={line.actual_price}
                      onChange={(e) => updateLine(i, "actual_price", e.target.value)}
                      className={clsx("w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 transition",
                        priceChanged ? "border-amber-400 focus:border-amber-500 focus:ring-amber-300" : "border-[#E5E7EB] focus:border-emerald-500 focus:ring-emerald-500"
                      )} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">{error}</div>}

      <div className="flex gap-3">
        <a href="/orders" className="flex-1 py-2 text-center text-sm text-gray-600 border border-[#E5E7EB] rounded-lg hover:bg-gray-50 transition">Cancel</a>
        <button onClick={handleValidate} disabled={validating}
          className="flex-1 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition flex items-center justify-center gap-2">
          {validating ? <><Loader2 size={14} className="animate-spin" /> Validating…</> : <><Check size={14} /> Validate & update prices</>}
        </button>
      </div>
    </div>
  );
}
