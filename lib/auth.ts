import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

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

export const getRestaurant = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createClient();
  const { data } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user.id)
    .single();
  return data;
});
