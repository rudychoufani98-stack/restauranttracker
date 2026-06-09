import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RecipeLine = { ingredient_id: string | null; sub_recipe_id: string | null; quantity: number; unit: string };
type RecipeRow = { id: string; yield_portions: number; recipe_lines: RecipeLine[] };
type IngRow = { id: string; cost_per_base_unit: number; unit: string };

const calcRecipeCost = (
  recipeId: string,
  recipes: RecipeRow[],
  ingMap: Map<string, IngRow>,
  recipeCosts: Map<string, number>,
  visited = new Set<string>()
): number => {
  if (visited.has(recipeId)) return 0;
  visited.add(recipeId);
  if (recipeCosts.has(recipeId)) return recipeCosts.get(recipeId)!;
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) return 0;
  let total = 0;
  for (const line of recipe.recipe_lines) {
    if (line.ingredient_id) {
      const ing = ingMap.get(line.ingredient_id);
      if (!ing) continue;
      let qty = line.quantity;
      if (line.unit === "kg" && (ing.unit === "g" || ing.unit === "kg")) qty = line.quantity * 1000;
      if (line.unit === "l" && (ing.unit === "ml" || ing.unit === "l")) qty = line.quantity * 1000;
      total += ing.cost_per_base_unit * qty;
    } else if (line.sub_recipe_id) {
      const subCost = calcRecipeCost(line.sub_recipe_id, recipes, ingMap, recipeCosts, new Set(visited));
      const subRecipe = recipes.find((r) => r.id === line.sub_recipe_id);
      const perPortion = subCost / (subRecipe?.yield_portions ?? 1);
      total += perPortion * line.quantity;
    }
  }
  recipeCosts.set(recipeId, total);
  return total;
};

export async function POST(req: NextRequest) {
  try {
    const { restaurantId } = await req.json();
    const supabase = createClient();

    const { data: recipes } = await supabase
      .from("recipes")
      .select("id, yield_portions, recipe_lines(ingredient_id, sub_recipe_id, quantity, unit)")
      .eq("restaurant_id", restaurantId);

    if (!recipes) return NextResponse.json({ ok: true });

    const { data: ingredients } = await supabase
      .from("ingredients")
      .select("id, cost_per_base_unit, unit")
      .eq("restaurant_id", restaurantId);

    const ingMap = new Map((ingredients ?? []).map((i) => [i.id, i]));
    const recipeCosts = new Map<string, number>();

    for (const recipe of recipes) {
      calcRecipeCost(recipe.id, recipes as RecipeRow[], ingMap, recipeCosts);
    }

    for (const recipeId of Array.from(recipeCosts.keys())) {
      const cost = recipeCosts.get(recipeId)!;
      await supabase.from("recipes").update({ total_cost: cost }).eq("id", recipeId);
    }

    return NextResponse.json({ ok: true, updated: recipeCosts.size });
  } catch (e: any) {
    console.error("recalculate-recipes error", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
