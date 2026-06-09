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

  return (
    <SettingsClient
      restaurant={restaurant}
      email={user!.email!}
      initialTags={tags ?? []}
    />
  );
}
