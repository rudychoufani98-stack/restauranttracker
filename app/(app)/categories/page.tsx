import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { CATEGORIES_EXEMPLES, compter } from "@/lib/rangement";
import CategoriesClient from "./CategoriesClient";

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
    const rows = Object.entries(CATEGORIES_EXEMPLES).flatMap(([type, names]) =>
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

  // Combien d'articles chaque rayon range VRAIMENT. Sans ce chiffre, une
  // liste de catégories est une liste d'intentions : chez le premier
  // client, quatre rayons sur treize ne classaient rien du tout et
  // personne ne pouvait le voir.
  const [{ data: produits }, { data: recettes }] = await Promise.all([
    supabase.from("ingredients").select("category").eq("restaurant_id", restaurant!.id),
    supabase.from("recipes").select("category, is_prep").eq("restaurant_id", restaurant!.id),
  ]);

  const comptes = {
    ingredient: Object.fromEntries(compter(produits ?? [])),
    prep: Object.fromEntries(compter((recettes ?? []).filter((r) => r.is_prep))),
    menu: Object.fromEntries(compter((recettes ?? []).filter((r) => !r.is_prep))),
  };

  return (
    <CategoriesClient
      restaurantId={restaurant!.id}
      initialCategories={cats ?? []}
      initialTags={tags ?? []}
      comptes={comptes}
    />
  );
}
