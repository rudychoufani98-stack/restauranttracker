import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { getIngredientUsage } from "@/lib/usage";
import ProductClient from "./ProductClient";

export default async function ProductPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_id", user!.id)
    .single();

  const [{ data: ingredient }, { data: suppliers }, { data: cats }, { data: allIngredients }] = await Promise.all([
    supabase
      .from("ingredients")
      .select("*, suppliers(name), ingredient_suppliers(*, suppliers(name))")
      .eq("id", params.id)
      .eq("restaurant_id", restaurant!.id)
      .single(),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    supabase
      .from("categories")
      .select("name, position")
      .eq("restaurant_id", restaurant!.id)
      .eq("type", "ingredient")
      .order("position"),
    supabase
      .from("ingredients")
      .select("id, name, unit")
      .eq("restaurant_id", restaurant!.id)
      .neq("id", params.id)
      .order("name"),
  ]);

  if (!ingredient) notFound();

  const categories = (cats ?? []).map((c) => c.name);
  const usedIn = await getIngredientUsage(params.id);

  return (
    <ProductClient
      ingredient={ingredient as any}
      suppliers={suppliers ?? []}
      categories={categories.length ? categories : ["Légumes/Fruits", "Viande", "Poisson", "Produits laitiers", "Épicerie", "Boissons", "Autre"]}
      allIngredients={(allIngredients ?? []) as any}
      usedIn={usedIn}
    />
  );
}
