import { createClient } from "@/lib/supabase/server";
import InventaireClient from "./InventaireClient";

export default async function InventairePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_id", user!.id)
    .single();

  const { data: ingredients } = await supabase
    .from("ingredients")
    .select("id, name, category, unit, stock_qty, cmup, cost_per_base_unit, pack_price, reorder_threshold, supplier_id, suppliers(name)")
    .eq("restaurant_id", restaurant!.id)
    .order("category")
    .order("name");

  const { data: recentMovements } = await supabase
    .from("stock_movements")
    .select("ingredient_id, movement_type, qty, unit_cost, reference_type, created_at")
    .eq("restaurant_id", restaurant!.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <InventaireClient
      restaurantId={restaurant!.id}
      ingredients={(ingredients ?? []) as any}
      recentMovements={recentMovements ?? []}
    />
  );
}
