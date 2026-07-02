import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import ReceiveClient from "./ReceiveClient";

export default async function ReceivePage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id")
    .eq("owner_id", user!.id)
    .single();

  const [{ data: po }, { data: allIngredients }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, suppliers(name, email), purchase_order_lines(*, ingredients(id, name, unit, pack_price, cost_per_base_unit, pack_quantity))")
      .eq("id", params.id)
      .eq("restaurant_id", restaurant!.id)
      .single(),
    supabase
      .from("ingredients")
      .select("id, name, unit, pack_price, pack_quantity")
      .eq("restaurant_id", restaurant!.id)
      .order("name"),
  ]);

  if (!po) return notFound();

  return <ReceiveClient po={po} restaurantId={restaurant!.id} allIngredients={allIngredients ?? []} />;
}
