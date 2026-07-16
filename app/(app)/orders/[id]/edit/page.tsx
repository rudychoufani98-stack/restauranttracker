import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import NewOrderClient from "../../new/NewOrderClient";

export const dynamic = "force-dynamic";

// Edit an existing DRAFT order on the same dedicated page as creation.
export default async function EditOrderPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  const [{ data: po }, { data: suppliers }, { data: ingredients }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, supplier_id, status, purchase_order_lines(ingredient_id, quantity, expected_price)")
      .eq("id", params.id)
      .eq("restaurant_id", restaurant!.id)
      .single(),
    supabase.from("suppliers").select("*").eq("restaurant_id", restaurant!.id).order("name"),
    supabase.from("ingredients")
      .select("id, name, unit, category, pack_price, pack_units, unit_size, pack_quantity, supplier_id, supplier_reference, secondary_unit_label, secondary_unit_size, ingredient_suppliers(*)")
      .eq("restaurant_id", restaurant!.id).order("name"),
  ]);

  if (!po) return notFound();
  // Only drafts can be edited; anything already sent goes back to the list.
  if (po.status !== "Draft") redirect("/orders");

  const initialCart: Record<string, { quantity: number; price: string }> = {};
  for (const l of po.purchase_order_lines ?? []) {
    if (!l.ingredient_id) continue;
    initialCart[l.ingredient_id] = {
      quantity: Number(l.quantity) || 0,
      price: l.expected_price != null ? String(l.expected_price) : "",
    };
  }

  return (
    <NewOrderClient
      restaurantId={restaurant!.id}
      restaurantName={restaurant!.name}
      suppliers={(suppliers ?? []) as any}
      ingredients={(ingredients ?? []) as any}
      orderId={po.id}
      initialSupplierId={po.supplier_id ?? ""}
      initialCart={initialCart}
      hidePrices={!!(restaurant as any)?.hide_po_prices}
    />
  );
}
