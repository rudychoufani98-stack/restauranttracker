import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import PertesClient from "./PertesClient";

export default async function PertesPage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  const [{ data: ingredients }, { data: losses }] = await Promise.all([
    supabase
      .from("ingredients")
      .select("id, name, category, unit, stock_qty, cmup, cost_per_base_unit")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    supabase
      .from("stock_movements")
      .select("ingredient_id, qty, unit_cost, loss_reason, notes, created_at")
      .eq("restaurant_id", restaurant!.id)
      .eq("movement_type", "loss")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <PertesClient
      restaurantId={restaurant!.id}
      ingredients={(ingredients ?? []) as any}
      recentLosses={(losses ?? []) as any}
    />
  );
}
