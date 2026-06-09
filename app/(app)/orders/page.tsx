import { createClient } from "@/lib/supabase/server";
import OrdersClient from "./OrdersClient";

export default async function OrdersPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, name")
    .eq("owner_id", user!.id)
    .single();

  const [{ data: orders }, { data: suppliers }, { data: ingredients }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, suppliers(name), purchase_order_lines(*, ingredients(name, unit, cost_per_base_unit))")
      .eq("restaurant_id", restaurant!.id)
      .order("created_at", { ascending: false }),
    supabase.from("suppliers").select("id, name, email").eq("restaurant_id", restaurant!.id).order("name"),
    supabase.from("ingredients").select("id, name, unit, pack_price, pack_quantity, cost_per_base_unit").eq("restaurant_id", restaurant!.id).order("name"),
  ]);

  return (
    <OrdersClient
      restaurantId={restaurant!.id}
      restaurantName={restaurant!.name}
      initialOrders={orders ?? []}
      suppliers={suppliers ?? []}
      ingredients={ingredients ?? []}
    />
  );
}
