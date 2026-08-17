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
    // reconciles by delta instead of deducting twice). Full rows are kept so
    // they can be restored if this run fails halfway.
    const prevGross = new Map<string, number>();
    let prevMoveRows: any[] = [];
    if (periodId) {
      const { data: prevMoves } = await supabase
        .from("stock_movements")
        .select("restaurant_id, ingredient_id, movement_type, qty, unit_cost, reference_type, reference_id, created_at")
        .eq("restaurant_id", restaurantId)
        .eq("reference_type", "sale")
        .eq("reference_id", periodId);
      prevMoveRows = prevMoves ?? [];
      for (const m of prevMoveRows) {
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

    // Compute everything first: new movements + stock patches (with previous
    // values kept for rollback). No write happens during this pass.
    const movements: any[] = [];
    const patches: { id: string; newStock: number; prevStock: number }[] = [];
    for (const ingredientId of allIngredientIds) {
      const ing = ingMap.get(ingredientId);
      if (!ing) continue;
      const gross = newGross.get(ingredientId) ?? 0;
      const prev = prevGross.get(ingredientId) ?? 0;
      const delta = gross - prev; // extra to remove (or add back if negative)
      const currentStock = Number(ing.stock_qty ?? 0);
      const unitCost = Number(ing.cmup ?? ing.cost_per_base_unit ?? 0);
      patches.push({ id: ingredientId, newStock: Math.max(0, currentStock - delta), prevStock: ing.stock_qty });

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

    // 1) Replace the period's movements FIRST (stock untouched so far) : if the
    //    database refuses the new set, the previous ones are restored.
    if (periodId && prevMoveRows.length > 0) {
      const { error: delErr } = await supabase.from("stock_movements").delete()
        .eq("restaurant_id", restaurantId).eq("reference_type", "sale").eq("reference_id", periodId);
      if (delErr) return NextResponse.json({ error: `Mouvements : ${delErr.message}` }, { status: 500 });
    }
    if (movements.length > 0) {
      const { error: movErr } = await supabase.from("stock_movements").insert(movements);
      if (movErr) {
        if (prevMoveRows.length > 0) await supabase.from("stock_movements").insert(prevMoveRows); // restore
        return NextResponse.json({ error: `Mouvements : ${movErr.message}` }, { status: 500 });
      }
    }

    // 2) Then apply stock updates; on failure, roll back what was applied and
    //    restore the previous movements so the next run reconciles correctly.
    const applied: typeof patches = [];
    for (const p of patches) {
      const { error: upErr } = await supabase.from("ingredients").update({ stock_qty: p.newStock }).eq("id", p.id);
      if (upErr) {
        for (const a of applied) await supabase.from("ingredients").update({ stock_qty: a.prevStock }).eq("id", a.id);
        await supabase.from("stock_movements").delete()
          .eq("restaurant_id", restaurantId).eq("reference_type", "sale").eq("reference_id", periodId);
        if (prevMoveRows.length > 0) await supabase.from("stock_movements").insert(prevMoveRows);
        return NextResponse.json({ error: `Stock : ${upErr.message}` }, { status: 500 });
      }
      applied.push(p);
    }

    return NextResponse.json({ ok: true, movements: movements.length });
  } catch (e: any) {
    console.error("[record-sale-movements] error:", (e as Error).message);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
