import { createClient } from "@/lib/supabase/server";
import { reglagesTva } from "@/lib/vat";
import RecipesClient from "./RecipesClient";
import { selectIngredients } from "@/lib/ingredients-query";
import { getRestaurant } from "@/lib/auth";

export default async function RecipesPage() {
  const supabase = createClient();
  // getRestaurant() gere aussi le cas du super-admin qui a ouvert un client :
  // chercher par owner_id renvoyait le restaurant de l admin, pas celui du
  // client, et l ecran Recettes affichait les mauvaises fiches.
  const restaurant = await getRestaurant();

  const [{ data: recipes }, { data: ingredients }, { data: cats }] = await Promise.all([
    supabase
      .from("recipes")
      .select("*, recipe_lines!recipe_id(*, ingredients(name, cost_per_base_unit, cmup, unit))")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    selectIngredients(supabase, restaurant!.id, "id, name, cost_per_base_unit, cmup, unit, yield_pct, is_active"),
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
      tva={reglagesTva(restaurant)}
      initialRecipes={recipes ?? []}
      ingredients={ingredients ?? []}
      allRecipes={recipes ?? []}
      menuCategories={menuCategories.length ? menuCategories : ["Entrée", "Plat", "Accompagnement", "Dessert", "Boisson", "Menu"]}
      prepCategories={prepCategories.length ? prepCategories : ["Sauce", "Fond/Bouillon", "Pâte", "Garniture", "Marinade", "Base"]}
      lockMode="recipe"
    />
  );
}
