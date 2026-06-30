import { createClient } from "@/lib/supabase/server";
import NewOrderClient from "./NewOrderClient";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, name")
    .eq("owner_id", user!.id)
    .single();

  const [{ data: suppliers }, { data: ingredients }] = await Promise.all([
    supabase.from("suppliers").select("id, name, email, min_order_amount, customer_reference").eq("restaurant_id", restaurant!.id).order("name"),
    supabase.from("ingredients")
      .select("id, name, unit, pack_price, pack_units, unit_size, pack_quantity, supplier_id, supplier_reference, ingredient_suppliers(supplier_id, supplier_reference, pack_units, unit_size, unit, pack_price, pack_label, pack_type)")
      .eq("restaurant_id", restaurant!.id).order("name"),
  ]);

  return (
    <NewOrderClient
      restaurantId={restaurant!.id}
      suppliers={(suppliers ?? []) as any}
      ingredients={(ingredients ?? []) as any}
    />
  );
}
