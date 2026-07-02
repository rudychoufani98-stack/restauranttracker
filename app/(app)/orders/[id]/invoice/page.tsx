import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import InvoiceClient from "./InvoiceClient";

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_id", user!.id)
    .single();

  if (!restaurant) return notFound();

  // Load PO with lines
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, suppliers(name, email), purchase_order_lines(*, ingredients(id, name, unit, pack_price, cost_per_base_unit, pack_quantity))")
    .eq("id", params.id)
    .eq("restaurant_id", restaurant.id)
    .single();

  if (!po) return notFound();

  // Load the most recent delivery note for this PO (to get received quantities)
  const { data: deliveryNote } = await supabase
    .from("delivery_notes")
    .select("*, delivery_note_lines(*, ingredients(id, name, unit, pack_price, cost_per_base_unit, pack_quantity))")
    .eq("po_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Most recent invoice already applied for this PO (to reconcile stock by delta
  // when the invoice is edited again later).
  const { data: priorInvoice } = await supabase
    .from("invoices")
    .select("id, invoice_lines(ingredient_id, quantity, unit_price)")
    .eq("po_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Supplier conditionnement (colis…) so quantities are shown consistently.
  const { data: supplierArticles } = await supabase
    .from("ingredient_suppliers")
    .select("ingredient_id, pack_type, pack_units, unit_size, pack_label, unit")
    .eq("supplier_id", (po as any).supplier_id);
  const orderCond: Record<string, { type: string; detail: string }> = {};
  for (const a of supplierArticles ?? []) {
    const units = Number(a.pack_units ?? 1) || 1;
    const size = Number(a.unit_size ?? 0) || 0;
    const u = a.unit ?? "";
    orderCond[a.ingredient_id] = {
      type: a.pack_type || "colis",
      detail: a.pack_label || (size > 0 ? (units > 1 ? `${units} × ${size} ${u}` : `${size} ${u}`) : ""),
    };
  }

  return (
    <InvoiceClient
      po={po}
      deliveryNote={deliveryNote ?? null}
      restaurantId={restaurant.id}
      orderCond={orderCond}
      priorInvoice={priorInvoice ?? null}
    />
  );
}
