import { createClient } from "@/lib/supabase/server";
import RentabiliteClient from "./RentabiliteClient";

export default async function RentabilitePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, target_food_cost_pct")
    .eq("owner_id", user!.id)
    .single();

  // Load all priced recipes with their cost
  const { data: recipes } = await supabase
    .from("recipes")
    .select("id, name, category, total_cost, yield_portions, menu_price")
    .eq("restaurant_id", restaurant!.id)
    .order("name");

  // Load existing sales periods for this restaurant
  const { data: periods } = await supabase
    .from("sales_periods")
    .select("*, sales_lines(recipe_id, qty_sold)")
    .eq("restaurant_id", restaurant!.id)
    .order("month", { ascending: false });

  return (
    <RentabiliteClient
      restaurantId={restaurant!.id}
      targetFoodCostPct={restaurant!.target_food_cost_pct}
      recipes={recipes ?? []}
      initialPeriods={periods ?? []}
    />
  );
}
