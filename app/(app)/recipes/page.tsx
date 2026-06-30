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
      lockMode="recipe"
    />
  );
}
