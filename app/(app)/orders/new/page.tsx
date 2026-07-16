import { createClient } from "@/lib/supabase/server";
import NewOrderClient from "./NewOrderClient";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, name, hide_po_prices")
    .eq("owner_id", user!.id)
    .single();

  const [{ data: suppliers }, { data: ingredients }] = await Promise.all([
    supabase.from("suppliers").select("*").eq("restaurant_id", restaurant!.id).order("name"),
    supabase.from("ingredients")
      .select("id, name, unit, category, pack_price, pack_units, unit_size, pack_quantity, supplier_id, supplier_reference, secondary_unit_label, secondary_unit_size, ingredient_suppliers(*)")
      .eq("restaurant_id", restaurant!.id).order("name"),
  ]);

  return (
    <NewOrderClient
      restaurantId={restaurant!.id}
      restaurantName={restaurant!.name}
      suppliers={(suppliers ?? []) as any}
      ingredients={(ingredients ?? []) as any}
      hidePrices={!!(restaurant as any)?.hide_po_prices}
    />
  );
}
