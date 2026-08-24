import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import PertesClient from "./PertesClient";

export const dynamic = "force-dynamic";

// `recipe_id` / `recipe_qty` arrivent avec supabase/perte_recette.sql. Entre le
// déploiement du code et l'exécution du SQL, demander ces colonnes ferait
// échouer toute la requête — et l'écran des pertes serait vide. On réessaie
// donc sans elles : l'historique reste lisible, seul le regroupement des
// pertes de MEP par leur vrai nom attend le SQL.
const COLS_BASE = "id, ingredient_id, qty, unit_cost, loss_reason, notes, created_at, reference_type, reference_id";
const COLS_RECETTE = `${COLS_BASE}, recipe_id, recipe_qty`;

async function lirePertes(supabase: any, restaurantId: string, depuis: string | null, limite: number | null) {
  const requete = (cols: string) => {
    let q = supabase
      .from("stock_movements")
      .select(cols)
      .eq("restaurant_id", restaurantId)
      .eq("movement_type", "loss")
      .order("created_at", { ascending: false });
    if (depuis) q = q.gte("created_at", depuis);
    if (limite) q = q.limit(limite);
    return q;
  };

  const avec = await requete(COLS_RECETTE);
  if (!avec.error) return { data: avec.data ?? [], migre: true };

  console.warn("[pertes] colonnes recipe_id/recipe_qty absentes — exécute supabase/perte_recette.sql");
  const sans = await requete(COLS_BASE);
  return { data: sans.data ?? [], migre: false };
}

export default async function PertesPage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  // Début du mois en cours : le total « Pertes ce mois » doit être COMPLET.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [{ data: ingredients }, mois, recentes, { data: recipes }] = await Promise.all([
    supabase
      .from("ingredients")
      .select("id, name, category, unit, stock_qty, cmup, cost_per_base_unit, yield_pct")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    lirePertes(supabase, restaurant!.id, monthStart, null),
    lirePertes(supabase, restaurant!.id, null, 200),
    // MEP et fiches techniques : on peut jeter une préparation entière.
    supabase
      .from("recipes")
      .select("id, name, is_prep, yield_portions, yield_unit, recipe_lines!recipe_id(ingredient_id, sub_recipe_id, quantity, unit)")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
  ]);

  return (
    <PertesClient
      restaurantId={restaurant!.id}
      ingredients={(ingredients ?? []) as any}
      recipes={(recipes ?? []) as any}
      recentLosses={recentes.data as any}
      monthLosses={mois.data as any}
      migrationFaite={recentes.migre}
    />
  );
}
