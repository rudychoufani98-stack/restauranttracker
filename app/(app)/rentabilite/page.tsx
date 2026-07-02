import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import RentabiliteClient from "./RentabiliteClient";

export default async function RentabilitePage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  // Load all priced recipes with their cost
  const [{ data: recipes }, { data: simpleProducts }] = await Promise.all([
    supabase
      .from("recipes")
      .select("id, name, category, total_cost, yield_portions, menu_price")
      .eq("restaurant_id", restaurant!.id)
      .eq("is_prep", false)
      .order("name"),
    supabase
      .from("ingredients")
      .select("id, name, category, pack_price, selling_price, unit")
      .eq("restaurant_id", restaurant!.id)
      .not("selling_price", "is", null)
      .order("name"),
  ]);

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
      simpleProducts={(simpleProducts ?? []) as any}
      initialPeriods={periods ?? []}
    />
  );
}
