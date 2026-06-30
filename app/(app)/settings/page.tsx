import { createClient } from "@/lib/supabase/server";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user!.id)
    .single();

  const { data: tags } = await supabase
    .from("tags")
    .select("*")
    .eq("restaurant_id", restaurant!.id)
    .order("name");

  // Membres d'équipe (table restaurant_members). Si la migration n'a pas
  // encore été lancée, la requête échoue silencieusement → liste vide.
  const { data: members } = await supabase
    .from("restaurant_members")
    .select("*")
    .eq("restaurant_id", restaurant!.id)
    .order("created_at");

  return (
    <SettingsClient
      restaurant={restaurant}
      email={user!.email!}
      initialTags={tags ?? []}
      initialMembers={members ?? []}
    />
  );
}
