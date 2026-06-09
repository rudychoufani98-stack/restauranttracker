import { createClient } from "@/lib/supabase/server";
import RecipesClient from "./RecipesClient";

export default async function RecipesPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_id", user!.id)
    .single();

  const [{ data: recipes }, { data: ingredients }] = await Promise.all([
    supabase
      .from("recipes")
      .select("*, recipe_lines(*, ingredients(name, cost_per_base_unit, unit))")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    supabase
      .from("ingredients")
      .select("id, name, cost_per_base_unit, unit")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
  ]);

  return (
    <RecipesClient
      restaurantId={restaurant!.id}
      initialRecipes={recipes ?? []}
      ingredients={ingredients ?? []}
      allRecipes={recipes ?? []}
    />
  );
}
