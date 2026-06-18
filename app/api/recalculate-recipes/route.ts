import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RecipeLine = { ingredient_id: string | null; sub_recipe_id: string | null; quantity: number; unit: string };
type RecipeRow = { id: string; yield_portions: number; recipe_lines: RecipeLine[] };
type IngRow = { id: string; cost_per_base_unit: number; cmup: number | null; unit: string };

// Use weighted average cost (CMUP) when available so recipe costs stay
// consistent with how stock movements are valued; fall back to last price.
const unitCost = (ing: IngRow) => Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);

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
      total += unitCost(ing) * qty;
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
    const supabase = createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const { restaurantId } = await req.json();

    // Ownership check
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id")
      .eq("id", restaurantId)
      .eq("owner_id", user.id)
      .single();
    if (!restaurant) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

    const { data: recipes } = await supabase
      .from("recipes")
      .select("id, yield_portions, recipe_lines(ingredient_id, sub_recipe_id, quantity, unit)")
      .eq("restaurant_id", restaurantId);

    if (!recipes) return NextResponse.json({ ok: true });

    const { data: ingredients } = await supabase
      .from("ingredients")
      .select("id, cost_per_base_unit, cmup, unit")
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
    console.error("[recalculate-recipes] error:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
