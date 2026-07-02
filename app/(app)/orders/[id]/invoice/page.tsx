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

  return (
    <InvoiceClient
      po={po}
      deliveryNote={deliveryNote ?? null}
      restaurantId={restaurant.id}
    />
  );
}
