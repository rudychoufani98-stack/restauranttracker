import { createClient } from "@/lib/supabase/server";
import IngredientsClient from "./IngredientsClient";

export default async function IngredientsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_id", user!.id)
    .single();

  const [{ data: ingredients }, { data: suppliers }, { data: tags }] = await Promise.all([
    supabase
      .from("ingredients")
      .select("*, suppliers(name), ingredient_tags(tag_id, tags(id, name, color))")
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
  ]);

  return (
    <IngredientsClient
      restaurantId={restaurant!.id}
      initialIngredients={ingredients ?? []}
      suppliers={suppliers ?? []}
      allTags={tags ?? []}
    />
  );
}
