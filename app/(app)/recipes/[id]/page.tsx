import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { getRecipeUsage } from "@/lib/usage";
import RecipeClient from "./RecipeClient";

export default async function RecipePage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_id", user!.id)
    .single();

  const [{ data: recipe }, { data: ingredients }, { data: allRecipes }, { data: cats }] = await Promise.all([
    supabase
      .from("recipes")
      .select("*, recipe_lines!recipe_id(*, ingredients(name, cost_per_base_unit, unit))")
      .eq("id", params.id)
      .eq("restaurant_id", restaurant!.id)
      .single(),
    supabase
      .from("ingredients")
      .select("id, name, cost_per_base_unit, unit, yield_pct")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    supabase
      .from("recipes")
      .select("id, name, total_cost, yield_portions, yield_unit, is_prep")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    supabase
      .from("categories")
      .select("type, name, position")
      .eq("restaurant_id", restaurant!.id)
      .in("type", ["menu", "prep"])
      .order("position"),
  ]);

  if (!recipe) notFound();

  const menuCategories = (cats ?? []).filter((c) => c.type === "menu").map((c) => c.name);
  const prepCategories = (cats ?? []).filter((c) => c.type === "prep").map((c) => c.name);
  const usedIn = await getRecipeUsage(params.id);

  return (
    <RecipeClient
      recipe={recipe as any}
      restaurantId={restaurant!.id}
      ingredients={(ingredients ?? []) as any}
      allRecipes={(allRecipes ?? []) as any}
      menuCategories={menuCategories.length ? menuCategories : ["Entrée", "Plat", "Accompagnement", "Dessert", "Boisson", "Menu"]}
      prepCategories={prepCategories.length ? prepCategories : ["Sauce", "Fond/Bouillon", "Pâte", "Garniture", "Marinade", "Base"]}
      usedIn={usedIn}
    />
  );
}
