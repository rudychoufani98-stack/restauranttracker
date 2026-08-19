import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import PertesClient from "./PertesClient";

export default async function PertesPage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

  // Début du mois en cours : le total « Pertes ce mois » doit être COMPLET.
  // (Avant, on ne lisait que les 100 dernières pertes : au-delà, le total du
  //  mois était tronqué sans que rien ne l'indique.)
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const LOSS_COLS = "id, ingredient_id, qty, unit_cost, loss_reason, notes, created_at, reference_type";

  const [{ data: ingredients }, { data: monthLosses }, { data: recentLosses }] = await Promise.all([
    supabase
      .from("ingredients")
      .select("id, name, category, unit, stock_qty, cmup, cost_per_base_unit")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
    // Toutes les pertes du mois (pour les totaux) — pas de limite.
    supabase
      .from("stock_movements")
      .select(LOSS_COLS)
      .eq("restaurant_id", restaurant!.id)
      .eq("movement_type", "loss")
      .gte("created_at", monthStart)
      .order("created_at", { ascending: false }),
    // Historique récent (pour le tableau).
    supabase
      .from("stock_movements")
      .select(LOSS_COLS)
      .eq("restaurant_id", restaurant!.id)
      .eq("movement_type", "loss")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  return (
    <PertesClient
      restaurantId={restaurant!.id}
      ingredients={(ingredients ?? []) as any}
      recentLosses={(recentLosses ?? []) as any}
      monthLosses={(monthLosses ?? []) as any}
    />
  );
}
