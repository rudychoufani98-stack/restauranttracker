import { createClient } from "@/lib/supabase/server";
import MenuClient from "./MenuClient";

export default async function MenuPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, target_food_cost_pct")
    .eq("owner_id", user!.id)
    .single();

  const [{ data: recipes }, { data: simpleProducts }, { data: cats }] = await Promise.all([
    supabase
      .from("recipes")
      .select("id, name, category, total_cost, menu_price, yield_portions")
      .eq("restaurant_id", restaurant!.id)
      .eq("is_prep", false)
      .order("name"),
    supabase
      .from("ingredients")
      .select("id, name, category, pack_price, selling_price, unit")
      .eq("restaurant_id", restaurant!.id)
      .not("selling_price", "is", null)
      .order("name"),
    supabase
      .from("categories")
      .select("name, position")
      .eq("restaurant_id", restaurant!.id)
      .eq("type", "menu")
      .order("position"),
  ]);

  const categoryOrder = (cats ?? []).map((c) => c.name);

  return (
    <MenuClient
      restaurantId={restaurant!.id}
      targetFoodCostPct={restaurant!.target_food_cost_pct}
      initialRecipes={recipes ?? []}
      simpleProducts={simpleProducts ?? []}
      categoryOrder={categoryOrder}
    />
  );
}
