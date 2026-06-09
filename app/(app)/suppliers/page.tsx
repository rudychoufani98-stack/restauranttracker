import { createClient } from "@/lib/supabase/server";
import SuppliersClient from "./SuppliersClient";

export default async function SuppliersPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_id", user!.id)
    .single();

  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("*")
    .eq("restaurant_id", restaurant!.id)
    .order("name");

  return (
    <SuppliersClient
      restaurantId={restaurant!.id}
      initialSuppliers={suppliers ?? []}
    />
  );
}
