// =====================================================================
//  Core costing & stock-deduction logic — pure, dependency-free.
//  Shared by the API routes AND covered by tests (lib/costing.test.ts)
//  so the critical maths can't silently regress.
// =====================================================================

export type RecipeLine = { ingredient_id: string | null; sub_recipe_id: string | null; quantity: number; unit: string };
export type RecipeRow = { id: string; yield_portions: number; yield_unit: string; recipe_lines: RecipeLine[] };
export type IngRow = { id: string; cost_per_base_unit: number; cmup: number | null; unit: string; yield_pct: number | null; allergens?: string[] | null };

// kg/l → base units (g/ml); portion/piece/unit stay as-is.
export function toBase(qty: number, unit: string): number {
  return unit === "kg" || unit === "l" ? qty * 1000 : qty;
}

// Total quantity a recipe yields, in base units.
export function yieldInBase(r: RecipeRow): number {
  return toBase(r.yield_portions || 1, r.yield_unit || "portion");
}

// Weighted-average cost (CMUP) when available, else last purchase price.
export function unitCost(ing: IngRow): number {
  return Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
}

// Material yield: recipes specify NET quantities; gross drawn = net / yield.
export function yieldFactor(ing: IngRow): number {
  const y = Number(ing.yield_pct ?? 100);
  return y > 0 ? y / 100 : 1;
}

/** Total cost of a recipe, flattening sub-recipes, CMUP + material yield aware. */
export function calcRecipeCost(
  recipeId: string,
  recipes: RecipeRow[],
  ingMap: Map<string, IngRow>,
  recipeCosts: Map<string, number> = new Map(),
  visited: Set<string> = new Set()
): number {
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
      total += unitCost(ing) * (qty / yieldFactor(ing));
    } else if (line.sub_recipe_id) {
      const subCost = calcRecipeCost(line.sub_recipe_id, recipes, ingMap, recipeCosts, new Set(visited));
      const sub = recipes.find((r) => r.id === line.sub_recipe_id);
      if (!sub) continue;
      total += subCost * (toBase(line.quantity, line.unit) / yieldInBase(sub));
    }
  }
  recipeCosts.set(recipeId, total);
  return total;
}

/** Union of allergens a recipe carries (own ingredients + sub-recipes). */
export function calcRecipeAllergens(
  recipeId: string,
  recipes: RecipeRow[],
  ingMap: Map<string, IngRow>,
  memo: Map<string, Set<string>> = new Map(),
  visited: Set<string> = new Set()
): Set<string> {
  if (memo.has(recipeId)) return memo.get(recipeId)!;
  if (visited.has(recipeId)) return new Set();
  visited.add(recipeId);
  const recipe = recipes.find((r) => r.id === recipeId);
  const result = new Set<string>();
  if (!recipe) return result;
  for (const line of recipe.recipe_lines) {
    if (line.ingredient_id) {
      (ingMap.get(line.ingredient_id)?.allergens ?? []).forEach((a) => result.add(a));
    } else if (line.sub_recipe_id) {
      calcRecipeAllergens(line.sub_recipe_id, recipes, ingMap, memo, new Set(visited)).forEach((a) => result.add(a));
    }
  }
  memo.set(recipeId, result);
  return result;
}

/**
 * Ingredient consumption (base units) per ONE base unit of a recipe's yield.
 * Recursively flattens sub-recipes. Material yield is NOT applied here — it is
 * applied once at the final deduction step (the recipe states NET quantities).
 */
export function ingredientsPerYieldBase(
  recipeId: string,
  recipeMap: Map<string, RecipeRow>,
  memo: Map<string, Map<string, number>> = new Map(),
  visited: Set<string> = new Set()
): Map<string, number> {
  if (memo.has(recipeId)) return memo.get(recipeId)!;
  if (visited.has(recipeId)) return new Map();
  visited.add(recipeId);

  const recipe = recipeMap.get(recipeId);
  const result = new Map<string, number>();
  if (!recipe) return result;

  const yieldBase = toBase(recipe.yield_portions || 1, recipe.yield_unit || "portion");

  for (const line of recipe.recipe_lines) {
    if (line.ingredient_id) {
      const perYieldBase = toBase(line.quantity, line.unit) / yieldBase;
      result.set(line.ingredient_id, (result.get(line.ingredient_id) ?? 0) + perYieldBase);
    } else if (line.sub_recipe_id) {
      const subPerYieldBase = ingredientsPerYieldBase(line.sub_recipe_id, recipeMap, memo, new Set(visited));
      const fractionPerParentYieldBase = toBase(line.quantity, line.unit) / yieldBase;
      for (const [ingId, qty] of Array.from(subPerYieldBase.entries())) {
        result.set(ingId, (result.get(ingId) ?? 0) + qty * fractionPerParentYieldBase);
      }
    }
  }

  memo.set(recipeId, result);
  return result;
}
