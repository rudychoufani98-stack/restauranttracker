import { createClient } from "@/lib/supabase/server";

/**
 * Ensures the "Fournitures" tag exists for the restaurant and returns the ids of
 * the ingredients that carry it. Fournitures (couverts, emballages…) are supplies,
 * not food — their purchases must be excluded from the food cost.
 */
export async function getFournitureIds(restaurantId: string): Promise<string[]> {
  const supabase = createClient();
  let { data: tag } = await supabase
    .from("tags")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("name", "Fournitures")
    .maybeSingle();
  if (!tag) {
    const { data: created } = await supabase
      .from("tags")
      .insert({ restaurant_id: restaurantId, name: "Fournitures", color: "#64748b" })
      .select("id")
      .single();
    tag = created;
  }
  if (!tag) return [];
  const { data: links } = await supabase
    .from("ingredient_tags")
    .select("ingredient_id")
    .eq("tag_id", tag.id);
  return (links ?? []).map((l) => l.ingredient_id);
}
