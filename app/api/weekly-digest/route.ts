import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Called by Vercel Cron every day — filters by digest_day
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const today = new Date().toLocaleDateString("en-US", { weekday: "long" });

  // Get all restaurants with digest enabled and today's day
  const { data: restaurants } = await supabase
    .from("restaurants")
    .select("id, name, target_food_cost_pct, digest_day, owner_id")
    .eq("digest_enabled", true)
    .eq("digest_day", today);

  if (!restaurants || restaurants.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return NextResponse.json({ error: "Resend not configured" }, { status: 500 });

  let sent = 0;

  for (const restaurant of restaurants) {
    // Get user email
    const { data: userData } = await supabase.auth.admin.getUserById(restaurant.owner_id);
    const email = userData?.user?.email;
    if (!email) continue;

    // Get recipes with prices
    const { data: recipes } = await supabase
      .from("recipes")
      .select("name, total_cost, menu_price, yield_portions")
      .eq("restaurant_id", restaurant.id);

    const priced = (recipes ?? []).filter((r) => r.menu_price && r.menu_price > 0);
    if (priced.length === 0) continue;

    const avgFoodCost = priced.reduce((sum, r) => {
      const cpp = r.total_cost / (r.yield_portions || 1);
      return sum + (cpp / r.menu_price) * 100;
    }, 0) / priced.length;

    const overTarget = priced.filter((r) => {
      const cpp = r.total_cost / (r.yield_portions || 1);
      return (cpp / r.menu_price) * 100 > restaurant.target_food_cost_pct;
    });

    const worst = priced.reduce((w, r) => {
      const cpp = r.total_cost / (r.yield_portions || 1);
      const wCpp = w.total_cost / (w.yield_portions || 1);
      return (cpp / r.menu_price) > (wCpp / w.menu_price) ? r : w;
    }, priced[0]);

    // Get this week's price changes
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: priceChanges } = await supabase
      .from("ingredient_price_history")
      .select("ingredient_id, old_price, new_price, ingredients(name)")
      .gte("changed_at", weekAgo)
      .eq("source", "delivery_note");

    const biggestChanges = (priceChanges ?? [])
      .filter((c: any) => c.old_price)
      .sort((a: any, b: any) => Math.abs(b.new_price - b.old_price) - Math.abs(a.new_price - a.old_price))
      .slice(0, 3);

    const changesText = biggestChanges.length > 0
      ? biggestChanges.map((c: any) => `  • ${(c.ingredients as any)?.name ?? "?"}: €${Number(c.old_price).toFixed(2)} → €${Number(c.new_price).toFixed(2)}`).join("\n")
      : "  No price changes this week.";

    const body = `Hi,

Here is your weekly digest for ${restaurant.name}.

AVERAGE FOOD COST: ${avgFoodCost.toFixed(1)}% (target: ${restaurant.target_food_cost_pct}%)

DISHES OVER TARGET: ${overTarget.length}
${overTarget.map((r) => `  • ${r.name}`).join("\n") || "  None — great work!"}

BIGGEST PRICE INCREASES THIS WEEK:
${changesText}

WORST-PERFORMING DISH: ${worst.name}
  Food cost: ${((worst.total_cost / (worst.yield_portions || 1)) / worst.menu_price * 100).toFixed(1)}%

Log in to review your menu margins: ${process.env.NEXT_PUBLIC_APP_URL ?? "https://your-app.vercel.app"}

—Restaurant Intelligence`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "digest@resend.dev",
        to: email,
        subject: `Weekly digest — ${restaurant.name}`,
        text: body,
      }),
    });

    sent++;
  }

  return NextResponse.json({ ok: true, sent });
}
