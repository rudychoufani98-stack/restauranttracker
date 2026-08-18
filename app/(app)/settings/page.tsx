import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getRestaurant } from "@/lib/auth";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const supabase = createClient();
  const user = await getCurrentUser();
  const restaurant = await getRestaurant();

  // Membres d'équipe (table restaurant_members). Si la migration n'a pas
  // encore été lancée, la requête échoue silencieusement → liste vide.
  // (Les tags sont gérés dans /categories, pas ici.)
  const { data: members } = await supabase
    .from("restaurant_members")
    .select("*")
    .eq("restaurant_id", restaurant!.id)
    .order("created_at");

  return (
    <SettingsClient
      restaurant={restaurant}
      email={user!.email!}
      initialMembers={members ?? []}
    />
  );
}
