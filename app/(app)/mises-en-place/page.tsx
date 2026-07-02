import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import RecipesClient from "../recipes/RecipesClient";

export default async function MisesEnPlacePage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  const [{ data: recipes }, { data: ingredients }, { data: cats }] = await Promise.all([
    supabase
      .from("recipes")
      .select("*, recipe_lines!recipe_id(*, ingredients(name, cost_per_base_unit, unit))")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    supabase
      .from("ingredients")
      .select("id, name, cost_per_base_unit, unit, yield_pct")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    supabase
      .from("categories")
      .select("type, name, position")
      .eq("restaurant_id", restaurant!.id)
      .in("type", ["menu", "prep"])
      .order("position"),
  ]);

  const menuCategories = (cats ?? []).filter((c) => c.type === "menu").map((c) => c.name);
  const prepCategories = (cats ?? []).filter((c) => c.type === "prep").map((c) => c.name);

  return (
    <RecipesClient
      restaurantId={restaurant!.id}
      initialRecipes={recipes ?? []}
      ingredients={ingredients ?? []}
      allRecipes={recipes ?? []}
      menuCategories={menuCategories.length ? menuCategories : ["Entrée", "Plat", "Accompagnement", "Dessert", "Boisson", "Menu"]}
      prepCategories={prepCategories.length ? prepCategories : ["Sauce", "Fond/Bouillon", "Pâte", "Garniture", "Marinade", "Base"]}
      lockMode="prep"
    />
  );
}
