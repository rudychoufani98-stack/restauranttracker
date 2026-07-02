import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import InventaireClient from "./InventaireClient";

export default async function InventairePage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  const { data: ingredients } = await supabase
    .from("ingredients")
    .select("id, name, category, unit, stock_qty, cmup, cost_per_base_unit, pack_price, reorder_threshold, supplier_id, suppliers(name)")
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

  // Ensure the "Fournitures" tag exists, then load which ingredients carry it.
  let { data: fournitureTag } = await supabase
    .from("tags")
    .select("id")
    .eq("restaurant_id", restaurant!.id)
    .eq("name", "Fournitures")
    .maybeSingle();
  if (!fournitureTag) {
    const { data: created } = await supabase
      .from("tags")
      .insert({ restaurant_id: restaurant!.id, name: "Fournitures", color: "#64748b" })
      .select("id")
      .single();
    fournitureTag = created;
  }
  let fournitureIds: string[] = [];
  if (fournitureTag) {
    const { data: links } = await supabase
      .from("ingredient_tags")
      .select("ingredient_id")
      .eq("tag_id", fournitureTag.id);
    fournitureIds = (links ?? []).map((l) => l.ingredient_id);
  }

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
