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
        qty_received: String(l.quantity), // pre-fill with ordered qty; user corrects if partial
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
      bl_pdf_url: blPdfUrl,
      validated: true,
      validated_at: new Date().toISOString(),
    }).select().single();

    if (dnErr) { setError(dnErr.message); setValidating(false); return; }

    // 3. Insert delivery note lines (quantities only — prices updated at invoice step)
    for (const line of lines) {
      const qtyReceived = parseFloat(line.qty_received) || 0;
      await supabase.from("delivery_note_lines").insert({
        delivery_note_id: dn.id,
        ingredient_id: line.ingredient_id,
        quantity_received: qtyReceived,
        actual_price: line.expected_price, // store expected price for now; invoice will override
        price_changed: false,
      });
    }

    // 4. Update PO status — partial if any line received less than ordered
    const isPartial = lines.some((l) => parseFloat(l.qty_received) < l.qty_ordered);
    await supabase.from("purchase_orders").update({
      status: isPartial ? "Partially received" : "Received",
    }).eq("id", po.id);

    setValidating(false);
    router.push("/orders?validated=1");
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <a href="/orders" className="text-sm text-gray-400 hover:text-gray-600 mb-2 inline-block">← Back to orders</a>
        <h1 className="text-xl font-medium text-gray-900">Receive delivery</h1>
        <p className="text-sm text-gray-500 mt-0.5">From: {po.suppliers?.name} · Confirm quantities received — prices are confirmed at the invoice step</p>
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
            const qtyPartial = parseFloat(line.qty_received) < line.qty_ordered;
            return (
              <div key={i} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900 text-sm">{line.ingredient_name}</span>
                  {qtyPartial && (
                    <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      <AlertTriangle size={11} /> Partial
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Quantity received ({line.unit})</label>
                    <input type="number" min="0" step="any" value={line.qty_received}
                      onChange={(e) => updateLine(i, "qty_received", e.target.value)}
                      className={clsx("w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 transition",
                        qtyPartial ? "border-amber-400 focus:border-amber-500 focus:ring-amber-300" : "border-[#E5E7EB] focus:border-emerald-500 focus:ring-emerald-500"
                      )} />
                    <p className="text-xs text-gray-400 mt-0.5">Ordered: {line.qty_ordered}</p>
                  </div>
                  <div className="text-right text-xs text-gray-400 pt-4">
                    Prix attendu:<br />
                    <span className="text-gray-600 font-medium">€{line.expected_price.toFixed(2)}</span>
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
          {validating ? <><Loader2 size={14} className="animate-spin" /> Enregistrement…</> : <><Check size={14} /> Valider la réception</>}
        </button>
      </div>
    </div>
  );
}
