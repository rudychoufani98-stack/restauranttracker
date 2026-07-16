import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import OrdersClient from "./OrdersClient";

export default async function OrdersPage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  const [{ data: orders }, { data: suppliers }, { data: ingredients }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, suppliers(name), delivery_notes(*), invoices(created_at, invoice_number), purchase_order_lines(*, ingredients(name, unit, cost_per_base_unit))")
      .eq("restaurant_id", restaurant!.id)
      .order("created_at", { ascending: false }),
    supabase.from("suppliers").select("*").eq("restaurant_id", restaurant!.id).order("name"),
    supabase.from("ingredients").select("id, name, unit, pack_price, pack_units, unit_size, pack_quantity, cost_per_base_unit, stock_qty, reorder_threshold, supplier_id, supplier_reference, suppliers(name), ingredient_suppliers(*)").eq("restaurant_id", restaurant!.id).order("name"),
  ]);

  // Draft-edit events (separate + resilient: won't break the list if the table
  // isn't created yet).
  const { data: orderEvents } = await supabase
    .from("order_events")
    .select("po_id, type, detail, created_at")
    .eq("restaurant_id", restaurant!.id)
    .order("created_at", { ascending: true });

  return (
    <OrdersClient
      restaurantId={restaurant!.id}
      restaurantName={restaurant!.name}
      initialOrders={orders ?? []}
      suppliers={suppliers ?? []}
      ingredients={(ingredients ?? []) as any}
      orderEvents={orderEvents ?? []}
      hidePrices={!!(restaurant as any)?.hide_po_prices}
    />
  );
}
