import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingredientsPerYieldBase, RecipeRow } from "@/lib/costing";

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
      .select("id, yield_portions, yield_unit, recipe_lines!recipe_id(ingredient_id, sub_recipe_id, quantity, unit)")
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

    // Previous destockage already applied for this period (so re-saving a month
    // reconciles by delta instead of deducting twice).
    const prevGross = new Map<string, number>();
    if (periodId) {
      const { data: prevMoves } = await supabase
        .from("stock_movements")
        .select("ingredient_id, qty")
        .eq("restaurant_id", restaurantId)
        .eq("reference_type", "sale")
        .eq("reference_id", periodId);
      for (const m of prevMoves ?? []) {
        if (m.ingredient_id) prevGross.set(m.ingredient_id, (prevGross.get(m.ingredient_id) ?? 0) + Number(m.qty));
      }
    }

    // New gross deductions per ingredient (apply material yield: gross = net / yield).
    const allIngredientIds = Array.from(new Set([...Array.from(deductions.keys()), ...Array.from(prevGross.keys())]));
    if (allIngredientIds.length === 0) {
      return NextResponse.json({ ok: true, movements: 0 });
    }

    const { data: ingredients } = await supabase
      .from("ingredients")
      .select("id, stock_qty, cmup, cost_per_base_unit, yield_pct")
      .in("id", allIngredientIds);
    const ingMap = new Map((ingredients ?? []).map((i: any) => [i.id, i]));

    const newGross = new Map<string, number>();
    for (const [ingredientId, qtyDeductNet] of Array.from(deductions.entries())) {
      const ing = ingMap.get(ingredientId);
      if (!ing) continue;
      const yieldF = Number(ing.yield_pct ?? 100) > 0 ? Number(ing.yield_pct ?? 100) / 100 : 1;
      newGross.set(ingredientId, qtyDeductNet / yieldF);
    }

    // Reconcile stock by delta = new − previous, then replace the period's movements.
    const movements: any[] = [];
    for (const ingredientId of allIngredientIds) {
      const ing = ingMap.get(ingredientId);
      if (!ing) continue;
      const gross = newGross.get(ingredientId) ?? 0;
      const prev = prevGross.get(ingredientId) ?? 0;
      const delta = gross - prev; // extra to remove (or add back if negative)
      const currentStock = Number(ing.stock_qty ?? 0);
      const unitCost = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
      const newStock = Math.max(0, currentStock - delta);

      await supabase.from("ingredients").update({ stock_qty: newStock }).eq("id", ingredientId);

      if (gross > 0) {
        movements.push({
          restaurant_id: restaurantId,
          ingredient_id: ingredientId,
          movement_type: "out",
          qty: gross,
          unit_cost: unitCost,
          reference_type: "sale",
          reference_id: periodId,
        });
      }
    }

    // Replace the period's previous "sale" movements with the new set.
    if (periodId && prevGross.size > 0) {
      await supabase.from("stock_movements").delete()
        .eq("restaurant_id", restaurantId).eq("reference_type", "sale").eq("reference_id", periodId);
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
