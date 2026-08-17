import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Cookie posé quand le super-admin "ouvre" l'interface d'un client.
export const ADMIN_RESTAURANT_COOKIE = "admin-restaurant-id";

/**
 * Request-scoped cached auth + restaurant lookups.
 *
 * React's `cache()` dedupes calls within a single server render pass, so the
 * layout and the page (which both need the current user and restaurant) share
 * ONE `getUser()` network round-trip and ONE restaurant query per navigation
 * instead of doing them twice each.
 */

export const getCurrentUser = cache(async () => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

// Le user courant est-il super-admin ? (table app_admins — RLS : chacun ne
// voit que sa propre ligne, donc cette requête ne fuit rien.)
export const isAppAdmin = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = createClient();
  const { data } = await supabase
    .from("app_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return !!data;
});

export const getRestaurant = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createClient();

  // Super-admin ayant "ouvert" un client : toute l'app bascule sur ce
  // restaurant (la RLS autorise l'admin ; pour tout autre user le cookie
  // est ignoré et la requête ne renverrait rien de toute façon).
  const adminTarget = cookies().get(ADMIN_RESTAURANT_COOKIE)?.value;
  if (adminTarget && (await isAppAdmin())) {
    const { data } = await supabase
      .from("restaurants")
      .select("*")
      .eq("id", adminTarget)
      .maybeSingle();
    if (data) return data;
  }

  const { data } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user.id)
    .single();
  return data;
});
