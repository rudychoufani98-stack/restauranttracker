import { createClient } from "@/lib/supabase/server";

export type UsageRef = { id: string; name: string; category: string | null; is_prep: boolean };

// Dedupe joined recipe rows by id (an item can appear on several lines).
function dedupe(rows: any[]): UsageRef[] {
  const map = new Map<string, UsageRef>();
  for (const r of rows) {
    const rec = r?.recipes;
    if (rec?.id && !map.has(rec.id)) {
      map.set(rec.id, { id: rec.id, name: rec.name, category: rec.category ?? null, is_prep: !!rec.is_prep });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Recipes and mises en place that directly use this ingredient. */
export async function getIngredientUsage(ingredientId: string): Promise<UsageRef[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("recipe_lines")
    .select("recipes!recipe_id(id, name, category, is_prep)")
    .eq("ingredient_id", ingredientId);
  return dedupe(data ?? []);
}

/** Recipes and mises en place that directly use this recipe/MEP as a sub-recipe. */
export async function getRecipeUsage(recipeId: string): Promise<UsageRef[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("recipe_lines")
    .select("recipes!recipe_id(id, name, category, is_prep)")
    .eq("sub_recipe_id", recipeId);
  return dedupe(data ?? []);
}
