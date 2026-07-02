import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import CaisseClient from "./CaisseClient";

export default async function CaissePage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  const [{ data: recipes }, { data: products }, { data: cats }] = await Promise.all([
    supabase
      .from("recipes")
      .select("id, name, category, total_cost, menu_price, yield_portions, allergens")
      .eq("restaurant_id", restaurant!.id)
      .eq("is_prep", false)
      .order("name"),
    supabase
      .from("ingredients")
      .select("id, name, category, pack_price, selling_price, allergens")
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

  return (
    <CaisseClient
      recipes={(recipes ?? []) as any}
      products={(products ?? []) as any}
      categoryOrder={(cats ?? []).map((c) => c.name)}
    />
  );
}
