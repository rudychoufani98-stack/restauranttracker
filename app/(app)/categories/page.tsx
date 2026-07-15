import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import CategoriesClient from "./CategoriesClient";

const DEFAULTS: Record<string, string[]> = {
  menu: ["Entrée", "Plat", "Accompagnement", "Dessert", "Boisson", "Menu"],
  prep: ["Sauce", "Fond/Bouillon", "Pâte", "Garniture", "Marinade", "Base"],
  ingredient: ["Légumes/Fruits", "Viande", "Poisson", "Produits laitiers", "Épicerie", "Boissons", "Autre"],
};

export default async function CategoriesPage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  let { data: cats } = await supabase
    .from("categories")
    .select("id, type, name, position")
    .eq("restaurant_id", restaurant!.id)
    .order("position");

  // Seed defaults on first visit
  if (!cats || cats.length === 0) {
    const rows = Object.entries(DEFAULTS).flatMap(([type, names]) =>
      names.map((name, i) => ({ restaurant_id: restaurant!.id, type, name, position: i }))
    );
    await supabase.from("categories").insert(rows);
    const res = await supabase
      .from("categories")
      .select("id, type, name, position")
      .eq("restaurant_id", restaurant!.id)
      .order("position");
    cats = res.data ?? [];
  }

  // Tags live alongside categories: both are ways of classifying products.
  const { data: tags } = await supabase
    .from("tags")
    .select("id, name, color")
    .eq("restaurant_id", restaurant!.id)
    .order("name");

  return (
    <CategoriesClient
      restaurantId={restaurant!.id}
      initialCategories={cats ?? []}
      initialTags={tags ?? []}
    />
  );
}
