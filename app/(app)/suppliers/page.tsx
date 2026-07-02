import { createClient } from "@/lib/supabase/server";
import { getRestaurant } from "@/lib/auth";
import SuppliersClient from "./SuppliersClient";

export default async function SuppliersPage() {
  const supabase = createClient();
  const restaurant = await getRestaurant();

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
