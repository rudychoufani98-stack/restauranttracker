import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { eur } from "@/lib/format";
import { foodCostPct, estAlcool, tauxDeVente, reglagesTva } from "@/lib/vat";

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
    // select("*") : reglagesTva a besoin des colonnes vat_*, et une colonne
    // pas encore migree ne doit pas faire echouer l envoi de tous les mails.
    .select("*")
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

    // Une fiche sans cout matiere n est pas a 0 % de food cost : elle n est
    // pas chiffree. L inclure ferait envoyer par mail un food cost moyen
    // flatteur et faux — la meme erreur que celle corrigee sur les ecrans.
    const chiffrees = (recipes ?? []).filter(
      (r) => r.menu_price && r.menu_price > 0 && Number(r.total_cost) > 0,
    );
    const aChiffrer = (recipes ?? []).filter(
      (r) => r.menu_price && r.menu_price > 0 && !(Number(r.total_cost) > 0),
    ).length;
    // Rien de chiffre : un mail annoncant « 0,0 % » serait pire que pas de mail.
    if (chiffrees.length === 0) continue;

    const tva = reglagesTva(restaurant);
    // Cout HT sur prix HT. Diviser par le prix de carte (TTC) sous-estime le
    // food cost d environ 2,6 points a 10 % de TVA.
    const fc = (r: any) =>
      foodCostPct(
        Number(r.total_cost) / (r.yield_portions || 1),
        Number(r.menu_price),
        tauxDeVente("dine_in", estAlcool(r), tva),
      ) ?? 0;

    const avgFoodCost = chiffrees.reduce((sum, r) => sum + fc(r), 0) / chiffrees.length;
    const overTarget = chiffrees.filter((r) => fc(r) > restaurant.target_food_cost_pct);
    const worst = chiffrees.reduce((w, r) => (fc(r) > fc(w) ? r : w), chiffrees[0]);

    // Get this week's price changes
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    // Cette route tourne en service_role : la RLS ne s applique PAS. Sans le
    // filtre sur le restaurant, chaque client recevait par mail les
    // variations de prix de TOUS les autres — noms de produits et prix
    // fournisseurs compris. ingredient_price_history ne porte pas de
    // restaurant_id : l appartenance passe par l ingredient, d ou la
    // jointure !inner.
    const { data: priceChanges } = await supabase
      .from("ingredient_price_history")
      .select("ingredient_id, old_price, new_price, ingredients!inner(name, restaurant_id)")
      .eq("ingredients.restaurant_id", restaurant.id)
      .gte("changed_at", weekAgo)
      .eq("source", "delivery_note");

    const biggestChanges = (priceChanges ?? [])
      .filter((c: any) => c.old_price)
      .sort((a: any, b: any) => Math.abs(b.new_price - b.old_price) - Math.abs(a.new_price - a.old_price))
      .slice(0, 3);

    const changesText = biggestChanges.length > 0
      ? biggestChanges.map((c: any) => `  • ${(c.ingredients as any)?.name ?? "?"} : ${eur(Number(c.old_price))} → ${eur(Number(c.new_price))}`).join("\n")
      : "  Aucun changement de prix cette semaine.";

    const body = `Bonjour,

Voici le résumé de la semaine pour ${restaurant.name}.

FOOD COST MOYEN : ${avgFoodCost.toFixed(1)} % (objectif ${restaurant.target_food_cost_pct} %)
  Calculé sur ${chiffrees.length} fiche(s) chiffrée(s)${aChiffrer > 0 ? `, ${aChiffrer} encore sans coût matière` : ""}.

PLATS AU-DESSUS DE L'OBJECTIF : ${overTarget.length}
${overTarget.map((r) => `  • ${r.name}`).join("\n") || "  Aucun — tout est dans les clous."}

PLUS FORTES VARIATIONS DE PRIX CETTE SEMAINE :
${changesText}

PLAT LE MOINS RENTABLE : ${worst.name}
  Food cost ${fc(worst).toFixed(1)} %

Ouvre ta carte pour revoir tes marges : ${process.env.NEXT_PUBLIC_APP_URL ?? "https://restauranttracker-nu.vercel.app"}

—Restointelligence`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: "digest@resend.dev",
        to: email,
        subject: `Résumé de la semaine — ${restaurant.name}`,
        text: body,
      }),
    });

    sent++;
  }

  return NextResponse.json({ ok: true, sent });
}
