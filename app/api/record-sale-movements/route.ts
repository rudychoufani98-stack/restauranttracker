import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RecipeLine = { ingredient_id: string | null; sub_recipe_id: string | null; quantity: number; unit: string };
type RecipeRow = { id: string; yield_portions: number; yield_unit: string; recipe_lines: RecipeLine[] };

// Convert a quantity to base units (g / ml / portion / piece). kg→g, l→ml; rest unchanged.
function toBaseQty(quantity: number, unit: string): number {
  if (unit === "kg" || unit === "l") return quantity * 1000;
  return quantity;
}

/**
 * Ingredient consumption (in base units) per ONE base unit of a recipe's yield.
 * For a portion-yield dish that's "per portion"; for a 2 kg sauce that's "per gram".
 * Recursively flattens sub-recipes (mises en place) so their ingredients are
 * deducted from stock too, at the real consumed fraction. Memoized + cycle-guarded.
 */
function ingredientsPerYieldBase(
  recipeId: string,
  recipeMap: Map<string, RecipeRow>,
  memo: Map<string, Map<string, number>>,
  visited: Set<string>
): Map<string, number> {
  if (memo.has(recipeId)) return memo.get(recipeId)!;
  if (visited.has(recipeId)) return new Map();
  visited.add(recipeId);

  const recipe = recipeMap.get(recipeId);
  const result = new Map<string, number>();
  if (!recipe) return result;

  const yieldBase = toBaseQty(recipe.yield_portions || 1, recipe.yield_unit || "portion");

  for (const line of recipe.recipe_lines) {
    if (line.ingredient_id) {
      const perYieldBase = toBaseQty(line.quantity, line.unit) / yieldBase;
      result.set(line.ingredient_id, (result.get(line.ingredient_id) ?? 0) + perYieldBase);
    } else if (line.sub_recipe_id) {
      // line.quantity (in its unit) = amount of the sub-recipe consumed by the WHOLE parent batch
      const subPerYieldBase = ingredientsPerYieldBase(line.sub_recipe_id, recipeMap, memo, new Set(visited));
      const subBaseConsumedByBatch = toBaseQty(line.quantity, line.unit);
      const fractionPerParentYieldBase = subBaseConsumedByBatch / yieldBase;
      for (const [ingId, qty] of Array.from(subPerYieldBase.entries())) {
        result.set(ingId, (result.get(ingId) ?? 0) + qty * fractionPerParentYieldBase);
      }
    }
  }

  memo.set(recipeId, result);
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const { restaurantId, periodId, salesLines } = await req.json();
    // salesLines: Array<{ recipe_id?: string; ingredient_id?: string; qty_sold: number }>

    if (!Array.isArray(salesLines)) {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    // Ownership check
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("id")
      .eq("id", restaurantId)
      .eq("owner_id", user.id)
      .single();
    if (!restaurant) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

    // Load ALL recipes of the restaurant (needed to flatten sub-recipes recursively)
    const { data: allRecipes } = await supabase
      .from("recipes")
      .select("id, yield_portions, yield_unit, recipe_lines(ingredient_id, sub_recipe_id, quantity, unit)")
      .eq("restaurant_id", restaurantId);

    const recipeMap = new Map<string, RecipeRow>(
      (allRecipes ?? []).map((r: any) => [r.id, r as RecipeRow])
    );
    const memo = new Map<string, Map<string, number>>();

    // Accumulate deductions: ingredientId → qty in base units
    const deductions = new Map<string, number>();

    for (const saleLine of salesLines) {
      const qtySold = Number(saleLine.qty_sold);
      if (!qtySold || qtySold <= 0) continue;

      if (saleLine.recipe_id) {
        // A sale = qtySold portions of a menu dish (yield_unit 'portion').
        const perYieldBase = ingredientsPerYieldBase(saleLine.recipe_id, recipeMap, memo, new Set());
        for (const [ingId, qty] of Array.from(perYieldBase.entries())) {
          deductions.set(ingId, (deductions.get(ingId) ?? 0) + qty * qtySold);
        }
      } else if (saleLine.ingredient_id) {
        // Simple product (revente): 1 sold = 1 base unit
        deductions.set(saleLine.ingredient_id, (deductions.get(saleLine.ingredient_id) ?? 0) + qtySold);
      }
    }

    const allIngredientIds = Array.from(deductions.keys());
    if (allIngredientIds.length === 0) {
      return NextResponse.json({ ok: true, movements: 0 });
    }

    const { data: ingredients } = await supabase
      .from("ingredients")
      .select("id, stock_qty, cmup, cost_per_base_unit")
      .in("id", allIngredientIds);

    const ingMap = new Map((ingredients ?? []).map((i: any) => [i.id, i]));

    // Apply deductions
    const movements: any[] = [];

    for (const [ingredientId, qtyDeduct] of Array.from(deductions.entries())) {
      const ing = ingMap.get(ingredientId);
      if (!ing) continue;

      const currentStock = Number(ing.stock_qty ?? 0);
      const unitCost = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
      const newStock = Math.max(0, currentStock - qtyDeduct);

      await supabase
        .from("ingredients")
        .update({ stock_qty: newStock })
        .eq("id", ingredientId);

      movements.push({
        restaurant_id: restaurantId,
        ingredient_id: ingredientId,
        movement_type: "out",
        qty: qtyDeduct,
        unit_cost: unitCost,
        reference_type: "sale",
        reference_id: periodId,
      });
    }

    if (movements.length > 0) {
      await supabase.from("stock_movements").insert(movements);
    }

    return NextResponse.json({ ok: true, movements: movements.length });
  } catch (e: any) {
    console.error("[record-sale-movements] error:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
