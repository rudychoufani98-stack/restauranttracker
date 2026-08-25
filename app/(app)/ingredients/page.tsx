import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import IngredientsClient from "./IngredientsClient";

export default async function IngredientsPage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  const [{ data: ingredients }, { data: suppliers }, { data: tags }, { data: cats }] = await Promise.all([
    supabase
      .from("ingredients")
      .select("*, suppliers(name), ingredient_tags(tag_id, tags(id, name, color)), ingredient_suppliers(*, suppliers(name))")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    supabase
      .from("tags")
      .select("id, name, color")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    supabase
      .from("categories")
      .select("name, position, ref_start")
      .eq("restaurant_id", restaurant!.id)
      .eq("type", "ingredient")
      .order("position"),
  ]);

  // `ref_start` arrive avec supabase/references.sql : sans ce repli, l’écran
  // des ingrédients se retrouverait sans aucune catégorie tant que le SQL
  // n’est pas passé.
  let categoriesRef: { name: string; ref_start: number | null }[] =
    (cats ?? []).map((c: any) => ({ name: c.name, ref_start: c.ref_start ?? null }));
  if (!cats) {
    const { data: simples } = await supabase
      .from("categories").select("name, position")
      .eq("restaurant_id", restaurant!.id).eq("type", "ingredient").order("position");
    categoriesRef = (simples ?? []).map((c: any) => ({ name: c.name, ref_start: null }));
  }
  const categories = categoriesRef.map((c) => c.name);

  return (
    <IngredientsClient
      restaurantId={restaurant!.id}
      initialIngredients={ingredients ?? []}
      categoriesRef={categoriesRef}
      suppliers={suppliers ?? []}
      allTags={tags ?? []}
      categories={categories.length ? categories : ["Légumes/Fruits", "Viande", "Poisson", "Produits laitiers", "Épicerie", "Boissons", "Autre"]}
    />
  );
}
