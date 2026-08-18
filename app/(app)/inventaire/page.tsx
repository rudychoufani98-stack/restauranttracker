import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { getFournitureIds } from "@/lib/fournitures";
import InventaireClient from "./InventaireClient";

export default async function InventairePage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  const { data: ingredients } = await supabase
    .from("ingredients")
    .select("id, name, category, unit, stock_qty, cmup, cost_per_base_unit, pack_price, reorder_threshold, supplier_id, secondary_unit_label, secondary_unit_size, yield_pct, suppliers(name)")
    .eq("restaurant_id", restaurant!.id)
    .order("category")
    .order("name");

  const [{ data: recentMovements }, { data: inventorySessions }, { data: recipes }] = await Promise.all([
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
    // MEP + recettes comptables : nécessaires pour convertir un comptage de
    // MEP/recette en équivalents ingrédients (récursif via recipe_lines).
    supabase
      .from("recipes")
      .select("id, name, is_prep, countable_in_inventory, yield_portions, yield_unit, recipe_lines!recipe_id(ingredient_id, sub_recipe_id, quantity, unit)")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
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
      recipes={(recipes ?? []) as any}
      serviceStart={(restaurant as any)?.service_start ?? null}
      serviceEnd={(restaurant as any)?.service_end ?? null}
    />
  );
}
