import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const { restaurantId, periodId, salesLines } = await req.json();
    // salesLines: Array<{ recipe_id?: string; ingredient_id?: string; qty_sold: number }>

    const supabase = createClient();

    // Load recipe lines for all recipes involved
    const recipeIds = salesLines.filter((l: any) => l.recipe_id).map((l: any) => l.recipe_id);
    const simpleProductIds = salesLines.filter((l: any) => l.ingredient_id).map((l: any) => l.ingredient_id);

    const { data: recipeLines } = recipeIds.length > 0
      ? await supabase
          .from("recipe_lines")
          .select("recipe_id, ingredient_id, quantity, unit")
          .in("recipe_id", recipeIds)
      : { data: [] };

    // Load ingredient stock data
    const allIngredientIdsRaw = [
      ...(recipeLines ?? []).filter((l: any) => l.ingredient_id).map((l: any) => l.ingredient_id),
      ...simpleProductIds,
    ];
    const allIngredientIds = Array.from(new Set(allIngredientIdsRaw));

    const { data: ingredients } = allIngredientIds.length > 0
      ? await supabase
          .from("ingredients")
          .select("id, unit, stock_qty, cmup, cost_per_base_unit")
          .in("id", allIngredientIds)
      : { data: [] };

    const ingMap = new Map((ingredients ?? []).map((i: any) => [i.id, i]));

    // Accumulate deductions: ingredientId → qty in base units
    const deductions = new Map<string, number>();

    for (const saleLine of salesLines) {
      const qtySold = saleLine.qty_sold;
      if (!qtySold || qtySold <= 0) continue;

      if (saleLine.recipe_id) {
        // Deduct each ingredient used in the recipe × qty_sold portions
        const lines = (recipeLines ?? []).filter((l: any) => l.recipe_id === saleLine.recipe_id && l.ingredient_id);
        for (const rl of lines) {
          let qty = rl.quantity;
          // Convert to base units (same logic as recalculate-recipes)
          if (rl.unit === "kg") qty = rl.quantity * 1000;
          else if (rl.unit === "l") qty = rl.quantity * 1000;
          const totalDeduct = qty * qtySold;
          deductions.set(rl.ingredient_id, (deductions.get(rl.ingredient_id) ?? 0) + totalDeduct);
        }
      } else if (saleLine.ingredient_id) {
        // Simple product: deduct qty_sold units
        const ing = ingMap.get(saleLine.ingredient_id);
        if (!ing) continue;
        // 1 sold = 1 base unit (unit, can, bottle, etc.)
        deductions.set(saleLine.ingredient_id, (deductions.get(saleLine.ingredient_id) ?? 0) + qtySold);
      }
    }

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
    console.error("record-sale-movements error", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
