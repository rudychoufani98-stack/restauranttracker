import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  const rid = restaurant.id;

  const [
    { data: recipes },
    { data: ingredients },
    { data: periods },
    { data: movements },
  ] = await Promise.all([
    supabase.from("recipes")
      .select("id, name, category, total_cost, menu_price, yield_portions")
      .eq("restaurant_id", rid).eq("is_prep", false),
    supabase.from("ingredients")
      .select("id, name, category, stock_qty, cmup, cost_per_base_unit, pack_price, selling_price")
      .eq("restaurant_id", rid),
    supabase.from("sales_periods")
      .select("id, month, sales_lines(recipe_id, ingredient_id, qty_sold)")
      .eq("restaurant_id", rid)
      .order("month", { ascending: false }),
    supabase.from("stock_movements")
      .select("movement_type, qty, unit_cost, created_at, ingredient_id")
      .eq("restaurant_id", rid)
      .in("movement_type", ["in", "loss"])
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);

  return (
    <DashboardClient
      restaurantName={restaurant.name}
      targetFoodCost={Number(restaurant.target_food_cost_pct ?? 28)}
      recipes={(recipes ?? []) as any}
      ingredients={(ingredients ?? []) as any}
      periods={(periods ?? []) as any}
      movements={(movements ?? []) as any}
    />
  );
}
