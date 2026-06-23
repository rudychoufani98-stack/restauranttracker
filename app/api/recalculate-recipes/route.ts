import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RecipeLine = { ingredient_id: string | null; sub_recipe_id: string | null; quantity: number; unit: string };
type RecipeRow = { id: string; yield_portions: number; yield_unit: string; recipe_lines: RecipeLine[] };
type IngRow = { id: string; cost_per_base_unit: number; cmup: number | null; unit: string; allergens: string[] | null };

// Use weighted average cost (CMUP) when available so recipe costs stay
// consistent with how stock movements are valued; fall back to last price.
const unitCost = (ing: IngRow) => Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);

// Convert a quantity expressed in (kg/l) to base units (g/ml). portion / piece / unit stay as-is.
const toBase = (qty: number, unit: string): number =>
  unit === "kg" || unit === "l" ? qty * 1000 : qty;

// Total quantity a recipe yields, expressed in base units.
const yieldInBase = (r: RecipeRow): number => toBase(r.yield_portions || 1, r.yield_unit || "portion");

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
      const sub = recipes.find((r) => r.id === line.sub_recipe_id);
      if (!sub) continue;
      // Cost of the fraction of the sub-recipe batch consumed by this line.
      // e.g. line uses 100 g out of a batch yielding 2 kg → subCost * (100 / 2000)
      const fraction = toBase(line.quantity, line.unit) / yieldInBase(sub);
      total += subCost * fraction;
    }
  }
  recipeCosts.set(recipeId, total);
  return total;
};

// Union of allergens a recipe carries: from its direct ingredients + recursively from sub-recipes.
const calcRecipeAllergens = (
  recipeId: string,
  recipes: RecipeRow[],
  ingMap: Map<string, IngRow>,
  memo: Map<string, Set<string>>,
  visited = new Set<string>()
): Set<string> => {
  if (memo.has(recipeId)) return memo.get(recipeId)!;
  if (visited.has(recipeId)) return new Set();
  visited.add(recipeId);
  const recipe = recipes.find((r) => r.id === recipeId);
  const result = new Set<string>();
  if (!recipe) return result;
  for (const line of recipe.recipe_lines) {
    if (line.ingredient_id) {
      const ing = ingMap.get(line.ingredient_id);
      (ing?.allergens ?? []).forEach((a) => result.add(a));
    } else if (line.sub_recipe_id) {
      calcRecipeAllergens(line.sub_recipe_id, recipes, ingMap, memo, new Set(visited))
        .forEach((a) => result.add(a));
    }
  }
  memo.set(recipeId, result);
  return result;
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
      .select("id, yield_portions, yield_unit, recipe_lines(ingredient_id, sub_recipe_id, quantity, unit)")
      .eq("restaurant_id", restaurantId);

    if (!recipes) return NextResponse.json({ ok: true });

    const { data: ingredients } = await supabase
      .from("ingredients")
      .select("id, cost_per_base_unit, cmup, unit, allergens")
      .eq("restaurant_id", restaurantId);

    const ingMap = new Map((ingredients ?? []).map((i) => [i.id, i as IngRow]));
    const recipeCosts = new Map<string, number>();
    const allergenMemo = new Map<string, Set<string>>();

    for (const recipe of recipes) {
      calcRecipeCost(recipe.id, recipes as RecipeRow[], ingMap, recipeCosts);
      calcRecipeAllergens(recipe.id, recipes as RecipeRow[], ingMap, allergenMemo);
    }

    for (const recipeId of Array.from(recipeCosts.keys())) {
      const cost = recipeCosts.get(recipeId)!;
      const allergens = Array.from(allergenMemo.get(recipeId) ?? []).sort();
      await supabase.from("recipes").update({ total_cost: cost, allergens }).eq("id", recipeId);
    }

    return NextResponse.json({ ok: true, updated: recipeCosts.size });
  } catch (e: any) {
    console.error("[recalculate-recipes] error:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
