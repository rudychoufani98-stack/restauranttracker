import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { getFournitureIds } from "@/lib/fournitures";
import InventaireClient from "./InventaireClient";

export default async function InventairePage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  const { data: ingredients } = await supabase
    .from("ingredients")
    .select("id, name, category, unit, stock_qty, cmup, cost_per_base_unit, pack_price, reorder_threshold, supplier_id, secondary_unit_label, secondary_unit_size, suppliers(name)")
    .eq("restaurant_id", restaurant!.id)
    .order("category")
    .order("name");

  const [{ data: recentMovements }, { data: inventorySessions }] = await Promise.all([
    supabase
      .from("stock_movements")
      .select("ingredient_id, movement_type, qty, unit_cost, reference_type, loss_reason, created_at")
      .eq("restaurant_id", restaurant!.id)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("inventory_sessions")
      .select("*, inventory_lines(*)")
      .eq("restaurant_id", restaurant!.id)
      .order("created_at", { ascending: false }),
  ]);

  // Ensure the "Fournitures" tag exists + load which ingredients carry it.
  const fournitureIds = await getFournitureIds(restaurant!.id);

  return (
    <InventaireClient
      restaurantId={restaurant!.id}
      ingredients={(ingredients ?? []) as any}
      recentMovements={recentMovements ?? []}
      inventorySessions={(inventorySessions ?? []) as any}
      fournitureIds={fournitureIds}
    />
  );
}
