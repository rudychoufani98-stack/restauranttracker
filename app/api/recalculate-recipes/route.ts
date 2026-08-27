import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import { calcRecipeCost, calcRecipeAllergens, RecipeRow, IngRow } from "@/lib/costing";

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const { restaurantId } = await req.json();

    // Le restaurant vise doit etre celui que la session pilote : le sien,
    // ou celui qu un super-admin a ouvert depuis « Mes clients ». Un filtre
    // owner_id brut ignore ce cas et renvoyait 403 en pleine impersonation.
    const restaurant = await getRestaurant();
    if (!restaurant || restaurant.id !== restaurantId) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const { data: recipes } = await supabase
      .from("recipes")
      .select("id, yield_portions, yield_unit, recipe_lines!recipe_id(ingredient_id, sub_recipe_id, quantity, unit)")
      .eq("restaurant_id", restaurantId);

    if (!recipes) return NextResponse.json({ ok: true });

    const { data: ingredients } = await supabase
      .from("ingredients")
      .select("id, cost_per_base_unit, cmup, unit, yield_pct, allergens")
      .eq("restaurant_id", restaurantId);

    const ingMap = new Map((ingredients ?? []).map((i) => [i.id, i as IngRow]));
    const recipeCosts = new Map<string, number>();
    const allergenMemo = new Map<string, Set<string>>();
    // Recettes faussées par une MEP circulaire : on ne réécrit pas leur coût.
    const tainted = new Set<string>();

    for (const recipe of recipes) {
      calcRecipeCost(recipe.id, recipes as RecipeRow[], ingMap, recipeCosts, new Set(), tainted);
      calcRecipeAllergens(recipe.id, recipes as RecipeRow[], ingMap, allergenMemo);
    }
    if (tainted.size > 0) {
      console.warn("[recalculate-recipes] MEP circulaire détectée, coûts non réécrits :", Array.from(tainted));
    }

    for (const recipeId of Array.from(recipeCosts.keys())) {
      const cost = recipeCosts.get(recipeId)!;
      const allergens = Array.from(allergenMemo.get(recipeId) ?? []).sort();
      await supabase.from("recipes").update({ total_cost: cost, allergens }).eq("id", recipeId);
    }

    return NextResponse.json({
      ok: true, updated: recipeCosts.size,
      ...(tainted.size > 0 ? { skipped: Array.from(tainted), reason: "MEP circulaire" } : {}),
    });
  } catch (e: any) {
    console.error("[recalculate-recipes] error:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
